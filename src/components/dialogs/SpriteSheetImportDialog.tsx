import { useEffect, useMemo, useState } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { createSpriteSheetSlices } from "../../core/spriteSheet";
import { importTrackForSession } from "../../core/projectImport";
import { projectSessionController } from "../../core/projectSession";
import { useAnimationDocumentStore } from "../../stores/animationDocumentStore";
import { useProjectStore } from "../../stores/projectStore";
import { useTimelineStore } from "../../stores/timelineStore";
import type { Track } from "../../types/timeline";

interface ImageFileInfo {
  width: number;
  height: number;
}

interface SpriteSheetImportProgress {
  operationId: string;
  projectId: string;
  stage: "slicing" | "committing";
  completed: number;
  total: number;
}

export function SpriteSheetImportDialog({ onClose }: { onClose: () => void }) {
  const project = useProjectStore((state) => state.project);
  const initialProjectId = useState(() => project?.id ?? null)[0];
  const [sourcePath, setSourcePath] = useState("");
  const [imageInfo, setImageInfo] = useState<ImageFileInfo | null>(null);
  const [name, setName] = useState("精灵图");
  const [cellWidth, setCellWidth] = useState(String(project?.canvasWidth ?? 16));
  const [cellHeight, setCellHeight] = useState(String(project?.canvasHeight ?? 16));
  const [offsetX, setOffsetX] = useState("0");
  const [offsetY, setOffsetY] = useState("0");
  const [spacingX, setSpacingX] = useState("0");
  const [spacingY, setSpacingY] = useState("0");
  const [frameCount, setFrameCount] = useState("");
  const [inspecting, setInspecting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<SpriteSheetImportProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (project?.id !== initialProjectId) onClose();
  }, [initialProjectId, onClose, project?.id]);

  const plan = useMemo(() => {
    if (!imageInfo) return { count: 0, error: null as string | null };
    try {
      const slices = createSpriteSheetSlices({
        sheetWidth: imageInfo.width,
        sheetHeight: imageInfo.height,
        cellWidth: Number(cellWidth),
        cellHeight: Number(cellHeight),
        offsetX: Number(offsetX),
        offsetY: Number(offsetY),
        spacingX: Number(spacingX),
        spacingY: Number(spacingY),
        frameCount: frameCount.trim() ? Number(frameCount) : undefined,
      });
      return { count: slices.length, error: null };
    } catch (planError) {
      return {
        count: 0,
        error: planError instanceof Error ? planError.message : String(planError),
      };
    }
  }, [cellHeight, cellWidth, frameCount, imageInfo, offsetX, offsetY, spacingX, spacingY]);

  if (!project || project.id !== initialProjectId) return null;

  const selectSource = async () => {
    const token = projectSessionController.snapshot();
    if (!token || !projectSessionController.isCurrent(token, true)) return;
    setInspecting(true);
    setError(null);
    try {
      const selected = await open({
        multiple: false,
        title: "选择精灵图",
        filters: [{ name: "图片", extensions: ["png", "jpg", "jpeg", "webp", "bmp"] }],
      });
      if (!selected || !projectSessionController.isCurrent(token, true)) return;
      const selectedPath = Array.isArray(selected) ? selected[0] : selected;
      if (!selectedPath) return;
      const info = await invoke<ImageFileInfo>("inspect_image_file", { filePath: selectedPath });
      if (!projectSessionController.isCurrent(token, true)) return;
      const fileName = selectedPath.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, "") || "精灵图";
      setSourcePath(selectedPath);
      setImageInfo(info);
      setName(fileName);
      setCellWidth(String(Math.max(1, Math.min(project.canvasWidth, info.width))));
      setCellHeight(String(Math.max(1, Math.min(project.canvasHeight, info.height))));
      setProgress(null);
    } catch (selectError) {
      setError(selectError instanceof Error ? selectError.message : String(selectError));
    } finally {
      setInspecting(false);
    }
  };

  const importSpriteSheet = async () => {
    const token = projectSessionController.snapshot();
    if (
      !token ||
      !sourcePath ||
      plan.error ||
      plan.count === 0 ||
      !projectSessionController.isCurrent(token, true)
    ) {
      return;
    }

    const operationId = crypto.randomUUID();
    const requestedFrameCount = frameCount.trim() ? Number(frameCount) : undefined;
    setImporting(true);
    setError(null);
    setProgress({
      operationId,
      projectId: project.id,
      stage: "slicing",
      completed: 0,
      total: plan.count,
    });

    let unlisten: (() => void) | undefined;
    try {
      unlisten = await listen<SpriteSheetImportProgress>(
        "sprite-sheet-progress",
        ({ payload }) => {
          if (payload.operationId === operationId && payload.projectId === project.id) {
            setProgress(payload);
          }
        },
      );
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
            invoke<Track>("slice_sprite_sheet_to_new_track", {
              operationId: request.operationId,
              projectId: request.projectId,
              name: request.name,
              sourcePath,
              cellWidth: Number(cellWidth),
              cellHeight: Number(cellHeight),
              offsetX: Number(offsetX),
              offsetY: Number(offsetY),
              spacingX: Number(spacingX),
              spacingY: Number(spacingY),
              frameCount: requestedFrameCount ?? null,
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
            console.info(`[FrameForge] sprite sheet ${message}`, {
              ...details,
              plannedFrameCount: plan.count,
            }),
        },
      );
      if (result === "accepted") onClose();
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : String(importError));
    } finally {
      unlisten?.();
      setImporting(false);
    }
  };

  const percent = progress?.total
    ? Math.round((progress.completed / progress.total) * 100)
    : 0;

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 p-6">
      <div className="flex max-h-full w-[760px] flex-col overflow-hidden rounded-lg border border-gray-700 bg-gray-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-700 px-5 py-3">
          <div>
            <h2 className="text-base font-bold text-white">导入精灵图</h2>
            <p className="mt-0.5 text-[11px] text-gray-500">按行从左到右切分完整画格，原图不会被修改。</p>
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

        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_300px] gap-5 overflow-y-auto p-5">
          <div className="flex min-h-[280px] items-center justify-center overflow-hidden rounded border border-gray-700 bg-gray-950 p-3">
            {sourcePath ? (
              <img
                src={convertFileSrc(sourcePath)}
                alt="精灵图预览"
                className="max-h-[420px] max-w-full object-contain [image-rendering:pixelated]"
                draggable={false}
              />
            ) : (
              <div className="text-center text-sm text-gray-600">
                <div className="mb-2 text-3xl">▦</div>
                先选择一张精灵图
              </div>
            )}
          </div>

          <div className="space-y-4">
            <button
              type="button"
              className="w-full rounded bg-gray-700 px-3 py-2 text-sm text-gray-200 hover:bg-gray-600 disabled:opacity-50"
              onClick={selectSource}
              disabled={inspecting || importing}
            >
              {inspecting ? "正在读取…" : sourcePath ? "重新选择图片" : "选择图片"}
            </button>

            {imageInfo && (
              <div className="rounded bg-gray-800 px-3 py-2 text-xs text-gray-400">
                原图 {imageInfo.width} × {imageInfo.height} px · 预计 {plan.count} 帧
              </div>
            )}

            <TextField label="轨道名称" value={name} onChange={setName} disabled={importing} />

            <div className="grid grid-cols-2 gap-3">
              <NumberField label="画格宽度" value={cellWidth} onChange={setCellWidth} min={1} disabled={importing} />
              <NumberField label="画格高度" value={cellHeight} onChange={setCellHeight} min={1} disabled={importing} />
              <NumberField label="左侧偏移" value={offsetX} onChange={setOffsetX} min={0} disabled={importing} />
              <NumberField label="顶部偏移" value={offsetY} onChange={setOffsetY} min={0} disabled={importing} />
              <NumberField label="水平间距" value={spacingX} onChange={setSpacingX} min={0} disabled={importing} />
              <NumberField label="垂直间距" value={spacingY} onChange={setSpacingY} min={0} disabled={importing} />
            </div>

            <NumberField
              label="导入帧数（留空为全部）"
              value={frameCount}
              onChange={setFrameCount}
              min={1}
              disabled={importing}
            />

            {plan.error && imageInfo && (
              <div className="rounded border border-amber-800/60 bg-amber-950/40 px-3 py-2 text-xs text-amber-300">
                网格设置无效：{plan.error}
              </div>
            )}
            {error && (
              <div className="rounded border border-red-800/60 bg-red-950/40 px-3 py-2 text-xs text-red-300">
                {error}
              </div>
            )}
            {importing && progress && (
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs text-gray-400">
                  <span>{progress.stage === "committing" ? "正在写入项目…" : "正在切分画格…"}</span>
                  <span>{progress.completed}/{progress.total}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded bg-gray-800">
                  <div className="h-full bg-orange-500 transition-[width]" style={{ width: `${percent}%` }} />
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
            onClick={importSpriteSheet}
            disabled={importing || !sourcePath || Boolean(plan.error) || plan.count === 0 || !name.trim()}
          >
            {importing ? "导入中…" : `导入 ${plan.count || 0} 帧`}
          </button>
        </div>
      </div>
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  return (
    <label className="block text-xs text-gray-400">
      <span className="mb-1 block">{label}</span>
      <input
        className="w-full rounded border border-gray-600 bg-gray-800 px-2 py-1.5 text-sm text-gray-200 outline-none focus:border-orange-400 disabled:opacity-50"
        value={value}
        maxLength={128}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
      />
    </label>
  );
}

function NumberField({
  label,
  value,
  onChange,
  min,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  min: number;
  disabled: boolean;
}) {
  return (
    <label className="block text-xs text-gray-400">
      <span className="mb-1 block">{label}</span>
      <input
        type="number"
        step={1}
        min={min}
        className="w-full rounded border border-gray-600 bg-gray-800 px-2 py-1.5 text-sm text-gray-200 outline-none focus:border-orange-400 disabled:opacity-50"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
      />
    </label>
  );
}
