import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type { GeneratedAsset, GenerationJob, GenerationProgress, TextToPixelParams } from "../types/generation";

export interface GenerationState {
  assets: GeneratedAsset[];
  assetsProjectId: string | null;
  activeJob: GenerationJob | null;
  error: string | null;

  loadAssets: (projectId: string) => Promise<void>;
  generate: (projectId: string, params: TextToPixelParams) => Promise<void>;
  cancelActiveJob: () => Promise<void>;
  retryActiveJob: () => Promise<void>;
  handleProgress: (progress: GenerationProgress) => void;
  deleteAsset: (assetId: string, projectId: string) => Promise<void>;
  addToTimeline: (assetId: string, trackId: string | null, projectId: string) => Promise<string>;
}

export type GenerationInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

export interface GenerationRetryStorage {
  load: (projectId: string) => GenerationJob | null;
  save: (job: GenerationJob) => void;
  clear: (projectId: string) => void;
}

const GENERATION_RETRY_STORAGE_PREFIX = "frameforge:generation-retry:v1:";

function cloneParams(params: TextToPixelParams): TextToPixelParams {
  return params.palette ? { ...params, palette: [...params.palette] } : { ...params };
}

function describeError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function normalizeRetryableJob(value: unknown, projectId: string): GenerationJob | null {
  if (!value || typeof value !== "object") return null;
  const job = value as Partial<GenerationJob>;
  if (
    typeof job.id !== "string" ||
    job.projectId !== projectId ||
    (job.status !== "failed" && job.status !== "cancelled") ||
    (job.error !== null && typeof job.error !== "string") ||
    !job.params ||
    typeof job.params !== "object"
  ) {
    return null;
  }
  const params = job.params as Partial<TextToPixelParams>;
  if (
    typeof params.prompt !== "string" ||
    typeof params.style !== "string" ||
    !Number.isInteger(params.width) ||
    !Number.isInteger(params.height) ||
    !Number.isInteger(params.numVariants) ||
    (params.negativePrompt !== undefined && typeof params.negativePrompt !== "string") ||
    (params.provider !== undefined && typeof params.provider !== "string") ||
    (params.seed !== undefined && !Number.isInteger(params.seed)) ||
    (params.palette !== undefined &&
      (!Array.isArray(params.palette) || params.palette.some((color) => typeof color !== "string")))
  ) {
    return null;
  }
  return {
    id: job.id,
    projectId,
    params: cloneParams(params as TextToPixelParams),
    status: job.status,
    progress: null,
    error: job.error ?? null,
  };
}

function createBrowserGenerationRetryStorage(): GenerationRetryStorage {
  const key = (projectId: string) => `${GENERATION_RETRY_STORAGE_PREFIX}${projectId}`;
  return {
    load: (projectId) => {
      if (typeof localStorage === "undefined") return null;
      const raw = localStorage.getItem(key(projectId));
      return raw ? normalizeRetryableJob(JSON.parse(raw), projectId) : null;
    },
    save: (job) => {
      if (typeof localStorage === "undefined") return;
      localStorage.setItem(
        key(job.projectId),
        JSON.stringify({ ...job, params: cloneParams(job.params), progress: null }),
      );
    },
    clear: (projectId) => {
      if (typeof localStorage === "undefined") return;
      localStorage.removeItem(key(projectId));
    },
  };
}

