# FrameForge MVP 增强功能实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 补全三个 MVP 增强功能：基准点标记交互、放大镜工具、展示与导出，为后续 AI 模块奠定基础。

**Architecture:** 在现有 Tauri v2 + React 架构上扩展。基准点和放大镜通过 ViewportPanel 的 canvas 覆盖层实现；展示模式在现有 FullscreenPreview 基础增强；导出增加 GIF/MP4 后端支持。

**Tech Stack:** Tauri v2, React 18, TypeScript, Rust, Zustand

---

## 文件结构

```
d:\Code\new\FrameForge\
├── src/
│   ├── components/
│   │   ├── viewport/
│   │   │   ├── BaselineOverlay.tsx       # 基准点标记覆盖层
│   │   │   └── MagnifierOverlay.tsx      # 放大镜覆盖层
│   │   ├── layout/
│   │   │   └── MenuBar.tsx               # 修改：全屏预览增强
│   │   ├── panels/
│   │   │   ├── ViewportPanel.tsx         # 修改：集成基准点和放大镜
│   │   │   └── PropertiesPanel.tsx       # 修改：基准点属性编辑
│   │   └── dialogs/
│   │       └── ExportDialog.tsx           # 新增：导出设置对话框
│   ├── hooks/
│   │   └── useBaselineMarker.ts          # 新增：基准点标记交互 hook
│   ├── stores/
│   │   ├── uiStore.ts                    # 修改：添加基准点/放大镜/导出状态
│   │   └── baselineStore.ts              # 新增：基准点状态管理
│   └── types/
│       └── baseline.ts                   # 新增：基准点类型定义
├── src-tauri/
│   └── src/
│       └── commands/
│           └── asset.rs                  # 修改：添加 GIF 导出命令
```

---

## Task 1: 基准点类型与状态管理

**Files:**
- Create: `src/types/baseline.ts`
- Create: `src/stores/baselineStore.ts`
- Modify: `src/stores/uiStore.ts` — 添加工具模式状态

- [ ] **Step 1: 创建基准点类型** `src/types/baseline.ts`

```typescript
export type BaselineType = "point" | "line" | "region";

export interface BaselinePoint {
  id: string;
  name: string;
  type: BaselineType;
  /** point: [x, y]; line: [x1, y1, x2, y2]; region: [x1, y1, x2, y2] */
  coordinates: number[];
  /** 标记所在帧索引 */
  frameIndex: number;
  /** 在视口中的像素颜色标记 */
  color: string;
}
```

- [ ] **Step 2: 创建基准点状态管理** `src/stores/baselineStore.ts`

```typescript
import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type { BaselinePoint, BaselineType } from "../types/baseline";
import { useProjectStore } from "./projectStore";

interface BaselineState {
  points: BaselinePoint[];
  activePointId: string | null;
  isMarkerMode: boolean;
  markerType: BaselineType;

  setPoints: (points: BaselinePoint[]) => void;
  addPoint: (point: BaselinePoint) => void;
  removePoint: (id: string) => void;
  updatePoint: (id: string, partial: Partial<BaselinePoint>) => void;
  setActivePoint: (id: string | null) => void;
  setMarkerMode: (active: boolean) => void;
  setMarkerType: (type: BaselineType) => void;
  clearAll: () => void;
}

const COLORS = ["#f97316", "#22c55e", "#3b82f6", "#ef4444", "#a855f7", "#eab308"];

export const useBaselineStore = create<BaselineState>((set, get) => ({
  points: [],
  activePointId: null,
  isMarkerMode: false,
  markerType: "point",

  setPoints: (points) => set({ points }),
  addPoint: (point) => {
    set((s) => ({ points: [...s.points, point] }));
    // 持久化到后端
    const project = useProjectStore.getState().project;
    if (project) {
      const pts = [...get().points];
      invoke("update_baseline_points", {
        projectId: project.id,
        pointsJson: JSON.stringify(pts),
      }).catch(console.error);
    }
  },
  removePoint: (id) => {
    set((s) => ({ points: s.points.filter((p) => p.id !== id), activePointId: s.activePointId === id ? null : s.activePointId }));
  },
  updatePoint: (id, partial) => {
    set((s) => ({
      points: s.points.map((p) => (p.id === id ? { ...p, ...partial } : p)),
    }));
  },
  setActivePoint: (id) => set({ activePointId: id }),
  setMarkerMode: (active) => set({ isMarkerMode: active }),
  setMarkerType: (type) => set({ markerType: type }),
  clearAll: () => set({ points: [], activePointId: null }),
}));

export function getNextColor(index: number): string {
  return COLORS[index % COLORS.length];
}
```

