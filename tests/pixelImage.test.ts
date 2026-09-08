import assert from "node:assert/strict";
import test from "node:test";
import {
  copyPixelSelection,
  createPixelSelection,
  drawPixelLine,
  floodFill,
  movePixelSelection,
  pastePixelSelection,
  readPixel,
} from "../src/core/pixelImage.ts";
import type { PixelImage } from "../src/types/pixelImage.ts";

function transparentImage(width: number, height: number): PixelImage {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

test("pencil draws an integer Bresenham line without mutating the source", () => {
  const source = transparentImage(4, 4);
  const result = drawPixelLine(source, { x: 0, y: 0 }, { x: 3, y: 3 }, [255, 0, 0, 255]);

  assert.deepEqual(readPixel(source, { x: 0, y: 0 }), [0, 0, 0, 0]);
  assert.deepEqual(readPixel(result, { x: 0, y: 0 }), [255, 0, 0, 255]);
  assert.deepEqual(readPixel(result, { x: 2, y: 2 }), [255, 0, 0, 255]);
  assert.deepEqual(readPixel(result, { x: 3, y: 0 }), [0, 0, 0, 0]);
});

test("eraser is a transparent pencil color", () => {
  const opaque = floodFill(transparentImage(2, 2), { x: 0, y: 0 }, [20, 30, 40, 255]);
  const erased = drawPixelLine(opaque, { x: 1, y: 1 }, { x: 1, y: 1 }, [0, 0, 0, 0]);

  assert.deepEqual(readPixel(erased, { x: 1, y: 1 }), [0, 0, 0, 0]);
  assert.deepEqual(readPixel(erased, { x: 0, y: 0 }), [20, 30, 40, 255]);
});

test("fill respects four-connected color boundaries", () => {
  let image = transparentImage(3, 3);
  image = drawPixelLine(image, { x: 1, y: 0 }, { x: 1, y: 2 }, [255, 255, 255, 255]);
  const filled = floodFill(image, { x: 0, y: 1 }, [0, 0, 255, 255]);

  assert.deepEqual(readPixel(filled, { x: 0, y: 2 }), [0, 0, 255, 255]);
  assert.deepEqual(readPixel(filled, { x: 2, y: 1 }), [0, 0, 0, 0]);
  assert.deepEqual(readPixel(filled, { x: 1, y: 1 }), [255, 255, 255, 255]);
});

test("eyedropper returns null outside the image", () => {
  assert.equal(readPixel(transparentImage(1, 1), { x: -1, y: 0 }), null);
});

test("selection normalizes reverse drags and clips to image bounds", () => {
  assert.deepEqual(
    createPixelSelection(transparentImage(4, 3), { x: 3, y: 2 }, { x: -2, y: 1 }),
    { x: 0, y: 1, width: 4, height: 2 },
  );
});

test("copy and paste preserve transparent pixels as replacement data", () => {
  let source = transparentImage(3, 2);
  source = drawPixelLine(source, { x: 0, y: 0 }, { x: 0, y: 0 }, [255, 0, 0, 255]);
  source = drawPixelLine(source, { x: 2, y: 0 }, { x: 2, y: 1 }, [0, 255, 0, 255]);
  const clipboard = copyPixelSelection(source, { x: 0, y: 0, width: 2, height: 1 });
  const pasted = pastePixelSelection(source, clipboard, { x: 1, y: 1 });

  assert.deepEqual(readPixel(pasted.image, { x: 1, y: 1 }), [255, 0, 0, 255]);
  assert.deepEqual(readPixel(pasted.image, { x: 2, y: 1 }), [0, 0, 0, 0]);
  assert.deepEqual(pasted.selection, { x: 1, y: 1, width: 2, height: 1 });
});

test("moving an overlapping selection clears the source from a stable copy", () => {
  let source = transparentImage(4, 1);
  source = drawPixelLine(source, { x: 0, y: 0 }, { x: 0, y: 0 }, [10, 0, 0, 255]);
  source = drawPixelLine(source, { x: 1, y: 0 }, { x: 1, y: 0 }, [20, 0, 0, 255]);
  const moved = movePixelSelection(source, { x: 0, y: 0, width: 2, height: 1 }, 1, 0);

  assert.deepEqual(readPixel(moved.image, { x: 0, y: 0 }), [0, 0, 0, 0]);
  assert.deepEqual(readPixel(moved.image, { x: 1, y: 0 }), [10, 0, 0, 255]);
  assert.deepEqual(readPixel(moved.image, { x: 2, y: 0 }), [20, 0, 0, 255]);
  assert.deepEqual(moved.selection, { x: 1, y: 0, width: 2, height: 1 });
});

test("selection movement is clamped without changing its size", () => {
  const image = floodFill(transparentImage(3, 3), { x: 0, y: 0 }, [1, 2, 3, 255]);
  const moved = movePixelSelection(image, { x: 1, y: 1, width: 2, height: 2 }, 5, -5);

  assert.deepEqual(moved.selection, { x: 1, y: 0, width: 2, height: 2 });
  assert.deepEqual(readPixel(moved.image, { x: 1, y: 2 }), [0, 0, 0, 0]);
  assert.deepEqual(readPixel(moved.image, { x: 1, y: 0 }), [1, 2, 3, 255]);
});

test("selection operations reject non-finite coordinates", () => {
  const image = transparentImage(2, 2);
  assert.throws(
    () => createPixelSelection(image, { x: Number.NaN, y: 0 }, { x: 1, y: 1 }),
    /Invalid pixel selection point/,
  );
  assert.throws(
    () => pastePixelSelection(image, copyPixelSelection(image, { x: 0, y: 0, width: 1, height: 1 }), { x: Number.POSITIVE_INFINITY, y: 0 }),
    /Invalid pixel paste destination/,
  );
});
