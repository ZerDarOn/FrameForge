import { useTimelineStore } from "../../stores/timelineStore";

export function PlaybackControls() {
  const currentFrame = useTimelineStore((s) => s.currentFrame);
  const totalFrames = useTimelineStore((s) => s.totalFrames);
  const isPlaying = useTimelineStore((s) => s.isPlaying);
  const fps = useTimelineStore((s) => s.fps);
  const zoom = useTimelineStore((s) => s.viewport.zoom);
  const setCurrentFrame = useTimelineStore((s) => s.setCurrentFrame);
  const togglePlay = useTimelineStore((s) => s.togglePlay);
  const setViewport = useTimelineStore((s) => s.setViewport);

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-900 border-b border-gray-700">
      <button
        className="px-2 py-0.5 hover:bg-gray-700 rounded text-sm"
        onClick={() => setCurrentFrame(0)}
      >
        ⏮
      </button>
      <button
        className={`px-2 py-0.5 hover:bg-gray-700 rounded text-lg ${isPlaying ? "text-orange-400" : ""}`}
        onClick={togglePlay}
      >
        {isPlaying ? "⏸" : "▶"}
      </button>
      <button
        className="px-2 py-0.5 hover:bg-gray-700 rounded text-sm"
        onClick={() => setCurrentFrame(Math.max(0, totalFrames - 1))}
      >
        ⏭
      </button>

      <div className="flex items-center gap-1 ml-4 text-xs text-gray-400">
        <span>帧:</span>
        <input
          type="number"
          value={currentFrame}
          onChange={(e) =>
            setCurrentFrame(
              Math.max(0, Math.min(totalFrames - 1, parseInt(e.target.value) || 0))
            )
          }
          className="w-12 bg-gray-800 border border-gray-600 rounded px-1 py-0.5 text-center text-gray-300"
        />
        <span>/ {totalFrames}</span>
      </div>

      <div className="text-xs text-gray-500 ml-3">{fps} fps</div>

      {isPlaying && (
        <div className="text-xs text-orange-400 ml-2 animate-pulse">播放中</div>
      )}

      <div className="ml-auto flex items-center gap-1 text-xs text-gray-500">
        <button
          className="px-1 hover:text-gray-300"
          onClick={() => setViewport({ zoom: Math.max(0.25, zoom - 0.25) })}
        >
          −
        </button>
        <input
          type="range"
          min="0.25"
          max="3"
          step="0.25"
          value={zoom}
          onChange={(e) => setViewport({ zoom: parseFloat(e.target.value) })}
          className="w-20 accent-orange-500"
        />
        <button
          className="px-1 hover:text-gray-300"
          onClick={() => setViewport({ zoom: Math.min(3, zoom + 0.25) })}
        >
          +
        </button>
        <span className="w-10 text-right">{Math.round(zoom * 100)}%</span>
      </div>
    </div>
  );
}
