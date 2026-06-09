import { useState } from "react";
import { useUIStore } from "../../stores/uiStore";
import { useTimelineStore } from "../../stores/timelineStore";
import { useThumbnail } from "../../hooks/useThumbnail";

export function AssetPanel() {  const tab = useUIStore((s) => s.sidebarTab);
  const setTab = useUIStore((s) => s.setSidebarTab);
  const onionSkinEnabled = useUIStore((s) => s.onionSkinEnabled);
  const setOnionSkinEnabled = useUIStore((s) => s.setOnionSkinEnabled);
  const onionSkinOpacity = useUIStore((s) => s.onionSkinOpacity);
  const setOnionSkinOpacity = useUIStore((s) => s.setOnionSkinOpacity);
  const onionSkinFrames = useUIStore((s) => s.onionSkinFrames);
  const setOnionSkinFrames = useUIStore((s) => s.setOnionSkinFrames);
  const tracks = useTimelineStore((s) => s.tracks);
  const updateTrack = useTimelineStore((s) => s.updateTrack);
  const removeTrack = useTimelineStore((s) => s.removeTrack);

  return (
    <div className="flex flex-col h-full bg-gray-900">
      <div className="flex border-b border-gray-700">
        <TabButton active={tab === "assets"} onClick={() => setTab("assets")} label="资产库" />
        <TabButton active={tab === "inspector"} onClick={() => setTab("inspector")} label="检查器" />
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {tab === "assets" ? (
          <div className="space-y-2">
            {tracks.map((track) => (
              <TrackCard key={track.id} track={track} updateTrack={updateTrack} removeTrack={removeTrack} />
            ))}
            {tracks.length === 0 && (
              <div className="text-center text-gray-600 text-xs py-8">
                点击下方按钮导入图片帧
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <div className="text-gray-400 font-medium text-xs mb-2">洋葱皮设置</div>
              <label className="flex items-center gap-2 mb-2">
                <input
                  type="checkbox"
                  checked={onionSkinEnabled}
                  onChange={(e) => setOnionSkinEnabled(e.target.checked)}
                  className="accent-orange-500"
                />
                <span className="text-xs text-gray-300">启用洋葱皮</span>
              </label>
              {onionSkinEnabled && (
                <div className="space-y-2 pl-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-gray-500 w-10">透明度</span>
                    <input type="range" min="0.05" max="0.8" step="0.05" value={onionSkinOpacity}
                      onChange={(e) => setOnionSkinOpacity(parseFloat(e.target.value))}
                      className="flex-1 accent-orange-500 h-1" />
                    <span className="text-[10px] text-gray-500 w-8">{Math.round(onionSkinOpacity * 100)}%</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-gray-500 w-10">帧数</span>
                    <input type="range" min="1" max="5" step="1" value={onionSkinFrames}
                      onChange={(e) => setOnionSkinFrames(parseInt(e.target.value))}
                      className="flex-1 accent-orange-500 h-1" />
                    <span className="text-[10px] text-gray-500 w-8">{onionSkinFrames}帧</span>
                  </div>
                </div>
              )}
            </div>
            <div>
              <div className="text-gray-400 font-medium text-xs mb-2">缩略图画质</div>
              <ThumbnailQualitySetting />
            </div>
            <div>
              <div className="text-gray-400 font-medium text-xs mb-2">放大镜</div>
              <div className="text-[10px] text-gray-600">点击画面启用（功能开发中）</div>
            </div>
            <div>
              <div className="text-gray-400 font-medium text-xs mb-2">基准点</div>
              <div className="text-[10px] text-gray-600">在画面上 Shift+点击 设定基准点</div>
            </div>
          </div>
        )}
      </div>

      {tab === "assets" && (
        <div className="p-2 border-t border-gray-700 space-y-1.5">
          <button className="w-full py-1.5 bg-orange-600 hover:bg-orange-500 rounded text-sm font-medium"
            onClick={() => window.dispatchEvent(new CustomEvent("frameforge:import-folder"))}>
            导入文件夹
          </button>
          <button className="w-full py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-sm"
            onClick={() => window.dispatchEvent(new CustomEvent("frameforge:import-files"))}>
            导入文件
          </button>
        </div>
      )}
    </div>
  );
}

function TrackCard({ track, updateTrack, removeTrack }: {
  track: any;
  updateTrack: (id: string, partial: any) => void;
  removeTrack: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(track.name);
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="bg-gray-800 rounded p-2">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1 flex-1 min-w-0">
          <button className={`text-xs ${track.visible ? "text-green-400" : "text-gray-600"}`}
            onClick={() => updateTrack(track.id, { visible: !track.visible })}
            title={track.visible ? "隐藏" : "显示"}>
            {track.visible ? "👁" : "👁‍🗨"}
          </button>
          <button className={`text-xs ${track.locked ? "text-red-400" : "text-gray-500"}`}
            onClick={() => updateTrack(track.id, { locked: !track.locked })}
            title={track.locked ? "解锁" : "锁定"}>
            {track.locked ? "🔒" : "🔓"}
          </button>
          {editing ? (
            <input
              className="flex-1 bg-gray-700 border border-orange-400 rounded px-1 py-0 text-xs text-gray-200 outline-none min-w-0"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onBlur={() => { updateTrack(track.id, { name: editName }); setEditing(false); }}
              onKeyDown={(e) => { if (e.key === "Enter") { updateTrack(track.id, { name: editName }); setEditing(false); } }}
              autoFocus
            />
          ) : (
            <span
              className="text-xs text-gray-300 truncate flex-1 cursor-text"
              onDoubleClick={() => { setEditName(track.name); setEditing(true); }}
              title="双击重命名"
            >
              {track.name}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-gray-500">{track.assets.length}帧</span>
          <button className="text-[10px] text-red-500 hover:text-red-400 px-1"
            onClick={() => removeTrack(track.id)} title="删除轨道">
            ✕
          </button>
        </div>
      </div>

      {/* 不透明度控制 */}
      <div className="flex items-center gap-1 mb-1">
        <span className="text-[9px] text-gray-500 w-8">透明</span>
        <input type="range" min="0" max="1" step="0.05" value={track.opacity}
          onChange={(e) => updateTrack(track.id, { opacity: parseFloat(e.target.value) })}
          className="flex-1 accent-orange-500 h-0.5" />
        <span className="text-[9px] text-gray-500 w-8">{Math.round(track.opacity * 100)}%</span>
        <button className="text-[9px] text-gray-500 hover:text-gray-300"
          onClick={() => setExpanded(!expanded)}>
          {expanded ? "▼" : "▶"}
        </button>
      </div>

      {/* 展开时显示所有缩略图 */}
      <div className="flex gap-0.5 overflow-x-auto">
        {(expanded ? track.assets : track.assets.slice(0, 8)).map((asset: any) => (
          <MiniThumbnail key={asset.id} sourcePath={asset.sourcePath} matched={asset.matchedFps} />
        ))}
        {!expanded && track.assets.length > 8 && (
          <div className="flex-shrink-0 w-8 h-6 bg-gray-700 rounded-sm flex items-center justify-center text-[8px] text-gray-500">
            +{track.assets.length - 8}
          </div>
        )}
      </div>
    </div>
  );
}

function MiniThumbnail({ sourcePath, matched }: { sourcePath: string; matched: boolean }) {
  const quality = useUIStore((s) => s.thumbnailQuality);
  const { thumbnail } = useThumbnail(sourcePath, quality);
  return (
    <div className={`flex-shrink-0 w-8 h-6 rounded-sm overflow-hidden ${matched ? "" : "opacity-40"}`}>
      {thumbnail ? (
        <img src={thumbnail} alt="" className="w-full h-full object-cover" draggable={false} />
      ) : (
        <div className="w-full h-full bg-gray-700" />
      )}
    </div>
  );
}

function TabButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      className={`flex-1 py-2 text-xs ${active ? "text-orange-400 border-b-2 border-orange-400" : "text-gray-500 hover:text-gray-300"}`}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function ThumbnailQualitySetting() {
  const quality = useUIStore((s) => s.thumbnailQuality);
  const setQuality = useUIStore((s) => s.setThumbnailQuality);

  const options: { key: typeof quality; label: string; desc: string }[] = [
    { key: "lossless", label: "无损", desc: "PNG 格式，最高质量" },
    { key: "high", label: "高", desc: "JPEG 90%，推荐" },
    { key: "medium", label: "中", desc: "JPEG 75%" },
    { key: "low", label: "低", desc: "JPEG 50%，节省内存" },
  ];

  return (
    <div className="space-y-1">
      {options.map((opt) => (
        <button
          key={opt.key}
          className={`w-full text-left px-2 py-1 rounded text-[10px] ${
            quality === opt.key ? "bg-orange-600/20 text-orange-400" : "text-gray-500 hover:bg-gray-800"
          }`}
          onClick={() => setQuality(opt.key)}
          title={opt.desc}
        >
          {opt.label} <span className="text-gray-600 ml-1">{opt.desc}</span>
        </button>
      ))}
    </div>
  );
}
