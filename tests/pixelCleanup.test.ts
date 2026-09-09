import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzePixelPalette,
  applyPixelPalette,
  reducePixelImagesPalette,
  reducePixelPalette,
  removeColorAsTransparency,
  suggestPixelBackgroundColor,
} from "../src/core/pixelCleanup.ts";
import type { PixelImage, RgbaColor } from "../src/types/pixelImage.ts";

function image(width: number, height: number, pixels: number[]): PixelImage {
  return { width, height, data: new Uint8ClampedArray(pixels) };
}

test("palette analysis ignores transparent pixels and sorts colors by usage", () => {
  const source = image(4, 1, [
    255, 0, 0, 255,
    0, 0, 255, 255,
    255, 0, 0, 255,
    10, 20, 30, 0,
  ]);

  const result = analyzePixelPalette(source, 8);

  assert.equal(result.opaquePixels, 3);
  assert.equal(result.transparentPixels, 1);
  assert.equal(result.uniqueColorCount, 2);
  assert.deepEqual(result.colors, [
    { color: [255, 0, 0, 255], count: 2 },
    { color: [0, 0, 255, 255], count: 1 },
  ]);
});

test("background transparency is immutable and clears exact matches", () => {
  const source = image(3, 1, [
    20, 30, 40, 255,
    21, 30, 40, 255,
    20, 30, 40, 0,
  ]);

  const result = removeColorAsTransparency(source, [20, 30, 40, 255], 0);

  assert.equal(result.changedPixels, 1);
  assert.deepEqual([...source.data], [
    20, 30, 40, 255,
    21, 30, 40, 255,
    20, 30, 40, 0,
  ]);
  assert.deepEqual([...result.image.data], [
    0, 0, 0, 0,
    21, 30, 40, 255,
    20, 30, 40, 0,
  ]);
});

test("background transparency uses bounded per-channel tolerance", () => {
  const source = image(2, 1, [
    110, 95, 100, 255,
    111, 95, 100, 255,
  ]);

  assert.equal(removeColorAsTransparency(source, [100, 100, 100, 255], 10).changedPixels, 1);
  assert.throws(
    () => removeColorAsTransparency(source, [100, 100, 100, 255], 256),
    /tolerance/,
  );
  assert.throws(() => analyzePixelPalette(source, 0), /maxColors/);
});

test("background suggestion uses opaque edge coverage and ignores interior pixels", () => {
  const source = image(3, 3, [
    255, 0, 0, 255,
    255, 0, 0, 255,
    0, 0, 255, 255,
    255, 0, 0, 255,
    0, 255, 0, 255,
    0, 0, 255, 255,
    255, 0, 0, 255,
    255, 0, 0, 128,
    255, 0, 0, 255,
  ]);

  assert.deepEqual(suggestPixelBackgroundColor(source), {
    color: [255, 0, 0, 255],
    matchedEdgePixels: 6,
    opaqueEdgePixels: 8,
    confidence: 0.75,
    recommendedTolerance: 0,
  });
});

test("background suggestion is deterministic and rejects fully transparent edges", () => {
  const tied = image(2, 1, [255, 0, 0, 255, 0, 0, 255, 200]);
  const transparent = image(2, 2, [
    10, 20, 30, 0,
    40, 50, 60, 0,
    70, 80, 90, 0,
    100, 110, 120, 0,
  ]);

  assert.deepEqual(suggestPixelBackgroundColor(tied), {
    color: [0, 0, 255, 255],
    matchedEdgePixels: 1,
    opaqueEdgePixels: 2,
    confidence: 0.5,
    recommendedTolerance: 0,
  });
  assert.equal(suggestPixelBackgroundColor(transparent), null);
});

test("background suggestion groups nearby edge shades into bounded RGB buckets", () => {
  const source = image(3, 1, [
    248, 16, 16, 255,
    249, 17, 17, 255,
    0, 0, 255, 255,
  ]);

  assert.deepEqual(suggestPixelBackgroundColor(source), {
    color: [249, 17, 17, 255],
    matchedEdgePixels: 2,
    opaqueEdgePixels: 3,
    confidence: 2 / 3,
    recommendedTolerance: 1,
  });
});

test("palette reduction deterministically groups colors and preserves alpha", () => {
  const source = image(5, 1, [
    0, 0, 0, 255,
    64, 64, 64, 128,
    192, 192, 192, 255,
    255, 255, 255, 64,
    123, 45, 67, 0,
  ]);

  const result = reducePixelPalette(source, 2);

  assert.deepEqual(result.palette, [
    [32, 32, 32, 255],
    [224, 224, 224, 255],
  ]);
  assert.equal(result.changedPixels, 4);
  assert.deepEqual([...result.image.data], [
    32, 32, 32, 255,
    32, 32, 32, 128,
    224, 224, 224, 255,
    224, 224, 224, 64,
    123, 45, 67, 0,
  ]);
  assert.deepEqual([...source.data], [
    0, 0, 0, 255,
    64, 64, 64, 128,
    192, 192, 192, 255,
    255, 255, 255, 64,
    123, 45, 67, 0,
  ]);
});

