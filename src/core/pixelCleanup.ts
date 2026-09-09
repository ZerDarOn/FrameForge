import type { PixelImage, RgbaColor } from "../types/pixelImage.ts";

const MAX_PALETTE_COLORS = 64;
const MAX_REDUCED_PALETTE_COLORS = 32;
const MAX_TRACKED_UNIQUE_COLORS = 65_536;
const MAX_DITHER_STRENGTH = 64;
const BAYER_MATRIX_SIZE = 4;
const BAYER_MATRIX = [
  0, 8, 2, 10,
  12, 4, 14, 6,
  3, 11, 1, 9,
  15, 7, 13, 5,
] as const;

export interface PixelPaletteEntry {
  color: RgbaColor;
  count: number;
}

export interface PixelPaletteAnalysis {
  colors: PixelPaletteEntry[];
  opaquePixels: number;
  transparentPixels: number;
  uniqueColorCount: number | null;
}

export interface TransparencyCleanupResult {
  image: PixelImage;
  changedPixels: number;
}

export interface PaletteReductionResult extends TransparencyCleanupResult {
  palette: RgbaColor[];
}

export interface SharedPaletteReductionResult {
  images: PixelImage[];
  changedPixels: number[];
  totalChangedPixels: number;
  palette: RgbaColor[];
}

export interface PixelPaletteApplicationOptions {
  ditherStrength?: number;
}

interface ColorSample {
  key: number;
  red: number;
  green: number;
  blue: number;
  redSum: number;
  greenSum: number;
  blueSum: number;
  count: number;
}

function assertPixelImage(image: PixelImage) {
  if (
    !Number.isInteger(image.width) ||
    !Number.isInteger(image.height) ||
    image.width <= 0 ||
    image.height <= 0 ||
    image.data.length !== image.width * image.height * 4
  ) {
    throw new Error("Invalid pixel image");
  }
}

function assertColor(color: RgbaColor) {
  if (
    color.length !== 4 ||
    color.some((channel) => !Number.isInteger(channel) || channel < 0 || channel > 255)
  ) {
    throw new Error("Invalid RGBA color");
  }
}

function colorKey(red: number, green: number, blue: number, alpha: number) {
  return (((red << 24) | (green << 16) | (blue << 8) | alpha) >>> 0);
}

function colorFromKey(key: number): RgbaColor {
  return [
    (key >>> 24) & 0xff,
    (key >>> 16) & 0xff,
    (key >>> 8) & 0xff,
    key & 0xff,
  ];
}

function rgbKey(red: number, green: number, blue: number) {
  return (red << 16) | (green << 8) | blue;
}

function assertDitherStrength(ditherStrength: number) {
  if (
    !Number.isInteger(ditherStrength) ||
    ditherStrength < 0 ||
    ditherStrength > MAX_DITHER_STRENGTH
  ) {
    throw new Error(
      `ditherStrength must be an integer between 0 and ${MAX_DITHER_STRENGTH}`,
    );
  }
}

function clampColorChannel(channel: number) {
  return Math.max(0, Math.min(255, channel));
}

function sampleChannel(sample: ColorSample, channel: 0 | 1 | 2) {
  return channel === 0 ? sample.red : channel === 1 ? sample.green : sample.blue;
}

function splitColorBoxes(samples: ColorSample[], maxColors: number) {
  const boxes = [samples];
  while (boxes.length < maxColors) {
    let selectedIndex = -1;
    let selectedRange = -1;
    let selectedPopulation = -1;
    let selectedChannel: 0 | 1 | 2 = 0;

    for (let boxIndex = 0; boxIndex < boxes.length; boxIndex += 1) {
      const box = boxes[boxIndex];
      if (box.length < 2) continue;
      const ranges = ([0, 1, 2] as const).map((channel) => {
        const values = box.map((sample) => sampleChannel(sample, channel));
        return Math.max(...values) - Math.min(...values);
      });
      const range = Math.max(...ranges);
      const channel = ranges.indexOf(range) as 0 | 1 | 2;
      const population = box.reduce((sum, sample) => sum + sample.count, 0);
      if (
        range > selectedRange ||
        (range === selectedRange && population > selectedPopulation)
      ) {
        selectedIndex = boxIndex;
        selectedRange = range;
        selectedPopulation = population;
        selectedChannel = channel;
      }
    }

    if (selectedIndex < 0) break;
    const selected = [...boxes[selectedIndex]].sort(
      (left, right) =>
        sampleChannel(left, selectedChannel) - sampleChannel(right, selectedChannel) ||
        left.key - right.key,
    );
    const total = selected.reduce((sum, sample) => sum + sample.count, 0);
    let splitIndex = 1;
    let cumulative = selected[0].count;
    while (
      splitIndex < selected.length - 1 &&
      cumulative + selected[splitIndex].count <= total / 2
    ) {
      cumulative += selected[splitIndex].count;
      splitIndex += 1;
    }
    boxes.splice(selectedIndex, 1, selected.slice(0, splitIndex), selected.slice(splitIndex));
  }
  return boxes;
}

