import { useEffect } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { useProjectStore } from "../stores/projectStore";
import { useTimelineStore } from "../stores/timelineStore";
import { useAnimationDocumentStore } from "../stores/animationDocumentStore";
import { projectSessionController } from "../core/projectSession";
import {
  importTrackForSession,
  type ProjectImportRequest,
} from "../core/projectImport";

export function useImportHandler() {
  const sessionId = useProjectStore((s) => s.sessionId);

  useEffect(() => {
    const handleImportFolder = async () => {
      const project = useProjectStore.getState().project;
      const token = projectSessionController.snapshot();
      if (!project || !token || !projectSessionController.isCurrent(token, true)) return;
      try {
        const selected = await open({
          directory: true,
          multiple: false,
          title: "选择图片序列帧文件夹",
        });
        if (!selected) return;
        if (!projectSessionController.isCurrent(token, true)) return;

        const folderPath = selected as string;
        const files = await invoke<string[]>("scan_image_folder", { folderPath });
        if (files.length === 0 || !projectSessionController.isCurrent(token, true)) return;

        const state = useTimelineStore.getState();
        const folderName = folderPath.split(/[/\\]/).pop() || "序列帧";
        await importFiles(token, {
          operationId: crypto.randomUUID(),
          projectId: project.id,
          name: folderName,
          filePaths: files,
          fps: state.fps,
        });
      } catch (err) {
        console.error("导入失败:", err);
      }
    };

    const handleImportFiles = async () => {
      const project = useProjectStore.getState().project;
      const token = projectSessionController.snapshot();
      if (!project || !token || !projectSessionController.isCurrent(token, true)) return;
      try {
        const selected = await open({
          multiple: true,
          title: "选择图片文件",
          filters: [{ name: "图片", extensions: ["png", "jpg", "jpeg", "webp", "bmp"] }],
        });
        if (!selected || selected.length === 0) return;
        if (!projectSessionController.isCurrent(token, true)) return;
        const files = Array.isArray(selected) ? selected : [selected];

        const state = useTimelineStore.getState();
        await importFiles(token, {
          operationId: crypto.randomUUID(),
          projectId: project.id,
          name: `帧序列 ${state.tracks.length + 1}`,
          filePaths: files,
          fps: state.fps,
        });
      } catch (err) {
        console.error("导入失败:", err);
      }
    };

    window.addEventListener("frameforge:import-folder", handleImportFolder);
    window.addEventListener("frameforge:import-files", handleImportFiles);
    return () => {
      window.removeEventListener("frameforge:import-folder", handleImportFolder);
      window.removeEventListener("frameforge:import-files", handleImportFiles);
    };
  }, [sessionId]);
}

async function importFiles(
  token: { projectId: string; sessionId: number },
  request: ProjectImportRequest,
) {
  return importTrackForSession(token, request, {
    isCurrent: (candidate, requireReady) =>
      projectSessionController.isCurrent(candidate, requireReady),
    importTrack: (input) =>
      invoke("import_files_to_new_track", {
        ...input,
        trackType: "image_sequence",
        startFrame: 0,
        sourceFps: 0,
      }),
    acceptTrack: (track) => {
      const project = useProjectStore.getState().project;
      if (!project || project.id !== request.projectId) return;
      const tracks = [...useTimelineStore.getState().tracks, track];
      useTimelineStore.getState().setTracks(tracks);
      useAnimationDocumentStore.getState().replaceFromLegacy(project, tracks);
    },
    log: (message, details) => console.info(`[FrameForge] ${message}`, details),
  });
}
