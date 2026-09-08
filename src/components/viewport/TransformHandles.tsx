import { useRef, useEffect, useCallback } from "react";
import type { Asset } from "../../types/asset";

interface Props {
  asset: Asset;
  containerRect: { x: number; y: number; width: number; height: number } | null;
  viewZoom: number;
  viewPan: { x: number; y: number };
  /** 图片原始尺寸（width/height 来自 asset） */
  onTransformPreview: (partial: AssetTransform) => void;
  onTransformCommit: (partial: AssetTransform) => void;
}

type AssetTransform = Pick<
  Asset,
  "transformX" | "transformY" | "transformScaleX" | "transformScaleY" | "transformRotation"
>;

type HandleType = "tl" | "tr" | "bl" | "br" | "tm" | "bm" | "ml" | "mr" | "center";

interface HandleDef {
  type: HandleType;
  cursor: string;
}

const HANDLES: HandleDef[] = [
  { type: "tl", cursor: "nwse-resize" },
  { type: "tm", cursor: "ns-resize" },
  { type: "tr", cursor: "nesw-resize" },
  { type: "ml", cursor: "ew-resize" },
  { type: "mr", cursor: "ew-resize" },
  { type: "bl", cursor: "nesw-resize" },
  { type: "bm", cursor: "ns-resize" },
  { type: "br", cursor: "nwse-resize" },
];

const HANDLE_SIZE = 8;

