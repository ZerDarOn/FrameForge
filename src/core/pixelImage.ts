import type {
  PixelClipboard,
  PixelImage,
  PixelPoint,
  PixelSelection,
  RgbaColor,
} from "../types/pixelImage.ts";

function assertImage(image: PixelImage) {
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

function clampChannel(channel: number) {
  return Math.max(0, Math.min(255, Math.round(channel)));
}

function inBounds(image: PixelImage, x: number, y: number) {
  return x >= 0 && y >= 0 && x < image.width && y < image.height;
}

function offset(image: PixelImage, x: number, y: number) {
  return (y * image.width + x) * 4;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function normalizeSelection(image: PixelImage, selection: PixelSelection): PixelSelection {
  if (
    !Number.isInteger(selection.x) ||
    !Number.isInteger(selection.y) ||
    !Number.isInteger(selection.width) ||
    !Number.isInteger(selection.height) ||
    selection.width <= 0 ||
    selection.height <= 0
  ) {
    throw new Error("Invalid pixel selection");
  }
  const left = clamp(selection.x, 0, image.width);
  const top = clamp(selection.y, 0, image.height);
  const right = clamp(selection.x + selection.width, 0, image.width);
  const bottom = clamp(selection.y + selection.height, 0, image.height);
  if (right <= left || bottom <= top) throw new Error("Pixel selection is outside the image");
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function writeClipboard(
  data: Uint8ClampedArray,
  imageWidth: number,
  clipboard: PixelClipboard,
  destination: PixelPoint,
) {
  for (let y = 0; y < clipboard.height; y += 1) {
    for (let x = 0; x < clipboard.width; x += 1) {
      const sourceIndex = (y * clipboard.width + x) * 4;
      const destinationIndex = ((destination.y + y) * imageWidth + destination.x + x) * 4;
      data.set(clipboard.data.subarray(sourceIndex, sourceIndex + 4), destinationIndex);
    }
  }
}

function writePixel(data: Uint8ClampedArray, index: number, color: RgbaColor) {
  data[index] = clampChannel(color[0]);
  data[index + 1] = clampChannel(color[1]);
  data[index + 2] = clampChannel(color[2]);
  data[index + 3] = clampChannel(color[3]);
}

function sameColor(data: Uint8ClampedArray, index: number, color: RgbaColor) {
  return (
    data[index] === color[0] &&
    data[index + 1] === color[1] &&
    data[index + 2] === color[2] &&
    data[index + 3] === color[3]
  );
}

export function readPixel(image: PixelImage, point: PixelPoint): RgbaColor | null {
  assertImage(image);
  const x = Math.floor(point.x);
  const y = Math.floor(point.y);
  if (!inBounds(image, x, y)) return null;
  const index = offset(image, x, y);
  return [
    image.data[index],
    image.data[index + 1],
    image.data[index + 2],
    image.data[index + 3],
  ];
}

export function drawPixelLine(
  image: PixelImage,
  start: PixelPoint,
  end: PixelPoint,
  color: RgbaColor,
): PixelImage {
  assertImage(image);
  const data = new Uint8ClampedArray(image.data);
  const result = { ...image, data };
  drawPixelLineMutable(result, start, end, color);
  return result;
}

/**
 * Mutates one stroke working buffer. Callers must clone the source data once at
 * pointer-down; this avoids copying the entire bitmap on every pointer move.
 */
export function drawPixelLineMutable(
  image: PixelImage,
  start: PixelPoint,
  end: PixelPoint,
  color: RgbaColor,
) {
  assertImage(image);
  const data = image.data;
  let x0 = Math.floor(start.x);
  let y0 = Math.floor(start.y);
  const x1 = Math.floor(end.x);
  const y1 = Math.floor(end.y);
  const dx = Math.abs(x1 - x0);
  const stepX = x0 < x1 ? 1 : -1;
  const dy = -Math.abs(y1 - y0);
  const stepY = y0 < y1 ? 1 : -1;
  let error = dx + dy;

  while (true) {
    if (inBounds(image, x0, y0)) writePixel(data, offset(image, x0, y0), color);
    if (x0 === x1 && y0 === y1) break;
    const doubled = error * 2;
    if (doubled >= dy) {
      error += dy;
      x0 += stepX;
    }
    if (doubled <= dx) {
      error += dx;
      y0 += stepY;
    }
  }
}

export function floodFill(
  image: PixelImage,
  start: PixelPoint,
  replacement: RgbaColor,
): PixelImage {
  assertImage(image);
  const startX = Math.floor(start.x);
  const startY = Math.floor(start.y);
  if (!inBounds(image, startX, startY)) return image;
  const data = new Uint8ClampedArray(image.data);
  const startIndex = offset(image, startX, startY);
  const target: RgbaColor = [
    data[startIndex],
    data[startIndex + 1],
    data[startIndex + 2],
    data[startIndex + 3],
  ];
  if (sameColor(data, startIndex, replacement)) return image;

  const stack = [startX, startY];
  while (stack.length > 0) {
    const y = stack.pop()!;
    let x = stack.pop()!;
    while (x >= 0 && sameColor(data, offset(image, x, y), target)) x -= 1;
    x += 1;
    let spansUp = false;
    let spansDown = false;
    for (; x < image.width && sameColor(data, offset(image, x, y), target); x += 1) {
      writePixel(data, offset(image, x, y), replacement);
      if (y > 0) {
        const matchesUp = sameColor(data, offset(image, x, y - 1), target);
        if (matchesUp && !spansUp) stack.push(x, y - 1);
        spansUp = matchesUp;
      }
      if (y + 1 < image.height) {
        const matchesDown = sameColor(data, offset(image, x, y + 1), target);
        if (matchesDown && !spansDown) stack.push(x, y + 1);
        spansDown = matchesDown;
      }
    }
  }
  return { ...image, data };
}

export function createPixelSelection(
  image: PixelImage,
  start: PixelPoint,
  end: PixelPoint,
): PixelSelection {
  assertImage(image);
  if (![start.x, start.y, end.x, end.y].every(Number.isFinite)) {
    throw new Error("Invalid pixel selection point");
  }
  const startX = clamp(Math.floor(start.x), 0, image.width - 1);
  const startY = clamp(Math.floor(start.y), 0, image.height - 1);
  const endX = clamp(Math.floor(end.x), 0, image.width - 1);
  const endY = clamp(Math.floor(end.y), 0, image.height - 1);
  const x = Math.min(startX, endX);
  const y = Math.min(startY, endY);
  return {
    x,
    y,
    width: Math.max(startX, endX) - x + 1,
    height: Math.max(startY, endY) - y + 1,
  };
}

export function copyPixelSelection(
  image: PixelImage,
  selection: PixelSelection,
): PixelClipboard {
  assertImage(image);
  const normalized = normalizeSelection(image, selection);
  const data = new Uint8ClampedArray(normalized.width * normalized.height * 4);
  for (let y = 0; y < normalized.height; y += 1) {
    const sourceStart = offset(image, normalized.x, normalized.y + y);
    const sourceEnd = sourceStart + normalized.width * 4;
    data.set(image.data.subarray(sourceStart, sourceEnd), y * normalized.width * 4);
  }
  return { width: normalized.width, height: normalized.height, data };
}

export function pastePixelSelection(
  image: PixelImage,
  clipboard: PixelClipboard,
  destination: PixelPoint,
): { image: PixelImage; selection: PixelSelection } {
  assertImage(image);
  assertImage(clipboard);
  if (!Number.isFinite(destination.x) || !Number.isFinite(destination.y)) {
    throw new Error("Invalid pixel paste destination");
  }
  const x = clamp(Math.floor(destination.x), 0, Math.max(0, image.width - clipboard.width));
  const y = clamp(Math.floor(destination.y), 0, Math.max(0, image.height - clipboard.height));
  const width = Math.min(clipboard.width, image.width);
  const height = Math.min(clipboard.height, image.height);
  const clippedClipboard =
    width === clipboard.width && height === clipboard.height
      ? clipboard
      : copyPixelSelection(clipboard, { x: 0, y: 0, width, height });
  const data = new Uint8ClampedArray(image.data);
  writeClipboard(data, image.width, clippedClipboard, { x, y });
  return {
    image: { ...image, data },
    selection: { x, y, width, height },
  };
}

export function movePixelSelection(
  image: PixelImage,
  selection: PixelSelection,
  deltaX: number,
  deltaY: number,
): { image: PixelImage; selection: PixelSelection } {
  assertImage(image);
  const normalized = normalizeSelection(image, selection);
  if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY)) {
    throw new Error("Invalid pixel selection movement");
  }
  const x = clamp(
    normalized.x + Math.trunc(deltaX),
    0,
    image.width - normalized.width,
  );
  const y = clamp(
    normalized.y + Math.trunc(deltaY),
    0,
    image.height - normalized.height,
  );
  if (x === normalized.x && y === normalized.y) {
    return { image, selection: normalized };
  }

  const clipboard = copyPixelSelection(image, normalized);
  const data = new Uint8ClampedArray(image.data);
  for (let sourceY = normalized.y; sourceY < normalized.y + normalized.height; sourceY += 1) {
    const rowStart = offset(image, normalized.x, sourceY);
    data.fill(0, rowStart, rowStart + normalized.width * 4);
  }
  writeClipboard(data, image.width, clipboard, { x, y });
  return {
    image: { ...image, data },
    selection: { ...normalized, x, y },
  };
}
