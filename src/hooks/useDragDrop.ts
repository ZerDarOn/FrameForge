import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useProjectStore } from "../stores/projectStore";
import { useTimelineStore } from "../stores/timelineStore";
import { useAnimationDocumentStore } from "../stores/animationDocumentStore";
import { projectSessionController } from "../core/projectSession";
import { importTrackForSession } from "../core/projectImport";

const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "bmp"];

export function useDragDrop() {
  const [isDragging, setIsDragging] = useState(false);
  const sessionId = useProjectStore((s) => s.sessionId);

  useEffect(() => {
    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(true);
    };

    const handleDragLeave = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
    };

    const handleDrop = async (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);

      const project = useProjectStore.getState().project;
      const token = projectSessionController.snapshot();
      if (!project || !token || !projectSessionController.isCurrent(token, true)) return;

      // Tauri 拖拽文件的处理
      const files = e.dataTransfer?.files;
      if (!files || files.length === 0) return;

      const imageFiles: string[] = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const ext = file.name.split(".").pop()?.toLowerCase() || "";
        if (IMAGE_EXTENSIONS.includes(ext)) {
          // Tauri 文件拖拽中 file.path 包含完整路径
          const path = (file as unknown as { path: string }).path;
          if (path) {
            imageFiles.push(path);
          }
        }
      }

      if (imageFiles.length === 0) return;

      try {
        const currentFps = useTimelineStore.getState().fps;
        const trackCount = useTimelineStore.getState().tracks.length;

        await importTrackForSession(
          token,
          {
            operationId: crypto.randomUUID(),
            projectId: project.id,
            name: `导入帧 ${trackCount + 1}`,
            filePaths: imageFiles,
            fps: currentFps,
          },
          {
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
              const activeProject = useProjectStore.getState().project;
              if (!activeProject || activeProject.id !== project.id) return;
              const tracks = [...useTimelineStore.getState().tracks, track];
              useTimelineStore.getState().setTracks(tracks);
              useAnimationDocumentStore
                .getState()
                .replaceFromLegacy(activeProject, tracks);
            },
            log: (message, details) =>
              console.info(`[FrameForge] ${message}`, details),
          },
        );
      } catch (err) {
        console.error("拖拽导入失败:", err);
      }
    };

    document.addEventListener("dragover", handleDragOver);
    document.addEventListener("dragleave", handleDragLeave);
    document.addEventListener("drop", handleDrop);

    return () => {
      document.removeEventListener("dragover", handleDragOver);
      document.removeEventListener("dragleave", handleDragLeave);
      document.removeEventListener("drop", handleDrop);
    };
  }, [sessionId]);

  return isDragging;
}
