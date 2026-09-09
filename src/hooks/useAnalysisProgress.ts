import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  useAnalysisStore,
  type AnalysisProgressEvent,
} from "../stores/analysisStore";
import { isTauriRuntime } from "../core/runtime";

/**
 * 始终监听 Rust 后端发出的 analysis-progress 事件，
 * 写入 analysisStore.progress。UI 组件通过 isAnalyzing 门控显示。
 */
export function useAnalysisProgress() {
  useEffect(() => {
    let unlistenFn: (() => void) | null = null;
    if (!isTauriRuntime()) return;

    void listen<AnalysisProgressEvent>(
      "analysis-progress",
      (event) => {
        useAnalysisStore.getState().handleProgress(event.payload);
      }
    )
      .then((fn) => {
        unlistenFn = fn;
      })
      .catch((error) => {
        console.info("[FrameForge] analysis progress listener unavailable", {
          reason: error instanceof Error ? error.name : "unknown",
        });
      });

    return () => {
      unlistenFn?.();
    };
  }, []);
}
