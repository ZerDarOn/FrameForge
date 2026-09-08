import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type { Track, TimelineViewport } from "../types/timeline";
import type { Asset } from "../types/asset";
import {
  createBottomAlignedCelTransforms,
  duplicateCelWithStep,
  getAnimationDurationTicks,
  insertAnimationStep,
  resolveAnimationStep,
} from "../core/animationDocument";
import { useAnimationDocumentStore } from "./animationDocumentStore";
import { useProjectStore } from "./projectStore";
import { projectSessionController } from "../core/projectSession";
import { selectTimelineAsset } from "../core/timelineSelection";

const MAX_HISTORY = 50;

interface HistorySnapshot {
  tracks: Track[];
  currentFrame: number;
  isPlaying: boolean;
  selectedTrackId: string | null;
  selectedAssetId: string | null;
  selectedAssetIds: string[];
}

function restoreSnapshot(set: any, snap: HistorySnapshot) {
  set({
    tracks: snap.tracks,
    currentFrame: snap.currentFrame,
    isPlaying: snap.isPlaying,
    selectedTrackId: snap.selectedTrackId,
    selectedAssetId: snap.selectedAssetId,
    selectedAssetIds: snap.selectedAssetIds,
  });
}

interface TimelineState {
  tracks: Track[];
  currentFrame: number;
  totalFrames: number;
  isPlaying: boolean;
  fps: number;
  viewport: TimelineViewport;
  selectedTrackId: string | null;
  selectedAssetId: string | null;
  selectedAssetIds: string[];
  undoStack: HistorySnapshot[];
  redoStack: HistorySnapshot[];

  setTracks: (tracks: Track[]) => void;
  addTrack: (track: Track) => void;
  removeTrack: (id: string) => void;
  updateTrack: (id: string, partial: Partial<Track>) => void;
  addAssetToTrack: (trackId: string, asset: Asset) => void;
  removeAssetFromTrack: (trackId: string, assetId: string) => void;
  updateAsset: (trackId: string, assetId: string, partial: Partial<Asset>) => void;
  previewAssetUpdate: (trackId: string, assetId: string, partial: Partial<Asset>) => void;
  deleteAsset: (trackId: string, assetId: string) => void;
  duplicateAsset: (trackId: string, assetId: string) => void;
  insertBlankFrame: (trackId: string, position: number) => void;
  moveAssetToPosition: (trackId: string, assetId: string, newPosition: number) => void;
  extractAssetToNewTrack: (trackId: string, assetId: string) => Promise<void>;
  setCurrentFrame: (frame: number) => void;
  togglePlay: () => void;
  setPlaying: (playing: boolean) => void;
  setFps: (fps: number) => void;
  recalcTotalFrames: () => void;
  setViewport: (partial: Partial<TimelineViewport>) => void;
  setSelectedTrack: (id: string | null) => void;
  setSelectedAsset: (id: string | null, additive?: boolean) => void;
  nudgeSelectedAssets: (deltaX: number, deltaY: number) => void;
  alignSelectedAssetsBottom: () => void;
  undo: () => void;
  redo: () => void;
  resetHistory: () => void;
}