export function createGenerationStore(
  invokeCommand: GenerationInvoke = invoke,
  createJobId: () => string = () => crypto.randomUUID(),
  retryStorage: GenerationRetryStorage = createBrowserGenerationRetryStorage(),
) {
  let loadSequence = 0;
  const loadRetryableJob = (projectId: string) => {
    try {
      return normalizeRetryableJob(retryStorage.load(projectId), projectId);
    } catch (storageError) {
      console.warn("[FrameForge] generation retry snapshot load failed", {
        projectId,
        error: describeError(storageError),
      });
      return null;
    }
  };
  const saveRetryableJob = (job: GenerationJob) => {
    try {
      retryStorage.save({ ...job, params: cloneParams(job.params), progress: null });
    } catch (storageError) {
      console.warn("[FrameForge] generation retry snapshot save failed", {
        jobId: job.id,
        projectId: job.projectId,
        error: describeError(storageError),
      });
    }
  };
  const clearRetryableJob = (projectId: string) => {
    try {
      retryStorage.clear(projectId);
    } catch (storageError) {
      console.warn("[FrameForge] generation retry snapshot clear failed", {
        projectId,
        error: describeError(storageError),
      });
    }
  };
  return create<GenerationState>((set, get) => ({
    assets: [],
    assetsProjectId: null,
    activeJob: null,
    error: null,

    loadAssets: async (projectId) => {
      const requestSequence = ++loadSequence;
      const currentJob = get().activeJob;
      const restoredJob = currentJob?.projectId === projectId
        ? currentJob
        : loadRetryableJob(projectId);
      if (restoredJob && restoredJob !== currentJob) {
        console.info("[FrameForge] generation retry snapshot restored", {
          jobId: restoredJob.id,
          projectId,
          status: restoredJob.status,
        });
      }
      set({
        assets: [],
        assetsProjectId: projectId,
        activeJob: restoredJob,
        error: restoredJob?.status === "failed" ? restoredJob.error : null,
      });
      try {
        const assets = await invokeCommand<GeneratedAsset[]>("list_generated_assets", { projectId });
        if (requestSequence !== loadSequence || get().assetsProjectId !== projectId) {
          console.info("[FrameForge] stale generated asset load ignored", { projectId });
          return;
        }
        set({ assets: assets.filter((asset) => asset.projectId === projectId) });
      } catch (loadError) {
        if (requestSequence !== loadSequence || get().assetsProjectId !== projectId) return;
        const message = describeError(loadError);
        console.error("[FrameForge] generated asset load failed", { projectId, error: message });
        set({ error: message });
      }
    },

    generate: async (projectId, sourceParams) => {
      const currentJob = get().activeJob;
      if (currentJob && (currentJob.status === "running" || currentJob.status === "cancelling")) return;
      const jobId = createJobId();
      const params = cloneParams(sourceParams);
      const job: GenerationJob = { id: jobId, projectId, params, status: "running", progress: null, error: null };
      clearRetryableJob(projectId);
      console.info("[FrameForge] generation job started", {
        jobId, projectId, provider: params.provider ?? "default", variants: params.numVariants,
      });
      set((state) => ({
        assets: state.assetsProjectId === projectId ? state.assets : [],
        assetsProjectId: projectId,
        activeJob: job,
        error: null,
      }));
      try {
        const newAssets = await invokeCommand<GeneratedAsset[]>("generate_pixel_art", { jobId, projectId, params });
        const activeJob = get().activeJob;
        if (activeJob?.id !== jobId || activeJob.projectId !== projectId) {
          console.info("[FrameForge] stale generation result ignored", { jobId, projectId });
          return;
        }
        if (activeJob.status !== "running") {
          console.info("[FrameForge] generation result ignored after cancellation", {
            jobId,
            projectId,
            status: activeJob.status,
          });
          if (activeJob.status === "cancelling") {
            const cancelledJob: GenerationJob = {
              ...activeJob,
              status: "cancelled",
              error: null,
            };
            saveRetryableJob(cancelledJob);
            set({ activeJob: cancelledJob, error: null });
          }
          return;
        }
        const acceptedAssets = newAssets.filter((asset) => asset.projectId === projectId);
        console.info("[FrameForge] generation job completed", {
          jobId, projectId, candidateCount: acceptedAssets.length,
        });
        clearRetryableJob(projectId);
        set((state) => ({
          assets: [...acceptedAssets, ...state.assets],
          activeJob: { ...activeJob, status: "completed", error: null },
          error: null,
        }));
      } catch (generationError) {
        const activeJob = get().activeJob;
        if (activeJob?.id !== jobId || activeJob.projectId !== projectId) return;
        const message = describeError(generationError);
        const cancelled = activeJob.status === "cancelling" || message.includes("GENERATION_CANCELLED");
        console.info("[FrameForge] generation job ended", {
          jobId, projectId, outcome: cancelled ? "cancelled" : "failed",
        });
        const terminalJob: GenerationJob = {
          ...activeJob,
          status: cancelled ? "cancelled" : "failed",
          error: cancelled ? null : message,
        };
        saveRetryableJob(terminalJob);
        set({
          activeJob: terminalJob,
          error: cancelled ? null : message,
        });
      }
    },

    cancelActiveJob: async () => {
      const job = get().activeJob;
      if (!job || job.status !== "running") return;
      set({ activeJob: { ...job, status: "cancelling" } });
      console.info("[FrameForge] generation cancellation requested", { jobId: job.id, projectId: job.projectId });
      try {
        const accepted = await invokeCommand<boolean>("cancel_generation", { jobId: job.id, projectId: job.projectId });
        const activeJob = get().activeJob;
        if (!accepted && activeJob?.id === job.id && activeJob.status === "cancelling") {
          set({ activeJob: { ...activeJob, status: "running" }, error: "生成任务已结束，取消未生效" });
        }
      } catch (cancelError) {
        const activeJob = get().activeJob;
        if (activeJob?.id !== job.id || activeJob.status !== "cancelling") return;
        const message = describeError(cancelError);
        console.error("[FrameForge] generation cancellation failed", {
          jobId: job.id, projectId: job.projectId, error: message,
        });
        set({ activeJob: { ...activeJob, status: "running" }, error: `取消失败：${message}` });
      }
    },

    retryActiveJob: async () => {
      const job = get().activeJob;
      if (!job || (job.status !== "failed" && job.status !== "cancelled")) return;
      console.info("[FrameForge] generation retry requested", { previousJobId: job.id, projectId: job.projectId });
      await get().generate(job.projectId, cloneParams(job.params));
    },

    handleProgress: (progress) => {
      const job = get().activeJob;
      if (!job || job.id !== progress.jobId || job.projectId !== progress.projectId) {
        console.info("[FrameForge] stale generation progress ignored", { jobId: progress.jobId, projectId: progress.projectId });
        return;
      }
      if (job.status !== "running" && job.status !== "cancelling") return;
      const updatedJob: GenerationJob = {
        ...job,
        progress,
        status: progress.stage === "cancelled" ? "cancelled" : job.status,
      };
      if (updatedJob.status === "cancelled") saveRetryableJob(updatedJob);
      set({ activeJob: updatedJob });
    },

    deleteAsset: async (assetId, projectId) => {
      try {
        await invokeCommand("delete_generated_asset", { assetId, projectId });
        if (get().assetsProjectId !== projectId) return;
        set((state) => ({ assets: state.assets.filter((asset) => asset.id !== assetId) }));
      } catch (deleteError) {
        const message = describeError(deleteError);
        console.error("[FrameForge] generated asset delete failed", { assetId, projectId, error: message });
        set({ error: message });
      }
    },

    addToTimeline: async (assetId, trackId, projectId) =>
      invokeCommand<string>("add_generated_to_timeline", { assetId, trackId, projectId }),
  }));
}

export const useGenerationStore = createGenerationStore();
