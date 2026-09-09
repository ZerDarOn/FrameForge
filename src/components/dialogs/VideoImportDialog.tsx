import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { importTrackForSession } from "../../core/projectImport";
import { projectSessionController } from "../../core/projectSession";
import { useAnimationDocumentStore } from "../../stores/animationDocumentStore";
import { useProjectStore } from "../../stores/projectStore";
import { useTimelineStore } from "../../stores/timelineStore";
import type { Track } from "../../types/timeline";

interface VideoImportDialogProps {
  onClose: () => void;
}

interface VideoFileInfo {
  width: number;
  height: number;
  durationSeconds: number;
}

interface VideoImportProgress {
  operationId: string;
  projectId: string;
  stage: "probing" | "extracting" | "committing";
  completed: number;
  total: number | null;
}

function formatSeconds(seconds: number) {
  return seconds.toFixed(3).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}

export function VideoImportDialog({ onClose }: VideoImportDialogProps) {
  const project = useProjectStore((state) => state.project);
  const initialProjectId = useState(() => project?.id ?? null)[0];
  const [sourcePath, setSourcePath] = useState("");
  const [videoInfo, setVideoInfo] = useState<VideoFileInfo | null>(null);
  const [name, setName] = useState("视频帧");
  const [startSeconds, setStartSeconds] = useState(0);
  const [endSeconds, setEndSeconds] = useState(0);
  const [sampleFps, setSampleFps] = useState(() => Math.min(project?.fps ?? 12, 12));
  const [selecting, setSelecting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [progress, setProgress] = useState<VideoImportProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const activeOperationRef = useRef<string | null>(null);
  const backendReadyRef = useRef(false);
  const cancelRequestedRef = useRef(false);
  const cancelSentRef = useRef(false);

  useEffect(() => {
    if (project?.id === initialProjectId) return;
    const operationId = activeOperationRef.current;
    if (operationId && initialProjectId) {
      cancelRequestedRef.current = true;
      void invoke<boolean>("cancel_video_import", {
        operationId,
        projectId: initialProjectId,
      }).catch((cancelError) => {
        console.warn("[FrameForge] stale video import cancellation failed", {
          operationId,
          projectId: initialProjectId,
          error: cancelError instanceof Error ? cancelError.message : String(cancelError),
        });
      });
    }
    onClose();
  }, [initialProjectId, onClose, project?.id]);

  if (!project || project.id !== initialProjectId) return null;

  const projectFps = useTimelineStore.getState().fps;
  const plannedFrameCount =
    videoInfo && Number.isFinite(startSeconds) && Number.isFinite(endSeconds) && Number.isFinite(sampleFps)
      ? Math.ceil(Math.max(0, endSeconds - startSeconds) * Math.max(0, sampleFps))
      : 0;
  const validRange =
    Boolean(videoInfo) &&
    startSeconds >= 0 &&
    endSeconds > startSeconds &&
    endSeconds <= (videoInfo?.durationSeconds ?? 0) + 0.001 &&
    sampleFps > 0 &&
    sampleFps <= projectFps &&
    plannedFrameCount >= 1 &&
    plannedFrameCount <= 10_000;

  const sendCancellation = async (operationId: string, projectId: string) => {
    if (cancelSentRef.current) return;
    cancelSentRef.current = true;
    try {
      const accepted = await invoke<boolean>("cancel_video_import", {
        operationId,
        projectId,
      });
      if (!accepted && activeOperationRef.current === operationId) {
        cancelRequestedRef.current = false;
        cancelSentRef.current = false;
        setCancelling(false);
        setError("视频已进入项目写入阶段，无法取消。");
      }
    } catch (cancelError) {
      if (activeOperationRef.current !== operationId) return;
      cancelRequestedRef.current = false;
      cancelSentRef.current = false;
      setCancelling(false);
      const message = cancelError instanceof Error ? cancelError.message : String(cancelError);
      setError(`取消失败：${message}`);
    }
  };

  const handleCancel = () => {
    if (!importing) {
      onClose();
      return;
    }
    const operationId = activeOperationRef.current;
    if (!operationId || cancelling) return;
    cancelRequestedRef.current = true;
    setCancelling(true);
    setError(null);
    if (backendReadyRef.current) {
      void sendCancellation(operationId, project.id);
    }
  };

  const handleSelectSource = async () => {
    const token = projectSessionController.snapshot();
    if (!token || !projectSessionController.isCurrent(token, true)) return;
    setSelecting(true);
    setError(null);
    try {
      const selected = await open({
        multiple: false,
        title: "选择视频",
        filters: [{
          name: "视频",
          extensions: ["mp4", "mov", "mkv", "webm", "avi", "m4v"],
        }],
      });
      if (!selected || !projectSessionController.isCurrent(token, true)) return;
      const selectedPath = Array.isArray(selected) ? selected[0] : selected;
      if (!selectedPath) return;
      const info = await invoke<VideoFileInfo>("inspect_video_file", {
        sourcePath: selectedPath,
      });
      if (!projectSessionController.isCurrent(token, true)) return;
      const fileName = selectedPath.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, "") || "视频帧";
      setSourcePath(selectedPath);
      setName(fileName);
      setVideoInfo(info);
      setStartSeconds(0);
      setEndSeconds(info.durationSeconds);
      setSampleFps(Math.min(projectFps, 12));
      setProgress(null);
    } catch (selectError) {
      setSourcePath("");
      setVideoInfo(null);
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
      !validRange ||
      !projectSessionController.isCurrent(token, true)
    ) {
      return;
    }

    const operationId = crypto.randomUUID();
    activeOperationRef.current = operationId;
    backendReadyRef.current = false;
    cancelRequestedRef.current = false;
    cancelSentRef.current = false;
    setImporting(true);
    setCancelling(false);
    setError(null);
    setProgress({
      operationId,
      projectId: project.id,
      stage: "probing",
      completed: 0,
      total: null,
    });

    let unlisten: (() => void) | undefined;
    try {
      unlisten = await listen<VideoImportProgress>("video-import-progress", ({ payload }) => {
        if (payload.operationId === operationId && payload.projectId === project.id) {
          backendReadyRef.current = true;
          setProgress(payload);
          if (cancelRequestedRef.current) {
            void sendCancellation(operationId, project.id);
          }
        }
      });
      const result = await importTrackForSession(
        token,
        {
          operationId,
          projectId: project.id,
          name: name.trim(),
          filePaths: [sourcePath],
          fps: projectFps,
        },
        {
          isCurrent: (candidate, requireReady) =>
            projectSessionController.isCurrent(candidate, requireReady),
          importTrack: (request) =>
            invoke<Track>("import_video_to_new_track", {
              operationId: request.operationId,
              projectId: request.projectId,
              name: request.name,
              sourcePath,
              startSeconds,
              endSeconds,
              sampleFps,
              projectFps: request.fps,
            }),
          acceptTrack: (track) => {
            const currentProject = useProjectStore.getState().project;
            if (!currentProject || currentProject.id !== project.id) return;
            const tracks = [...useTimelineStore.getState().tracks, track];
            useTimelineStore.getState().setTracks(tracks);
            useAnimationDocumentStore.getState().replaceFromLegacy(currentProject, tracks);
          },
          log: (message, details) =>
            console.info(`[FrameForge] video ${message}`, details),
        },
      );
      if (result === "accepted") {
        onClose();
      } else if (result === "cancelled") {
        setError("项目状态已变化，视频未开始导入。");
      }
    } catch (importError) {
      const message = importError instanceof Error ? importError.message : String(importError);
      if (message.includes("VIDEO_IMPORT_CANCELLED")) {
        onClose();
      } else {
        setError(message);
      }
    } finally {
      unlisten?.();
      activeOperationRef.current = null;
      backendReadyRef.current = false;
      cancelRequestedRef.current = false;
      cancelSentRef.current = false;
      setImporting(false);
      setCancelling(false);
    }
  };

  const progressLabel =
    cancelling
      ? "正在取消视频导入…"
      : progress?.stage === "committing"
      ? "正在写入项目…"
      : progress?.stage === "extracting"
        ? "正在抽取视频帧…"
        : "正在检查视频…";

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 p-6">
      <div className="w-[720px] overflow-hidden rounded-lg border border-gray-700 bg-gray-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-700 px-5 py-3">
          <div>
            <h2 className="text-base font-bold text-white">导入视频帧</h2>
            <p className="mt-0.5 text-[11px] text-gray-500">
              选择范围与抽帧 FPS，生成的 PNG 会按项目 {projectFps} fps 保存节奏。
            </p>
          </div>
          <button
            type="button"
            className="px-2 text-lg text-gray-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
            onClick={handleCancel}
            disabled={cancelling}
            aria-label={importing ? "取消导入" : "关闭"}
          >
            ×
          </button>
        </div>

        <div className="grid grid-cols-[minmax(0,1fr)_300px] gap-5 p-5">
          <div className="flex min-h-[320px] items-center justify-center overflow-hidden rounded border border-gray-700 bg-gray-950 p-3">
            <div className="max-w-full text-center text-sm text-gray-500">
              <div className="mb-3 text-4xl">VIDEO</div>
              {videoInfo ? (
                <>
                  <div className="truncate text-gray-300">{name}</div>
                  <div className="mt-2 text-[11px] leading-5 text-gray-500">
                    <div>{videoInfo.width} × {videoInfo.height}</div>
                    <div>时长 {formatSeconds(videoInfo.durationSeconds)} 秒</div>
                    <div>预计导入 {plannedFrameCount} 帧</div>
                  </div>
                </>
              ) : (
                <div>{selecting ? "正在检查视频…" : "先选择一个视频文件"}</div>
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
              {selecting ? "正在检查…" : sourcePath ? "重新选择视频" : "选择视频"}
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

            <div className="grid grid-cols-2 gap-2">
              <label className="block text-xs text-gray-400">
                <span className="mb-1 block">开始秒数</span>
                <input
                  type="number"
                  min={0}
                  max={videoInfo?.durationSeconds}
                  step={0.001}
                  value={startSeconds}
                  onChange={(event) => setStartSeconds(event.currentTarget.valueAsNumber)}
                  disabled={importing || !videoInfo}
                  className="w-full rounded border border-gray-600 bg-gray-800 px-2 py-1.5 text-sm text-gray-200 outline-none focus:border-orange-400 disabled:opacity-50"
                />
              </label>
              <label className="block text-xs text-gray-400">
                <span className="mb-1 block">结束秒数</span>
                <input
                  type="number"
                  min={0}
                  max={videoInfo?.durationSeconds}
                  step={0.001}
                  value={endSeconds}
                  onChange={(event) => setEndSeconds(event.currentTarget.valueAsNumber)}
                  disabled={importing || !videoInfo}
                  className="w-full rounded border border-gray-600 bg-gray-800 px-2 py-1.5 text-sm text-gray-200 outline-none focus:border-orange-400 disabled:opacity-50"
                />
              </label>
            </div>

            <label className="block text-xs text-gray-400">
              <span className="mb-1 block">抽帧 FPS（最高 {projectFps}）</span>
              <input
                type="number"
                min={0.1}
                max={projectFps}
                step={0.1}
                value={sampleFps}
                onChange={(event) => setSampleFps(event.currentTarget.valueAsNumber)}
                disabled={importing || !videoInfo}
                className="w-full rounded border border-gray-600 bg-gray-800 px-2 py-1.5 text-sm text-gray-200 outline-none focus:border-orange-400 disabled:opacity-50"
              />
            </label>

            <div className="rounded bg-gray-800 px-3 py-2 text-xs leading-5 text-gray-400">
              <div>单次最多 10,000 帧</div>
              <div>原视频不会被修改</div>
              <div>FFmpeg 输出验证后才写入项目</div>
            </div>

            {videoInfo && !validRange && (
              <div className="rounded border border-amber-800/60 bg-amber-950/40 px-3 py-2 text-xs text-amber-300">
                范围必须位于视频时长内，抽帧 FPS 不得高于项目 FPS，预计帧数需为 1–10,000。
              </div>
            )}

            {error && (
              <div className="rounded border border-red-800/60 bg-red-950/40 px-3 py-2 text-xs text-red-300">
                {error}
              </div>
            )}

            {importing && progress && (
              <div className="space-y-1.5" aria-live="polite">
                <div className="flex justify-between text-xs text-gray-400">
                  <span>{progressLabel}</span>
                  <span>{progress.total ? `${progress.completed}/${progress.total}` : ""}</span>
                </div>
                <div
                  className="h-1.5 overflow-hidden rounded bg-gray-800"
                  role="progressbar"
                  aria-label={progressLabel}
                  aria-valuemin={0}
                  aria-valuemax={progress.total ?? undefined}
                  aria-valuenow={progress.total ? progress.completed : undefined}
                >
                  <div
                    className="h-full bg-orange-500"
                    style={{ width: progress.stage === "committing" ? "100%" : "35%" }}
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
            onClick={handleCancel}
            disabled={cancelling}
          >
            {cancelling ? "正在取消…" : "取消"}
          </button>
          <button
            type="button"
            className="rounded bg-orange-600 px-5 py-2 text-sm font-medium text-white hover:bg-orange-500 disabled:cursor-not-allowed disabled:opacity-40"
            onClick={handleImport}
            disabled={importing || selecting || !sourcePath || !name.trim() || !validRange}
          >
            {cancelling ? "正在取消…" : importing ? "导入中…" : "导入视频帧"}
          </button>
        </div>
      </div>
    </div>
  );
}
