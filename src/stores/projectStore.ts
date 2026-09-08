import { create } from "zustand";
import type { Project, BaselinePoint } from "../types/project";
import {
  projectSessionController,
  type ProjectLoadStatus,
  type ProjectSessionToken,
} from "../core/projectSession";

interface ProjectState {
  project: Project | null;
  sessionId: number;
  loadStatus: ProjectLoadStatus;
  loadError: string | null;
  setProject: (project: Project) => void;
  markLoadReady: (token: ProjectSessionToken) => void;
  markLoadError: (token: ProjectSessionToken, error: string) => void;
  clearProject: () => void;
  updateProject: (partial: Partial<Project>) => void;
  addBaselinePoint: (point: BaselinePoint) => void;
  removeBaselinePoint: (id: string) => void;
}

export const useProjectStore = create<ProjectState>((set) => ({
  project: null,
  sessionId: 0,
  loadStatus: "idle",
  loadError: null,
  setProject: (project) => {
    const token = projectSessionController.begin(project.id);
    set({
      project,
      sessionId: token.sessionId,
      loadStatus: "loading",
      loadError: null,
    });
  },
  markLoadReady: (token) => {
    if (!projectSessionController.markReady(token)) return;
    set({ loadStatus: "ready", loadError: null });
  },
  markLoadError: (token, error) => {
    if (!projectSessionController.markError(token)) return;
    set({ loadStatus: "error", loadError: error });
  },
  clearProject: () => {
    projectSessionController.clear();
    set((state) => ({
      project: null,
      sessionId: state.sessionId + 1,
      loadStatus: "idle",
      loadError: null,
    }));
  },
  updateProject: (partial) =>
    set((state) => ({
      project: state.project && projectSessionController.isReadyFor(state.project.id)
        ? { ...state.project, ...partial, updatedAt: Date.now() }
        : state.project,
    })),
  addBaselinePoint: (point) =>
    set((state) => ({
      project: state.project && projectSessionController.isReadyFor(state.project.id)
        ? {
            ...state.project,
            baselinePoints: [...state.project.baselinePoints, point],
            updatedAt: Date.now(),
          }
        : state.project,
    })),
  removeBaselinePoint: (id) =>
    set((state) => ({
      project: state.project && projectSessionController.isReadyFor(state.project.id)
        ? {
            ...state.project,
            baselinePoints: state.project.baselinePoints.filter(
              (p) => p.id !== id
            ),
            updatedAt: Date.now(),
          }
        : state.project,
    })),
}));