export function analyzePixelPalette(
  image: PixelImage,
  maxColors: number,
): PixelPaletteAnalysis {
  assertPixelImage(image);
  if (!Number.isInteger(maxColors) || maxColors < 1 || maxColors > MAX_PALETTE_COLORS) {
    throw new Error(`maxColors must be an integer between 1 and ${MAX_PALETTE_COLORS}`);
  }

  const counts = new Map<number, number>();
  let opaquePixels = 0;
  let transparentPixels = 0;
  let uniqueColorCountKnown = true;
  for (let index = 0; index < image.data.length; index += 4) {
    const alpha = image.data[index + 3];
    if (alpha === 0) {
      transparentPixels += 1;
      continue;
    }
    opaquePixels += 1;
    const key = colorKey(
      image.data[index],
      image.data[index + 1],
      image.data[index + 2],
      alpha,
    );
    const current = counts.get(key);
    if (current !== undefined) {
      counts.set(key, current + 1);
    } else if (counts.size < MAX_TRACKED_UNIQUE_COLORS) {
      counts.set(key, 1);
    } else {
      uniqueColorCountKnown = false;
    }
  }

  const colors = [...counts.entries()]
    .sort(([leftKey, leftCount], [rightKey, rightCount]) =>
      rightCount - leftCount || leftKey - rightKey,
    )
    .slice(0, maxColors)
    .map(([key, count]) => ({ color: colorFromKey(key), count }));

  return {
    colors,
    opaquePixels,
    transparentPixels,
    uniqueColorCount: uniqueColorCountKnown ? counts.size : null,
  };
}

export function removeColorAsTransparency(
  image: PixelImage,
  target: RgbaColor,
  tolerance: number,
): TransparencyCleanupResult {
  assertPixelImage(image);
  assertColor(target);
  if (!Number.isInteger(tolerance) || tolerance < 0 || tolerance > 255) {
    throw new Error("tolerance must be an integer between 0 and 255");
  }

  let data: Uint8ClampedArray | null = null;
  let changedPixels = 0;
  for (let index = 0; index < image.data.length; index += 4) {
    if (image.data[index + 3] === 0) continue;
    if (
      Math.abs(image.data[index] - target[0]) <= tolerance &&
      Math.abs(image.data[index + 1] - target[1]) <= tolerance &&
      Math.abs(image.data[index + 2] - target[2]) <= tolerance
    ) {
      data ??= new Uint8ClampedArray(image.data);
      data.fill(0, index, index + 4);
      changedPixels += 1;
    }
  }

  return {
    image: data ? { ...image, data } : image,
    changedPixels,
  };
}

function assertReducedPaletteSize(maxColors: number) {
  if (
    !Number.isInteger(maxColors) ||
    maxColors < 2 ||
    maxColors > MAX_REDUCED_PALETTE_COLORS
  ) {
    throw new Error(
      `maxColors must be an integer between 2 and ${MAX_REDUCED_PALETTE_COLORS}`,
    );
  }
}

function createPalettePlan(images: PixelImage[], maxColors: number) {
  const exactColors = new Set<number>();
  const buckets = new Map<number, ColorSample>();
  for (const image of images) {
    for (let index = 0; index < image.data.length; index += 4) {
      if (image.data[index + 3] === 0) continue;
      const red = image.data[index];
      const green = image.data[index + 1];
      const blue = image.data[index + 2];
      if (exactColors.size <= maxColors) exactColors.add(rgbKey(red, green, blue));

      const key = ((red >> 3) << 10) | ((green >> 3) << 5) | (blue >> 3);
      const bucket = buckets.get(key);
      if (bucket) {
        bucket.redSum += red;
        bucket.greenSum += green;
        bucket.blueSum += blue;
        bucket.count += 1;
        bucket.red = Math.round(bucket.redSum / bucket.count);
        bucket.green = Math.round(bucket.greenSum / bucket.count);
        bucket.blue = Math.round(bucket.blueSum / bucket.count);
      } else {
        buckets.set(key, {
          key,
          red,
          green,
          blue,
          redSum: red,
          greenSum: green,
          blueSum: blue,
          count: 1,
        });
      }
    }
  }

  if (exactColors.size <= maxColors) {
    return {
      palette: [...exactColors]
        .sort((left, right) => left - right)
        .map<RgbaColor>((key) => [
          (key >>> 16) & 0xff,
          (key >>> 8) & 0xff,
          key & 0xff,
          255,
        ]),
      requiresReduction: false,
    };
  }

  const palette = splitColorBoxes([...buckets.values()], maxColors)
    .map<RgbaColor>((box) => {
      const count = box.reduce((sum, sample) => sum + sample.count, 0);
      return [
        Math.round(box.reduce((sum, sample) => sum + sample.redSum, 0) / count),
        Math.round(box.reduce((sum, sample) => sum + sample.greenSum, 0) / count),
        Math.round(box.reduce((sum, sample) => sum + sample.blueSum, 0) / count),
        255,
      ];
    })
    .sort(
      (left, right) =>
        rgbKey(left[0], left[1], left[2]) - rgbKey(right[0], right[1], right[2]),
    )
    .filter(
      (color, index, colors) =>
        index === 0 ||
        rgbKey(color[0], color[1], color[2]) !==
          rgbKey(colors[index - 1][0], colors[index - 1][1], colors[index - 1][2]),
    );

  return { palette, requiresReduction: true };
}

