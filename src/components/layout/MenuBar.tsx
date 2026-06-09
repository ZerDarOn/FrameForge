import { useState, useRef, useEffect } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useTimelineStore } from "../../stores/timelineStore";
import { undo, redo } from "../../stores/timelineStore";
import { ExportDialog } from "../dialogs/ExportDialog";
import { AiSettingsDialog } from "../ai/AiSettingsDialog";
import { useProjectStore } from "../../stores/projectStore";
import { useAnalysisStore } from "../../stores/analysisStore";

export function MenuBar() {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [showFullscreen, setShowFullscreen] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [showAiSettings, setShowAiSettings] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const close = () => setOpenMenu(null);

  const action = (fn: () => void) => {
    fn();
    close();
  };

  return (
    <>
      <div ref={menuRef} className="flex items-center h-7 bg-gray-900 border-b border-gray-700 px-1 text-xs">
        <MenuDropdown label="项目" isOpen={openMenu === "project"} onToggle={() => setOpenMenu(openMenu === "project" ? null : "project")} items={[
          { label: "新建项目", shortcut: "Ctrl+N", action: () => action(() => window.location.reload()) },
          { label: "打开项目", shortcut: "Ctrl+O", action: () => action(() => {
            window.dispatchEvent(new CustomEvent("frameforge:show-welcome"));
          })},
          { type: "separator" },
          { label: "项目设置", action: () => action(() => {
            window.dispatchEvent(new CustomEvent("frameforge:show-settings"));
          })},
        ]} />
        <MenuDropdown label="编辑" isOpen={openMenu === "edit"} onToggle={() => setOpenMenu(openMenu === "edit" ? null : "edit")} items={[
          { label: "撤销", shortcut: "Ctrl+Z", action: () => action(() => undo()) },
          { label: "重做", shortcut: "Ctrl+Y", action: () => action(() => redo()) },
          { type: "separator" },
          { label: "删除选中帧", shortcut: "Delete", action: () => action(() => {
            const s = useTimelineStore.getState();
            if (s.selectedAssetId) {
              const t = s.tracks.find(t => t.assets.some(a => a.id === s.selectedAssetId));
              if (t) s.deleteAsset(t.id, s.selectedAssetId);
            }
          })},
          { label: "复制选中帧", shortcut: "Ctrl+D", action: () => action(() => {
            const s = useTimelineStore.getState();
            if (s.selectedAssetId) {
              const t = s.tracks.find(t => t.assets.some(a => a.id === s.selectedAssetId));
              if (t) s.duplicateAsset(t.id, s.selectedAssetId);
            }
          })},
        ]} />
        <MenuDropdown label="视图" isOpen={openMenu === "view"} onToggle={() => setOpenMenu(openMenu === "view" ? null : "view")} items={[
          { label: "放大时间线", shortcut: "Ctrl+=", action: () => action(() => {
            const vp = useTimelineStore.getState().viewport;
            useTimelineStore.getState().setViewport({ zoom: Math.min(3, vp.zoom + 0.25) });
          })},
          { label: "缩小时间线", shortcut: "Ctrl+-", action: () => action(() => {
            const vp = useTimelineStore.getState().viewport;
            useTimelineStore.getState().setViewport({ zoom: Math.max(0.25, vp.zoom - 0.25) });
          })},
          { label: "重置缩放", action: () => action(() => useTimelineStore.getState().setViewport({ zoom: 1 })) },
          { type: "separator" },
          { label: "全屏预览", shortcut: "F11", action: () => action(() => setShowFullscreen(true)) },
        ]} />
        <MenuDropdown label="AI工具" isOpen={openMenu === "ai"} onToggle={() => setOpenMenu(openMenu === "ai" ? null : "ai")} items={[
          { label: "分析当前轨道", action: () => action(() => {
            const project = useProjectStore.getState().project;
            const track = useTimelineStore.getState().tracks[0];
            if (project && track) {
              useAnalysisStore.getState().analyzeTrack(project.id, track.id);
            }
          })},
          { type: "separator" },
          { label: "AI 设置...", action: () => action(() => setShowAiSettings(true)) },
        ]} />
        <MenuDropdown label="导出" isOpen={openMenu === "export"} onToggle={() => setOpenMenu(openMenu === "export" ? null : "export")} items={[
          { label: "导出...", action: () => action(() => setShowExport(true)) },
        ]} />
        <MenuDropdown label="帮助" isOpen={openMenu === "help"} onToggle={() => setOpenMenu(openMenu === "help" ? null : "help")} items={[
          { label: "快捷键说明", action: () => action(() => alert(
            "快捷键说明：\n\n空格 - 播放/暂停\n←/→ - 逐帧导航\n,/. - 逐帧后退/前进\nHome/End - 首帧/末帧\nDelete - 删除选中帧\nCtrl+D - 复制选中帧\nCtrl+=/- - 时间线缩放\nM - 放大镜工具\nB - 基准点标记工具\nEsc - 停止播放\nF11 - 全屏预览"
          )) },
          { type: "separator" },
          { label: "关于 FrameForge", action: () => action(() => alert("FrameForge v0.1.0\nAI动画帧审查工具")) },
        ]} />
      </div>

      {/* 全屏预览 */}
      {showFullscreen && <FullscreenPreview onClose={() => setShowFullscreen(false)} />}

      {/* 导出对话框 */}
      {showExport && <ExportDialog onClose={() => setShowExport(false)} />}

      {/* AI 设置对话框 */}
      {showAiSettings && <AiSettingsDialog onClose={() => setShowAiSettings(false)} />}
    </>
  );
}

