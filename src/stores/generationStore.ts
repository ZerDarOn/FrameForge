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

function cloneParams(params: TextToPixelParams): TextToPixelParams {
  return params.palette ? { ...params, palette: [...params.palette] } : { ...params };
}

function describeError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function createGenerationStore(
  invokeCommand: GenerationInvoke = invoke,
  createJobId: () => string = () => crypto.randomUUID(),
) {
  let loadSequence = 0;
  return create<GenerationState>((set, get) => ({
    assets: [],
    assetsProjectId: null,
    activeJob: null,
    error: null,

    loadAssets: async (projectId) => {
      const requestSequence = ++loadSequence;
      set((state) => ({
        assets: [],
        assetsProjectId: projectId,
        activeJob: state.activeJob?.projectId === projectId ? state.activeJob : null,
        error: null,
      }));
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
        const acceptedAssets = newAssets.filter((asset) => asset.projectId === projectId);
        console.info("[FrameForge] generation job completed", {
          jobId, projectId, candidateCount: acceptedAssets.length,
        });
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
        set({
          activeJob: { ...activeJob, status: cancelled ? "cancelled" : "failed", error: cancelled ? null : message },
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
      set({ activeJob: {
        ...job,
        progress,
        status: progress.stage === "cancelled" ? "cancelled" : job.status,
      } });
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