- [ ] **Step 3: 修改 uiStore 添加工具模式** `src/stores/uiStore.ts`

在 UIState 接口中添加：

```typescript
type ViewportTool = "select" | "baseline" | "magnifier";

// 添加到 UIState 接口：
viewportTool: ViewportTool;
setViewportTool: (tool: ViewportTool) => void;

// 添加到 store 默认值：
viewportTool: "select",
setViewportTool: (tool) => set({ viewportTool: tool }),
```

- [ ] **Step 4: 添加后端基准点命令** 修改 `src-tauri/src/commands/project.rs`

添加 `update_baseline_points` 和 `get_baseline_points` 命令：

```rust
#[tauri::command]
pub fn update_baseline_points(
    db: State<'_, DbState>,
    project_id: String,
    points_json: String,
) -> Result<(), String> {
    let conn = db.lock().map_err(|e| format!("数据库锁失败: {}", e))?;
    // 先删除旧的
    conn.execute("DELETE FROM baseline_points WHERE project_id = ?1", params![project_id])
        .map_err(|e| format!("删除旧基准点失败: {}", e))?;
    // 解析并插入新的
    let points: Vec<serde_json::Value> = serde_json::from_str(&points_json)
        .map_err(|e| format!("解析基准点失败: {}", e))?;
    for p in points {
        let id = p["id"].as_str().unwrap_or("").to_string();
        let name = p["name"].as_str().unwrap_or("").to_string();
        let pt_type = p["type"].as_str().unwrap_or("point").to_string();
        let coords = p["coordinates"].as_array()
            .map(|arr| arr.iter().filter_map(|v| v.as_f64()).collect::<Vec<_>>())
            .unwrap_or_default();
        let coords_str = serde_json::to_string(&coords).unwrap_or("[]".to_string());
        let frame_index = p["frameIndex"].as_i64().unwrap_or(0);
        conn.execute(
            "INSERT INTO baseline_points (id, project_id, name, type, coordinates, frame_index) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![id, project_id, name, pt_type, coords_str, frame_index],
        ).map_err(|e| format!("插入基准点失败: {}", e))?;
    }
    Ok(())
}

#[tauri::command]
pub fn get_baseline_points(
    db: State<'_, DbState>,
    project_id: String,
) -> Result<Vec<serde_json::Value>, String> {
    let conn = db.lock().map_err(|e| format!("数据库锁失败: {}", e))?;
    let mut stmt = conn
        .prepare("SELECT id, name, type, coordinates, frame_index FROM baseline_points WHERE project_id = ?1")
        .map_err(|e| format!("查询基准点失败: {}", e))?;
    let points = stmt.query_map(params![project_id], |row| {
        let id: String = row.get(0)?;
        let name: String = row.get(1)?;
        let pt_type: String = row.get(2)?;
        let coords_str: String = row.get(3)?;
        let frame_index: i64 = row.get(4)?;
        Ok(serde_json::json!({
            "id": id,
            "name": name,
            "type": pt_type,
            "coordinates": serde_json::from_str::<Vec<f64>>(&coords_str).unwrap_or_default(),
            "frameIndex": frame_index,
        }))
    }).map_err(|e| format!("读取基准点失败: {}", e))?
    .filter_map(|p| p.ok())
    .collect();
    Ok(points)
}
```

- [ ] **Step 5: 注册新命令** 修改 `src-tauri/src/lib.rs`

在 `invoke_handler` 中添加：

```rust
commands::project::update_baseline_points,
commands::project::get_baseline_points,
```

- [ ] **Step 6: Commit**

```bash
git add src/types/baseline.ts src/stores/baselineStore.ts src/stores/uiStore.ts src-tauri/src/commands/project.rs src-tauri/src/lib.rs
git commit -m "feat: 添加基准点类型、状态管理与后端持久化命令"
```

