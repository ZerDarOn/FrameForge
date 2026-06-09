import { create } from "zustand";
import type { Project, BaselinePoint } from "../types/project";

interface ProjectState {
  project: Project | null;
  setProject: (project: Project) => void;
  updateProject: (partial: Partial<Project>) => void;
  addBaselinePoint: (point: BaselinePoint) => void;
  removeBaselinePoint: (id: string) => void;
}

export const useProjectStore = create<ProjectState>((set) => ({
  project: null,
  setProject: (project) => set({ project }),
  updateProject: (partial) =>
    set((state) => ({
      project: state.project
        ? { ...state.project, ...partial, updatedAt: Date.now() }
        : null,
    })),
  addBaselinePoint: (point) =>
    set((state) => ({
      project: state.project
        ? {
            ...state.project,
            baselinePoints: [...state.project.baselinePoints, point],
            updatedAt: Date.now(),
          }
        : null,
    })),
  removeBaselinePoint: (id) =>
    set((state) => ({
      project: state.project
        ? {
            ...state.project,
            baselinePoints: state.project.baselinePoints.filter(
              (p) => p.id !== id
            ),
            updatedAt: Date.now(),
          }
        : null,
    })),
}));
