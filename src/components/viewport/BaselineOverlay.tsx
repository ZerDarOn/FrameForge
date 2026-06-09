import { useState, useCallback, useRef } from "react";
import { useBaselineStore, getNextColor } from "../../stores/baselineStore";
import { useTimelineStore } from "../../stores/timelineStore";
import { useUIStore } from "../../stores/uiStore";
import type { BaselineType, BaselinePoint } from "../../types/baseline";

interface Props {
  imageRect: { x: number; y: number; width: number; height: number } | null;
}

export function BaselineOverlay({ imageRect }: Props) {
  const points = useBaselineStore((s) => s.points);
  const activePointId = useBaselineStore((s) => s.activePointId);
  const markerType = useBaselineStore((s) => s.markerType);
  const addPoint = useBaselineStore((s) => s.addPoint);
  const setActivePoint = useBaselineStore((s) => s.setActivePoint);
  const removePoint = useBaselineStore((s) => s.removePoint);
  const currentFrame = useTimelineStore((s) => s.currentFrame);
  const viewportTool = useUIStore((s) => s.viewportTool);

  const [tempStart, setTempStart] = useState<{ x: number; y: number } | null>(null);
  const [tempEnd, setTempEnd] = useState<{ x: number; y: number } | null>(null);
  const [draggingPointId, setDraggingPointId] = useState<string | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  const isMarkerMode = viewportTool === "baseline";

  const toPixel = useCallback(
    (nx: number, ny: number) => {
      if (!imageRect) return { x: 0, y: 0 };
      return {
        x: imageRect.x + nx * imageRect.width,
        y: imageRect.y + ny * imageRect.height,
      };
    },
    [imageRect]
  );

  const toNormalized = useCallback(
    (px: number, py: number) => {
      if (!imageRect || imageRect.width === 0 || imageRect.height === 0) return { x: 0, y: 0 };
      return {
        x: Math.max(0, Math.min(1, (px - imageRect.x) / imageRect.width)),
        y: Math.max(0, Math.min(1, (py - imageRect.y) / imageRect.height)),
      };
    },
    [imageRect]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (!isMarkerMode || !imageRect) return;
      e.stopPropagation();
      const rect = overlayRef.current!.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;

      // 检查是否点击了已有的点（拖拽）
      const hitRadius = 12;
      for (const p of points) {
        if (p.type === "point") {
          const pp = toPixel(p.coordinates[0], p.coordinates[1]);
          const dist = Math.sqrt((px - pp.x) ** 2 + (py - pp.y) ** 2);
          if (dist < hitRadius) {
            setDraggingPointId(p.id);
            setActivePoint(p.id);
            return;
          }
        }
      }

      const norm = toNormalized(px, py);

      if (markerType === "point") {
        const point: BaselinePoint = {
          id: crypto.randomUUID(),
          name: `基准点 ${points.length + 1}`,
          type: "point",
          coordinates: [norm.x, norm.y],
          frameIndex: currentFrame,
          color: getNextColor(points.length),
        };
        addPoint(point);
      } else {
        // line 或 region：记录起点
        setTempStart({ x: px, y: py });
        setTempEnd(null);
      }
    },
    [isMarkerMode, markerType, points, currentFrame, imageRect, addPoint, setActivePoint, toPixel, toNormalized]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isMarkerMode || !imageRect) return;
      const rect = overlayRef.current!.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;

      if (draggingPointId) {
        const norm = toNormalized(px, py);
        useBaselineStore.getState().updatePoint(draggingPointId, { coordinates: [norm.x, norm.y] });
        return;
      }

      if (tempStart) {
        setTempEnd({ x: px, y: py });
      }
    },
    [isMarkerMode, draggingPointId, tempStart, imageRect, toNormalized]
  );

  const handleMouseUp = useCallback(
    (e: React.MouseEvent) => {
      if (draggingPointId) {
        setDraggingPointId(null);
        return;
      }

      if (!isMarkerMode || !tempStart || !imageRect) return;
      const rect = overlayRef.current!.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;

      const normStart = toNormalized(tempStart.x, tempStart.y);
      const normEnd = toNormalized(px, py);

      if (markerType === "line") {
        const point: BaselinePoint = {
          id: crypto.randomUUID(),
          name: `基准线 ${points.length + 1}`,
          type: "line",
          coordinates: [normStart.x, normStart.y, normEnd.x, normEnd.y],
          frameIndex: currentFrame,
          color: getNextColor(points.length),
        };
        addPoint(point);
      } else if (markerType === "region") {
        const point: BaselinePoint = {
          id: crypto.randomUUID(),
          name: `基准区域 ${points.length + 1}`,
          type: "region",
          coordinates: [
            Math.min(normStart.x, normEnd.x),
            Math.min(normStart.y, normEnd.y),
            Math.max(normStart.x, normEnd.x),
            Math.max(normStart.y, normEnd.y),
          ],
          frameIndex: currentFrame,
          color: getNextColor(points.length),
        };
        addPoint(point);
      }

      setTempStart(null);
      setTempEnd(null);
    },
    [isMarkerMode, markerType, tempStart, points.length, currentFrame, imageRect, addPoint, draggingPointId, toNormalized]
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      if (!isMarkerMode) return;
      e.preventDefault();
      if (activePointId) {
        removePoint(activePointId);
      }
    },
    [isMarkerMode, activePointId, removePoint]
  );

  if (!isMarkerMode && points.length === 0) return null;

  return (
    <div
      ref={overlayRef}
      className="absolute inset-0"
      style={{ cursor: isMarkerMode ? "crosshair" : "default" }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onContextMenu={handleContextMenu}
    >
      {points.map((p) => {
        if (p.type === "point") {
          const px = toPixel(p.coordinates[0], p.coordinates[1]);
          return (
            <div
              key={p.id}
              className="absolute w-4 h-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2"
              style={{
                left: px.x,
                top: px.y,
                borderColor: p.color,
                backgroundColor: activePointId === p.id ? p.color : "transparent",
              }}
              title={p.name}
            />
          );
        }
        if (p.type === "line") {
          const p1 = toPixel(p.coordinates[0], p.coordinates[1]);
          const p2 = toPixel(p.coordinates[2], p.coordinates[3]);
          return (
            <svg key={p.id} className="absolute inset-0 w-full h-full pointer-events-none">
              <line
                x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y}
                stroke={p.color} strokeWidth={2}
                strokeDasharray={activePointId === p.id ? "6 3" : "none"}
              />
            </svg>
          );
        }
        if (p.type === "region") {
          const topLeft = toPixel(p.coordinates[0], p.coordinates[1]);
          const bottomRight = toPixel(p.coordinates[2], p.coordinates[3]);
          return (
            <div
              key={p.id}
              className="absolute border-2"
              style={{
                left: topLeft.x,
                top: topLeft.y,
                width: bottomRight.x - topLeft.x,
                height: bottomRight.y - topLeft.y,
                borderColor: p.color,
                backgroundColor: activePointId === p.id ? `${p.color}20` : "transparent",
              }}
            />
          );
        }
        return null;
      })}

      {tempStart && tempEnd && (
        <>
          {markerType === "line" && (
            <svg className="absolute inset-0 w-full h-full pointer-events-none">
              <line
                x1={tempStart.x} y1={tempStart.y} x2={tempEnd.x} y2={tempEnd.y}
                stroke="#f97316" strokeWidth={2} strokeDasharray="4 4"
              />
            </svg>
          )}
          {markerType === "region" && (
            <div
              className="absolute border-2 border-dashed border-orange-400 bg-orange-400/10"
              style={{
                left: Math.min(tempStart.x, tempEnd.x),
                top: Math.min(tempStart.y, tempEnd.y),
                width: Math.abs(tempEnd.x - tempStart.x),
                height: Math.abs(tempEnd.y - tempStart.y),
              }}
            />
          )}
        </>
      )}
    </div>
  );
}