export function applyPixelPalette(
  image: PixelImage,
  palette: RgbaColor[],
  options: PixelPaletteApplicationOptions = {},
) {
  assertPixelImage(image);
  if (palette.length < 1 || palette.length > MAX_REDUCED_PALETTE_COLORS) {
    throw new Error(`palette must contain between 1 and ${MAX_REDUCED_PALETTE_COLORS} colors`);
  }
  palette.forEach(assertColor);
  const ditherStrength = options.ditherStrength ?? 0;
  assertDitherStrength(ditherStrength);
  const paletteByExactRgb = new Map(
    palette.map((color) => [rgbKey(color[0], color[1], color[2]), color]),
  );
  const paletteByBucket = new Map<number, RgbaColor>();
  const data = new Uint8ClampedArray(image.data);
  let changedPixels = 0;
  for (let index = 0; index < data.length; index += 4) {
    if (data[index + 3] === 0) continue;
    const red = data[index];
    const green = data[index + 1];
    const blue = data[index + 2];
    const exactKey = rgbKey(red, green, blue);
    const key = ((red >> 3) << 10) | ((green >> 3) << 5) | (blue >> 3);
    const pixelIndex = index / 4;
    const x = pixelIndex % image.width;
    const y = Math.floor(pixelIndex / image.width);
    const ditherPhase =
      (y % BAYER_MATRIX_SIZE) * BAYER_MATRIX_SIZE + (x % BAYER_MATRIX_SIZE);
    const cacheKey = ditherStrength > 0 ? (ditherPhase << 15) | key : key;
    let closest = paletteByExactRgb.get(exactKey) ?? paletteByBucket.get(cacheKey);
    if (!closest) {
      const ditherOffset =
        ditherStrength > 0
          ? ((BAYER_MATRIX[ditherPhase] - 7.5) / 16) * ditherStrength
          : 0;
      const bucketRed = clampColorChannel(((key >>> 10) & 0x1f) * 8 + 3.5 + ditherOffset);
      const bucketGreen = clampColorChannel(((key >>> 5) & 0x1f) * 8 + 3.5 + ditherOffset);
      const bucketBlue = clampColorChannel((key & 0x1f) * 8 + 3.5 + ditherOffset);
      let closestDistance = Number.POSITIVE_INFINITY;
      for (const candidate of palette) {
        const distance =
          (bucketRed - candidate[0]) ** 2 +
          (bucketGreen - candidate[1]) ** 2 +
          (bucketBlue - candidate[2]) ** 2;
        if (distance < closestDistance) {
          closest = candidate;
          closestDistance = distance;
        }
      }
      if (!closest) throw new Error("Palette is empty");
      paletteByBucket.set(cacheKey, closest);
    }
    if (red !== closest[0] || green !== closest[1] || blue !== closest[2]) {
      data[index] = closest[0];
      data[index + 1] = closest[1];
      data[index + 2] = closest[2];
      changedPixels += 1;
    }
  }

  return {
    image: changedPixels > 0 ? { ...image, data } : image,
    changedPixels,
  };
}

export function reducePixelImagesPalette(
  images: PixelImage[],
  maxColors: number,
  options: PixelPaletteApplicationOptions = {},
): SharedPaletteReductionResult {
  if (images.length === 0) throw new Error("at least one image is required");
  assertReducedPaletteSize(maxColors);
  images.forEach(assertPixelImage);
  assertDitherStrength(options.ditherStrength ?? 0);
  const plan = createPalettePlan(images, maxColors);
  if (!plan.requiresReduction) {
    return {
      images,
      changedPixels: images.map(() => 0),
      totalChangedPixels: 0,
      palette: plan.palette,
    };
  }
  const reduced = images.map((image) => applyPixelPalette(image, plan.palette, options));
  const changedPixels = reduced.map((result) => result.changedPixels);
  return {
    images: reduced.map((result) => result.image),
    changedPixels,
    totalChangedPixels: changedPixels.reduce((sum, count) => sum + count, 0),
    palette: plan.palette,
  };
}

export function reducePixelPalette(
  image: PixelImage,
  maxColors: number,
  options: PixelPaletteApplicationOptions = {},
): PaletteReductionResult {
  const reduced = reducePixelImagesPalette([image], maxColors, options);
  return {
    image: reduced.images[0],
    changedPixels: reduced.changedPixels[0],
    palette: reduced.palette,
  };
}
