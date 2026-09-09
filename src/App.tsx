import { useState, useEffect } from "react";
import { useProjectStore } from "./stores/projectStore";
import { useUIStore } from "./stores/uiStore";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { useDragDrop } from "./hooks/useDragDrop";
import { useImportHandler } from "./hooks/useImportHandler";
import { useProjectLoader } from "./hooks/useProjectLoader";
import { useGlobalEvents } from "./hooks/useGlobalEvents";
import { useAnalysisProgress } from "./hooks/useAnalysisProgress";
import { useResizeHandle } from "./hooks/useResizeHandle";
import { useAnimationDocumentTimelineSync } from "./hooks/useAnimationDocumentTimelineSync";
import { useUnsavedChangesGuard } from "./hooks/useUnsavedChangesGuard";
import { ErrorBoundary, PanelErrorFallback } from "./components/ErrorBoundary";
import { TitleBar } from "./components/layout/TitleBar";
import { MenuBar } from "./components/layout/MenuBar";
import { StatusBar } from "./components/layout/StatusBar";
import { AssetPanel } from "./components/panels/AssetPanel";
import { ViewportPanel } from "./components/panels/ViewportPanel";
import { PropertiesPanel } from "./components/panels/PropertiesPanel";
import { Timeline } from "./components/timeline/Timeline";
import { WelcomeDialog } from "./components/dialogs/WelcomeDialog";
import { ProjectSettingsDialog } from "./components/dialogs/ProjectSettingsDialog";
import { SpriteSheetImportDialog } from "./components/dialogs/SpriteSheetImportDialog";
import { GifImportDialog } from "./components/dialogs/GifImportDialog";
import { VideoImportDialog } from "./components/dialogs/VideoImportDialog";

