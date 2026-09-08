const MAX_SPRITE_SHEET_DIMENSION = 16_384;
const MAX_SPRITE_SHEET_FRAMES = 10_000;

export interface SpriteSheetSliceSettings {
  sheetWidth: number;
  sheetHeight: number;
  cellWidth: number;
  cellHeight: number;
  offsetX: number;
  offsetY: number;
  spacingX: number;
  spacingY: number;
  frameCount?: number;
}

export interface SpriteSheetSlice {
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

function assertPositiveInteger(value: number, label: string) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
}

function assertNonNegativeInteger(value: number, label: string) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
}

export function createSpriteSheetSlices(settings: SpriteSheetSliceSettings): SpriteSheetSlice[] {
  assertPositiveInteger(settings.sheetWidth, "sheetWidth");
  assertPositiveInteger(settings.sheetHeight, "sheetHeight");
  assertPositiveInteger(settings.cellWidth, "cellWidth");
  assertPositiveInteger(settings.cellHeight, "cellHeight");
  assertNonNegativeInteger(settings.offsetX, "offsetX");
  assertNonNegativeInteger(settings.offsetY, "offsetY");
  assertNonNegativeInteger(settings.spacingX, "spacingX");
  assertNonNegativeInteger(settings.spacingY, "spacingY");
  if (
    settings.sheetWidth > MAX_SPRITE_SHEET_DIMENSION ||
    settings.sheetHeight > MAX_SPRITE_SHEET_DIMENSION
  ) {
    throw new Error(`sprite sheet dimensions cannot exceed ${MAX_SPRITE_SHEET_DIMENSION}`);
  }

  const availableWidth = settings.sheetWidth - settings.offsetX;
  const availableHeight = settings.sheetHeight - settings.offsetY;
  const columns = Math.floor(
    (availableWidth + settings.spacingX) / (settings.cellWidth + settings.spacingX),
  );
  const rows = Math.floor(
    (availableHeight + settings.spacingY) / (settings.cellHeight + settings.spacingY),
  );
  const availableCells = Math.max(0, columns) * Math.max(0, rows);
  if (availableCells === 0) {
    throw new Error("sprite sheet grid does not contain a complete cell");
  }

  if (settings.frameCount !== undefined) {
    assertPositiveInteger(settings.frameCount, "frameCount");
    if (settings.frameCount > availableCells) {
      throw new Error(`frameCount exceeds ${availableCells} available cells`);
    }
  }
  const frameCount = settings.frameCount ?? availableCells;
  if (frameCount > MAX_SPRITE_SHEET_FRAMES) {
    throw new Error(`sprite sheet cannot produce more than ${MAX_SPRITE_SHEET_FRAMES.toLocaleString("en-US")} frames`);
  }

  return Array.from({ length: frameCount }, (_, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    return {
      index,
      x: settings.offsetX + column * (settings.cellWidth + settings.spacingX),
      y: settings.offsetY + row * (settings.cellHeight + settings.spacingY),
      width: settings.cellWidth,
      height: settings.cellHeight,
    };
  });
}
