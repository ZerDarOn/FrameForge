import { getAnimationDurationTicks } from "./animationDocument.ts";
import type { AnimationDocument } from "../types/animationDocument";

export type AvailableExportFormat = "png_sequence" | "gif";

interface FileDialogOptions {
  directory?: boolean;
  title?: string;
  defaultPath?: string;
  filters?: { name: string; extensions: string[] }[];
}

type FileDialog = (options: FileDialogOptions) => Promise<string | string[] | null>;

export async function chooseExportDestination(
  format: AvailableExportFormat,
  projectName: string,
  openDirectory: FileDialog,
  saveFile: FileDialog,
) {
  const selected =
    format === "png_sequence"
      ? await openDirectory({ directory: true, title: "选择导出目录" })
      : await saveFile({
          title: "保存 GIF 文件",
          defaultPath: `${projectName}.gif`,
          filters: [{ name: "GIF", extensions: ["gif"] }],
        });
  return typeof selected === "string" ? selected : null;
}

export function getAnimationExportTiming(document: AnimationDocument) {
  const animation = document.animations[0];
  if (!animation) throw new Error("动画文档没有可导出的动作");
  return {
    animationId: animation.id,
    fps: animation.fps,
    totalFrames: getAnimationDurationTicks(animation),
    frameDelayMs: Math.max(1, Math.round(1000 / animation.fps)),
  };
}
