import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useProjectStore } from "../../stores/projectStore";
import { useTimelineStore } from "../../stores/timelineStore";

export function ProjectSettingsDialog({ onClose }: { onClose: () => void }) {
  const project = useProjectStore((s) => s.project);
  const updateProject = useProjectStore((s) => s.updateProject);
  const setTimelineFps = useTimelineStore((s) => s.setFps);
  const [name, setName] = useState(project?.name || "");
  const [width, setWidth] = useState(project?.canvasWidth || 1920);
  const [height, setHeight] = useState(project?.canvasHeight || 1080);
  const [fps, setFps] = useState(project?.fps || 24);

  if (!project) return null;

  const handleSave = async () => {
    try {
      await invoke("update_project", {
        id: project.id,
        name,
        canvasWidth: width,
        canvasHeight: height,
        fps,
      });
      updateProject({ name, canvasWidth: width, canvasHeight: height, fps });
      setTimelineFps(fps);
      onClose();
    } catch (err) {
      console.error("保存设置失败:", err);
      alert(`保存失败: ${err}`);
    }
  };

  return (
    <div className="absolute inset-0 bg-black/80 flex items-center justify-center z-50">
      <div className="bg-gray-900 rounded-lg border border-gray-700 p-8 w-[480px] shadow-2xl">
        <h2 className="text-lg font-bold text-white mb-4">项目设置</h2>

        <div className="space-y-4">
          <div>
            <label className="block text-xs text-gray-400 mb-1">项目名称</label>
            <input
              className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm text-gray-200 outline-none focus:border-orange-400"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="flex gap-4">
            <div>
              <label className="block text-xs text-gray-400 mb-1">画布宽度</label>
              <input
                type="number"
                className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm text-gray-200 outline-none focus:border-orange-400"
                value={width}
                onChange={(e) => setWidth(parseInt(e.target.value) || 1920)}
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">画布高度</label>
              <input
                type="number"
                className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm text-gray-200 outline-none focus:border-orange-400"
                value={height}
                onChange={(e) => setHeight(parseInt(e.target.value) || 1080)}
              />
            </div>
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">建议帧率（播放速度）</label>
            <div className="flex gap-2">
              {[12, 24, 30, 60].map((f) => (
                <button
                  key={f}
                  className={`flex-1 py-2 rounded text-sm ${fps === f ? "bg-orange-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}
                  onClick={() => setFps(f)}
                >
                  {f} fps
                </button>
              ))}
            </div>
          </div>

          <div className="text-xs text-gray-600">
            项目ID: {project.id}
          </div>
        </div>

        <div className="flex gap-3 mt-6">
          <button
            className="flex-1 py-2 bg-gray-800 hover:bg-gray-700 rounded text-sm text-gray-300"
            onClick={onClose}
          >
            取消
          </button>
          <button
            className="flex-1 py-2 bg-orange-600 hover:bg-orange-500 rounded text-sm font-medium text-white"
            onClick={handleSave}
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
