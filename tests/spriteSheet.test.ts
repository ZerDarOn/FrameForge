import assert from "node:assert/strict";
import test from "node:test";
import { createSpriteSheetSlices } from "../src/core/spriteSheet.ts";

test("sprite sheet slices are row-major and ignore incomplete edge cells", () => {
  const slices = createSpriteSheetSlices({
    sheetWidth: 35,
    sheetHeight: 18,
    cellWidth: 16,
    cellHeight: 8,
    offsetX: 1,
    offsetY: 1,
    spacingX: 1,
    spacingY: 1,
  });

  assert.deepEqual(slices.map(({ index, x, y }) => ({ index, x, y })), [
    { index: 0, x: 1, y: 1 },
    { index: 1, x: 18, y: 1 },
    { index: 2, x: 1, y: 10 },
    { index: 3, x: 18, y: 10 },
  ]);
  assert.ok(slices.every((slice) => slice.width === 16 && slice.height === 8));
});

test("sprite sheet frame count limits the row-major plan", () => {
  const slices = createSpriteSheetSlices({
    sheetWidth: 64,
    sheetHeight: 32,
    cellWidth: 16,
    cellHeight: 16,
    offsetX: 0,
    offsetY: 0,
    spacingX: 0,
    spacingY: 0,
    frameCount: 5,
  });

  assert.equal(slices.length, 5);
  assert.deepEqual(slices[4], { index: 4, x: 0, y: 16, width: 16, height: 16 });
});

test("sprite sheet plan rejects invalid geometry and excessive counts", () => {
  const base = {
    sheetWidth: 64,
    sheetHeight: 64,
    cellWidth: 16,
    cellHeight: 16,
    offsetX: 0,
    offsetY: 0,
    spacingX: 0,
    spacingY: 0,
  };

  assert.throws(() => createSpriteSheetSlices({ ...base, cellWidth: 0 }), /positive integer/);
  assert.throws(() => createSpriteSheetSlices({ ...base, offsetX: -1 }), /non-negative integer/);
  assert.throws(() => createSpriteSheetSlices({ ...base, frameCount: 17 }), /available cells/);
  assert.throws(
    () => createSpriteSheetSlices({ ...base, sheetWidth: 2000, sheetHeight: 2000, cellWidth: 1, cellHeight: 1 }),
    /10,000/,
  );
});
