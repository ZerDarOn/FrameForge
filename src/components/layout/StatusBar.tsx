import { useTimelineStore } from "../../stores/timelineStore";
import { useProjectStore } from "../../stores/projectStore";
import { useAnimationDocumentStore } from "../../stores/animationDocumentStore";

export function StatusBar() {
  const currentFrame = useTimelineStore((s) => s.currentFrame);
  const totalFrames = useTimelineStore((s) => s.totalFrames);
  const fps = useTimelineStore((s) => s.fps);
  const trackCount = useTimelineStore((s) => s.tracks.length);
  const isPlaying = useTimelineStore((s) => s.isPlaying);
  const zoom = useTimelineStore((s) => s.viewport.zoom);
  const project = useProjectStore((s) => s.project);
  const loadStatus = useProjectStore((s) => s.loadStatus);
  const loadError = useProjectStore((s) => s.loadError);
  const saveStatus = useAnimationDocumentStore((s) => s.saveStatus);
  const saveError = useAnimationDocumentStore((s) => s.error);
  const retrySave = useAnimationDocumentStore((s) => s.retrySave);
  const saveLabel =
    saveStatus === "saving"
      ? "保存中…"
      : saveStatus === "error"
        ? "保存失败"
        : saveStatus === "saved"
          ? "已保存"
          : "就绪";
  const lifecycleLabel =
    loadStatus === "loading"
      ? "项目加载中…"
      : loadStatus === "error"
        ? "项目加载失败"
        : saveLabel;

  return (
    <div className="flex items-center h-6 bg-gray-950 border-t border-gray-700 px-3 text-xs text-gray-500 gap-4">
      {project && <span className="text-gray-400">{project.name}</span>}
      <span>帧: {currentFrame}/{totalFrames}</span>
      <span>{fps} fps</span>
      <span>{trackCount} 轨道</span>
      <span>{Math.round(zoom * 100)}%</span>
      {isPlaying && (
        <span className="text-orange-400 animate-pulse">播放中</span>
      )}
      <div className="ml-auto flex items-center gap-2" title={loadError ?? saveError ?? undefined}>
        <span
          className={loadStatus === "error" || saveStatus === "error" ? "text-red-400" : loadStatus === "loading" || saveStatus === "saving" ? "text-amber-400" : "text-green-600"}
        >
          {lifecycleLabel}
        </span>
        {loadStatus !== "loading" && saveStatus === "error" && (
          <button
            type="button"
            className="rounded bg-red-950 px-1.5 text-red-300 hover:bg-red-900"
            onClick={retrySave}
          >
            重试
          </button>
        )}
      </div>
    </div>
  );
}
