import { useState, useCallback, useRef, useEffect } from "react";
import { useUIStore } from "../../stores/uiStore";

interface Props {
  containerRef: React.RefObject<HTMLDivElement | null>;
  imageSrc: string | null;
  imageRect: { x: number; y: number; width: number; height: number } | null;
  viewZoom: number;
  viewPan: { x: number; y: number };
}

const MAGNIFIER_SIZE = 160;

export function MagnifierOverlay({ containerRef, imageSrc, imageRect, viewZoom, viewPan }: Props) {
  const viewportTool = useUIStore((s) => s.viewportTool);
  const magnifierZoom = useUIStore((s) => s.magnifierZoom);
  const setMagnifierZoom = useUIStore((s) => s.setMagnifierZoom);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const isActive = viewportTool === "magnifier";

  useEffect(() => {
    if (!imageSrc) return;
    const img = new Image();
    img.src = imageSrc;
    img.onload = () => { imgRef.current = img; };
    return () => { imgRef.current = null; };
  }, [imageSrc]);

  useEffect(() => {
    if (!pos || !imgRef.current || !canvasRef.current || !imageRect) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const img = imgRef.current;
    const zoom = magnifierZoom;
    const size = MAGNIFIER_SIZE;

    canvas.width = size;
    canvas.height = size;

    const imgX = (pos.x - imageRect.x) / imageRect.width;
    const imgY = (pos.y - imageRect.y) / imageRect.height;

    const srcSize = size / zoom;
    const sx = imgX * img.naturalWidth - srcSize / 2;
    const sy = imgY * img.naturalHeight - srcSize / 2;

    ctx.clearRect(0, 0, size, size);
    ctx.imageSmoothingEnabled = false;

    ctx.drawImage(
      img,
      Math.max(0, sx), Math.max(0, sy), srcSize, srcSize,
      0, 0, size, size
    );

    // 十字线
    ctx.strokeStyle = "rgba(249, 115, 22, 0.6)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(size / 2, 0);
    ctx.lineTo(size / 2, size);
    ctx.moveTo(0, size / 2);
    ctx.lineTo(size, size / 2);
    ctx.stroke();

    // 中心像素高亮
    ctx.strokeStyle = "rgba(249, 115, 22, 0.8)";
    ctx.lineWidth = 2;
    ctx.strokeRect(size / 2 - zoom / 2, size / 2 - zoom / 2, zoom, zoom);
  }, [pos, magnifierZoom, imageRect]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isActive || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    setPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  }, [isActive, containerRef]);

  const handleMouseLeave = useCallback(() => {
    setPos(null);
  }, []);

  if (!isActive) return null;

  return (
    <div
      className="absolute inset-0 z-20"
      style={{ cursor: "none" }}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      {pos && (
        <div
          className="absolute pointer-events-none"
          style={{
            left: pos.x + 20,
            top: pos.y - MAGNIFIER_SIZE - 10,
            width: MAGNIFIER_SIZE,
            height: MAGNIFIER_SIZE,
          }}
        >
          <div className="relative rounded-lg overflow-hidden border-2 border-orange-400 shadow-xl">
            <canvas
              ref={canvasRef}
              width={MAGNIFIER_SIZE}
              height={MAGNIFIER_SIZE}
              className="block"
              style={{ width: MAGNIFIER_SIZE, height: MAGNIFIER_SIZE }}
            />
            <div className="absolute bottom-1 right-1 bg-black/70 rounded px-1.5 py-0.5 text-[9px] text-orange-400">
              {magnifierZoom}x
            </div>
          </div>
          <div className="flex items-center gap-1 mt-1 bg-black/60 rounded px-2 py-1">
            <span className="text-[9px] text-gray-500">倍率</span>
            <input
              type="range"
              min="2"
              max="16"
              step="1"
              value={magnifierZoom}
              onChange={(e) => setMagnifierZoom(parseInt(e.target.value))}
              className="flex-1 accent-orange-500 h-0.5"
            />
          </div>
        </div>
      )}
    </div>
  );
}