---

## Task 2: 基准点标记覆盖层

**Files:**
- Create: `src/hooks/useBaselineMarker.ts`
- Create: `src/components/viewport/BaselineOverlay.tsx`
- Modify: `src/components/panels/ViewportPanel.tsx` — 集成覆盖层

- [ ] **Step 1: 创建基准点标记 hook** `src/hooks/useBaselineMarker.ts`

```typescript
import { useCallback } from "react";
import { useBaselineStore, getNextColor } from "../stores/baselineStore";
import { useTimelineStore } from "../stores/timelineStore";
import { useUIStore } from "../stores/uiStore";
import type { BaselineType } from "../types/baseline";

interface MarkerResult {
  onCanvasClick: (e: React.MouseEvent<HTMLDivElement>) => void;
  onCanvasMouseMove: (e: React.MouseEvent<HTMLDivElement>) => void;
  onCanvasMouseUp: () => void;
  previewPoint: { x: number; y: number } | null;
  previewLine: { x1: number; y1: number; x2: number; y2 } | null;
}

export function useBaselineMarker(): MarkerResult {
  const isMarkerMode = useBaselineStore((s) => s.isMarkerMode);
  const markerType = useBaselineStore((s) => s.markerType);
  const addPoint = useBaselineStore((s) => s.addPoint);
  const points = useBaselineStore((s) => s.points);
  const currentFrame = useTimelineStore((s) => s.currentFrame);
  const viewportTool = useUIStore((s) => s.viewportTool);

  // 用于 line 类型的临时起点
  let lineStart: { x: number; y: number } | null = null;

  const getImageCoords = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    // 归一化坐标 0-1（相对于视口容器）
    return {
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
    };
  }, []);

  const onCanvasClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (viewportTool !== "baseline") return;
    const coords = getImageCoords(e);

    if (markerType === "point") {
      const point = {
        id: crypto.randomUUID(),
        name: `基准点 ${points.length + 1}`,
        type: "point" as BaselineType,
        coordinates: [coords.x, coords.y],
        frameIndex: currentFrame,
        color: getNextColor(points.length),
      };
      addPoint(point);
    }
    // line 和 region 类型在 mouseDown/mouseUp 中处理
  }, [viewportTool, markerType, points.length, currentFrame, addPoint, getImageCoords]);

  const onCanvasMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    // 预览功能由覆盖层自己处理
  }, []);

  const onCanvasMouseUp = useCallback(() => {
    // line/region 完成标记
  }, []);

  return {
    onCanvasClick,
    onCanvasMouseMove,
    onCanvasMouseUp,
    previewPoint: null,
    previewLine: null,
  };
}
```

- [ ] **Step 2: 创建基准点覆盖层** `src/components/viewport/BaselineOverlay.tsx`

```tsx
import { useState, useCallback, useRef, useEffect } from "react";
import { useBaselineStore, getNextColor } from "../../stores/baselineStore";
import { useTimelineStore } from "../../stores/timelineStore";
import { useUIStore } from "../../stores/uiStore";
import type { BaselineType, BaselinePoint } from "../../types/baseline";

interface Props {
  containerRect: DOMRect | null;
  imageRect: { x: number; y: number; width: number; height: number } | null;
}

export function BaselineOverlay({ containerRect, imageRect }: Props) {
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

  // 将归一化坐标转换为容器内像素坐标
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

  // 将容器像素坐标转换为归一化坐标
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
      } else if (markerType === "line") {
        setTempStart({ x: px, y: py });
        setTempEnd(null);
      } else if (markerType === "region") {
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

      // 拖拽已有点
      if (draggingPointId) {
        const norm = toNormalized(px, py);
        const store = useBaselineStore.getState();
        store.updatePoint(draggingPointId, { coordinates: [norm.x, norm.y] });
        return;
      }

      // line/region 预览
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

  // 右键删除
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
      {/* 渲染已有基准点 */}
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

      {/* 预览中的 line/region */}
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
```

- [ ] **Step 3: 修改 ViewportPanel 集成基准点覆盖层** `src/components/panels/ViewportPanel.tsx`

