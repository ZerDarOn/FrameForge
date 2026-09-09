import assert from "node:assert/strict";
import test from "node:test";
import {
  createOpaqueBottomAlignment,
  findOpaquePixelBounds,
} from "../src/core/pixelBaseline.ts";
import type { PixelImage } from "../src/types/pixelImage.ts";

function imageWithOpaquePixels(
  width: number,
  height: number,
  pixels: Array<[number, number, number]>,
): PixelImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (const [x, y, alpha] of pixels) {
    data[(y * width + x) * 4 + 3] = alpha;
  }
  return { width, height, data };
}

test("opaque bounds ignore transparent and low-alpha pixels", () => {
  const image = imageWithOpaquePixels(4, 4, [
    [0, 3, 8],
    [1, 2, 255],
    [2, 3, 16],
  ]);

  assert.deepEqual(findOpaquePixelBounds(image, 16), {
    left: 1,
    top: 2,
    right: 3,
    bottom: 4,
  });
});

test("opaque-bottom alignment returns reviewable transforms without mutating inputs", () => {
  const firstTransform = {
    x: 0,
    y: 0,
    scaleX: 1,
    scaleY: 1,
    rotationDegrees: 0,
  };
  const secondTransform = {
    x: 0,
    y: 10,
    scaleX: 1,
    scaleY: 1,
    rotationDegrees: 0,
  };
  const suggestion = createOpaqueBottomAlignment([
    {
      celId: "first",
      contentWidth: 4,
      contentHeight: 4,
      bounds: { left: 1, top: 2, right: 3, bottom: 4 },
      transform: firstTransform,
    },
    {
      celId: "second",
      contentWidth: 4,
      contentHeight: 4,
      bounds: { left: 1, top: 0, right: 3, bottom: 2 },
      transform: secondTransform,
    },
  ]);

  assert.equal(suggestion.targetBottom, 10);
  assert.deepEqual(
    suggestion.entries.map((entry) => [entry.celId, entry.transform.y, entry.deltaY]),
    [["first", 8, 8], ["second", 10, 0]],
  );
  assert.equal(firstTransform.y, 0);
  assert.equal(secondTransform.y, 10);
});

test("opaque-bottom alignment accounts for rotation and horizontal extent", () => {
  const suggestion = createOpaqueBottomAlignment([
    {
      celId: "rotated",
      contentWidth: 4,
      contentHeight: 4,
      bounds: { left: 3, top: 1, right: 4, bottom: 2 },
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotationDegrees: 90 },
    },
    {
      celId: "target",
      contentWidth: 4,
      contentHeight: 4,
      bounds: { left: 0, top: 0, right: 4, bottom: 4 },
      transform: { x: 0, y: 5, scaleX: 1, scaleY: 1, rotationDegrees: 0 },
    },
  ]);

  const rotated = suggestion.entries.find((entry) => entry.celId === "rotated");
  assert.equal(suggestion.targetBottom, 7);
  assert.equal(rotated?.transform.y, 5);
});
