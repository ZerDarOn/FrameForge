import { convertFileSrc } from "@tauri-apps/api/core";
import { evaluateAnimation, getAnimationDurationTicks } from "../core/animationDocument.ts";
import type { AnimationDocument, ContentRevision } from "../types/animationDocument";

const MAX_EXPORT_FRAMES = 10_000;
const MAX_EXPORT_RAW_PIXELS = 64 * 1024 * 1024;
export const EXPORT_CANCELLED = "EXPORT_CANCELLED";

function abortable<T>(task: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return task;
  if (signal.aborted) return Promise.reject(new Error(EXPORT_CANCELLED));
  return new Promise<T>((resolve, reject) => {
    const handleAbort = () => reject(new Error(EXPORT_CANCELLED));
    signal.addEventListener("abort", handleAbort, { once: true });
    task.then(
      (value) => {
        signal.removeEventListener("abort", handleAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", handleAbort);
        reject(error);
      },
    );
  });
}

function sourceUrl(content: ContentRevision) {
  if (/^(asset:|blob:|data:|https?:)/.test(content.sourcePath)) {
    return content.sourcePath;
  }
  return convertFileSrc(content.sourcePath);
}

export class AnimationCanvasRenderer {
  private readonly imageCache = new Map<string, Promise<HTMLImageElement>>();
  private readonly targetGenerations = new WeakMap<HTMLCanvasElement, number>();

  private loadImage(content: ContentRevision) {
    const cacheKey = `${content.id}\u0000${content.sourcePath}`;
    const cached = this.imageCache.get(cacheKey);
    if (cached) return cached;
    const pending = new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`无法加载素材: ${content.sourcePath}`));
      image.src = sourceUrl(content);
    });
    this.imageCache.set(cacheKey, pending);
    void pending.catch(() => {
      if (this.imageCache.get(cacheKey) === pending) {
        this.imageCache.delete(cacheKey);
      }
    });
    return pending;
  }

  async renderFrame(
    document: AnimationDocument,
    animationId: string,
    tick: number,
    target?: HTMLCanvasElement,
  ) {
    const canvas = target ?? window.document.createElement("canvas");
    const generation = target
      ? (this.targetGenerations.get(target) ?? 0) + 1
      : null;
    if (target && generation !== null) {
      this.targetGenerations.set(target, generation);
    }
    const staging = target ? window.document.createElement("canvas") : canvas;
    staging.width = document.canvas.width;
    staging.height = document.canvas.height;
    const context = staging.getContext("2d");
    if (!context) throw new Error("无法创建 Canvas 2D 上下文");
    context.clearRect(0, 0, staging.width, staging.height);
    context.imageSmoothingEnabled = false;

    const layers = evaluateAnimation(document, animationId, tick);
    for (const { layer, cel, content } of layers) {
      const image = await this.loadImage(content);
      const transform = cel.transform;
      context.save();
      context.globalAlpha = layer.opacity;
      context.translate(
        document.canvas.originX + Math.round(transform.x),
        document.canvas.originY + Math.round(transform.y),
      );
      context.rotate((transform.rotationDegrees * Math.PI) / 180);
      context.scale(transform.scaleX, transform.scaleY);
      context.drawImage(image, -image.width / 2, -image.height / 2);
      context.restore();
    }

    if (target) {
      if (this.targetGenerations.get(target) !== generation) {
        return target;
      }
      target.width = staging.width;
      target.height = staging.height;
      const targetContext = target.getContext("2d");
      if (!targetContext) throw new Error("无法创建目标 Canvas 2D 上下文");
      targetContext.clearRect(0, 0, target.width, target.height);
      targetContext.imageSmoothingEnabled = false;
      targetContext.drawImage(staging, 0, 0);
    }
    return canvas;
  }

  async renderPngFrames(
    document: AnimationDocument,
    animationId: string,
    signal?: AbortSignal,
  ) {
    const animation = document.animations.find((candidate) => candidate.id === animationId);
    if (!animation) throw new Error(`动画不存在: ${animationId}`);
    const totalTicks = getAnimationDurationTicks(animation);
    if (totalTicks <= 0 || totalTicks > MAX_EXPORT_FRAMES) {
      throw new Error(`导出帧数必须在 1 到 ${MAX_EXPORT_FRAMES} 之间`);
    }
    const rawPixels = document.canvas.width * document.canvas.height * totalTicks;
    if (!Number.isSafeInteger(rawPixels) || rawPixels > MAX_EXPORT_RAW_PIXELS) {
      throw new Error("导出规模过大，请缩小画布或分段导出");
    }
    const frames: string[] = [];
    for (let tick = 0; tick < totalTicks; tick += 1) {
      if (signal?.aborted) throw new Error(EXPORT_CANCELLED);
      const canvas = await abortable(
        this.renderFrame(document, animationId, tick),
        signal,
      );
      if (signal?.aborted) throw new Error(EXPORT_CANCELLED);
      frames.push(canvas.toDataURL("image/png"));
    }
    return frames;
  }
}
