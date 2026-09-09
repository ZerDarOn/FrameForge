import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useProjectStore } from "../stores/projectStore";
import { useTimelineStore } from "../stores/timelineStore";
import { useAnimationDocumentStore } from "../stores/animationDocumentStore";
import {
  restoreBaselinePoints,
  useBaselineStore,
  type StoredBaselinePoint,
} from "../stores/baselineStore";
import type { Track } from "../types/timeline";
import {
  projectSessionController,
  type ProjectSessionToken,
} from "../core/projectSession";
import { useAnalysisStore } from "../stores/analysisStore";

/**
 * 当项目切换时，从数据库加载轨道和帧数据
 */
export function useProjectLoader() {
  const project = useProjectStore((s) => s.project);
  const projectId = project?.id ?? null;
  const sessionId = useProjectStore((s) => s.sessionId);
  const markLoadReady = useProjectStore((s) => s.markLoadReady);
  const markLoadError = useProjectStore((s) => s.markLoadError);
  const setTracks = useTimelineStore((s) => s.setTracks);
  const setFps = useTimelineStore((s) => s.setFps);
  const loadAnimationDocument = useAnimationDocumentStore((s) => s.loadForProject);
  const beginProjectLoad = useAnimationDocumentStore((s) => s.beginProjectLoad);
  const setBaselinePoints = useBaselineStore((s) => s.setPoints);
  const beginAnalysisProject = useAnalysisStore((s) => s.beginProject);
  const loadAnalysisReports = useAnalysisStore((s) => s.loadReports);

  useEffect(() => {
    if (!projectId) {
      setBaselinePoints([]);
      beginAnalysisProject(null);
      return;
    }
    const projectSnapshot = useProjectStore.getState().project;
    if (!projectSnapshot || projectSnapshot.id !== projectId) return;
    const token: ProjectSessionToken = { projectId, sessionId };
    let cancelled = false;
    beginProjectLoad();
    setTracks([]);
    setBaselinePoints([]);
    beginAnalysisProject(projectId);
    void loadAnalysisReports(projectId);
    useTimelineStore.getState().setPlaying(false);

    const loadProjectData = async () => {
      try {
        const [tracks, baselinePoints] = await Promise.all([
          invoke<Track[]>("get_project_tracks", { projectId }),
          invoke<StoredBaselinePoint[]>("get_baseline_points", { projectId }),
        ]);
        if (cancelled || !projectSessionController.isCurrent(token)) return;
        setTracks(tracks);
        setBaselinePoints(restoreBaselinePoints(baselinePoints));
        setFps(projectSnapshot.fps);
        const loaded = await loadAnimationDocument(projectSnapshot, tracks);
        if (cancelled || !projectSessionController.isCurrent(token)) return;
        if (!loaded) {
          const error = useAnimationDocumentStore.getState().error ?? "动画文档加载失败";
          markLoadError(token, error);
          return;
        }
        markLoadReady(token);
      } catch (err) {
        if (cancelled || !projectSessionController.isCurrent(token)) return;
        const message = err instanceof Error ? err.message : String(err);
        console.error("加载项目数据失败:", message);
        markLoadError(token, message);
      }
    };

    void loadProjectData();
    return () => {
      cancelled = true;
    };
  }, [
    beginAnalysisProject,
    beginProjectLoad,
    loadAnimationDocument,
    loadAnalysisReports,
    markLoadError,
    markLoadReady,
    projectId,
    sessionId,
    setFps,
    setBaselinePoints,
    setTracks,
  ]);
}