function FullscreenPreview({ onClose }: { onClose: () => void }) {
  const tracks = useTimelineStore((s) => s.tracks);
  const currentFrame = useTimelineStore((s) => s.currentFrame);
  const setCurrentFrame = useTimelineStore((s) => s.setCurrentFrame);
  const togglePlay = useTimelineStore((s) => s.togglePlay);
  const isPlaying = useTimelineStore((s) => s.isPlaying);
  const fps = useTimelineStore((s) => s.fps);
  const totalFrames = useTimelineStore((s) => s.totalFrames);

  // 查找当前帧图片
  const currentAsset = (() => {
    for (const track of tracks) {
      if (!track.visible) continue;
      if (currentFrame < track.assets.length) return track.assets[currentFrame];
    }
    return null;
  })();

  const [imgSrc, setImgSrc] = useState<string | null>(null);

  useEffect(() => {
    if (currentAsset) {
      setImgSrc(convertFileSrc(currentAsset.sourcePath));
    } else {
      setImgSrc(null);
    }
  }, [currentAsset]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "F11") {
        e.preventDefault();
        onClose();
      } else if (e.key === " ") {
        e.preventDefault();
        togglePlay();
      } else if (e.key === "ArrowLeft") {
        setCurrentFrame(Math.max(0, currentFrame - 1));
      } else if (e.key === "ArrowRight") {
        setCurrentFrame(Math.min(totalFrames - 1, currentFrame + 1));
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose, togglePlay, currentFrame, totalFrames, setCurrentFrame]);

  return (
    <div className="fixed inset-0 z-[100] bg-black flex flex-col">
      <div className="flex-1 flex items-center justify-center relative">
        {imgSrc ? (
          <img src={imgSrc} alt="预览" className="max-w-full max-h-full object-contain" />
        ) : (
          <div className="text-gray-600 text-lg">帧 {currentFrame} 无内容</div>
        )}
        {/* 帧信息 */}
        <div className="absolute top-4 left-4 bg-black/60 rounded px-3 py-1 text-sm text-gray-300">
          帧 {currentFrame} / {totalFrames} | {fps} fps | {isPlaying ? "播放中" : "已暂停"}
        </div>
      </div>
      {/* 底部控制栏 */}
      <div className="h-12 bg-gray-900/80 flex items-center justify-center gap-4 px-4">
        <button className="text-gray-300 hover:text-white px-3" onClick={() => setCurrentFrame(0)}>⏮</button>
        <button className="text-gray-300 hover:text-white px-3 text-lg" onClick={togglePlay}>
          {isPlaying ? "⏸" : "▶"}
        </button>
        <button className="text-gray-300 hover:text-white px-3" onClick={() => setCurrentFrame(totalFrames - 1)}>⏭</button>
        <span className="text-gray-400 text-sm ml-4">按 Esc 退出全屏</span>
      </div>
    </div>
  );
}

interface MenuItem {
  label?: string;
  shortcut?: string;
  action?: () => void;
  type?: "separator";
}

function MenuDropdown({ label, isOpen, onToggle, items }: {
  label: string;
  isOpen: boolean;
  onToggle: () => void;
  items: MenuItem[];
}) {
  return (
    <div className="relative">
      <button
        className={`px-3 py-1 rounded ${isOpen ? "bg-gray-700 text-white" : "text-gray-300 hover:bg-gray-700 hover:text-white"}`}
        onClick={onToggle}
      >
        {label}
      </button>
      {isOpen && (
        <div className="absolute top-full left-0 mt-0.5 bg-gray-800 border border-gray-600 rounded shadow-xl py-1 min-w-[200px] z-50">
          {items.map((item, i) =>
            item.type === "separator" ? (
              <div key={i} className="border-t border-gray-600 my-1" />
            ) : (
              <button
                key={i}
                className="w-full px-3 py-1.5 text-left hover:bg-gray-700 text-gray-300 hover:text-white flex items-center justify-between"
                onClick={item.action}
              >
                <span>{item.label}</span>
                {item.shortcut && <span className="text-gray-500 text-[10px] ml-4">{item.shortcut}</span>}
              </button>
            )
          )}
        </div>
      )}
    </div>
  );
}