在 ViewportPanel 中添加：
1. 导入 BaselineOverlay 和 useUIStore 的 viewportTool
2. 追踪图片在容器中的位置和尺寸（通过 img element 的 getBoundingClientRect）
3. 在图片容器中渲染 BaselineOverlay
4. 当 viewportTool === "baseline" 时，阻止图片拖拽行为（isPanning 不触发）

关键修改点：

```tsx
// 在 import 区域添加：
import { BaselineOverlay } from "../viewport/BaselineOverlay";
import { useUIStore } from "../../stores/uiStore";

// 在 ViewportPanel 函数体内添加：
const viewportTool = useUIStore((s) => s.viewportTool);
const [imageRect, setImageRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
const imgRef = useRef<HTMLImageElement | null>(null);

// 更新 imageRect 的 effect：
useEffect(() => {
  if (!imgRef.current) return;
  const updateRect = () => {
    const container = containerRef.current;
    const img = imgRef.current;
    if (!container || !img) return;
    const containerRect = container.getBoundingClientRect();
    const imgRect = img.getBoundingClientRect();
    setImageRect({
      x: imgRect.left - containerRect.left,
      y: imgRect.top - containerRect.top,
      width: imgRect.width,
      height: imgRect.height,
    });
  };
  updateRect();
  const observer = new ResizeObserver(updateRect);
  if (containerRef.current) observer.observe(containerRef.current);
  return () => observer.disconnect();
}, [currentImage, viewZoom, viewPan]);

// 修改 handleMouseDown：当 viewportTool === "baseline" 时不触发平移
// 原有代码：if (e.button === 1 || (e.button === 0 && e.altKey))
// 改为：if ((e.button === 1 || (e.button === 0 && e.altKey)) && viewportTool !== "baseline")

// 在当前帧 img 标签上添加 ref：
// <img ref={imgRef} src={currentImage} ... />

// 在图片容器 div 的末尾（A/B 并排之前）添加：
// <BaselineOverlay containerRect={containerRef.current?.getBoundingClientRect() ?? null} imageRect={imageRect} />
```

- [ ] **Step 4: 修改 PropertiesPanel 的基准点标签** `src/components/panels/PropertiesPanel.tsx`

将 `BaselineInfo` 函数替换为完整的基准点管理面板：

