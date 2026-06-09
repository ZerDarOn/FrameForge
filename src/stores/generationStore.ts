import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type { TextToPixelParams, GeneratedAsset } from "../types/generation";

interface GenerationState {
  assets: GeneratedAsset[];
  isGenerating: boolean;
  progress: { stage: string; current: number; total: number } | null;
  error: string | null;

  loadAssets: (projectId: string) => Promise<void>;
  generate: (projectId: string, params: TextToPixelParams) => Promise<void>;
  deleteAsset: (assetId: string) => Promise<void>;
  addToTimeline: (assetId: string, trackId: string | null, projectId: string) => Promise<string>;
}

export const useGenerationStore = create<GenerationState>((set) => ({
  assets: [],
  isGenerating: false,
  progress: null,
  error: null,

  loadAssets: async (projectId) => {
    try {
      const assets = await invoke<GeneratedAsset[]>("list_generated_assets", { projectId });
      set({ assets });
    } catch (err) {
      console.error("加载生成资产失败:", err);
    }
  },

  generate: async (projectId, params) => {
    set({ isGenerating: true, progress: null, error: null });
    try {
      const newAssets = await invoke<GeneratedAsset[]>("generate_pixel_art", { projectId, params });
      set((s) => ({
        assets: [...newAssets, ...s.assets],
        isGenerating: false,
        progress: null,
      }));
    } catch (err) {
      set({ isGenerating: false, progress: null, error: String(err) });
    }
  },

  deleteAsset: async (assetId) => {
    try {
      await invoke("delete_generated_asset", { assetId });
      set((s) => ({ assets: s.assets.filter((a) => a.id !== assetId) }));
    } catch (err) {
      console.error("删除生成资产失败:", err);
    }
  },

  addToTimeline: async (assetId, trackId, projectId) => {
    const tid = await invoke<string>("add_generated_to_timeline", { assetId, trackId, projectId });
    return tid;
  },
}));
