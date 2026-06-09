import { memo } from "react";
import type { Asset } from "../../types/asset";
import { useThumbnail } from "../../hooks/useThumbnail";
import { useUIStore } from "../../stores/uiStore";

interface Props {
  asset: Asset;
  isSelected: boolean;
  isCurrentFrame: boolean;
  onClick: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  width?: number;
  height?: number;
}

export const FrameThumbnail = memo(function FrameThumbnail({
  asset, isSelected, isCurrentFrame, onClick, onContextMenu, width = 60, height = 40,
}: Props) {
  const quality = useUIStore((s) => s.thumbnailQuality);
  const { thumbnail } = useThumbnail(asset.sourcePath, quality);

  const borderClass = isSelected
    ? "border-orange-400"
    : isCurrentFrame
      ? "border-orange-400/50"
      : "border-gray-700 hover:border-gray-500";

  const opacityClass = asset.matchedFps ? "" : "opacity-40";

  return (
    <div
      className={`flex-shrink-0 border-2 cursor-pointer transition-colors overflow-hidden relative ${borderClass} ${opacityClass}`}
      style={{ width, height }}
      onClick={onClick}
      onContextMenu={onContextMenu}
      title={asset.matchedFps ? asset.name : `${asset.name} (不匹配帧率)`}
    >
      {thumbnail ? (
        <img src={thumbnail} alt={asset.name} className="w-full h-full object-cover" draggable={false} />
      ) : (
        <div className="w-full h-full bg-gray-800 flex items-center justify-center text-[8px] text-gray-600">
          {asset.name.slice(0, 6)}
        </div>
      )}
      {asset.matchedFps && <div className="absolute top-0 right-0 w-1.5 h-1.5 bg-green-400 rounded-bl" />}
    </div>
  );
});
