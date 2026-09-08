import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { importTrackForSession } from "../../core/projectImport";
import { projectSessionController } from "../../core/projectSession";
import { useAnimationDocumentStore } from "../../stores/animationDocumentStore";
import { useProjectStore } from "../../stores/projectStore";
import { useTimelineStore } from "../../stores/timelineStore";
import type { Track } from "../../types/timeline";

interface GifImportDialogProps {
  onClose: () => void;
}

interface GifImportProgress {
  operationId: string;
  projectId: string;
  stage: "decoding" | "committing";
  completed: number;
  total: number | null;
}

export function GifImportDialog({ onClose }: GifImportDialogProps) {
  const project = useProjectStore((state) => state.project);
  const initialProjectId = useState(() => project?.id ?? null)[0];
  const [sourcePath, setSourcePath] = useState("");
  const [name, setName] = useState("GIF 动画");
  const [selecting, setSelecting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<GifImportProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (project?.id !== initialProjectId) onClose();
  }, [initialProjectId, onClose, project?.id]);

  if (!project || project.id !== initialProjectId) return null;

  const handleSelectSource = async () => {
    const token = projectSessionController.snapshot();
    if (!token || !projectSessionController.isCurrent(token, true)) return;
    setSelecting(true);
    setError(null);
    try {
      const selected = await open({
        multiple: false,
        title: "选择 GIF 动画",
        filters: [{ name: "GIF 动画", extensions: ["gif"] }],
      });
      if (!selected || !projectSessionController.isCurrent(token, true)) return;
      const selectedPath = Array.isArray(selected) ? selected[0] : selected;
      if (!selectedPath) return;
      const fileName = selectedPath.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, "") || "GIF 动画";
      setSourcePath(selectedPath);
      setName(fileName);
      setProgress(null);
    } catch (selectError) {
      setError(selectError instanceof Error ? selectError.message : String(selectError));
    } finally {
      setSelecting(false);
    }
  };

  const handleImport = async () => {
    const token = projectSessionController.snapshot();
    if (
      !token ||
      !sourcePath ||
      !name.trim() ||
      !projectSessionController.isCurrent(token, true)
    ) {
      return;
    }

    const operationId = crypto.randomUUID();
    setImporting(true);
    setError(null);
    setProgress({
      operationId,
      projectId: project.id,
      stage: "decoding",
      completed: 0,
      total: null,
    });

    let unlisten: (() => void) | undefined;
    try {
      unlisten = await listen<GifImportProgress>("gif-import-progress", ({ payload }) => {
        if (payload.operationId === operationId && payload.projectId === project.id) {
          setProgress(payload);
        }
      });
      const result = await importTrackForSession(
        token,
        {
          operationId,
          projectId: project.id,
          name: name.trim(),
          filePaths: [sourcePath],
          fps: useTimelineStore.getState().fps,
        },
        {
          isCurrent: (candidate, requireReady) =>
            projectSessionController.isCurrent(candidate, requireReady),
          importTrack: (request) =>
            invoke<Track>("import_gif_to_new_track", {
              operationId: request.operationId,
              projectId: request.projectId,
              name: request.name,
              sourcePath,
              fps: request.fps,
            }),
          acceptTrack: (track) => {
            const currentProject = useProjectStore.getState().project;
            if (!currentProject || currentProject.id !== project.id) return;
            const tracks = [...useTimelineStore.getState().tracks, track];
            useTimelineStore.getState().setTracks(tracks);
            useAnimationDocumentStore.getState().replaceFromLegacy(currentProject, tracks);
          },
          log: (message, details) =>
            console.info(`[FrameForge] gif ${message}`, details),
        },
      );
      if (result === "accepted") {
        onClose();
      } else if (result === "cancelled") {
        setError("项目状态已变化，GIF 未开始导入。");
      }
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : String(importError));
    } finally {
      unlisten?.();
      setImporting(false);
    }
  };

  const progressPercent = progress?.total
    ? Math.round((progress.completed / progress.total) * 100)
    : null;

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 p-6">
      <div className="w-[680px] overflow-hidden rounded-lg border border-gray-700 bg-gray-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-700 px-5 py-3">
          <div>
            <h2 className="text-base font-bold text-white">导入 GIF 动画</h2>
            <p className="mt-0.5 text-[11px] text-gray-500">
              原始帧时长会量化到项目 {project.fps} fps 时间线，且每帧至少停留 1 tick。
            </p>
          </div>
          <button
            type="button"
            className="px-2 text-lg text-gray-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
            onClick={onClose}
            disabled={importing}
            aria-label="关闭"
          >
            ×
          </button>
        </div>

        <div className="grid grid-cols-[minmax(0,1fr)_260px] gap-5 p-5">
          <div className="flex min-h-[300px] items-center justify-center overflow-hidden rounded border border-gray-700 bg-gray-950 p-3">
            <div className="max-w-full text-center text-sm text-gray-500">
              <div className="mb-3 text-4xl">GIF</div>
              {sourcePath ? (
                <>
                  <div className="truncate text-gray-300">{name}</div>
                  <div className="mt-2 text-[11px] text-gray-600">
                    文件将在受限后端中解码，原文件保持不变
                  </div>
                </>
              ) : (
                <div>先选择一个 GIF 文件</div>
              )}
            </div>
          </div>

          <div className="space-y-4">
            <button
              type="button"
              className="w-full rounded bg-gray-700 px-3 py-2 text-sm text-gray-200 hover:bg-gray-600 disabled:opacity-50"
              onClick={handleSelectSource}
              disabled={selecting || importing}
            >
              {selecting ? "正在选择…" : sourcePath ? "重新选择 GIF" : "选择 GIF"}
            </button>

            <label className="block text-xs text-gray-400">
              <span className="mb-1 block">轨道名称</span>
              <input
                className="w-full rounded border border-gray-600 bg-gray-800 px-2 py-1.5 text-sm text-gray-200 outline-none focus:border-orange-400 disabled:opacity-50"
                value={name}
                maxLength={128}
                onChange={(event) => setName(event.target.value)}
                disabled={importing}
              />
            </label>

            <div className="rounded bg-gray-800 px-3 py-2 text-xs leading-5 text-gray-400">
              <div>导入全部合成帧</div>
              <div>保留透明通道与 GIF 帧时长</div>
              <div>原始 GIF 不会被修改</div>
            </div>

            {error && (
              <div className="rounded border border-red-800/60 bg-red-950/40 px-3 py-2 text-xs text-red-300">
                {error}
              </div>
            )}

            {importing && progress && (
              <div className="space-y-1.5" aria-live="polite">
                <div className="flex justify-between text-xs text-gray-400">
                  <span>{progress.stage === "committing" ? "正在写入项目…" : "正在解码 GIF…"}</span>
                  <span>
                    {progress.total ? `${progress.completed}/${progress.total}` : `${progress.completed} 帧`}
                  </span>
                </div>
                <div
                  className="h-1.5 overflow-hidden rounded bg-gray-800"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={progress.total ?? undefined}
                  aria-valuenow={progress.total ? progress.completed : undefined}
                >
                  <div
                    className="h-full bg-orange-500"
                    style={{ width: progressPercent === null ? "35%" : `${progressPercent}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-3 border-t border-gray-700 px-5 py-3">
          <button
            type="button"
            className="rounded bg-gray-800 px-5 py-2 text-sm text-gray-300 hover:bg-gray-700 disabled:opacity-40"
            onClick={onClose}
            disabled={importing}
          >
            取消
          </button>
          <button
            type="button"
            className="rounded bg-orange-600 px-5 py-2 text-sm font-medium text-white hover:bg-orange-500 disabled:cursor-not-allowed disabled:opacity-40"
            onClick={handleImport}
            disabled={importing || !sourcePath || !name.trim()}
          >
            {importing ? "导入中…" : "导入 GIF"}
          </button>
        </div>
      </div>
    </div>
  );
}