export default function App() {
  const project = useProjectStore((s) => s.project);
  const loadStatus = useProjectStore((s) => s.loadStatus);
  const loadError = useProjectStore((s) => s.loadError);
  const sidebarWidth = useUIStore((s) => s.sidebarWidth);
  const propertiesWidth = useUIStore((s) => s.propertiesWidth);
  const timelineHeight = useUIStore((s) => s.timelineHeight);
  const setSidebarWidth = useUIStore((s) => s.setSidebarWidth);
  const setPropertiesWidth = useUIStore((s) => s.setPropertiesWidth);
  const setTimelineHeight = useUIStore((s) => s.setTimelineHeight);
  const [showWelcome, setShowWelcome] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [showSpriteSheetImport, setShowSpriteSheetImport] = useState(false);
  const [showGifImport, setShowGifImport] = useState(false);
  const [showVideoImport, setShowVideoImport] = useState(false);

  useKeyboardShortcuts();
  useUnsavedChangesGuard();
  const isDragging = useDragDrop();
  useImportHandler();
  useAnimationDocumentTimelineSync();
  useProjectLoader();
  useGlobalEvents();
  useAnalysisProgress();

  const handleSidebarResize = useResizeHandle("horizontal", 180, 400, sidebarWidth, setSidebarWidth);
  const handleTimelineResize = useResizeHandle("vertical", 120, 500, timelineHeight, setTimelineHeight);
  const handlePropertiesResize = useResizeHandle("horizontal", 200, 450, propertiesWidth, setPropertiesWidth, true);

  // 监听菜单栏事件
  useEffect(() => {
    const showWelcomeHandler = () => setShowWelcome(true);
    const showSettingsHandler = () => {
      if (useProjectStore.getState().loadStatus === "ready") setShowSettings(true);
    };
    const showSpriteSheetImportHandler = () => {
      if (useProjectStore.getState().loadStatus === "ready") setShowSpriteSheetImport(true);
    };
    const showGifImportHandler = () => {
      if (useProjectStore.getState().loadStatus === "ready") setShowGifImport(true);
    };
    const showVideoImportHandler = () => {
      if (useProjectStore.getState().loadStatus === "ready") setShowVideoImport(true);
    };
    window.addEventListener("frameforge:show-welcome", showWelcomeHandler);
    window.addEventListener("frameforge:show-settings", showSettingsHandler);
    window.addEventListener("frameforge:import-sprite-sheet", showSpriteSheetImportHandler);
    window.addEventListener("frameforge:import-gif", showGifImportHandler);
    window.addEventListener("frameforge:import-video", showVideoImportHandler);
    return () => {
      window.removeEventListener("frameforge:show-welcome", showWelcomeHandler);
      window.removeEventListener("frameforge:show-settings", showSettingsHandler);
      window.removeEventListener("frameforge:import-sprite-sheet", showSpriteSheetImportHandler);
      window.removeEventListener("frameforge:import-gif", showGifImportHandler);
      window.removeEventListener("frameforge:import-video", showVideoImportHandler);
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

        {showSettings && project && loadStatus === "ready" && (
          <ProjectSettingsDialog onClose={() => setShowSettings(false)} />
        )}

        {showSpriteSheetImport && project && loadStatus === "ready" && (
          <SpriteSheetImportDialog onClose={() => setShowSpriteSheetImport(false)} />
        )}

        {showGifImport && project && loadStatus === "ready" && (
          <GifImportDialog onClose={() => setShowGifImport(false)} />
        )}

        {showVideoImport && project && loadStatus === "ready" && (
          <VideoImportDialog onClose={() => setShowVideoImport(false)} />
        )}

        {project && loadStatus !== "ready" && (
          <div className="absolute inset-0 z-40 flex items-center justify-center bg-gray-950/80">
            <div className="rounded border border-gray-700 bg-gray-900 px-6 py-4 text-center">
              <div className={loadStatus === "error" ? "text-red-300" : "text-amber-300"}>
                {loadStatus === "error" ? "项目加载失败" : "正在加载项目…"}
              </div>
              {loadError && <div className="mt-2 max-w-md text-xs text-gray-400">{loadError}</div>}
              {loadStatus === "error" && (
                <button
                  type="button"
                  className="mt-3 rounded bg-gray-700 px-3 py-1 text-xs text-white hover:bg-gray-600"
                  onClick={() => setShowWelcome(true)}
                >
                  返回项目列表
                </button>
              )}
            </div>
          </div>
        )}

        <div
          className="flex-shrink-0 border-r border-gray-700 overflow-hidden"
          style={{ width: sidebarWidth }}
        >
          <ErrorBoundary name="AssetPanel" fallback={PanelErrorFallback("资产面板")}>
            <AssetPanel />
          </ErrorBoundary>
        </div>

        {/* 左侧面板拖拽分割条 */}
        <div
          className="w-1 cursor-col-resize bg-gray-800 hover:bg-orange-400/50 flex-shrink-0 transition-colors"
          onMouseDown={handleSidebarResize}
        />

        <div className="flex flex-col flex-1 overflow-hidden">
          <div className="flex-1 overflow-hidden">
            <ErrorBoundary name="ViewportPanel" fallback={PanelErrorFallback("视口")}>
              <ViewportPanel />
            </ErrorBoundary>
          </div>
          {/* 时间线高度拖拽分割条 */}
          <div
            className="h-1 cursor-row-resize bg-gray-800 hover:bg-orange-400/50 flex-shrink-0 transition-colors"
            onMouseDown={handleTimelineResize}
          />
          <div
            className="flex-shrink-0 border-t border-gray-700 overflow-hidden"
            style={{ height: timelineHeight }}
          >
            <ErrorBoundary name="Timeline" fallback={PanelErrorFallback("时间线")}>
              <Timeline />
            </ErrorBoundary>
          </div>
        </div>

        {/* 右侧面板拖拽分割条 */}
        <div
          className="w-1 cursor-col-resize bg-gray-800 hover:bg-orange-400/50 flex-shrink-0 transition-colors"
          onMouseDown={handlePropertiesResize}
        />

        <div
          className="flex-shrink-0 border-l border-gray-700 overflow-hidden"
          style={{ width: propertiesWidth }}
        >
          <ErrorBoundary name="PropertiesPanel" fallback={PanelErrorFallback("属性面板")}>
            <PropertiesPanel />
          </ErrorBoundary>
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
