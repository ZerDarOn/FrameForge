import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import {
  applyAnimationDocumentCommand,
  convertLegacyProject,
  validateAnimationDocument,
} from "../core/animationDocument.ts";
import type {
  AnimationDocument,
  AnimationDocumentCommand,
  AnimationDocumentMigrationReport,
} from "../types/animationDocument";
import type { Project } from "../types/project";
import type { Track } from "../types/timeline";
import { projectSessionController } from "../core/projectSession.ts";

type DocumentSaveStatus = "idle" | "saving" | "saved" | "error";

interface AnimationDocumentRecord {
  projectId: string;
  schemaVersion: number;
  revision: number;
  documentJson: string;
  updatedAt: number;
}

interface AnimationDocumentState {
  document: AnimationDocument | null;
  saveStatus: DocumentSaveStatus;
  persistedRevision: number | null;
  error: string | null;
  migrationReport: AnimationDocumentMigrationReport | null;
  undoStack: AnimationDocumentCommand[];
  redoStack: AnimationDocumentCommand[];
  beginProjectLoad: () => void;
  loadForProject: (project: Project, legacyTracks: Track[]) => Promise<boolean>;
  replaceFromLegacy: (project: Project, tracks: Track[]) => void;
  updateProjectSettings: (project: Project) => void;
  execute: (command: AnimationDocumentCommand) => void;
  undo: () => void;
  redo: () => void;
  retrySave: () => void;
  flushCurrentProject: () => Promise<boolean>;
}

interface ProjectDraft {
  document: AnimationDocument;
  persistedRevision: number | null;
  error: string | null;
  migrationReport: AnimationDocumentMigrationReport | null;
  undoStack: AnimationDocumentCommand[];
  redoStack: AnimationDocumentCommand[];
}

type InvokeCommand = <T>(
  command: string,
  args?: Record<string, unknown>,
) => Promise<T>;

interface PersistenceContext {
  saveQueues: Map<string, Promise<void>>;
  blockedSaveProjects: Set<string>;
  projectDrafts: Map<string, ProjectDraft>;
  loadSequence: number;
}

function describeError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function rememberDraft(context: PersistenceContext, state: AnimationDocumentState) {
  if (!state.document) return;
  context.projectDrafts.set(state.document.projectId, {
    document: state.document,
    persistedRevision: state.persistedRevision,
    error: state.error,
    migrationReport: state.migrationReport,
    undoStack: state.undoStack,
    redoStack: state.redoStack,
  });
}

async function waitForProjectQueue(context: PersistenceContext, projectId: string) {
  while (true) {
    const pending = context.saveQueues.get(projectId);
    if (!pending) return;
    await pending.catch(() => undefined);
    if (context.saveQueues.get(projectId) === pending) return;
  }
}

function enqueueSave(
  context: PersistenceContext,
  invokeCommand: InvokeCommand,
  get: () => AnimationDocumentState,
  set: (
    partial:
      | Partial<AnimationDocumentState>
      | ((state: AnimationDocumentState) => Partial<AnimationDocumentState>),
  ) => void,
  document: AnimationDocument,
  expectedRevision: number | null,
) {
  const projectId = document.projectId;
  if (context.blockedSaveProjects.has(projectId)) {
    if (get().document?.projectId === projectId) {
      set((state) => ({
        saveStatus: "error",
        error: state.error ?? "保存队列已暂停，请重试保存",
      }));
    }
    rememberDraft(context, get());
    return;
  }
  const previous = context.saveQueues.get(projectId) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(async () => {
      if (context.blockedSaveProjects.has(projectId)) {
        return;
      }
      if (get().document?.projectId === projectId) {
        set({ saveStatus: "saving", error: null });
      }
      try {
        const record = await invokeCommand<AnimationDocumentRecord>("save_animation_document", {
          projectId,
          expectedRevision,
          documentJson: JSON.stringify(document),
        });
        const draft = context.projectDrafts.get(projectId);
        if (draft) {
          if (draft.document.revision === record.revision) {
            context.projectDrafts.delete(projectId);
          } else {
            context.projectDrafts.set(projectId, {
              ...draft,
              persistedRevision: Math.max(draft.persistedRevision ?? -1, record.revision),
            });
          }
        }
        if (get().document?.projectId === projectId) {
          set((state) => ({
            persistedRevision: Math.max(state.persistedRevision ?? -1, record.revision),
            saveStatus:
              state.document?.revision === record.revision ? "saved" : state.saveStatus,
          }));
        }
      } catch (error) {
        context.blockedSaveProjects.add(projectId);
        const draft = context.projectDrafts.get(projectId);
        if (draft) {
          context.projectDrafts.set(projectId, { ...draft, error: describeError(error) });
        }
        if (get().document?.projectId === projectId) {
          set({ saveStatus: "error", error: describeError(error) });
          rememberDraft(context, get());
        }
        throw error;
      }
    });
  context.saveQueues.set(projectId, next);
  void next.catch(() => undefined);
  void next
    .finally(() => {
      if (context.saveQueues.get(projectId) === next) {
        context.saveQueues.delete(projectId);
      }
    })
    .catch(() => undefined);
}

