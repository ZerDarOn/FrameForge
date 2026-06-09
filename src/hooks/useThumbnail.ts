import { useState, useEffect, useRef } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { invoke } from "@tauri-apps/api/core";

// 缩略图质量等级，对应 JPEG 编码质量
export type ThumbnailQuality = "lossless" | "high" | "medium" | "low";

const QUALITY_MAP: Record<ThumbnailQuality, { jpegQuality: number; format: "png" | "jpeg" }> = {
  lossless: { jpegQuality: 100, format: "png" },
  high: { jpegQuality: 90, format: "jpeg" },
  medium: { jpegQuality: 75, format: "jpeg" },
  low: { jpegQuality: 50, format: "jpeg" },
};

// LRU 缓存（缩略图专用，有容量上限）
const MAX_THUMB_CACHE = 500;
const thumbCache = new Map<string, string>();

function thumbCacheGet(key: string): string | undefined {
  const val = thumbCache.get(key);
  if (val !== undefined) {
    // 访问时移到末尾（LRU）
    thumbCache.delete(key);
    thumbCache.set(key, val);
  }
  return val;
}

function thumbCacheSet(key: string, val: string) {
  if (thumbCache.has(key)) thumbCache.delete(key);
  thumbCache.set(key, val);
  // 淘汰最早的条目
  while (thumbCache.size > MAX_THUMB_CACHE) {
    const oldest = thumbCache.keys().next().value;
    if (oldest !== undefined) thumbCache.delete(oldest);
  }
}

// 并发控制：最多同时 6 个缩略图请求
const MAX_CONCURRENT = 6;
let activeCount = 0;
const pendingQueue: (() => void)[] = [];

function enqueue(): Promise<void> {
  if (activeCount < MAX_CONCURRENT) {
    activeCount++;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => pendingQueue.push(resolve));
}

function dequeue() {
  activeCount = Math.max(0, activeCount - 1);
  if (pendingQueue.length > 0 && activeCount < MAX_CONCURRENT) {
    activeCount++;
    pendingQueue.shift()!();
  }
}

/**
 * 缩略图 hook — 用于时间线和资产面板
 * 通过 Rust 后端生成缩略图 base64，支持 quality 控制
 */
export function useThumbnail(sourcePath: string | null, quality: ThumbnailQuality = "high") {
  const [thumbnail, setThumbnail] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const qualityRef = useRef(quality);
  qualityRef.current = quality;

  useEffect(() => {
    if (!sourcePath) {
      setThumbnail(null);
      return;
    }

    const cacheKey = `${sourcePath}:${quality}`;
    const cached = thumbCacheGet(cacheKey);
    if (cached) {
      setThumbnail(cached);
      return;
    }

    let cancelled = false;
    setLoading(true);

    const load = async () => {
      await enqueue();
      try {
        if (cancelled) return;
        const { jpegQuality, format } = QUALITY_MAP[qualityRef.current];
        const base64 = await invoke<string>("read_thumbnail_base64", {
          filePath: sourcePath,
          maxWidth: 120,
          maxHeight: 80,
          jpegQuality,
          format,
        });
        if (!cancelled) {
          thumbCacheSet(cacheKey, base64);
          setThumbnail(base64);
        }
      } catch {
        if (!cancelled) setThumbnail(null);
      } finally {
        dequeue();
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [sourcePath, quality]);

  return { thumbnail, loading };
}

/**
 * 全尺寸图片 hook — 用于视口和全屏预览
 * 使用 Tauri asset protocol 直接加载本地文件，零内存开销，无损
 */
export function useFullImage(sourcePath: string | null) {
  const [image, setImage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!sourcePath) {
      setImage(null);
      return;
    }

    // asset protocol: 浏览器直接加载文件，无需 base64 编码
    setLoading(true);
    const url = convertFileSrc(sourcePath);

    const img = new Image();
    img.onload = () => {
      setImage(url);
      setLoading(false);
    };
    img.onerror = () => {
      setImage(null);
      setLoading(false);
    };
    img.src = url;

    return () => {
      img.onload = null;
      img.onerror = null;
    };
  }, [sourcePath]);

  return { image, loading };
}
