import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useProjectStore } from "../../stores/projectStore";
import { useTimelineStore } from "../../stores/timelineStore";

type ExportFormat = "png_sequence" | "gif" | "mp4";

interface Props {
  onClose: () => void;
}

export function ExportDialog({ onClose }: Props) {
  const project = useProjectStore((s) => s.project);
  const tracks = useTimelineStore((s) => s.tracks);
  const fps = useTimelineStore((s) => s.fps);
  const totalFrames = useTimelineStore((s) => s.totalFrames);
  const [format, setFormat] = useState<ExportFormat>("png_sequence");
  const [exporting, setExporting] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const handleExport = async () => {
    if (!project) return;

    if (format === "png_sequence") {
      const selected = await openDialog({ directory: true, title: "选择导出目录" });
      if (!selected) return;
      setExporting(true);
      try {
        const count = await invoke<number>("export_png_sequence", {
          projectId: project.id,
          outputDir: selected,
        });
        setResult(`成功导出 ${count} 帧到:\n${selected}`);
      } catch (err) {
        setResult(`导出失败: ${err}`);
      } finally {
        setExporting(false);
      }
    } else if (format === "gif") {
      const selected = await openDialog({
        save: true,
        title: "保存 GIF 文件",
        filters: [{ name: "GIF", extensions: ["gif"] }],
      });
      if (!selected) return;
      setExporting(true);
      try {
        const count = await invoke<number>("export_gif", {
          projectId: project.id,
          outputPath: selected,
          fps,
        });
        setResult(`成功导出 GIF（${count} 帧）到:\n${selected}`);
      } catch (err) {
        setResult(`导出失败: ${err}`);
      } finally {
        setExporting(false);
      }
    }
  };

  const formats: { key: ExportFormat; label: string; desc: string; available: boolean }[] = [
    { key: "png_sequence", label: "PNG 序列帧", desc: "逐帧导出为 PNG 图片", available: true },
    { key: "gif", label: "GIF 动画", desc: "导出为 GIF 动画文件", available: true },
    { key: "mp4", label: "MP4 视频", desc: "导出为 MP4 视频文件", available: false },
  ];

  return (
    <div className="absolute inset-0 bg-black/80 flex items-center justify-center z-50">
      <div className="bg-gray-900 rounded-lg border border-gray-700 p-8 w-[500px] shadow-2xl">
        <h2 className="text-lg font-bold text-white mb-4">导出</h2>

        <div className="space-y-3 mb-4">
          <div className="text-xs text-gray-500">
            项目: {project?.name} | {totalFrames} 帧 | {fps} fps | {tracks.length} 轨道
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
            onClick={onClose}
            disabled={exporting}
          >
            {result ? "关闭" : "取消"}
          </button>
          <button
            className="flex-1 py-2 bg-orange-600 hover:bg-orange-500 rounded text-sm font-medium text-white disabled:opacity-50"
            onClick={handleExport}
            disabled={exporting}
          >
            {exporting ? "导出中..." : "导出"}
          </button>
        </div>
      </div>
    </div>
  );
}
