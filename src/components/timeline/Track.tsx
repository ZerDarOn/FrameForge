import { useState, useEffect, useRef } from "react";
import type { Track as TrackType } from "../../types/timeline";
import { useTimelineStore } from "../../stores/timelineStore";
import { FrameThumbnail } from "./FrameThumbnail";

interface Props {
  track: TrackType;
  frameWidth: number;
  frameHeight: number;
}

export function Track({ track, frameWidth, frameHeight }: Props) {
  const selectedAssetId = useTimelineStore((s) => s.selectedAssetId);
  const setSelectedAsset = useTimelineStore((s) => s.setSelectedAsset);
  const currentFrame = useTimelineStore((s) => s.currentFrame);
  const setCurrentFrame = useTimelineStore((s) => s.setCurrentFrame);
  const deleteAsset = useTimelineStore((s) => s.deleteAsset);
  const duplicateAsset = useTimelineStore((s) => s.duplicateAsset);
  const insertBlankFrame = useTimelineStore((s) => s.insertBlankFrame);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    assetId: string;
  } | null>(null);
  const framesContainerRef = useRef<HTMLDivElement>(null);

  const handleContextMenu = (e: React.MouseEvent, assetId: string) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, assetId });
  };

  const closeContextMenu = () => setContextMenu(null);

  // 监听全局关闭右键菜单事件
  useEffect(() => {
    const handler = () => setContextMenu(null);
    window.addEventListener("frameforge:close-context-menu", handler);
    return () => window.removeEventListener("frameforge:close-context-menu", handler);
  }, []);

  // 监听时间线滚动同步
  useEffect(() => {
    const handler = (e: Event) => {
      const { scrollLeft } = (e as CustomEvent).detail;
      if (framesContainerRef.current) {
        framesContainerRef.current.scrollLeft = scrollLeft;
      }
    };
    window.addEventListener("frameforge:timeline-scroll", handler);
    return () => window.removeEventListener("frameforge:timeline-scroll", handler);
  }, []);

  return (
    <div className="flex items-stretch border-b border-gray-800" style={{ height: frameHeight + 8 }}>
      <div className="w-32 flex-shrink-0 flex items-center gap-1 px-2 bg-gray-900 border-r border-gray-700">
        <span className={`text-xs ${track.visible ? "text-gray-300" : "text-gray-600"}`}>
          {track.visible ? "👁" : "—"}
        </span>
        <span className="text-xs text-gray-400 truncate flex-1">{track.name}</span>
      </div>

      <div
        className="flex-1 flex items-center overflow-x-auto px-1 gap-0.5 relative"
        onClick={closeContextMenu}
      >
        {track.assets.map((asset, index) => (
          <FrameThumbnail
            key={asset.id}
            asset={asset}
            isSelected={selectedAssetId === asset.id}
            isCurrentFrame={index === currentFrame}
            onClick={() => {
              setSelectedAsset(asset.id);
              setCurrentFrame(index);
            }}
            onContextMenu={(e) => handleContextMenu(e, asset.id)}
            width={frameWidth}
            height={frameHeight}
          />
        ))}

        <button
          className="flex-shrink-0 border-2 border-dashed border-gray-700 hover:border-gray-500 flex items-center justify-center text-gray-600 hover:text-gray-400 text-sm"
          style={{ width: frameWidth, height: frameHeight }}
          onClick={() => insertBlankFrame(track.id, track.assets.length)}
          title="在此位置插入空白帧"
        >
          +
        </button>
      </div>

      {/* 右键菜单 */}
      {contextMenu && (
        <div
          className="fixed bg-gray-800 border border-gray-600 rounded shadow-xl py-1 z-50 text-xs"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            className="w-full px-4 py-1.5 text-left hover:bg-gray-700 text-gray-300"
            onClick={() => {
              duplicateAsset(track.id, contextMenu.assetId);
              closeContextMenu();
            }}
          >
            复制帧
          </button>
          <button
            className="w-full px-4 py-1.5 text-left hover:bg-gray-700 text-gray-300"
            onClick={() => {
              const asset = track.assets.find((a) => a.id === contextMenu.assetId);
              if (asset) insertBlankFrame(track.id, asset.startFrame);
              closeContextMenu();
            }}
          >
            前方插入空白帧
          </button>
          <div className="border-t border-gray-600 my-1" />
          <button
            className="w-full px-4 py-1.5 text-left hover:bg-red-900/50 text-red-400"
            onClick={() => {
              deleteAsset(track.id, contextMenu.assetId);
              closeContextMenu();
            }}
          >
            删除帧
          </button>
        </div>
      )}
    </div>
  );
}