```tsx
function BaselineInfo() {
  const points = useBaselineStore((s) => s.points);
  const activePointId = useBaselineStore((s) => s.activePointId);
  const setActivePoint = useBaselineStore((s) => s.setActivePoint);
  const removePoint = useBaselineStore((s) => s.removePoint);
  const markerType = useBaselineStore((s) => s.markerType);
  const setMarkerType = useBaselineStore((s) => s.setMarkerType);
  const isMarkerMode = useUIStore((s) => s.viewportTool) === "baseline";
  const setViewportTool = useUIStore((s) => s.setViewportTool);

  return (
    <div className="space-y-3">
      <div>
        <div className="text-gray-400 font-medium text-xs mb-2">标记工具</div>
        <div className="flex gap-1 mb-2">
          <button
            className={`flex-1 py-1.5 rounded text-xs ${isMarkerMode ? "bg-orange-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}
            onClick={() => setViewportTool(isMarkerMode ? "select" : "baseline")}
          >
            {isMarkerMode ? "退出标记" : "开始标记"}
          </button>
        </div>
        {isMarkerMode && (
          <div className="flex gap-1">
            {(["point", "line", "region"] as const).map((t) => (
              <button
                key={t}
                className={`flex-1 py-1 rounded text-[10px] ${markerType === t ? "bg-orange-600/30 text-orange-400 border border-orange-400" : "bg-gray-800 text-gray-500"}`}
                onClick={() => setMarkerType(t)}
              >
                {t === "point" ? "点" : t === "line" ? "线" : "区域"}
              </button>
            ))}
          </div>
        )}
      </div>

      {points.length > 0 && (
        <div>
          <div className="text-gray-400 font-medium text-xs mb-2">基准点列表</div>
          <div className="space-y-1">
            {points.map((p) => (
              <div
                key={p.id}
                className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer ${activePointId === p.id ? "bg-gray-700" : "hover:bg-gray-800"}`}
                onClick={() => setActivePoint(p.id)}
              >
                <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: p.color }} />
                <span className="text-xs text-gray-300 flex-1 truncate">{p.name}</span>
                <span className="text-[10px] text-gray-600">帧{p.frameIndex}</span>
                <span className="text-[10px] text-gray-600">{p.type}</span>
                <button className="text-[10px] text-red-500 hover:text-red-400" onClick={() => removePoint(p.id)}>✕</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {points.length === 0 && (
        <div className="text-[10px] text-gray-600 text-center py-4">
          在视口中点击添加基准点
        </div>
      )}
    </div>
  );
}
```

注意：在 PropertiesPanel 顶部添加导入：
```tsx
import { useBaselineStore } from "../../stores/baselineStore";
```

- [ ] **Step 5: Commit**

```bash
git add src/
git commit -m "feat: 实现基准点标记交互（点/线/区域）与覆盖层渲染"
```

---

## Task 3: 放大镜工具

**Files:**
- Create: `src/components/viewport/MagnifierOverlay.tsx`
- Modify: `src/components/panels/ViewportPanel.tsx` — 集成放大镜

- [ ] **Step 1: 创建放大镜覆盖层** `src/components/viewport/MagnifierOverlay.tsx`

```tsx
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
const MAGNIFIER_ZOOM = 4;

export function MagnifierOverlay({ containerRef, imageSrc, imageRect, viewZoom, viewPan }: Props) {
  const viewportTool = useUIStore((s) => s.viewportTool);
  const magnifierZoom = useUIStore((s) => s.magnifierZoom);
  const setMagnifierZoom = useUIStore((s) => s.setMagnifierZoom);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const isActive = viewportTool === "magnifier";

  // 预加载图片
  useEffect(() => {
    if (!imageSrc) return;
    const img = new Image();
    img.src = imageSrc;
    img.onload = () => { imgRef.current = img; };
    return () => { imgRef.current = null; };
  }, [imageSrc]);

  // 绘制放大区域
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

    // 鼠标在容器中的位置 → 图片中的位置
    const imgX = (pos.x - imageRect.x) / imageRect.width;
    const imgY = (pos.y - imageRect.y) / imageRect.height;

    // 源区域（图片上的小区域）
    const srcSize = size / zoom;
    const sx = imgX * img.naturalWidth - srcSize / 2;
    const sy = imgY * img.naturalHeight - srcSize / 2;

    ctx.clearRect(0, 0, size, size);
    ctx.imageSmoothingEnabled = false; // 像素级清晰

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
      className="absolute inset-0"
      style={{ cursor: "none" }}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      {pos && (
        <div
          className="absolute pointer-events-none z-20"
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
            {/* 倍率标签 */}
            <div className="absolute bottom-1 right-1 bg-black/70 rounded px-1.5 py-0.5 text-[9px] text-orange-400">
              {magnifierZoom}x
            </div>
          </div>
          {/* 缩放控制 */}
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
```

- [ ] **Step 2: 修改 ViewportPanel 集成放大镜** `src/components/panels/ViewportPanel.tsx`

在 ViewportPanel 中添加：
1. 导入 MagnifierOverlay
2. 在图片容器中渲染 MagnifierOverlay
3. 当 viewportTool === "magnifier" 时，阻止平移行为

关键修改点：

```tsx
// 在 import 区域添加：
import { MagnifierOverlay } from "../viewport/MagnifierOverlay";

// 在 return 的图片容器 div 中（BaselineOverlay 之后）添加：
// <MagnifierOverlay
//   containerRef={containerRef}
//   imageSrc={currentImage}
//   imageRect={imageRect}
//   viewZoom={viewZoom}
//   viewPan={viewPan}
// />

// 修改 handleMouseDown 条件，放大镜模式也不触发平移：
// if ((e.button === 1 || (e.button === 0 && e.altKey)) && viewportTool === "select")
```

- [ ] **Step 3: 在 AssetPanel 检查器标签中添加放大镜开关** `src/components/panels/AssetPanel.tsx`

在检查器标签的放大镜部分，替换占位文本：

```tsx
// 替换：<div className="text-[10px] text-gray-600">点击画面启用（功能开发中）</div>
// 为：
<div className="space-y-1">
  <button
    className={`w-full text-left px-2 py-1 rounded text-[10px] ${
      useUIStore.getState().viewportTool === "magnifier"
        ? "bg-orange-600/20 text-orange-400"
        : "text-gray-500 hover:bg-gray-800"
    }`}
    onClick={() => {
      const current = useUIStore.getState().viewportTool;
      useUIStore.getState().setViewportTool(current === "magnifier" ? "select" : "magnifier");
    }}
  >
    🔍 启用放大镜
  </button>
  <div className="text-[9px] text-gray-600 pl-2">在画面上移动鼠标查看像素细节</div>
</div>
```

- [ ] **Step 4: 添加快捷键 M 切换放大镜** 修改 `src/hooks/useKeyboardShortcuts.ts`

在 switch 语句中添加：

```typescript
case "m":
  e.preventDefault();
  const currentTool = useUIStore.getState().viewportTool;
  useUIStore.getState().setViewportTool(currentTool === "magnifier" ? "select" : "magnifier");
  break;
case "b":
  e.preventDefault();
  const curTool = useUIStore.getState().viewportTool;
  useUIStore.getState().setViewportTool(curTool === "baseline" ? "select" : "baseline");
  break;
```

在顶部添加导入：`import { useUIStore } from "../stores/uiStore";`

- [ ] **Step 5: Commit**

```bash
git add src/
git commit -m "feat: 实现放大镜工具（像素级查看、可调倍率、快捷键 M/B）"
```

---

## Task 4: 展示与导出增强

**Files:**
- Create: `src/components/dialogs/ExportDialog.tsx`
- Modify: `src/components/layout/MenuBar.tsx` — 增强全屏预览、导出对话框
- Modify: `src-tauri/src/commands/asset.rs` — 添加 GIF 导出

- [ ] **Step 1: 创建导出对话框** `src/components/dialogs/ExportDialog.tsx`

```tsx
import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useProjectStore } from "../../stores/projectStore";
import { useTimelineStore } from "../../stores/timelineStore";

type ExportFormat = "png_sequence" | "gif" | "mp4";

interface Props {
  onClose: () => void;
}

export function ExportDialog({ onClose }: Props) {
  const project = useProjectStore((s) => s.project);
  const tracks = useTimelineStore((s) => s.tracks);
  const fps = useTimelineStore((s) => s.fps);
  const totalFrames = useTimelineStore((s) => s.totalFrames);
  const [format, setFormat] = useState<ExportFormat>("png_sequence");
  const [exporting, setExporting] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const handleExport = async () => {
    if (!project) return;

    if (format === "png_sequence") {
      const selected = await openDialog({ directory: true, title: "选择导出目录" });
      if (!selected) return;
      setExporting(true);
      try {
        const count = await invoke<number>("export_png_sequence", {
          projectId: project.id,
          outputDir: selected,
        });
        setResult(`成功导出 ${count} 帧到:\n${selected}`);
      } catch (err) {
        setResult(`导出失败: ${err}`);
      } finally {
        setExporting(false);
      }
    } else if (format === "gif") {
      const selected = await openDialog({
        save: true,
        title: "保存 GIF 文件",
        filters: [{ name: "GIF", extensions: ["gif"] }],
      });
      if (!selected) return;
      setExporting(true);
      try {
        const count = await invoke<number>("export_gif", {
          projectId: project.id,
          outputPath: selected,
          fps,
        });
        setResult(`成功导出 GIF（${count} 帧）到:\n${selected}`);
      } catch (err) {
        setResult(`导出失败: ${err}`);
      } finally {
        setExporting(false);
      }
    }
  };

  const formats: { key: ExportFormat; label: string; desc: string; available: boolean }[] = [
    { key: "png_sequence", label: "PNG 序列帧", desc: "逐帧导出为 PNG 图片", available: true },
    { key: "gif", label: "GIF 动画", desc: "导出为 GIF 动画文件", available: true },
    { key: "mp4", label: "MP4 视频", desc: "导出为 MP4 视频文件", available: false },
  ];

  return (
    <div className="absolute inset-0 bg-black/80 flex items-center justify-center z-50">
      <div className="bg-gray-900 rounded-lg border border-gray-700 p-8 w-[500px] shadow-2xl">
        <h2 className="text-lg font-bold text-white mb-4">导出</h2>

        <div className="space-y-3 mb-4">
          <div className="text-xs text-gray-500">
            项目: {project?.name} | {totalFrames} 帧 | {fps} fps | {tracks.length} 轨道
          </div>

          {formats.map((f) => (
            <button
              key={f.key}
              className={`w-full text-left px-4 py-3 rounded-lg border ${
                format === f.key
                  ? "border-orange-400 bg-orange-600/10"
                  : "border-gray-700 hover:border-gray-500"
              } ${!f.available ? "opacity-40 cursor-not-allowed" : ""}`}
              onClick={() => f.available && setFormat(f.key)}
              disabled={!f.available}
            >
              <div className="flex items-center justify-between">
                <span className={`text-sm ${format === f.key ? "text-orange-400" : "text-gray-300"}`}>
                  {f.label}
                </span>
                {!f.available && <span className="text-[10px] text-gray-600">即将支持</span>}
              </div>
              <div className="text-[10px] text-gray-500 mt-1">{f.desc}</div>
            </button>
          ))}
        </div>

        {result && (
          <div className="mb-4 p-3 bg-gray-800 rounded text-xs text-gray-300 whitespace-pre-wrap">
            {result}
          </div>
        )}

        <div className="flex gap-3">
          <button
            className="flex-1 py-2 bg-gray-800 hover:bg-gray-700 rounded text-sm text-gray-300"
            onClick={onClose}
            disabled={exporting}
          >
            {result ? "关闭" : "取消"}
          </button>
          <button
            className="flex-1 py-2 bg-orange-600 hover:bg-orange-500 rounded text-sm font-medium text-white disabled:opacity-50"
            onClick={handleExport}
            disabled={exporting}
          >
            {exporting ? "导出中..." : "导出"}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 添加 GIF 导出后端命令** 修改 `src-tauri/src/commands/asset.rs`

在文件末尾添加 GIF 导出函数：

```rust
/// 导出当前项目为 GIF 动画
#[tauri::command]
pub fn export_gif(
    db: State<'_, DbState>,
    project_id: String,
    output_path: String,
    fps: i64,
) -> Result<usize, String> {
    let conn = db.lock().map_err(|e| format!("数据库锁失败: {}", e))?;

    // 收集所有帧路径（按轨道顺序、按帧排序）
    let mut track_stmt = conn
        .prepare("SELECT id FROM tracks WHERE project_id = ?1 ORDER BY track_order")
        .map_err(|e| format!("查询轨道失败: {}", e))?;

    let track_ids: Vec<String> = track_stmt
        .query_map(params![project_id], |row| row.get(0))
        .map_err(|e| format!("读取轨道失败: {}", e))?
        .filter_map(|t| t.ok())
        .collect();
    drop(track_stmt);

    let mut frame_paths: Vec<String> = Vec::new();
    for track_id in &track_ids {
        let mut asset_stmt = conn
            .prepare("SELECT source_path FROM assets WHERE track_id = ?1 ORDER BY start_frame")
            .map_err(|e| format!("查询资产失败: {}", e))?;

        let paths: Vec<String> = asset_stmt
            .query_map(params![track_id], |row| row.get(0))
            .map_err(|e| format!("读取资产失败: {}", e))?
            .filter_map(|p| p.ok())
            .collect();

        frame_paths.extend(paths);
    }

    if frame_paths.is_empty() {
        return Err("没有可导出的帧".to_string());
    }

    // 使用 image crate 编码 GIF
    use std::io::BufWriter;
    use std::fs::File;

    let output_file = File::create(&output_path)
        .map_err(|e| format!("创建输出文件失败: {}", e))?;
    let mut writer = BufWriter::new(output_file);

    let frame_delay = (100.0 / fps as f64).round() as u16; // GIF 延迟单位: 10ms

    // 编码 GIF
    let mut encoder = image::codecs::gif::GifEncoder::new(&mut writer);
    encoder.set_repeat(image::codecs::gif::Repeat::Infinite)
        .map_err(|e| format!("设置 GIF 循环失败: {}", e))?;

    for (i, path) in frame_paths.iter().enumerate() {
        let src = Path::new(path);
        if !src.exists() { continue; }

        let img = image::io::Reader::open(path)
            .map_err(|e| format!("打开帧 {} 失败: {}", i, e))?
            .decode()
            .map_err(|e| format!("解码帧 {} 失败: {}", i, e))?;

        let rgba = img.to_rgba8();

        encoder.encode_frame(rgba)
            .map_err(|e| format!("编码帧 {} 失败: {}", i, e))?;
    }

    drop(encoder);
    drop(writer);

    Ok(frame_paths.len())
}
```

注意：需要在帧编码前设置帧延迟。GifEncoder 需要通过 `encode` 方法设置每帧延迟。由于 `image` crate 的 GIF 编码器 API 限制，实际实现需要使用 `image::codecs::gif::GifEncoder::encode()` 方法配合 `Frame`：

```rust
// 替换 encoder.encode_frame() 为：
let mut frame = image::Frame::from(rgba);
frame.delay = image::Delay::from_numer_denom_ms(frame_delay * 10, 1);
encoder.encode(&frame)
    .map_err(|e| format!("编码帧 {} 失败: {}", i, e))?;
```

- [ ] **Step 3: 注册 GIF 导出命令** 修改 `src-tauri/src/lib.rs`

在 invoke_handler 中添加：

```rust
commands::asset::export_gif,
```

- [ ] **Step 4: 修改 MenuBar 的导出菜单** `src/components/layout/MenuBar.tsx`

将导出菜单项中的 `alert` 替换为打开 ExportDialog：

1. 在 MenuBar 组件中添加状态：
```tsx
const [showExport, setShowExport] = useState(false);
```

2. 导入 ExportDialog：
```tsx
import { ExportDialog } from "../dialogs/ExportDialog";
```

3. 将"导出 PNG 序列帧"的 action 改为：
```tsx
{ label: "导出...", action: () => action(() => setShowExport(true)) },
```

4. 在 MenuBar return 的末尾（FullscreenPreview 之后）添加：
```tsx
{showExport && <ExportDialog onClose={() => setShowExport(false)} />}
```

- [ ] **Step 5: 增强全屏预览使用 asset protocol** 修改 `src/components/layout/MenuBar.tsx`

将 FullscreenPreview 中的 `read_image_as_base64` 替换为 `convertFileSrc`（零内存开销）：

```tsx
// 在 FullscreenPreview 顶部添加导入：
import { convertFileSrc } from "@tauri-apps/api/core";

// 替换 useEffect 中的 invoke：
useEffect(() => {
  if (currentAsset) {
    setImgSrc(convertFileSrc(currentAsset.sourcePath));
  } else {
    setImgSrc(null);
  }
}, [currentAsset]);
```

- [ ] **Step 6: Commit**

```bash
git add src/ src-tauri/
git commit -m "feat: 实现导出对话框（PNG序列/GIF）、增强全屏预览性能"
```

---

## Task 5: 编译验证与整合

**Files:**
- Modify: 各文件根据编译错误修正

- [ ] **Step 1: 安装依赖并编译前端**

```bash
cd d:\Code\new\FrameForge
npm run build
```

Expected: TypeScript 编译通过，无类型错误。

- [ ] **Step 2: 编译 Rust 后端**

```bash
npm run tauri build -- --debug
```

Expected: Rust 编译通过，无错误。

- [ ] **Step 3: 运行并验证**

```bash
npm run tauri dev
```

Expected:
1. 创建项目，导入图片帧
2. 按 B 进入基准点标记模式，在画面上点击添加点/线/区域
3. 按 M 进入放大镜模式，鼠标悬停查看像素
4. 菜单栏 → 导出 → 导出对话框正常工作
5. 全屏预览性能流畅

- [ ] **Step 4: 修复所有编译错误**

根据编译输出修复所有 TypeScript 类型错误和 Rust 编译错误。

- [ ] **Step 5: 最终 Commit**

```bash
git add -A
git commit -m "feat: MVP 增强功能完成 — 基准点标记、放大镜、展示与导出"
```

---

## 总计

| 指标 | 数量 |
|------|------|
| Tasks | 5 |
| 新建文件 | 5 |
| 修改文件 | 7 |
| 核心功能 | 基准点标记（点/线/区域）、放大镜工具、导出对话框（PNG/GIF）、全屏预览增强 |
| 可并行 | Task 2 和 Task 3 可并行（基准点和放大镜互不依赖） |
