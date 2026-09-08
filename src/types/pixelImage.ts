export type RgbaColor = readonly [number, number, number, number];

export interface PixelImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export interface PixelPoint {
  x: number;
  y: number;
}

export interface PixelSelection {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PixelClipboard {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}
