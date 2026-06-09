import { useEffect } from "react";
import { useTimelineStore, undo, redo } from "../stores/timelineStore";
import { useUIStore } from "../stores/uiStore";

export function useKeyboardShortcuts() {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;

      const state = useTimelineStore.getState();
      const { currentFrame, totalFrames, selectedAssetId, viewport } = state;
      const { zoom } = viewport;

      switch (e.key) {
        case "ArrowLeft":
          e.preventDefault();
          state.setCurrentFrame(Math.max(0, currentFrame - 1));
          break;
        case "ArrowRight":
          e.preventDefault();
          state.setCurrentFrame(Math.min(totalFrames - 1, currentFrame + 1));
          break;
        case " ":
          e.preventDefault();
          state.togglePlay();
          break;
        case "Home":
          e.preventDefault();
          state.setCurrentFrame(0);
          break;
        case "End":
          e.preventDefault();
          state.setCurrentFrame(Math.max(0, totalFrames - 1));
          break;
        case "Escape":
          e.preventDefault();
          state.setPlaying(false);
          break;
        case ",":
          e.preventDefault();
          state.setCurrentFrame(Math.max(0, currentFrame - 1));
          break;
        case ".":
          e.preventDefault();
          state.setCurrentFrame(Math.min(totalFrames - 1, currentFrame + 1));
          break;
        case "Delete":
        case "Backspace":
          if (selectedAssetId) {
            e.preventDefault();
            const track = state.tracks.find((t) =>
              t.assets.some((a) => a.id === selectedAssetId)
            );
            if (track) state.deleteAsset(track.id, selectedAssetId);
          }
          break;
        case "d":
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            if (selectedAssetId) {
              const track = state.tracks.find((t) =>
                t.assets.some((a) => a.id === selectedAssetId)
              );
              if (track) state.duplicateAsset(track.id, selectedAssetId);
            }
          }
          break;
        case "+":
        case "=":
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            state.setViewport({ zoom: Math.min(3, zoom + 0.25) });
          }
          break;
        case "-":
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            state.setViewport({ zoom: Math.max(0.25, zoom - 0.25) });
          }
          break;
        case "z":
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            undo();
          }
          break;
        case "y":
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            redo();
          }
          break;
        case "n":
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            window.location.reload();
          }
          break;
        case "o":
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            window.dispatchEvent(new CustomEvent("frameforge:show-welcome"));
          }
          break;
        case "m":
          e.preventDefault();
          const curMagTool = useUIStore.getState().viewportTool;
          useUIStore.getState().setViewportTool(curMagTool === "magnifier" ? "select" : "magnifier");
          break;
        case "b":
          e.preventDefault();
          const curBaseTool = useUIStore.getState().viewportTool;
          useUIStore.getState().setViewportTool(curBaseTool === "baseline" ? "select" : "baseline");
          break;
      }
    };

    // 时间线区域鼠标滚轮缩放
    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const state = useTimelineStore.getState();
        const { zoom } = state.viewport;
        const delta = e.deltaY > 0 ? -0.25 : 0.25;
        state.setViewport({ zoom: Math.max(0.25, Math.min(3, zoom + delta)) });
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("wheel", handleWheel);
    };
  }, []);
}
