import { useEffect } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { useProjectStore } from "../stores/projectStore";
import { useTimelineStore } from "../stores/timelineStore";
import type { Track } from "../types/timeline";
import type { Asset } from "../types/asset";

export function useImportHandler() {
  const project = useProjectStore((s) => s.project);
  const addTrack = useTimelineStore((s) => s.addTrack);
  const addAssetToTrack = useTimelineStore((s) => s.addAssetToTrack);
  const fps = useTimelineStore((s) => s.fps);
  const tracks = useTimelineStore((s) => s.tracks);

  useEffect(() => {
    const handleImportFolder = async () => {
      if (!project) return;
      try {
        const selected = await open({
          directory: true,
          multiple: false,
          title: "选择图片序列帧文件夹",
        });
        if (!selected) return;

        const folderPath = selected as string;
        const files = await invoke<string[]>("scan_image_folder", { folderPath });
        if (files.length === 0) return;

        const folderName = folderPath.split(/[/\\]/).pop() || "序列帧";
        const track = await invoke<Track>("create_track", {
          projectId: project.id,
          name: folderName,
          trackType: "image_sequence",
        });
        addTrack(track);

        const assets = await invoke<Asset[]>("import_frames_to_track", {
          trackId: track.id,
          filePaths: files,
          startFrame: 0,
          fps,
          sourceFps: 0,
        });
        for (const asset of assets) addAssetToTrack(track.id, asset);
      } catch (err) {
        console.error("导入失败:", err);
      }
    };

    const handleImportFiles = async () => {
      if (!project) return;
      try {
        const selected = await open({
          multiple: true,
          title: "选择图片文件",
          filters: [{ name: "图片", extensions: ["png", "jpg", "jpeg", "webp", "bmp"] }],
        });
        if (!selected || selected.length === 0) return;
        const files = Array.isArray(selected) ? selected : [selected];

        const track = await invoke<Track>("create_track", {
          projectId: project.id,
          name: `帧序列 ${tracks.length + 1}`,
          trackType: "image_sequence",
        });
        addTrack(track);

        const assets = await invoke<Asset[]>("import_frames_to_track", {
          trackId: track.id,
          filePaths: files,
          startFrame: 0,
          fps,
          sourceFps: 0,
        });
        for (const asset of assets) addAssetToTrack(track.id, asset);
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
  }, [project, tracks.length, addTrack, addAssetToTrack, fps]);
}