export function createAnimationDocumentStore(
  invokeCommand: InvokeCommand = (command, args) => invoke(command, args),
  canEditProject: (projectId: string) => boolean = () => true,
) {
  const persistence: PersistenceContext = {
    saveQueues: new Map(),
    blockedSaveProjects: new Set(),
    projectDrafts: new Map(),
    loadSequence: 0,
  };
  return create<AnimationDocumentState>((set, get) => ({
  document: null,
  saveStatus: "idle",
  persistedRevision: null,
  error: null,
  migrationReport: null,
  undoStack: [],
  redoStack: [],

  beginProjectLoad: () => {
    persistence.loadSequence += 1;
    set({
      document: null,
      saveStatus: "idle",
      persistedRevision: null,
      error: null,
      migrationReport: null,
      undoStack: [],
      redoStack: [],
    });
  },

  loadForProject: async (project, legacyTracks) => {
    const requestSequence = ++persistence.loadSequence;
    set({
      document: null,
      saveStatus: "idle",
      persistedRevision: null,
      error: null,
      migrationReport: null,
      undoStack: [],
      redoStack: [],
    });

    try {
      await waitForProjectQueue(persistence, project.id);
      if (requestSequence !== persistence.loadSequence) return false;
      const draft = persistence.projectDrafts.get(project.id);
      if (persistence.blockedSaveProjects.has(project.id) && draft) {
        set({
          ...draft,
          saveStatus: "error",
          error: draft.error ?? "保存队列已暂停，请重试保存",
        });
        return true;
      }

      const record = await invokeCommand<AnimationDocumentRecord | null>("get_animation_document", {
        projectId: project.id,
      });
      if (requestSequence !== persistence.loadSequence) return false;

      if (record) {
        const document = JSON.parse(record.documentJson) as AnimationDocument;
        const validationErrors = validateAnimationDocument(document);
        if (validationErrors.length > 0) {
          throw new Error(`动画文档校验失败: ${validationErrors.join("; ")}`);
        }
        if (document.projectId !== project.id) {
          throw new Error("动画文档属于另一个项目");
        }
        if (record.projectId !== project.id || document.revision !== record.revision) {
          throw new Error("动画文档记录与内容版本不一致");
        }
        set({
          document,
          persistedRevision: record.revision,
          saveStatus: "saved",
        });
        return true;
      }

      const { document, report } = convertLegacyProject(project, legacyTracks);
      set({
        document,
        persistedRevision: null,
        saveStatus: "saving",
        migrationReport: report,
      });
      rememberDraft(persistence, get());
      enqueueSave(persistence, invokeCommand, get, set, document, null);
      return true;
    } catch (error) {
      if (requestSequence !== persistence.loadSequence) return false;
      set({ saveStatus: "error", error: describeError(error) });
      return false;
    }
  },

  replaceFromLegacy: (project, tracks) => {
    const current = get().document;
    if (!current || current.projectId !== project.id || !canEditProject(current.projectId)) {
      return;
    }
    const converted = convertLegacyProject(project, tracks, Date.now(), current ?? undefined);
    const applied = applyAnimationDocumentCommand(current, {
      type: "replace_document",
      document: converted.document,
    });
    set((state) => ({
      document: applied.document,
      migrationReport: converted.report,
      saveStatus: "saving",
      error: null,
      undoStack: [...state.undoStack, applied.inverse],
      redoStack: [],
    }));
    rememberDraft(persistence, get());
    enqueueSave(persistence, invokeCommand, get, set, applied.document, current.revision);
  },

  updateProjectSettings: (project) => {
    const current = get().document;
    const animation = current?.animations[0];
    if (
      !current ||
      !animation ||
      current.projectId !== project.id ||
      !canEditProject(current.projectId)
    ) return;
    get().execute({
      type: "replace_document",
      document: {
        ...current,
        canvas: {
          ...current.canvas,
          width: project.canvasWidth,
          height: project.canvasHeight,
          originX: Math.floor(project.canvasWidth / 2),
          originY: Math.floor(project.canvasHeight / 2),
        },
        animations: current.animations.map((candidate) =>
          candidate.id === animation.id ? { ...candidate, fps: project.fps } : candidate,
        ),
      },
    });
  },

  execute: (command) => {
    const current = get().document;
    if (!current || !canEditProject(current.projectId)) return;
    const applied = applyAnimationDocumentCommand(current, command);
    set((state) => ({
      document: applied.document,
      saveStatus: "saving",
      error: null,
      undoStack: [...state.undoStack, applied.inverse],
      redoStack: [],
    }));
    rememberDraft(persistence, get());
    enqueueSave(persistence, invokeCommand, get, set, applied.document, current.revision);
  },

  undo: () => {
    const state = get();
    const current = state.document;
    const command = state.undoStack[state.undoStack.length - 1];
    if (!current || !command || !canEditProject(current.projectId)) return;
    const applied = applyAnimationDocumentCommand(current, command);
    set({
      document: applied.document,
      saveStatus: "saving",
      error: null,
      undoStack: state.undoStack.slice(0, -1),
      redoStack: [...state.redoStack, applied.inverse],
    });
    rememberDraft(persistence, get());
    enqueueSave(persistence, invokeCommand, get, set, applied.document, current.revision);
  },

  redo: () => {
    const state = get();
    const current = state.document;
    const command = state.redoStack[state.redoStack.length - 1];
    if (!current || !command || !canEditProject(current.projectId)) return;
    const applied = applyAnimationDocumentCommand(current, command);
    set({
      document: applied.document,
      saveStatus: "saving",
      error: null,
      undoStack: [...state.undoStack, applied.inverse],
      redoStack: state.redoStack.slice(0, -1),
    });
    rememberDraft(persistence, get());
    enqueueSave(persistence, invokeCommand, get, set, applied.document, current.revision);
  },

  retrySave: () => {
    const state = get();
    const current = state.document;
    if (!current || !canEditProject(current.projectId)) return;
    const expectedRevision = state.persistedRevision;
    const rebased = {
      ...current,
      revision: expectedRevision === null ? 0 : expectedRevision + 1,
    };
    persistence.blockedSaveProjects.delete(current.projectId);
    set({
      document: rebased,
      saveStatus: "saving",
      error: null,
    });
    rememberDraft(persistence, get());
    enqueueSave(persistence, invokeCommand, get, set, rebased, expectedRevision);
  },
  flushCurrentProject: async () => {
    const projectId = get().document?.projectId;
    if (!projectId) return true;
    await waitForProjectQueue(persistence, projectId);
    if (persistence.blockedSaveProjects.has(projectId)) return false;
    const state = get();
    if (state.document?.projectId !== projectId) return true;
    return (
      state.saveStatus !== "error" &&
      state.persistedRevision === state.document.revision
    );
  },
  }));
}

export const useAnimationDocumentStore = createAnimationDocumentStore(
  (command, args) => invoke(command, args),
  (projectId) => projectSessionController.isReadyFor(projectId),
);
