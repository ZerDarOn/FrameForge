import { create } from "zustand";
import type { ThumbnailQuality } from "../hooks/useThumbnail";

type PanelTab = "assets" | "inspector" | "ai";
type PropertiesTab = "info" | "baseline" | "ai" | "transform";
export type ViewportTool = "select" | "baseline" | "magnifier";

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

export const useUIStore = create<UIState>((set) => ({
  viewportTool: "select",
  sidebarTab: "assets",
  propertiesTab: "info",
  sidebarWidth: 260,
  propertiesWidth: 300,
  timelineHeight: 240,
  onionSkinEnabled: false,
  onionSkinOpacity: 0.3,
  onionSkinFrames: 2,
  magnifierEnabled: false,
  magnifierZoom: 4,
  thumbnailQuality: "high",

  setSidebarTab: (tab) => set({ sidebarTab: tab }),
  setPropertiesTab: (tab) => set({ propertiesTab: tab }),
  setSidebarWidth: (w) => set({ sidebarWidth: w }),
  setPropertiesWidth: (w) => set({ propertiesWidth: w }),
  setTimelineHeight: (h) => set({ timelineHeight: h }),
  setOnionSkinEnabled: (v) => set({ onionSkinEnabled: v }),
  setOnionSkinOpacity: (v) => set({ onionSkinOpacity: v }),
  setOnionSkinFrames: (n) => set({ onionSkinFrames: n }),
  setMagnifierEnabled: (v) => set({ magnifierEnabled: v }),
  setMagnifierZoom: (v) => set({ magnifierZoom: v }),
  setThumbnailQuality: (q) => set({ thumbnailQuality: q }),
  setViewportTool: (tool) => set({ viewportTool: tool }),
}));
