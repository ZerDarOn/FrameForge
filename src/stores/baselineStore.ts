import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type { BaselinePoint, BaselineType } from "../types/baseline";

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
  /** 将当前基准点持久化到后端数据库 */
  persist: (projectId: string) => Promise<void>;
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
  },
  removePoint: (id) => {
    set((s) => ({
      points: s.points.filter((p) => p.id !== id),
      activePointId: s.activePointId === id ? null : s.activePointId,
    }));
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

  persist: async (projectId) => {
    const points = get().points;
    try {
      await invoke("update_baseline_points", {
        projectId,
        pointsJson: JSON.stringify(points),
      });
    } catch (err) {
      console.error("持久化基准点失败:", err);
    }
  },
}));

export function getNextColor(index: number): string {
  return COLORS[index % COLORS.length];
}