test("palette reduction is a no-op when the requested palette already fits", () => {
  const source = image(2, 1, [255, 0, 0, 255, 0, 0, 255, 100]);

  const result = reducePixelPalette(source, 2);

  assert.equal(result.image, source);
  assert.equal(result.changedPixels, 0);
  assert.deepEqual(result.palette, [
    [0, 0, 255, 255],
    [255, 0, 0, 255],
  ]);
  assert.throws(() => reducePixelPalette(source, 1), /maxColors/);
  assert.throws(() => reducePixelPalette(source, 33), /maxColors/);
});

test("multiple images use one shared reduced palette", () => {
  const first = image(2, 1, [0, 0, 0, 255, 64, 64, 64, 128]);
  const second = image(3, 1, [
    192, 192, 192, 255,
    255, 255, 255, 64,
    20, 40, 60, 0,
  ]);

  const result = reducePixelImagesPalette([first, second], 2);

  assert.deepEqual(result.palette, [
    [32, 32, 32, 255],
    [224, 224, 224, 255],
  ]);
  assert.deepEqual(result.changedPixels, [2, 2]);
  assert.equal(result.totalChangedPixels, 4);
  assert.deepEqual([...result.images[0].data], [32, 32, 32, 255, 32, 32, 32, 128]);
  assert.deepEqual([...result.images[1].data], [
    224, 224, 224, 255,
    224, 224, 224, 64,
    20, 40, 60, 0,
  ]);
  assert.deepEqual([...first.data], [0, 0, 0, 255, 64, 64, 64, 128]);
  assert.throws(() => reducePixelImagesPalette([], 2), /at least one image/);
});

test("applying a fixed palette preserves exact colors that share one RGB bucket", () => {
  const source = image(2, 1, [1, 1, 1, 255, 2, 2, 2, 128]);

  const result = applyPixelPalette(source, [
    [1, 1, 1, 255],
    [2, 2, 2, 255],
  ]);

  assert.equal(result.image, source);
  assert.equal(result.changedPixels, 0);
});

test("ordered palette dithering is deterministic and preserves alpha", () => {
  const source = image(4, 2, [
    128, 128, 128, 255,
    128, 128, 128, 128,
    9, 8, 7, 0,
    128, 128, 128, 64,
    128, 128, 128, 32,
    128, 128, 128, 255,
    128, 128, 128, 128,
    128, 128, 128, 64,
  ]);
  const palette = [
    [0, 0, 0, 255],
    [255, 255, 255, 255],
  ] satisfies RgbaColor[];

  const result = applyPixelPalette(source, palette, { ditherStrength: 64 });

  assert.equal(result.changedPixels, 7);
  assert.deepEqual([...result.image.data], [
    0, 0, 0, 255,
    255, 255, 255, 128,
    9, 8, 7, 0,
    255, 255, 255, 64,
    255, 255, 255, 32,
    0, 0, 0, 255,
    255, 255, 255, 128,
    0, 0, 0, 64,
  ]);
  assert.deepEqual([...source.data], [
    128, 128, 128, 255,
    128, 128, 128, 128,
    9, 8, 7, 0,
    128, 128, 128, 64,
    128, 128, 128, 32,
    128, 128, 128, 255,
    128, 128, 128, 128,
    128, 128, 128, 64,
  ]);
});

test("palette dithering defaults off and validates its strength", () => {
  const source = image(1, 1, [128, 128, 128, 200]);
  const palette = [
    [0, 0, 0, 255],
    [255, 255, 255, 255],
  ] satisfies RgbaColor[];

  assert.deepEqual(
    [...applyPixelPalette(source, palette).image.data],
    [...applyPixelPalette(source, palette, { ditherStrength: 0 }).image.data],
  );
  assert.throws(
    () => applyPixelPalette(source, palette, { ditherStrength: -1 }),
    /ditherStrength/,
  );
  assert.throws(
    () => applyPixelPalette(source, palette, { ditherStrength: 65 }),
    /ditherStrength/,
  );
  assert.throws(
    () => applyPixelPalette(source, palette, { ditherStrength: 1.5 }),
    /ditherStrength/,
  );
  assert.throws(
    () => reducePixelPalette(source, 2, { ditherStrength: 65 }),
    /ditherStrength/,
  );
});
