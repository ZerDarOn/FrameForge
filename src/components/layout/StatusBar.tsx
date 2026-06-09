import { useTimelineStore } from "../../stores/timelineStore";
import { useProjectStore } from "../../stores/projectStore";

export function StatusBar() {
  const currentFrame = useTimelineStore((s) => s.currentFrame);
  const totalFrames = useTimelineStore((s) => s.totalFrames);
  const fps = useTimelineStore((s) => s.fps);
  const trackCount = useTimelineStore((s) => s.tracks.length);
  const isPlaying = useTimelineStore((s) => s.isPlaying);
  const zoom = useTimelineStore((s) => s.viewport.zoom);
  const project = useProjectStore((s) => s.project);

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
      <span className="ml-auto text-green-600">就绪</span>
    </div>
  );
}
