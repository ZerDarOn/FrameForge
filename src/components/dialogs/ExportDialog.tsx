import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { useProjectStore } from "../../stores/projectStore";
import { useTimelineStore } from "../../stores/timelineStore";
import {
  AnimationCanvasRenderer,
  EXPORT_CANCELLED,
} from "../../engines/animationCanvasRenderer";
import { useAnimationDocumentStore } from "../../stores/animationDocumentStore";
import {
  chooseExportDestination,
  getAnimationExportTiming,
} from "../../core/exportWorkflow";

type ExportFormat = "png_sequence" | "gif" | "mp4";

interface Props {
  onClose: () => void;
}

interface Mp4ExportProgress {
  operationId: string;
  projectId: string;
  stage: "preparing" | "encoding" | "committing";
}

export function ExportDialog({ onClose }: Props) {
  const project = useProjectStore((s) => s.project);
  const initialProjectId = useState(() => project?.id ?? null)[0];
  const tracks = useTimelineStore((s) => s.tracks);
  const document = useAnimationDocumentStore((s) => s.document);
  const [format, setFormat] = useState<ExportFormat>("png_sequence");
  const [exporting, setExporting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const activeOperationRef = useRef<string | null>(null);
  const activeProjectRef = useRef<string | null>(null);
  const activeFormatRef = useRef<ExportFormat | null>(null);
  const phaseRef = useRef<"idle" | "rendering" | "writing">("idle");
  const abortControllerRef = useRef<AbortController | null>(null);
  const mp4BackendReadyRef = useRef(false);
  const cancelRequestedRef = useRef(false);
  const cancelSentRef = useRef(false);
  const animation = document?.animations[0];
  const timing = document && animation ? getAnimationExportTiming(document) : null;

  const sendMp4Cancellation = async (operationId: string, projectId: string) => {
    if (cancelSentRef.current) return;
    cancelSentRef.current = true;
    try {
      const accepted = await invoke<boolean>("cancel_rendered_mp4_export", {
        operationId,
        projectId,
      });
      if (!accepted && activeOperationRef.current === operationId) {
        cancelRequestedRef.current = false;
        cancelSentRef.current = false;
        setCancelling(false);
        setResult("MP4 已进入文件提交阶段，无法取消。");
      }
    } catch (cancelError) {
      if (activeOperationRef.current !== operationId) return;
      cancelRequestedRef.current = false;
      cancelSentRef.current = false;
      setCancelling(false);
      const message = cancelError instanceof Error ? cancelError.message : String(cancelError);
      setResult(`取消失败: ${message}`);
    }
  };

  const handleCancel = () => {
    if (!exporting) {
      onClose();
      return;
    }
    if (cancelling) return;
    const operationId = activeOperationRef.current;
    const projectId = activeProjectRef.current;
    const activeFormat = activeFormatRef.current;
    if (!operationId || !projectId || !activeFormat) return;
    if (phaseRef.current === "writing" && activeFormat !== "mp4") {
      setResult("文件已进入写入阶段，无法取消。");
      return;
    }

    cancelRequestedRef.current = true;
    setCancelling(true);
    setResult(null);
    abortControllerRef.current?.abort();
    if (activeFormat === "mp4" && mp4BackendReadyRef.current) {
      void sendMp4Cancellation(operationId, projectId);
    }
  };

  useEffect(() => {
    if (project?.id === initialProjectId) return;
    cancelRequestedRef.current = true;
    abortControllerRef.current?.abort();
    const operationId = activeOperationRef.current;
    const projectId = activeProjectRef.current;
    if (
      operationId &&
      projectId &&
      activeFormatRef.current === "mp4" &&
      mp4BackendReadyRef.current
    ) {
      void sendMp4Cancellation(operationId, projectId);
    }
    onClose();
  }, [initialProjectId, onClose, project?.id]);

  const handleExport = async () => {
    if (!project || project.id !== initialProjectId) return;
    if (!document || !animation) {
      setResult("导出失败: 动画文档尚未就绪");
      return;
    }

    try {
      const selected = await chooseExportDestination(
        format,
        project.name,
        openDialog,
        saveDialog,
      );
      if (!selected) return;
      const operationId = crypto.randomUUID();
      const controller = new AbortController();
      activeOperationRef.current = operationId;
      activeProjectRef.current = project.id;
      activeFormatRef.current = format;
      phaseRef.current = "rendering";
      abortControllerRef.current = controller;
      mp4BackendReadyRef.current = false;
      cancelRequestedRef.current = false;
      cancelSentRef.current = false;
      setExporting(true);
      setCancelling(false);
      setResult(null);
      let unlisten: (() => void) | undefined;
      if (format === "mp4") {
        unlisten = await listen<Mp4ExportProgress>("mp4-export-progress", ({ payload }) => {
          if (payload.operationId !== operationId || payload.projectId !== project.id) return;
          mp4BackendReadyRef.current = true;
          if (cancelRequestedRef.current) {
            void sendMp4Cancellation(operationId, project.id);
          }
        });
      }
      try {
        if (format === "png_sequence") {
          const frames = await new AnimationCanvasRenderer().renderPngFrames(
            document,
            animation.id,
            controller.signal,
          );
          phaseRef.current = "writing";
          const count = await invoke<number>("write_rendered_png_sequence", {
            operationId,
            outputDir: selected,
            frames,
          });
          setResult(`成功导出 ${count} 帧到:\n${selected}`);
        } else if (format === "gif") {
          const frames = await new AnimationCanvasRenderer().renderPngFrames(
            document,
            animation.id,
            controller.signal,
          );
          phaseRef.current = "writing";
          const count = await invoke<number>("write_rendered_gif", {
            operationId,
            outputPath: selected,
            frameDelayMs: timing?.frameDelayMs ?? 1,
            frames,
          });
          setResult(`成功导出 GIF（${count} 帧）到:\n${selected}`);
        } else if (format === "mp4") {
          const frames = await new AnimationCanvasRenderer().renderPngFrames(
            document,
            animation.id,
            controller.signal,
          );
          phaseRef.current = "writing";
          const count = await invoke<number>("write_rendered_mp4", {
            operationId,
            projectId: project.id,
            outputPath: selected,
            fps: timing?.fps ?? 1,
            frames,
          });
          setResult(`成功导出 MP4（${count} 帧）到:\n${selected}`);
        }
      } finally {
        unlisten?.();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes(EXPORT_CANCELLED) || message.includes("MP4_EXPORT_CANCELLED")) {
        onClose();
      } else {
        setResult(`导出失败: ${message}`);
      }
    } finally {
      activeOperationRef.current = null;
      activeProjectRef.current = null;
      activeFormatRef.current = null;
      phaseRef.current = "idle";
      abortControllerRef.current = null;
      mp4BackendReadyRef.current = false;
      cancelRequestedRef.current = false;
      cancelSentRef.current = false;
      setExporting(false);
      setCancelling(false);
    }
  };

  const formats: { key: ExportFormat; label: string; desc: string; available: boolean }[] = [
    { key: "png_sequence", label: "PNG 序列帧", desc: "逐帧导出为 PNG 图片", available: true },
    { key: "gif", label: "GIF 动画", desc: "导出为 GIF 动画文件", available: true },
    { key: "mp4", label: "MP4 视频", desc: "H.264 编码，透明区域显示为黑色", available: true },
  ];

  return (
    <div className="absolute inset-0 bg-black/80 flex items-center justify-center z-50">
      <div className="bg-gray-900 rounded-lg border border-gray-700 p-8 w-[500px] shadow-2xl">
        <h2 className="text-lg font-bold text-white mb-4">导出</h2>

        <div className="space-y-3 mb-4">
          <div className="text-xs text-gray-500">
            项目: {project?.name} | {timing?.totalFrames ?? 0} 帧 | {timing?.fps ?? 0} fps | {tracks.length} 图层
          </div>

          {formats.map((f) => (
            <button
              key={f.key}
              className={`w-full text-left px-4 py-3 rounded-lg border ${
                format === f.key
                  ? "border-orange-400 bg-orange-600/10"
                  : "border-gray-700 hover:border-gray-500"
              } ${!f.available ? "opacity-40 cursor-not-allowed" : ""}`}
              onClick={() => f.available && setFormat(f.key)}
              disabled={!f.available}
            >
              <div className="flex items-center justify-between">
                <span className={`text-sm ${format === f.key ? "text-orange-400" : "text-gray-300"}`}>
                  {f.label}
                </span>
                {!f.available && <span className="text-[10px] text-gray-600">即将支持</span>}
              </div>
              <div className="text-[10px] text-gray-500 mt-1">{f.desc}</div>
            </button>
          ))}
        </div>

        {result && (
          <div className="mb-4 p-3 bg-gray-800 rounded text-xs text-gray-300 whitespace-pre-wrap">
            {result}
          </div>
        )}

        <div className="flex gap-3">
          <button
            className="flex-1 py-2 bg-gray-800 hover:bg-gray-700 rounded text-sm text-gray-300"
            onClick={handleCancel}
            disabled={cancelling}
          >
            {cancelling ? "正在取消..." : result ? "关闭" : "取消"}
          </button>
          <button
            className="flex-1 py-2 bg-orange-600 hover:bg-orange-500 rounded text-sm font-medium text-white disabled:opacity-50"
            onClick={handleExport}
            disabled={exporting}
          >
            {cancelling ? "正在取消..." : exporting ? "导出中..." : "导出"}
          </button>
        </div>
      </div>
    </div>
  );
}