export function TransformHandles({
  asset,
  containerRect,
  viewZoom,
  viewPan,
  onTransformPreview,
  onTransformCommit,
}: Props) {
  const dragState = useRef<{
    type: HandleType;
    startX: number;
    startY: number;
    startTransformX: number;
    startTransformY: number;
    startScaleX: number;
    startScaleY: number;
    startRotation: number;
  } | null>(null);

  // 关闭 ref，避免 useEffect 重新绑定
  const onPreviewRef = useRef(onTransformPreview);
  onPreviewRef.current = onTransformPreview;
  const onCommitRef = useRef(onTransformCommit);
  onCommitRef.current = onTransformCommit;
  const pendingTransform = useRef<AssetTransform | null>(null);
  const viewZoomRef = useRef(viewZoom);
  viewZoomRef.current = viewZoom;

  const handleMouseDown = useCallback((e: React.MouseEvent, type: HandleType) => {
    e.preventDefault();
    e.stopPropagation();
    dragState.current = {
      type,
      startX: e.clientX,
      startY: e.clientY,
      startTransformX: asset.transformX,
      startTransformY: asset.transformY,
      startScaleX: asset.transformScaleX,
      startScaleY: asset.transformScaleY,
      startRotation: asset.transformRotation,
    };
    pendingTransform.current = null;
  }, [asset]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const ds = dragState.current;
      if (!ds) return;
      const zoom = viewZoomRef.current;
      const dx = (e.clientX - ds.startX) / zoom;
      const dy = (e.clientY - ds.startY) / zoom;

      switch (ds.type) {
        case "center":
          pendingTransform.current = {
            transformX: ds.startTransformX + dx,
            transformY: ds.startTransformY + dy,
            transformScaleX: ds.startScaleX,
            transformScaleY: ds.startScaleY,
            transformRotation: ds.startRotation,
          };
          break;
        case "mr":
          pendingTransform.current = {
            transformX: ds.startTransformX,
            transformY: ds.startTransformY,
            transformScaleX: Math.max(0.01, ds.startScaleX + dx / 100),
            transformScaleY: ds.startScaleY,
            transformRotation: ds.startRotation,
          };
          break;
        case "ml":
          pendingTransform.current = {
            transformX: ds.startTransformX,
            transformY: ds.startTransformY,
            transformScaleX: Math.max(0.01, ds.startScaleX - dx / 100),
            transformScaleY: ds.startScaleY,
            transformRotation: ds.startRotation,
          };
          break;
        case "bm":
          pendingTransform.current = {
            transformX: ds.startTransformX,
            transformY: ds.startTransformY,
            transformScaleX: ds.startScaleX,
            transformScaleY: Math.max(0.01, ds.startScaleY + dy / 100),
            transformRotation: ds.startRotation,
          };
          break;
        case "tm":
          pendingTransform.current = {
            transformX: ds.startTransformX,
            transformY: ds.startTransformY,
            transformScaleX: ds.startScaleX,
            transformScaleY: Math.max(0.01, ds.startScaleY - dy / 100),
            transformRotation: ds.startRotation,
          };
          break;
        case "br":
        case "tr":
        case "bl":
        case "tl":
          // 角手柄：等比例缩放
          const scaleDelta = (dx + dy) / 200;
          const newScale = Math.max(0.01, ds.startScaleX + scaleDelta);
          pendingTransform.current = {
            transformX: ds.startTransformX,
            transformY: ds.startTransformY,
            transformScaleX: newScale,
            transformScaleY: newScale,
            transformRotation: ds.startRotation,
          };
          break;
      }
      if (pendingTransform.current) {
        onPreviewRef.current(pendingTransform.current);
      }
    };

    const onUp = () => {
      if (pendingTransform.current) {
        onCommitRef.current(pendingTransform.current);
      }
      pendingTransform.current = null;
      dragState.current = null;
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, []);

  if (!containerRect) return null;

  const imgW = asset.width || containerRect.width;
  const imgH = asset.height || containerRect.height;
  const contentCenterX = containerRect.x + containerRect.width / 2 + asset.transformX;
  const contentCenterY = containerRect.y + containerRect.height / 2 + asset.transformY;
  const screenX = contentCenterX * viewZoom + viewPan.x;
  const screenY = contentCenterY * viewZoom + viewPan.y;
  const scaledW = imgW * asset.transformScaleX * viewZoom;
  const scaledH = imgH * asset.transformScaleY * viewZoom;
  const halfW = scaledW / 2;
  const halfH = scaledH / 2;

  const getHandlePos = (type: HandleType): { left: number; top: number } => {
    switch (type) {
      case "tl": return { left: screenX - halfW - HANDLE_SIZE / 2, top: screenY - halfH - HANDLE_SIZE / 2 };
      case "tm": return { left: screenX - HANDLE_SIZE / 2, top: screenY - halfH - HANDLE_SIZE / 2 };
      case "tr": return { left: screenX + halfW - HANDLE_SIZE / 2, top: screenY - halfH - HANDLE_SIZE / 2 };
      case "ml": return { left: screenX - halfW - HANDLE_SIZE / 2, top: screenY - HANDLE_SIZE / 2 };
      case "mr": return { left: screenX + halfW - HANDLE_SIZE / 2, top: screenY - HANDLE_SIZE / 2 };
      case "bl": return { left: screenX - halfW - HANDLE_SIZE / 2, top: screenY + halfH - HANDLE_SIZE / 2 };
      case "bm": return { left: screenX - HANDLE_SIZE / 2, top: screenY + halfH - HANDLE_SIZE / 2 };
      case "br": return { left: screenX + halfW - HANDLE_SIZE / 2, top: screenY + halfH - HANDLE_SIZE / 2 };
      case "center": return { left: screenX - 10, top: screenY - 10 };
    }
  };

  return (
    <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 50 }}>
      {/* 选中框 */}
      <div
        className="absolute border border-blue-400 pointer-events-none"
        style={{ left: screenX - halfW, top: screenY - halfH, width: scaledW, height: scaledH }}
      />
      {HANDLES.map((h) => {
        const pos = getHandlePos(h.type);
        return (
          <div
            key={h.type}
            className="absolute bg-white border border-blue-500 rounded-full pointer-events-auto"
            style={{ left: pos.left, top: pos.top, width: HANDLE_SIZE, height: HANDLE_SIZE, cursor: h.cursor }}
            onMouseDown={(e) => handleMouseDown(e, h.type)}
          />
        );
      })}
      <div
        className="absolute border border-white/30 rounded pointer-events-auto"
        style={{ left: getHandlePos("center").left, top: getHandlePos("center").top, width: 20, height: 20, cursor: "move" }}
        onMouseDown={(e) => handleMouseDown(e, "center")}
      />
    </div>
  );
}
