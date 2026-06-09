import { useRef, useEffect, useState, useCallback } from "react";
import { useTimelineStore } from "../../stores/timelineStore";
import { useUIStore } from "../../stores/uiStore";
import { useFullImage } from "../../hooks/useThumbnail";

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

  // 获取当前帧资产
  const getAssetAtIndex = useCallback((frameIndex: number) => {
    for (const track of tracks) {
      if (!track.visible) continue;
      if (frameIndex >= 0 && frameIndex < track.assets.length) return track.assets[frameIndex];
    }
    return null;
  }, [tracks]);

  const currentAsset = getAssetAtIndex(currentFrame);
  const compareAsset = compareMode !== "none" ? getAssetAtIndex(compareFrame) : null;

  const { image: currentImage } = useFullImage(currentAsset?.sourcePath || null);
  const { image: prevImage } = useFullImage(
    onionSkinEnabled && onionSkinFrames > 0 ? getAssetAtIndex(currentFrame - 1)?.sourcePath || null : null
  );
  const { image: compareImage } = useFullImage(compareAsset?.sourcePath || null);

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

  // 视口平移（中键拖拽或 Alt+左键）
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
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

          {/* 当前帧 */}
          <img src={currentImage} alt={`帧 ${currentFrame}`} className="relative max-w-full max-h-full object-contain" />

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
    </div>
  );
}
