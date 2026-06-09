import { getCurrentWindow } from "@tauri-apps/api/window";

export function TitleBar() {
  const appWindow = getCurrentWindow();

  return (
    <div className="flex items-center justify-between h-9 bg-gray-950 px-3">
      {/* 只有文字区域可拖拽 */}
      <div
        data-tauri-drag-region
        className="flex items-center gap-2 flex-1 h-full cursor-default"
      >
        <span className="text-sm font-bold text-orange-400">FrameForge</span>
        <span className="text-xs text-gray-500">AI动画帧审查工具</span>
      </div>
      <div className="flex items-center gap-0.5">
        <button
          className="w-10 h-8 flex items-center justify-center hover:bg-gray-700 text-gray-400 rounded-sm text-sm"
          onClick={() => appWindow.minimize()}
        >
          ─
        </button>
        <button
          className="w-10 h-8 flex items-center justify-center hover:bg-gray-700 text-gray-400 rounded-sm text-sm"
          onClick={() => appWindow.toggleMaximize()}
        >
          □
        </button>
        <button
          className="w-10 h-8 flex items-center justify-center hover:bg-red-600 text-gray-300 rounded-sm text-sm"
          onClick={() => appWindow.close()}
        >
          ✕
        </button>
      </div>
    </div>
  );
}