export const useTimelineStore = create<TimelineState>((set, get) => {
  function canEditCurrentProject() {
    const project = useProjectStore.getState().project;
    const document = useAnimationDocumentStore.getState().document;
    return Boolean(
      project &&
        document?.projectId === project.id &&
        projectSessionController.isReadyFor(project.id),
    );
  }

  function replaceDocumentFromCurrentTracks() {
    const project = useProjectStore.getState().project;
    const documentState = useAnimationDocumentStore.getState();
    if (!project || !documentState.document) return;
    documentState.replaceFromLegacy(project, get().tracks);
  }

  function pushHistory() {
    const s = get();
    const snap: HistorySnapshot = {
      tracks: structuredClone(s.tracks),
      currentFrame: s.currentFrame,
      isPlaying: s.isPlaying,
      selectedTrackId: s.selectedTrackId,
      selectedAssetId: s.selectedAssetId,
      selectedAssetIds: s.selectedAssetIds,
    };
    set((prev) => {
      const next = [...prev.undoStack, snap];
      if (next.length > MAX_HISTORY) next.shift();
      return { undoStack: next, redoStack: [] };
    });
  }

  function undo() {
    if (!canEditCurrentProject()) return;
    if (useAnimationDocumentStore.getState().document) {
      useAnimationDocumentStore.getState().undo();
      return;
    }
    const s = get();
    if (s.undoStack.length === 0) return;
    const prev = s.undoStack[s.undoStack.length - 1];
    const currentSnap = {
      tracks: structuredClone(s.tracks),
      currentFrame: s.currentFrame,
      isPlaying: s.isPlaying,
      selectedTrackId: s.selectedTrackId,
      selectedAssetId: s.selectedAssetId,
      selectedAssetIds: s.selectedAssetIds,
    };
    set({
      undoStack: s.undoStack.slice(0, -1),
      redoStack: [...s.redoStack, currentSnap],
    });
    restoreSnapshot(set, prev);
    get().recalcTotalFrames();
  }

  function redo() {
    if (!canEditCurrentProject()) return;
    if (useAnimationDocumentStore.getState().document) {
      useAnimationDocumentStore.getState().redo();
      return;
    }
    const s = get();
    if (s.redoStack.length === 0) return;
    const next = s.redoStack[s.redoStack.length - 1];
    const currentSnap = {
      tracks: structuredClone(s.tracks),
      currentFrame: s.currentFrame,
      isPlaying: s.isPlaying,
      selectedTrackId: s.selectedTrackId,
      selectedAssetId: s.selectedAssetId,
      selectedAssetIds: s.selectedAssetIds,
    };
    set({
      redoStack: s.redoStack.slice(0, -1),
      undoStack: [...s.undoStack, currentSnap],
    });
    restoreSnapshot(set, next);
    get().recalcTotalFrames();
  }

  return {
    tracks: [],
    currentFrame: 0,
    totalFrames: 0,
    isPlaying: false,
    fps: 24,
    viewport: { scrollX: 0, scrollY: 0, zoom: 1, frameWidth: 60, frameHeight: 40 },
    selectedTrackId: null,
    selectedAssetId: null,
    selectedAssetIds: [],
    undoStack: [],
    redoStack: [],

    undo,
    redo,
    resetHistory: () => set({ undoStack: [], redoStack: [] }),

    setTracks: (tracks) => {
      const validIds = new Set(tracks.flatMap((track) => track.assets.map((asset) => asset.id)));
      set((state) => {
        const selectedAssetIds = state.selectedAssetIds.filter((id) => validIds.has(id));
        return {
          tracks,
          selectedAssetIds,
          selectedAssetId:
            state.selectedAssetId && validIds.has(state.selectedAssetId)
              ? state.selectedAssetId
              : selectedAssetIds[selectedAssetIds.length - 1] ?? null,
        };
      });
      get().recalcTotalFrames();
    },
    addTrack: (track) => {
      if (!canEditCurrentProject()) return;
      set((s) => ({ tracks: [...s.tracks, track] }));
      get().recalcTotalFrames();
    },
    removeTrack: (id) => {
      if (!canEditCurrentProject()) return;
      pushHistory();
      set((state) => {
        const removedIds = new Set(
          state.tracks.find((track) => track.id === id)?.assets.map((asset) => asset.id) ?? [],
        );
        const selectedAssetIds = state.selectedAssetIds.filter(
          (assetId) => !removedIds.has(assetId),
        );
        return {
          tracks: state.tracks.filter((track) => track.id !== id),
          selectedAssetIds,
          selectedAssetId:
            state.selectedAssetId && !removedIds.has(state.selectedAssetId)
              ? state.selectedAssetId
              : selectedAssetIds[selectedAssetIds.length - 1] ?? null,
        };
      });
      get().recalcTotalFrames();
      invoke("delete_track", { trackId: id }).catch(console.error);
      replaceDocumentFromCurrentTracks();
    },
    updateTrack: (id, partial) => {
      if (!canEditCurrentProject()) return;
      const documentState = useAnimationDocumentStore.getState();
      const document = documentState.document;
      const animation = document?.animations[0];
      const layer = animation?.layers.find((candidate) => candidate.id === id);
      if (animation && layer) {
        documentState.execute({
          type: "update_layer",
          animationId: animation.id,
          layerId: layer.id,
          name: partial.name ?? layer.name,
          visible: partial.visible ?? layer.visible,
          locked: partial.locked ?? layer.locked,
          opacity: partial.opacity ?? layer.opacity,
        });
        return;
      }
      set((s) => ({
        tracks: s.tracks.map((t) => (t.id === id ? { ...t, ...partial } : t)),
      }));
    },
    addAssetToTrack: (trackId, asset) => {
      if (!canEditCurrentProject()) return;
      pushHistory();
      set((s) => ({
        tracks: s.tracks.map((t) =>
          t.id === trackId ? { ...t, assets: [...t.assets, asset] } : t
        ),
      }));
      get().recalcTotalFrames();
    },
    removeAssetFromTrack: (trackId, assetId) => {
      if (!canEditCurrentProject()) return;
      pushHistory();
      set((state) => {
        const selectedAssetIds = state.selectedAssetIds.filter((id) => id !== assetId);
        return {
          tracks: state.tracks.map((t) =>
            t.id === trackId
              ? { ...t, assets: t.assets.filter((a) => a.id !== assetId) }
              : t
          ),
          selectedAssetIds,
          selectedAssetId:
            state.selectedAssetId === assetId
              ? selectedAssetIds[selectedAssetIds.length - 1] ?? null
              : state.selectedAssetId,
        };
      });
      get().recalcTotalFrames();
      replaceDocumentFromCurrentTracks();
    },
    updateAsset: (trackId, assetId, partial) => {
      if (!canEditCurrentProject()) return;
      const documentState = useAnimationDocumentStore.getState();
      const document = documentState.document;
      const animation = document?.animations[0];
      const cel = animation?.cels.find((candidate) => candidate.id === assetId);
      const currentAsset = get().tracks
        .find((track) => track.id === trackId)
        ?.assets.find((asset) => asset.id === assetId);
      if (animation && cel && currentAsset) {
        if (partial.durationFrames !== undefined) {
          documentState.execute({
            type: "set_step_duration",
            animationId: animation.id,
            stepId: cel.stepId,
            durationTicks: partial.durationFrames,
          });
        }
        const changesTransform = [
          "transformX",
          "transformY",
          "transformScaleX",
          "transformScaleY",
          "transformRotation",
          "alignmentDx",
          "alignmentDy",
        ].some((field) => field in partial);
        if (changesTransform) {
          documentState.execute({
            type: "set_cel_transform",
            animationId: animation.id,
            celId: cel.id,
            transform: {
              x: (partial.transformX ?? currentAsset.transformX) +
                (partial.alignmentDx ?? currentAsset.alignmentDx),
              y: (partial.transformY ?? currentAsset.transformY) +
                (partial.alignmentDy ?? currentAsset.alignmentDy),
              scaleX: partial.transformScaleX ?? currentAsset.transformScaleX,
              scaleY: partial.transformScaleY ?? currentAsset.transformScaleY,
              rotationDegrees: partial.transformRotation ?? currentAsset.transformRotation,
            },
          });
        }
        return;
      }
      set((s) => ({
        tracks: s.tracks.map((t) =>
          t.id === trackId
            ? { ...t, assets: t.assets.map((a) => a.id === assetId ? { ...a, ...partial } : a) }
            : t
        ),
      }));
    },
    previewAssetUpdate: (trackId, assetId, partial) => {
      if (!canEditCurrentProject()) return;
      set((state) => ({
        tracks: state.tracks.map((track) =>
          track.id === trackId
            ? {
                ...track,
                assets: track.assets.map((asset) =>
                  asset.id === assetId ? { ...asset, ...partial } : asset,
                ),
              }
            : track,
        ),
      }));
    },

    deleteAsset: (trackId, assetId) => {
      if (!canEditCurrentProject()) return;
      const documentState = useAnimationDocumentStore.getState();
      const animation = documentState.document?.animations[0];
      const cel = animation?.cels.find((candidate) => candidate.id === assetId);
      if (animation && cel) {
        documentState.execute({
          type: "delete_cel",
          animationId: animation.id,
          celId: cel.id,
        });
        set({ selectedAssetId: null, selectedAssetIds: [] });
        return;
      }
      pushHistory();
      set((state) => {
        const selectedAssetIds = state.selectedAssetIds.filter((id) => id !== assetId);
        return {
          tracks: state.tracks.map((t) =>
            t.id === trackId
              ? {
                  ...t,
                  assets: t.assets
                    .filter((a) => a.id !== assetId)
                    .map((a, i) => ({ ...a, startFrame: i })),
                }
              : t
          ),
          selectedAssetIds,
          selectedAssetId:
            state.selectedAssetId === assetId
              ? selectedAssetIds[selectedAssetIds.length - 1] ?? null
              : state.selectedAssetId,
        };
      });
      get().recalcTotalFrames();
      invoke("delete_asset", { assetId }).catch(console.error);
    },

    duplicateAsset: (trackId, assetId) => {
      if (!canEditCurrentProject()) return;
      const documentState = useAnimationDocumentStore.getState();
      const document = documentState.document;
      const animation = document?.animations[0];
      const cel = animation?.cels.find((candidate) => candidate.id === assetId);
      if (document && animation && cel) {
        documentState.execute({
          type: "replace_document",
          document: duplicateCelWithStep(
            document,
            animation.id,
            cel.id,
            crypto.randomUUID(),
            crypto.randomUUID(),
          ),
        });
        return;
      }
      pushHistory();
      const track = get().tracks.find((t) => t.id === trackId);
      if (!track) return;
      const asset = track.assets.find((a) => a.id === assetId);
      if (!asset) return;
      const newAsset: Asset = {
        ...asset,
        id: crypto.randomUUID(),
        documentCelId: undefined,
        name: `${asset.name} (副本)`,
        startFrame: asset.startFrame + 1,
      };
      set((s) => ({
        tracks: s.tracks.map((t) =>
          t.id === trackId
            ? {
                ...t,
                assets: [
                  ...t.assets.map((a) => a.startFrame > asset.startFrame ? { ...a, startFrame: a.startFrame + 1 } : a),
                  newAsset,
                ].sort((a, b) => a.startFrame - b.startFrame),
              }
            : t
        ),
      }));
      get().recalcTotalFrames();
      replaceDocumentFromCurrentTracks();
    },

    insertBlankFrame: (trackId, position) => {
      if (!canEditCurrentProject()) return;
      const documentState = useAnimationDocumentStore.getState();
      const document = documentState.document;
      const animation = document?.animations[0];
      if (document && animation) {
        const duration = getAnimationDurationTicks(animation);
        const target =
          position >= duration
            ? null
            : resolveAnimationStep(animation, Math.max(0, position));
        documentState.execute({
          type: "replace_document",
          document: insertAnimationStep(
            document,
            animation.id,
            {
              id: crypto.randomUUID(),
              order: target?.step.order ?? animation.steps.length,
              durationTicks: 1,
            },
            target?.step.id ?? null,
          ),
        });
        return;
      }
      pushHistory();
      set((s) => ({
        tracks: s.tracks.map((t) =>
          t.id === trackId
            ? { ...t, assets: t.assets.map((a) => a.startFrame >= position ? { ...a, startFrame: a.startFrame + 1 } : a) }
            : t
        ),
      }));
      get().recalcTotalFrames();
      replaceDocumentFromCurrentTracks();
    },

    moveAssetToPosition: (trackId, assetId, newPosition) => {
      if (!canEditCurrentProject()) return;
      const documentState = useAnimationDocumentStore.getState();
      const animation = documentState.document?.animations[0];
      const cel = animation?.cels.find((candidate) => candidate.id === assetId);
      const duration = animation ? getAnimationDurationTicks(animation) : 0;
      const target = animation
        ? resolveAnimationStep(animation, Math.min(Math.max(0, newPosition), duration - 1))
        : null;
      if (animation && cel && target) {
        documentState.execute({
          type: "move_cel_to_step",
          animationId: animation.id,
          celId: cel.id,
          stepId: target.step.id,
        });
        return;
      }
      pushHistory();
      const state = get();
      const track = state.tracks.find((t) => t.id === trackId);
      if (!track) return;
      const assetIdx = track.assets.findIndex((a) => a.id === assetId);
      if (assetIdx === -1) return;
      const asset = track.assets[assetIdx];
      const oldPos = asset.startFrame;

      if (oldPos === newPosition) return;

      set((s) => ({
        tracks: s.tracks.map((t) => {
          if (t.id !== trackId) return t;
          // 1. 移除旧位置的 asset
          let assets = t.assets.filter((a) => a.id !== assetId);
          // 2. 补位：移除后 startFrame > oldPos 的帧左移
          assets = assets.map((a) => a.startFrame > oldPos ? { ...a, startFrame: a.startFrame - 1 } : a);
          // 3. newPosition 之后的帧右移（为插入腾出空间）
          assets = assets.map((a) => a.startFrame >= newPosition ? { ...a, startFrame: a.startFrame + 1 } : a);
          // 4. 插入 asset 到新位置
          assets.push({ ...asset, startFrame: newPosition });
          assets.sort((a, b) => a.startFrame - b.startFrame);
          return { ...t, assets };
        }),
      }));
      get().recalcTotalFrames();
      replaceDocumentFromCurrentTracks();
    },

    extractAssetToNewTrack: async (trackId, assetId) => {
      if (!canEditCurrentProject()) return;
      const state = get();
      const sourceTrack = state.tracks.find((t) => t.id === trackId);
      if (!sourceTrack) return;
      const asset = sourceTrack.assets.find((a) => a.id === assetId);
      if (!asset) return;

      if (useAnimationDocumentStore.getState().document) {
        const newTrack: Track = {
          id: crypto.randomUUID(),
          projectId: sourceTrack.projectId,
          name: `${asset.name}（提取）`,
          trackType: sourceTrack.trackType,
          visible: true,
          locked: false,
          opacity: 1,
          trackOrder: state.tracks.length,
          assets: [{ ...asset, trackId: "", startFrame: asset.startFrame }],
        };
        newTrack.assets[0].trackId = newTrack.id;
        pushHistory();
        set((current) => ({
          tracks: [
            ...current.tracks.map((track) =>
              track.id === trackId
                ? {
                    ...track,
                    assets: track.assets.filter((candidate) => candidate.id !== assetId),
                  }
                : track,
            ),
            newTrack,
          ],
        }));
        get().recalcTotalFrames();
        replaceDocumentFromCurrentTracks();
        return;
      }

      const newTrack = await invoke<Track>("extract_asset_to_new_track", {
        sourceTrackId: trackId,
        assetId,
        name: `${asset.name}（提取）`,
      });

      pushHistory();
      set((s) => ({
        tracks: [
          ...s.tracks.map((t) =>
            t.id === trackId
              ? { ...t, assets: t.assets.filter((a) => a.id !== assetId).map((a) => a.startFrame > asset.startFrame ? { ...a, startFrame: a.startFrame - 1 } : a) }
              : t
          ),
          newTrack,
        ],
      }));
      get().recalcTotalFrames();
      replaceDocumentFromCurrentTracks();
    },

    setCurrentFrame: (frame) => set({ currentFrame: frame }),
    togglePlay: () => set((s) => ({ isPlaying: !s.isPlaying })),
    setPlaying: (playing) => set({ isPlaying: playing }),
    setFps: (fps) => set({ fps }),
    recalcTotalFrames: () => {
      const tracks = get().tracks;
      let maxFrame = 0;
      for (const track of tracks) {
        for (const asset of track.assets) {
          const endFrame = asset.startFrame + (asset.durationFrames || 1);
          if (endFrame > maxFrame) maxFrame = endFrame;
        }
      }
      set({ totalFrames: Math.max(0, maxFrame) });
    },
    setViewport: (partial) => set((s) => ({ viewport: { ...s.viewport, ...partial } })),
    setSelectedTrack: (id) => set({ selectedTrackId: id }),
    setSelectedAsset: (id, additive = false) =>
      set((state) => {
        const selection = selectTimelineAsset(
          { primaryId: state.selectedAssetId, selectedIds: state.selectedAssetIds },
          id,
          additive,
        );
        return {
          selectedAssetId: selection.primaryId,
          selectedAssetIds: selection.selectedIds,
        };
      }),
    nudgeSelectedAssets: (deltaX, deltaY) => {
      if (!canEditCurrentProject() || (!deltaX && !deltaY)) return;
      const documentState = useAnimationDocumentStore.getState();
      const document = documentState.document;
      const animation = document?.animations[0];
      if (!document || !animation) return;
      const selected = new Set(get().selectedAssetIds);
      const cels = animation.cels.filter((cel) => selected.has(cel.id));
      if (cels.length === 0) return;
      if (cels.some((cel) => animation.layers.find((layer) => layer.id === cel.layerId)?.locked)) {
        console.info("[FrameForge] batch cel transform skipped", {
          projectId: document.projectId,
          operation: "nudge",
          assetCount: cels.length,
          reason: "locked-layer",
        });
        return;
      }
      console.info("[FrameForge] batch cel transform", {
        projectId: document.projectId,
        operation: "nudge",
        assetCount: cels.length,
      });
      documentState.execute({
        type: "set_cel_transforms",
        animationId: animation.id,
        entries: cels.map((cel) => ({
          celId: cel.id,
          transform: {
            ...cel.transform,
            x: cel.transform.x + deltaX,
            y: cel.transform.y + deltaY,
          },
        })),
      });
    },
    alignSelectedAssetsBottom: () => {
      if (!canEditCurrentProject()) return;
      const documentState = useAnimationDocumentStore.getState();
      const document = documentState.document;
      const animation = document?.animations[0];
      if (!document || !animation) return;
      const selected = new Set(get().selectedAssetIds);
      const cels = animation.cels.filter((cel) => selected.has(cel.id));
      if (cels.length < 2) return;
      if (cels.some((cel) => animation.layers.find((layer) => layer.id === cel.layerId)?.locked)) {
        console.info("[FrameForge] batch cel transform skipped", {
          projectId: document.projectId,
          operation: "align-bottom",
          assetCount: cels.length,
          reason: "locked-layer",
        });
        return;
      }
      const entries = createBottomAlignedCelTransforms(
        document,
        animation.id,
        cels.map((cel) => cel.id),
      );
      console.info("[FrameForge] batch cel transform", {
        projectId: document.projectId,
        operation: "align-bottom",
        assetCount: cels.length,
      });
      documentState.execute({
        type: "set_cel_transforms",
        animationId: animation.id,
        entries,
      });
    },
  };
});
