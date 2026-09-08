import { useRef, useEffect, useState, useCallback, useMemo } from "react";
import { useTimelineStore } from "../../stores/timelineStore";
import { useUIStore } from "../../stores/uiStore";
import { useFullImage } from "../../hooks/useThumbnail";
import { BaselineOverlay } from "../viewport/BaselineOverlay";
import { MagnifierOverlay } from "../viewport/MagnifierOverlay";
import { AnalysisOverlay } from "../viewport/AnalysisOverlay";
import { TransformHandles } from "../viewport/TransformHandles";
import { PixelEditorDialog } from "../viewport/PixelEditorDialog";
import type { Asset } from "../../types/asset";

type CompareMode = "none" | "side" | "overlay" | "wipe";

export function ViewportPanel() {
  const containerRef = useRef<HTMLDivElement>(null);
  const tracks = useTimelineStore((s) => s.tracks);
  const currentFrame = useTimelineStore((s) => s.currentFrame);
  const onionSkinEnabled = useUIStore((s) => s.onionSkinEnabled);
  const onionSkinOpacity = useUIStore((s) => s.onionSkinOpacity);
  const onionSkinFrames = useUIStore((s) => s.onionSkinFrames);
  const [compareMode, setCompareMode] = useState<CompareMode>("none");
  const [compareFrame, setCompareFrame] = useState(0);
  const [wipePosition, setWipePosition] = useState(50);
  const [viewZoom, setViewZoom] = useState(1);
  const [viewPan, setViewPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const lastMouseRef = useRef({ x: 0, y: 0 });
  const viewportTool = useUIStore((s) => s.viewportTool);
  const [imageRect, setImageRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const selectedLayerId = useTimelineStore((s) => s.selectedAssetId);
  const setSelectedLayerId = useTimelineStore((s) => s.setSelectedAsset);
  const [pixelEditorAsset, setPixelEditorAsset] = useState<Asset | null>(null);
  const updateAsset = useTimelineStore((s) => s.updateAsset);
  const previewAssetUpdate = useTimelineStore((s) => s.previewAssetUpdate);

  // 获取当前帧在所有可见轨道中的资产（按 trackOrder 排序叠加）
  const getAssetsAtFrame = useCallback((frameIndex: number): Asset[] => {
    const result: { asset: Asset; trackOrder: number }[] = [];
    for (const track of tracks) {
      if (!track.visible) continue;
      for (const asset of track.assets) {
        if (
          frameIndex >= asset.startFrame &&
          frameIndex < asset.startFrame + Math.max(1, asset.durationFrames)
        ) {
          result.push({ asset, trackOrder: track.trackOrder ?? 0 });
          break;
        }
      }
    }
    result.sort((a, b) => a.trackOrder - b.trackOrder);
    return result.map((r) => r.asset);
  }, [tracks]);

  // 向后兼容单帧获取
  const getAssetAtIndex = useCallback((frameIndex: number) => {
    for (const track of tracks) {
      if (!track.visible) continue;
      for (const asset of track.assets) {
        if (
          frameIndex >= asset.startFrame &&
          frameIndex < asset.startFrame + Math.max(1, asset.durationFrames)
        ) return asset;
      }
    }
    return null;
  }, [tracks]);

  const currentAsset = getAssetAtIndex(currentFrame);
  const compareAsset = compareMode !== "none" ? getAssetAtIndex(compareFrame) : null;

  // 多轨道：当前帧在所有轨道中的图层
  const currentLayers = useMemo(
    () => getAssetsAtFrame(currentFrame),
    [currentFrame, getAssetsAtFrame],
  );

  const { image: currentImage } = useFullImage(currentAsset?.sourcePath || null);
  const { image: prevImage } = useFullImage(
    onionSkinEnabled && onionSkinFrames > 0 ? getAssetAtIndex(currentFrame - 1)?.sourcePath || null : null
  );
  const { image: compareImage } = useFullImage(compareAsset?.sourcePath || null);

  // 预加载所有图层的全尺寸图片
  const [layerImages, setLayerImages] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    const loadImages = async () => {
      const map = new Map<string, string>();
      for (const asset of currentLayers) {
        if (!asset) continue;
        // useFullImage hook 在顶层已调用 currentImage，这里只加载额外图层
        if (asset.sourcePath === currentAsset?.sourcePath) continue;
        try {
          const { convertFileSrc } = await import("@tauri-apps/api/core");
          map.set(asset.id, convertFileSrc(asset.sourcePath));
        } catch {
          // 忽略加载失败的图层
        }
      }
      setLayerImages(map);
    };
    loadImages();
  }, [currentLayers, currentAsset?.sourcePath]);

  // 当前选中的编辑图层
  const selectedLayerAsset = selectedLayerId
    ? currentLayers.find((a) => a.id === selectedLayerId) ?? null
    : null;

  // 变换更新回调 → store
  const handleTransformChange = useCallback(
    (partial: Pick<Asset, "transformX" | "transformY" | "transformScaleX" | "transformScaleY" | "transformRotation">) => {
      if (!selectedLayerId) return;
      const track = tracks.find((t) => t.assets.some((a) => a.id === selectedLayerId));
      if (track) {
        updateAsset(track.id, selectedLayerId, partial);
      }
    },
    [selectedLayerId, tracks, updateAsset],
  );

  const handleTransformPreview = useCallback(
    (partial: Pick<Asset, "transformX" | "transformY" | "transformScaleX" | "transformScaleY" | "transformRotation">) => {
      if (!selectedLayerId) return;
      const track = tracks.find((candidate) =>
        candidate.assets.some((asset) => asset.id === selectedLayerId),
      );
      if (track) previewAssetUpdate(track.id, selectedLayerId, partial);
    },
    [previewAssetUpdate, selectedLayerId, tracks],
  );

  // 键盘方向键微移（1px） + Shift（10px）
  useEffect(() => {
    if (!selectedLayerAsset || !selectedLayerId) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const step = e.shiftKey ? 10 : 1;
      let handled = true;
      const track = tracks.find((t) => t.assets.some((a) => a.id === selectedLayerId));
      if (!track) return;

      switch (e.key) {
        case "ArrowUp":
          updateAsset(track.id, selectedLayerId, { transformY: selectedLayerAsset.transformY - step });
          break;
        case "ArrowDown":
          updateAsset(track.id, selectedLayerId, { transformY: selectedLayerAsset.transformY + step });
          break;
        case "ArrowLeft":
          updateAsset(track.id, selectedLayerId, { transformX: selectedLayerAsset.transformX - step });
          break;
        case "ArrowRight":
          updateAsset(track.id, selectedLayerId, { transformX: selectedLayerAsset.transformX + step });
          break;
        default:
          handled = false;
      }
      if (handled) e.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedLayerAsset, selectedLayerId, tracks, updateAsset]);

  // 视口缩放（Alt+滚轮）
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const handleWheel = (e: WheelEvent) => {
      if (e.altKey) {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -0.1 : 0.1;
        setViewZoom((z) => Math.max(0.1, Math.min(10, z + delta)));
      }
    };
    container.addEventListener("wheel", handleWheel, { passive: false });
    return () => container.removeEventListener("wheel", handleWheel);
  }, []);

  // 追踪图片在容器中的位置和尺寸
  useEffect(() => {
    if (!imgRef.current || !containerRef.current) return;
    const updateRect = () => {
      const container = containerRef.current;
      const img = imgRef.current;
      if (!container || !img) return;
      const containerRect = container.getBoundingClientRect();
      const ir = img.getBoundingClientRect();
      setImageRect({
        x: ir.left - containerRect.left,
        y: ir.top - containerRect.top,
        width: ir.width,
        height: ir.height,
      });
    };
    updateRect();
    const observer = new ResizeObserver(updateRect);
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [currentImage, viewZoom, viewPan]);

  // 视口平移（中键拖拽或 Alt+左键，工具模式下不触发）
  const handleMouseDown = (e: React.MouseEvent) => {
    if ((e.button === 1 || (e.button === 0 && e.altKey)) && viewportTool === "select") {
      e.preventDefault();
      setIsPanning(true);
      lastMouseRef.current = { x: e.clientX, y: e.clientY };
    }
  };
  const handleMouseMove = (e: React.MouseEvent) => {
    if (isPanning) {
      setViewPan((p) => ({
        x: p.x + e.clientX - lastMouseRef.current.x,
        y: p.y + e.clientY - lastMouseRef.current.y,
      }));
      lastMouseRef.current = { x: e.clientX, y: e.clientY };
    }
  };
  const handleMouseUp = () => setIsPanning(false);

  // 重置视口
  const resetViewport = () => {
    setViewZoom(1);
    setViewPan({ x: 0, y: 0 });
  };

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full bg-gray-950 overflow-hidden"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onClick={() => { if (viewportTool === "select") setSelectedLayerId(null); }}
      style={{ cursor: isPanning ? "grabbing" : viewZoom > 1 ? "zoom-in" : "default" }}
    >
      {currentImage ? (
        <div
          className="absolute inset-0 flex items-center justify-center"
          style={{
            transform: `translate(${viewPan.x}px, ${viewPan.y}px) scale(${viewZoom})`,
            transformOrigin: "center center",
          }}
        >
          {/* 洋葱皮前一帧 */}
          {onionSkinEnabled && prevImage && (
            <img
              src={prevImage}
              alt="前一帧"
              className="absolute max-w-full max-h-full object-contain"
              style={{ opacity: onionSkinOpacity, filter: "hue-rotate(120deg) saturate(0.5)" }}
            />
          )}

          {/* 当前帧 — 多图层叠加渲染 */}
          {currentLayers.map((asset) => {
            if (!asset) return null;
            const isPrimary = asset.sourcePath === currentAsset?.sourcePath;
            const imgSrc = isPrimary ? currentImage : layerImages.get(asset.id);
            if (!imgSrc) return null;

            return (
              <img
                key={asset.id}
                ref={isPrimary ? imgRef : undefined}
                src={imgSrc}
                alt={asset.name}
                className="absolute max-w-full max-h-full object-contain"
                style={{
                  transform: `translate(${asset.transformX}px, ${asset.transformY}px) rotate(${asset.transformRotation}deg) scale(${asset.transformScaleX}, ${asset.transformScaleY})`,
                  transformOrigin: "center center",
                  imageRendering: "pixelated",
                  opacity:
                    tracks.find((track) => track.assets.some((candidate) => candidate.id === asset.id))
                      ?.opacity ?? 1,
                  cursor: viewportTool === "select" ? "pointer" : undefined,
                  outline: selectedLayerId === asset.id ? "2px solid #60a5fa" : undefined,
                  outlineOffset: "1px",
                }}
                onClick={(e) => {
                  if (viewportTool !== "select") return;
                  e.stopPropagation();
                  setSelectedLayerId(selectedLayerId === asset.id ? null : asset.id);
                }}
              />
            );
          })}

          {/* 基准点覆盖层 */}
          <BaselineOverlay imageRect={imageRect} />

          {/* 分析结果叠加层 */}
          <AnalysisOverlay imageRect={imageRect} />

          {/* 变换手柄（选中图层时显示） */}
          {selectedLayerAsset && (
            <TransformHandles
              asset={selectedLayerAsset}
              containerRect={imageRect}
              viewZoom={viewZoom}
              viewPan={viewPan}
              onTransformPreview={handleTransformPreview}
              onTransformCommit={handleTransformChange}
            />
          )}

          {/* A/B 对比：叠加模式 */}
          {compareMode === "overlay" && compareImage && (
            <img
              src={compareImage}
              alt={`对比帧 ${compareFrame}`}
              className="absolute max-w-full max-h-full object-contain"
              style={{ opacity: 0.5, mixBlendMode: "difference" }}
            />
          )}

          {/* A/B 对比：擦除模式 */}
          {compareMode === "wipe" && compareImage && (
            <div className="absolute max-w-full max-h-full" style={{ clipPath: `inset(0 0 0 ${wipePosition}%)` }}>
              <img src={compareImage} alt={`对比帧 ${compareFrame}`} className="max-w-full max-h-full object-contain" />
            </div>
          )}
        </div>
      ) : (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-center text-gray-600">
            <div className="text-4xl mb-2">&#127916;</div>
            <div className="text-sm">
              {tracks.length === 0 ? "导入图片序列帧开始审查" : `帧 ${currentFrame} 无内容`}
            </div>
          </div>
        </div>
      )}

      {/* 帧号 + 工具栏 */}
      <div className="absolute top-2 left-2 bg-black/60 rounded px-2 py-1 text-xs text-gray-300 flex items-center gap-2">
        <span>帧 {currentFrame}</span>
        {viewZoom !== 1 && <span>{Math.round(viewZoom * 100)}%</span>}
        {onionSkinEnabled && prevImage && (
          <span className="text-blue-400">洋葱皮</span>
        )}
        {compareMode !== "none" && (
          <span className="text-green-400">对比帧 {compareFrame}</span>
        )}
      </div>

      {/* 视口控制工具栏 */}
      <div className="absolute top-2 right-2 flex gap-1">
        {selectedLayerAsset && (
          <button
            className="rounded bg-orange-700 px-2 py-1 text-xs text-white hover:bg-orange-600"
            onClick={() => setPixelEditorAsset(selectedLayerAsset)}
            title="以不可变内容版本编辑所选画格"
          >
            像素编辑
          </button>
        )}
        <button
          className="bg-black/60 rounded px-2 py-1 text-xs text-gray-400 hover:text-white"
          onClick={resetViewport}
          title="重置缩放"
        >
          1:1
        </button>
        <button
          className="bg-black/60 rounded px-2 py-1 text-xs text-gray-400 hover:text-white"
          onClick={() => setViewZoom((z) => Math.min(10, z * 1.5))}
          title="放大"
        >
          +
        </button>
        <button
          className="bg-black/60 rounded px-2 py-1 text-xs text-gray-400 hover:text-white"
          onClick={() => setViewZoom((z) => Math.max(0.1, z / 1.5))}
          title="缩小"
        >
          −
        </button>
      </div>

      {/* A/B 对比工具栏 */}
      <div className="absolute bottom-2 left-2 bg-black/60 rounded px-2 py-1 text-xs flex items-center gap-2">
        <span className="text-gray-500">对比:</span>
        {(["none", "side", "overlay", "wipe"] as CompareMode[]).map((mode) => (
          <button
            key={mode}
            className={`px-2 py-0.5 rounded ${compareMode === mode ? "bg-orange-600 text-white" : "text-gray-400 hover:text-white"}`}
            onClick={() => setCompareMode(mode)}
          >
            {mode === "none" ? "关" : mode === "side" ? "并排" : mode === "overlay" ? "叠加" : "擦除"}
          </button>
        ))}
        {compareMode !== "none" && (
          <input
            type="number"
            value={compareFrame}
            onChange={(e) => setCompareFrame(parseInt(e.target.value) || 0)}
            className="w-12 bg-gray-800 border border-gray-600 rounded px-1 text-gray-300"
            placeholder="帧号"
          />
        )}
        {compareMode === "wipe" && (
          <input
            type="range"
            min="0"
            max="100"
            value={wipePosition}
            onChange={(e) => setWipePosition(parseInt(e.target.value))}
            className="w-20 accent-orange-500"
          />
        )}
      </div>

      {/* 放大镜覆盖层 */}
      <MagnifierOverlay
        containerRef={containerRef}
        imageSrc={currentImage}
        imageRect={imageRect}
      />

      {/* A/B 并排对比 */}
      {compareMode === "side" && compareImage && (
        <div className="absolute inset-0 flex pointer-events-none">
          <div className="flex-1 flex items-center justify-center border-r border-gray-600">
            <img src={currentImage || ""} alt="当前帧" className="max-w-full max-h-full object-contain" />
            <div className="absolute bottom-2 text-xs text-gray-400">帧 {currentFrame}</div>
          </div>
          <div className="flex-1 flex items-center justify-center">
            <img src={compareImage} alt="对比帧" className="max-w-full max-h-full object-contain" />
            <div className="absolute bottom-2 text-xs text-gray-400">帧 {compareFrame}</div>
          </div>
        </div>
      )}
      {pixelEditorAsset && (
        <PixelEditorDialog asset={pixelEditorAsset} onClose={() => setPixelEditorAsset(null)} />
      )}
    </div>
  );
}
