import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type { AiConfig } from "../types/ai";

interface AiConfigState {
  config: AiConfig | null;
  loading: boolean;

  loadConfig: () => Promise<void>;
  setApiKey: (providerId: string, key: string) => Promise<void>;
  toggleProvider: (providerId: string) => Promise<void>;
  setDefaultProvider: (type: "analysis" | "generation", providerId: string) => Promise<void>;
}

export const useAiConfigStore = create<AiConfigState>((set, get) => ({
  config: null,
  loading: false,

  loadConfig: async () => {
    set({ loading: true });
    try {
      const config = await invoke<AiConfig>("get_ai_config");
      set({ config });
    } catch (err) {
      console.error("加载 AI 配置失败:", err);
    } finally {
      set({ loading: false });
    }
  },

  setApiKey: async (providerId, key) => {
    try {
      await invoke("set_ai_api_key", { providerId, key });
      const config = { ...get().config! };
      config.apiKeys = { ...config.apiKeys, [providerId]: "••••••••" };
      set({ config });
    } catch (err) {
      console.error("设置 API Key 失败:", err);
    }
  },

  toggleProvider: async (providerId) => {
    try {
      const config = await invoke<AiConfig>("toggle_ai_provider", { providerId });
      set({ config });
    } catch (err) {
      console.error("切换 Provider 失败:", err);
    }
  },

  setDefaultProvider: async (type, providerId) => {
    try {
      const config = await invoke<AiConfig>("set_default_ai_provider", { type, providerId });
      set({ config });
    } catch (err) {
      console.error("设置默认 Provider 失败:", err);
    }
  },
}));
