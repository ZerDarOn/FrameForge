import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useProjectStore } from "../stores/projectStore";
import { useTimelineStore } from "../stores/timelineStore";
import type { Track } from "../types/timeline";

/**
 * 当项目切换时，从数据库加载轨道和帧数据
 */
export function useProjectLoader() {
  const project = useProjectStore((s) => s.project);
  const setTracks = useTimelineStore((s) => s.setTracks);
  const setFps = useTimelineStore((s) => s.setFps);

  useEffect(() => {
    if (!project) return;

    const loadProjectData = async () => {
      try {
        const tracks = await invoke<Track[]>("get_project_tracks", {
          projectId: project.id,
        });
        setTracks(tracks);
        setFps(project.fps);
      } catch (err) {
        console.error("加载项目数据失败:", err);
      }
    };

    loadProjectData();
  }, [project, setTracks, setFps]);
}
