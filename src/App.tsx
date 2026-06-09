import { useState, useEffect } from "react";
import { useProjectStore } from "./stores/projectStore";
import { useUIStore } from "./stores/uiStore";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { useDragDrop } from "./hooks/useDragDrop";
import { useImportHandler } from "./hooks/useImportHandler";
import { useProjectLoader } from "./hooks/useProjectLoader";
import { useGlobalEvents } from "./hooks/useGlobalEvents";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { TitleBar } from "./components/layout/TitleBar";
import { MenuBar } from "./components/layout/MenuBar";
import { StatusBar } from "./components/layout/StatusBar";
import { AssetPanel } from "./components/panels/AssetPanel";
import { ViewportPanel } from "./components/panels/ViewportPanel";
import { PropertiesPanel } from "./components/panels/PropertiesPanel";
import { Timeline } from "./components/timeline/Timeline";
import { WelcomeDialog } from "./components/dialogs/WelcomeDialog";
import { ProjectSettingsDialog } from "./components/dialogs/ProjectSettingsDialog";

export default function App() {
  const project = useProjectStore((s) => s.project);
  const sidebarWidth = useUIStore((s) => s.sidebarWidth);
  const propertiesWidth = useUIStore((s) => s.propertiesWidth);
  const timelineHeight = useUIStore((s) => s.timelineHeight);
  const [showWelcome, setShowWelcome] = useState(true);
  const [showSettings, setShowSettings] = useState(false);

  useKeyboardShortcuts();
  const isDragging = useDragDrop();
  useImportHandler();
  useProjectLoader();
  useGlobalEvents();

  // 监听菜单栏事件
  useEffect(() => {
    const showWelcomeHandler = () => setShowWelcome(true);
    const showSettingsHandler = () => setShowSettings(true);
    window.addEventListener("frameforge:show-welcome", showWelcomeHandler);
    window.addEventListener("frameforge:show-settings", showSettingsHandler);
    return () => {
      window.removeEventListener("frameforge:show-welcome", showWelcomeHandler);
      window.removeEventListener("frameforge:show-settings", showSettingsHandler);
    };
  }, []);

  return (
    <ErrorBoundary>
      <div className="relative flex flex-col h-screen bg-gray-900 text-gray-100 select-none overflow-hidden">
      <TitleBar />
      <MenuBar />

      <div className="flex flex-1 overflow-hidden relative">
        {(showWelcome || !project) && (
          <WelcomeDialog onProjectCreated={() => setShowWelcome(false)} />
        )}

        {showSettings && project && (
          <ProjectSettingsDialog onClose={() => setShowSettings(false)} />
        )}

        <div
          className="flex-shrink-0 border-r border-gray-700 overflow-hidden"
          style={{ width: sidebarWidth }}
        >
          <AssetPanel />
        </div>

        {/* 左侧面板拖拽分割条 */}
        <div
          className="w-1 cursor-col-resize bg-gray-800 hover:bg-orange-400/50 flex-shrink-0 transition-colors"
          onMouseDown={(e) => {
            e.preventDefault();
            const startX = e.clientX;
            const startWidth = sidebarWidth;
            const onMove = (ev: MouseEvent) => {
              const delta = ev.clientX - startX;
              useUIStore.getState().setSidebarWidth(Math.max(180, Math.min(400, startWidth + delta)));
            };
            const onUp = () => {
              document.removeEventListener("mousemove", onMove);
              document.removeEventListener("mouseup", onUp);
            };
            document.addEventListener("mousemove", onMove);
            document.addEventListener("mouseup", onUp);
          }}
        />

        <div className="flex flex-col flex-1 overflow-hidden">
          <div className="flex-1 overflow-hidden">
            <ViewportPanel />
          </div>
          {/* 时间线高度拖拽分割条 */}
          <div
            className="h-1 cursor-row-resize bg-gray-800 hover:bg-orange-400/50 flex-shrink-0 transition-colors"
            onMouseDown={(e) => {
              e.preventDefault();
              const startY = e.clientY;
              const startHeight = timelineHeight;
              const onMove = (ev: MouseEvent) => {
                const delta = startY - ev.clientY;
                useUIStore.getState().setTimelineHeight(Math.max(120, Math.min(500, startHeight + delta)));
              };
              const onUp = () => {
                document.removeEventListener("mousemove", onMove);
                document.removeEventListener("mouseup", onUp);
              };
              document.addEventListener("mousemove", onMove);
              document.addEventListener("mouseup", onUp);
            }}
          />
          <div
            className="flex-shrink-0 border-t border-gray-700 overflow-hidden"
            style={{ height: timelineHeight }}
          >
            <Timeline />
          </div>
        </div>

        {/* 右侧面板拖拽分割条 */}
        <div
          className="w-1 cursor-col-resize bg-gray-800 hover:bg-orange-400/50 flex-shrink-0 transition-colors"
          onMouseDown={(e) => {
            e.preventDefault();
            const startX = e.clientX;
            const startWidth = propertiesWidth;
            const onMove = (ev: MouseEvent) => {
              const delta = startX - ev.clientX;
              useUIStore.getState().setPropertiesWidth(Math.max(200, Math.min(450, startWidth + delta)));
            };
            const onUp = () => {
              document.removeEventListener("mousemove", onMove);
              document.removeEventListener("mouseup", onUp);
            };
            document.addEventListener("mousemove", onMove);
            document.addEventListener("mouseup", onUp);
          }}
        />

        <div
          className="flex-shrink-0 border-l border-gray-700 overflow-hidden"
          style={{ width: propertiesWidth }}
        >
          <PropertiesPanel />
        </div>
      </div>

      <StatusBar />

      {isDragging && (
        <div className="fixed inset-0 bg-orange-500/10 border-4 border-dashed border-orange-400 z-50 flex items-center justify-center pointer-events-none">
          <div className="bg-gray-900/90 rounded-xl px-8 py-4 text-center">
            <div className="text-3xl mb-2">&#128194;</div>
            <div className="text-orange-400 font-bold text-lg">释放以导入图片帧</div>
            <div className="text-gray-400 text-sm">支持 PNG / JPG / WebP / BMP</div>
          </div>
        </div>
      )}
    </div>
    </ErrorBoundary>
  );
}
