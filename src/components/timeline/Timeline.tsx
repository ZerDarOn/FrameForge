import { useEffect, useRef } from "react";
import { useTimelineStore } from "../../stores/timelineStore";
import { useProjectStore } from "../../stores/projectStore";
import { invoke } from "@tauri-apps/api/core";
import type { Track as TrackType } from "../../types/timeline";
import { Track } from "./Track";
import { PlaybackControls } from "./PlaybackControls";

export function Timeline() {
  const tracks = useTimelineStore((s) => s.tracks);
  const isPlaying = useTimelineStore((s) => s.isPlaying);
  const currentFrame = useTimelineStore((s) => s.currentFrame);
  const totalFrames = useTimelineStore((s) => s.totalFrames);
  const fps = useTimelineStore((s) => s.fps);
  const zoom = useTimelineStore((s) => s.viewport.zoom);
  const setCurrentFrame = useTimelineStore((s) => s.setCurrentFrame);
  const addTrack = useTimelineStore((s) => s.addTrack);
  const project = useProjectStore((s) => s.project);
  const timerRef = useRef<number | null>(null);
  const frameRef = useRef(currentFrame);
  const totalRef = useRef(totalFrames);
  const rulerScrollRef = useRef<HTMLDivElement>(null);

  frameRef.current = currentFrame;
  totalRef.current = totalFrames;

  // 播放定时器
  useEffect(() => {
    if (isPlaying && totalFrames > 0) {
      const interval = 1000 / fps;
      timerRef.current = window.setInterval(() => {
        const next = frameRef.current + 1;
        if (next >= totalRef.current) {
          setCurrentFrame(0);
        } else {
          setCurrentFrame(next);
        }
      }, interval);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isPlaying, fps, totalFrames, setCurrentFrame]);

  // 播放头自动滚动跟随
  useEffect(() => {
    if (!rulerScrollRef.current) return;
    const frameWidth = Math.round(60 * zoom);
    const scrollLeft = rulerScrollRef.current.scrollLeft;
    const containerWidth = rulerScrollRef.current.clientWidth;
    const playheadPos = currentFrame * frameWidth;

    if (playheadPos < scrollLeft || playheadPos > scrollLeft + containerWidth - frameWidth) {
      rulerScrollRef.current.scrollTo({
        left: Math.max(0, playheadPos - containerWidth / 3),
        behavior: "smooth",
      });
    }
  }, [currentFrame, zoom]);

  // 同步刻度尺和轨道的水平滚动
  const handleRulerScroll = () => {
    if (!rulerScrollRef.current) return;
    const scrollLeft = rulerScrollRef.current.scrollLeft;
    // 广播滚动位置给所有 Track 组件
    window.dispatchEvent(new CustomEvent("frameforge:timeline-scroll", { detail: { scrollLeft } }));
  };

  const frameWidth = Math.round(60 * zoom);
  const frameHeight = Math.round(40 * zoom);

  const handleAddTrack = async () => {
    if (!project) return;
    try {
      const track = await invoke<TrackType>("create_track", {
        projectId: project.id,
        name: `新轨道 ${tracks.length + 1}`,
        trackType: "image_sequence",
      });
      addTrack(track);
    } catch (err) {
      console.error("创建轨道失败:", err);
    }
  };

  return (
    <div className="flex flex-col h-full bg-gray-900">
      <PlaybackControls />

      <div className="flex-1 overflow-hidden flex flex-col">
        {/* 帧刻度尺 */}
        <div className="flex items-center h-6 border-b border-gray-800">
          <div className="w-32 flex-shrink-0 border-r border-gray-700" />
          <div
            ref={rulerScrollRef}
            className="flex-1 overflow-x-auto"
            style={{ scrollBehavior: "smooth" }}
            onScroll={handleRulerScroll}
          >
            <div className="flex items-end relative" style={{ minWidth: totalFrames * frameWidth }}>
              {Array.from({ length: Math.max(totalFrames, 1) }, (_, i) => (
                <div
                  key={i}
                  className={`flex-shrink-0 flex items-end justify-center text-[9px] cursor-pointer ${
                    i === currentFrame
                      ? "text-orange-400 font-bold"
                      : i % 5 === 0
                        ? "text-gray-500"
                        : "text-gray-700"
                  }`}
                  style={{ width: frameWidth }}
                  onClick={() => setCurrentFrame(i)}
                >
                  {i % (zoom < 0.5 ? 10 : 5) === 0 ? i : "|"}
                </div>
              ))}
              <div
                className="absolute top-0 bottom-0 w-0.5 bg-orange-400 z-10 pointer-events-none"
                style={{ left: currentFrame * frameWidth + frameWidth / 2 }}
              />
            </div>
          </div>
        </div>

        {/* 轨道区域 */}
        <div className="flex-1 overflow-y-auto">
          {tracks.length === 0 ? (
            <div className="flex items-center justify-center h-full text-gray-600 text-xs">
              导入图片序列帧开始编辑
            </div>
          ) : (
            tracks.map((track) => (
              <Track key={track.id} track={track} frameWidth={frameWidth} frameHeight={frameHeight} />
            ))
          )}
        </div>
      </div>

      <div className="flex items-center h-8 px-2 border-t border-gray-700 gap-4">
        <button className="text-xs text-gray-500 hover:text-orange-400" onClick={handleAddTrack}>
          + 添加轨道
        </button>
        <div className="text-xs text-gray-600">
          共 {totalFrames} 帧 | {tracks.length} 轨道 | 缩放 {Math.round(zoom * 100)}%
        </div>
      </div>
    </div>
  );
}
