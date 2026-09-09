import type { CelTransform } from "../types/animationDocument.ts";
import type { PixelImage } from "../types/pixelImage.ts";

export interface OpaquePixelBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface OpaqueBottomAlignmentInput {
  celId: string;
  contentWidth: number;
  contentHeight: number;
  bounds: OpaquePixelBounds;
  transform: CelTransform;
}

export interface OpaqueBottomAlignmentEntry {
  celId: string;
  transform: CelTransform;
  deltaY: number;
}

export interface OpaqueBottomAlignmentSuggestion {
  targetBottom: number;
  entries: OpaqueBottomAlignmentEntry[];
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

export function findOpaquePixelBounds(
  image: PixelImage,
  minimumAlpha = 16,
): OpaquePixelBounds | null {
  assertPixelImage(image);
  if (!Number.isInteger(minimumAlpha) || minimumAlpha < 1 || minimumAlpha > 255) {
    throw new Error("minimumAlpha must be an integer from 1 to 255");
  }

  let left = image.width;
  let top = image.height;
  let right = 0;
  let bottom = 0;
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      if (image.data[(y * image.width + x) * 4 + 3] < minimumAlpha) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x + 1);
      bottom = Math.max(bottom, y + 1);
    }
  }
  return right > left && bottom > top ? { left, top, right, bottom } : null;
}

function opaqueBottomOffset(input: OpaqueBottomAlignmentInput) {
  const { bounds, contentWidth, contentHeight, transform } = input;
  if (
    !Number.isInteger(contentWidth) ||
    !Number.isInteger(contentHeight) ||
    contentWidth <= 0 ||
    contentHeight <= 0 ||
    ![transform.x, transform.y, transform.scaleX, transform.scaleY, transform.rotationDegrees]
      .every(Number.isFinite) ||
    bounds.left < 0 ||
    bounds.top < 0 ||
    bounds.right > contentWidth ||
    bounds.bottom > contentHeight ||
    bounds.right <= bounds.left ||
    bounds.bottom <= bounds.top
  ) {
    throw new Error(`Invalid opaque bounds for cel: ${input.celId}`);
  }

  const radians = (transform.rotationDegrees * Math.PI) / 180;
  const sine = Math.sin(radians);
  const cosine = Math.cos(radians);
  const xs = [bounds.left - contentWidth / 2, bounds.right - contentWidth / 2];
  const ys = [bounds.top - contentHeight / 2, bounds.bottom - contentHeight / 2];
  let maximumY = Number.NEGATIVE_INFINITY;
  for (const x of xs) {
    for (const y of ys) {
      maximumY = Math.max(
        maximumY,
        sine * x * transform.scaleX + cosine * y * transform.scaleY,
      );
    }
  }
  return maximumY;
}

export function createOpaqueBottomAlignment(
  inputs: OpaqueBottomAlignmentInput[],
): OpaqueBottomAlignmentSuggestion {
  if (inputs.length < 2) {
    throw new Error("Opaque-bottom alignment requires at least two cels");
  }
  const seen = new Set<string>();
  const prepared = inputs.map((input) => {
    if (!input.celId || seen.has(input.celId)) {
      throw new Error("Opaque-bottom alignment cel IDs must be unique");
    }
    seen.add(input.celId);
    const bottomOffset = opaqueBottomOffset(input);
    return {
      input,
      bottomOffset,
      currentBottom: input.transform.y + bottomOffset,
    };
  });
  const targetBottom = Math.max(...prepared.map((entry) => entry.currentBottom));
  return {
    targetBottom,
    entries: prepared.map(({ input, bottomOffset }) => {
      const y = targetBottom - bottomOffset;
      return {
        celId: input.celId,
        transform: { ...input.transform, y },
        deltaY: y - input.transform.y,
      };
    }),
  };
}
