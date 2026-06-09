import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useAnalysisStore } from "../stores/analysisStore";

export function useAnalysisProgress() {
  const isAnalyzing = useAnalysisStore((s) => s.isAnalyzing);

  useEffect(() => {
    if (!isAnalyzing) return;

    const unlisten = listen<{ stage: string; current: number; total: number }>(
      "analysis-progress",
      (event) => {
        useAnalysisStore.setState({ progress: event.payload });
      }
    );

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [isAnalyzing]);
}
