import { create } from "zustand";
import type { ThumbnailQuality } from "../hooks/useThumbnail";

type PanelTab = "assets" | "inspector" | "ai";
type PropertiesTab = "info" | "baseline" | "ai" | "transform";
export type ViewportTool = "select" | "baseline" | "magnifier";

const UI_STORAGE_KEY = "frameforge-ui-state";

interface PersistedUIState {
  sidebarWidth: number;
  propertiesWidth: number;
  timelineHeight: number;
  onionSkinEnabled: boolean;
  onionSkinOpacity: number;
  onionSkinFrames: number;
  thumbnailQuality: ThumbnailQuality;
}

/** 仅持久化布局和偏好设置，不保存临时状态（如当前工具、标签页） */
function loadPersistedState(): Partial<PersistedUIState> {
  try {
    const raw = localStorage.getItem(UI_STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function persistState(state: UIState) {
  try {
    const data: PersistedUIState = {
      sidebarWidth: state.sidebarWidth,
      propertiesWidth: state.propertiesWidth,
      timelineHeight: state.timelineHeight,
      onionSkinEnabled: state.onionSkinEnabled,
      onionSkinOpacity: state.onionSkinOpacity,
      onionSkinFrames: state.onionSkinFrames,
      thumbnailQuality: state.thumbnailQuality,
    };
    localStorage.setItem(UI_STORAGE_KEY, JSON.stringify(data));
  } catch {
    // localStorage 不可用时静默失败（无痕模式等）
  }
}

interface UIState {
  viewportTool: ViewportTool;
  sidebarTab: PanelTab;
  propertiesTab: PropertiesTab;
  sidebarWidth: number;
  propertiesWidth: number;
  timelineHeight: number;
  onionSkinEnabled: boolean;
  onionSkinOpacity: number;
  onionSkinFrames: number;
  magnifierEnabled: boolean;
  magnifierZoom: number;
  thumbnailQuality: ThumbnailQuality;

  setSidebarTab: (tab: PanelTab) => void;
  setPropertiesTab: (tab: PropertiesTab) => void;
  setSidebarWidth: (w: number) => void;
  setPropertiesWidth: (w: number) => void;
  setTimelineHeight: (h: number) => void;
  setOnionSkinEnabled: (v: boolean) => void;
  setOnionSkinOpacity: (v: number) => void;
  setOnionSkinFrames: (n: number) => void;
  setMagnifierEnabled: (v: boolean) => void;
  setMagnifierZoom: (v: number) => void;
  setThumbnailQuality: (q: ThumbnailQuality) => void;
  setViewportTool: (tool: ViewportTool) => void;
}

export const useUIStore = create<UIState>((set) => {
  const persisted = loadPersistedState();

  // 包装 setter：写入后自动持久化
  function persist(setter: Partial<UIState>) {
    set((state) => {
      const next = { ...state, ...setter };
      persistState(next);
      return setter;
    });
  }

  return {
    viewportTool: "select",
    sidebarTab: "assets",
    propertiesTab: "info",
    sidebarWidth: persisted.sidebarWidth ?? 260,
    propertiesWidth: persisted.propertiesWidth ?? 300,
    timelineHeight: persisted.timelineHeight ?? 240,
    onionSkinEnabled: persisted.onionSkinEnabled ?? false,
    onionSkinOpacity: persisted.onionSkinOpacity ?? 0.3,
    onionSkinFrames: persisted.onionSkinFrames ?? 2,
    magnifierEnabled: false,
    magnifierZoom: 4,
    thumbnailQuality: persisted.thumbnailQuality ?? "high",

    setSidebarTab: (tab) => set({ sidebarTab: tab }),
    setPropertiesTab: (tab) => set({ propertiesTab: tab }),
    setSidebarWidth: (w) => persist({ sidebarWidth: w }),
    setPropertiesWidth: (w) => persist({ propertiesWidth: w }),
    setTimelineHeight: (h) => persist({ timelineHeight: h }),
    setOnionSkinEnabled: (v) => persist({ onionSkinEnabled: v }),
    setOnionSkinOpacity: (v) => persist({ onionSkinOpacity: v }),
    setOnionSkinFrames: (n) => persist({ onionSkinFrames: n }),
    setMagnifierEnabled: (v) => set({ magnifierEnabled: v }),
    setMagnifierZoom: (v) => set({ magnifierZoom: v }),
    setThumbnailQuality: (q) => persist({ thumbnailQuality: q }),
    setViewportTool: (tool) => set({ viewportTool: tool }),
  };
});
