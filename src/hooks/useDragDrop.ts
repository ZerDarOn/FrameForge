import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useProjectStore } from "../stores/projectStore";
import { useTimelineStore } from "../stores/timelineStore";
import type { Track } from "../types/timeline";
import type { Asset } from "../types/asset";

const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "bmp"];

export function useDragDrop() {
  const [isDragging, setIsDragging] = useState(false);
  const project = useProjectStore((s) => s.project);
  const addTrack = useTimelineStore((s) => s.addTrack);
  const addAssetToTrack = useTimelineStore((s) => s.addAssetToTrack);
  const tracks = useTimelineStore((s) => s.tracks);

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

      if (!project) return;

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
        const track = await invoke<Track>("create_track", {
          projectId: project.id,
          name: `导入帧 ${tracks.length + 1}`,
          trackType: "image_sequence",
        });

        addTrack(track);

        const assets = await invoke<Asset[]>("import_frames_to_track", {
          trackId: track.id,
          filePaths: imageFiles,
          startFrame: 0,
        });

        for (const asset of assets) {
          addAssetToTrack(track.id, asset);
        }
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
  }, [project, tracks.length, addTrack, addAssetToTrack]);

  return isDragging;
}
