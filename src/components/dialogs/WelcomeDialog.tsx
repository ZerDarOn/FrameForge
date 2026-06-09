import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useProjectStore } from "../../stores/projectStore";
import { useTimelineStore } from "../../stores/timelineStore";
import type { Project } from "../../types/project";

interface Props {
  onProjectCreated: () => void;
}

export function WelcomeDialog({ onProjectCreated }: Props) {
  const [showNew, setShowNew] = useState(false);
  const [recentProjects, setRecentProjects] = useState<Project[]>([]);
  const setProject = useProjectStore((s) => s.setProject);

  useEffect(() => {
    invoke<Project[]>("list_projects").then(setRecentProjects).catch(() => {});
  }, []);

  const handleOpenProject = async (id: string) => {
    try {
      const project = await invoke<Project>("get_project", { id });
      setProject(project);
      onProjectCreated();
    } catch (err) {
      console.error("打开项目失败:", err);
    }
  };

  const handleDeleteProject = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("确定删除此项目？")) return;
    try {
      await invoke("delete_project", { id });
      setRecentProjects((prev) => prev.filter((p) => p.id !== id));
    } catch (err) {
      console.error("删除项目失败:", err);
    }
  };

  if (showNew) {
    return (
      <NewProjectDialog
        onCreated={onProjectCreated}
        onCancel={() => setShowNew(false)}
      />
    );
  }

  return (
    <div className="absolute inset-0 bg-black/80 flex items-center justify-center z-50">
      <div className="bg-gray-900 rounded-lg border border-gray-700 p-8 w-[480px] shadow-2xl">
        <h1 className="text-2xl font-bold text-orange-400 mb-2">FrameForge</h1>
        <p className="text-gray-400 text-sm mb-6">AI动画帧审查工具</p>

        <div className="space-y-3">
          <button
            className="w-full py-3 bg-orange-600 hover:bg-orange-500 rounded-lg text-sm font-medium text-white"
            onClick={() => setShowNew(true)}
          >
            新建项目
          </button>
        </div>

        {recentProjects.length > 0 && (
          <div className="mt-6 pt-4 border-t border-gray-700">
            <h3 className="text-xs text-gray-500 mb-2">最近项目</h3>
            <div className="space-y-1 max-h-60 overflow-y-auto">
              {recentProjects.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center group"
                >
                  <button
                    className="flex-1 text-left px-3 py-2 rounded hover:bg-gray-800 text-sm text-gray-300 truncate"
                    onClick={() => handleOpenProject(p.id)}
                  >
                    <span className="text-gray-100">{p.name}</span>
                    <span className="text-xs text-gray-600 ml-2">
                      {p.canvasWidth}x{p.canvasHeight} @ {p.fps}fps
                    </span>
                  </button>
                  <button
                    className="px-2 py-1 text-gray-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity text-xs"
                    onClick={(e) => handleDeleteProject(p.id, e)}
                    title="删除项目"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mt-6 pt-4 border-t border-gray-700 text-xs text-gray-600 text-center">
          v0.1.0 - MVP
        </div>
      </div>
    </div>
  );
}

function NewProjectDialog({
  onCreated,
  onCancel,
}: {
  onCreated: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("未命名项目");
  const [width, setWidth] = useState(1920);
  const [height, setHeight] = useState(1080);
  const [fps, setFps] = useState(24);

  const setProject = useProjectStore((s) => s.setProject);
  const setCurrentFrame = useTimelineStore((s) => s.setCurrentFrame);
  const setPlaying = useTimelineStore((s) => s.setPlaying);
  const setTimelineFps = useTimelineStore((s) => s.setFps);

  const handleCreate = async () => {
    try {
      const project = await invoke<Project>("create_project", {
        name,
        canvasWidth: width,
        canvasHeight: height,
        fps,
      });
      setProject(project);
      setCurrentFrame(0);
      setPlaying(false);
      setTimelineFps(fps);
      onCreated();
    } catch (err) {
      console.error("创建项目失败:", err);
    }
  };

  return (
    <div className="absolute inset-0 bg-black/80 flex items-center justify-center z-50">
      <div className="bg-gray-900 rounded-lg border border-gray-700 p-8 w-[480px] shadow-2xl">
        <h2 className="text-lg font-bold text-white mb-4">新建项目</h2>

        <div className="space-y-4">
          <Field label="项目名称">
            <input
              className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm text-gray-200 outline-none focus:border-orange-400"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </Field>

          <div className="flex gap-4">
            <Field label="画布宽度">
              <input
                type="number"
                className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm text-gray-200 outline-none focus:border-orange-400"
                value={width}
                onChange={(e) => setWidth(parseInt(e.target.value) || 1920)}
              />
            </Field>
            <Field label="画布高度">
              <input
                type="number"
                className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm text-gray-200 outline-none focus:border-orange-400"
                value={height}
                onChange={(e) => setHeight(parseInt(e.target.value) || 1080)}
              />
            </Field>
          </div>

          <Field label="建议帧率（播放速度，不限制帧数）">
            <div className="flex gap-2">
              {[12, 24, 30, 60].map((f) => (
                <button
                  key={f}
                  className={`flex-1 py-2 rounded text-sm ${
                    fps === f
                      ? "bg-orange-600 text-white"
                      : "bg-gray-800 text-gray-400 hover:bg-gray-700"
                  }`}
                  onClick={() => setFps(f)}
                >
                  {f} fps
                </button>
              ))}
            </div>
          </Field>
        </div>

        <div className="flex gap-3 mt-6">
          <button
            className="flex-1 py-2 bg-gray-800 hover:bg-gray-700 rounded text-sm text-gray-300"
            onClick={onCancel}
          >
            取消
          </button>
          <button
            className="flex-1 py-2 bg-orange-600 hover:bg-orange-500 rounded text-sm font-medium text-white"
            onClick={handleCreate}
          >
            创建
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs text-gray-400 mb-1">{label}</label>
      {children}
    </div>
  );
}
