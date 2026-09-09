import type { PixelImage } from "../types/pixelImage.ts";

export const MAX_DECODED_PIXEL_IMAGE_PIXELS = 4 * 1024 * 1024;

export interface ReadContentImage {
  pngDataUrl: string;
  width: number;
  height: number;
}

export async function decodePixelImageDataUrl(
  dataUrl: string,
  decodeErrorMessage = "无法解码图片",
): Promise<PixelImage> {
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error(decodeErrorMessage));
    image.src = dataUrl;
  });
  if (image.naturalWidth * image.naturalHeight > MAX_DECODED_PIXEL_IMAGE_PIXELS) {
    throw new Error("图片超过 4M 像素上限");
  }
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("浏览器不支持 Canvas 2D");
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  return { width: canvas.width, height: canvas.height, data: pixels.data };
}
