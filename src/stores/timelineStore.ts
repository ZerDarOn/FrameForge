import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type { Track, TimelineViewport } from "../types/timeline";
import type { Asset } from "../types/asset";

// 撤销/重做栈（内联实现，避免循环依赖）
const undoStack: string[] = [];
const redoStack: string[] = [];
const MAX_HISTORY = 50;

function pushHistory(tracks: Track[], currentFrame: number) {
  undoStack.push(JSON.stringify({ tracks, currentFrame }));
  if (undoStack.length > MAX_HISTORY) undoStack.shift();
  redoStack.length = 0;
}

export function undo() {
  if (undoStack.length === 0) return;
  const state = useTimelineStore.getState();
  redoStack.push(JSON.stringify({ tracks: state.tracks, currentFrame: state.currentFrame }));
  const prev = JSON.parse(undoStack.pop()!);
  state.setTracks(prev.tracks);
  state.setCurrentFrame(prev.currentFrame);
}

export function redo() {
  if (redoStack.length === 0) return;
  const state = useTimelineStore.getState();
  undoStack.push(JSON.stringify({ tracks: state.tracks, currentFrame: state.currentFrame }));
  const next = JSON.parse(redoStack.pop()!);
  state.setTracks(next.tracks);
  state.setCurrentFrame(next.currentFrame);
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

  setTracks: (tracks: Track[]) => void;
  addTrack: (track: Track) => void;
  removeTrack: (id: string) => void;
  updateTrack: (id: string, partial: Partial<Track>) => void;
  addAssetToTrack: (trackId: string, asset: Asset) => void;
  removeAssetFromTrack: (trackId: string, assetId: string) => void;
  updateAsset: (trackId: string, assetId: string, partial: Partial<Asset>) => void;
  deleteAsset: (trackId: string, assetId: string) => void;
  duplicateAsset: (trackId: string, assetId: string) => void;
  insertBlankFrame: (trackId: string, position: number) => void;
  setCurrentFrame: (frame: number) => void;
  togglePlay: () => void;
  setPlaying: (playing: boolean) => void;
  setFps: (fps: number) => void;
  recalcTotalFrames: () => void;
  setViewport: (partial: Partial<TimelineViewport>) => void;
  setSelectedTrack: (id: string | null) => void;
  setSelectedAsset: (id: string | null) => void;
}

export const useTimelineStore = create<TimelineState>((set, get) => ({
  tracks: [],
  currentFrame: 0,
  totalFrames: 0,
  isPlaying: false,
  fps: 24,
  viewport: { scrollX: 0, scrollY: 0, zoom: 1, frameWidth: 60, frameHeight: 40 },
  selectedTrackId: null,
  selectedAssetId: null,

  setTracks: (tracks) => {
    set({ tracks });
    get().recalcTotalFrames();
  },
  addTrack: (track) => {
    set((s) => ({ tracks: [...s.tracks, track] }));
    get().recalcTotalFrames();
  },
  removeTrack: (id) => {
    set((s) => ({ tracks: s.tracks.filter((t) => t.id !== id) }));
    get().recalcTotalFrames();
    invoke("delete_track", { trackId: id }).catch(console.error);
  },
  updateTrack: (id, partial) =>
    set((s) => ({
      tracks: s.tracks.map((t) => (t.id === id ? { ...t, ...partial } : t)),
    })),
  addAssetToTrack: (trackId, asset) => {
    set((s) => ({
      tracks: s.tracks.map((t) =>
        t.id === trackId ? { ...t, assets: [...t.assets, asset] } : t
      ),
    }));
    get().recalcTotalFrames();
  },
  removeAssetFromTrack: (trackId, assetId) => {
    set((s) => ({
      tracks: s.tracks.map((t) =>
        t.id === trackId
          ? { ...t, assets: t.assets.filter((a) => a.id !== assetId) }
          : t
      ),
    }));
    get().recalcTotalFrames();
  },
  updateAsset: (trackId, assetId, partial) =>
    set((s) => ({
      tracks: s.tracks.map((t) =>
        t.id === trackId
          ? { ...t, assets: t.assets.map((a) => a.id === assetId ? { ...a, ...partial } : a) }
          : t
      ),
    })),

  deleteAsset: (trackId, assetId) => {
    const state = get();
    pushHistory(state.tracks, state.currentFrame);
    set((s) => ({
      tracks: s.tracks.map((t) =>
        t.id === trackId
          ? { ...t, assets: t.assets.filter((a) => a.id !== assetId).map((a, i) => ({ ...a, startFrame: i })) }
          : t
      ),
    }));
    get().recalcTotalFrames();
    invoke("delete_asset", { assetId }).catch(console.error);
  },

  duplicateAsset: (trackId, assetId) => {
    const state = get();
    pushHistory(state.tracks, state.currentFrame);
    const track = state.tracks.find((t) => t.id === trackId);
    if (!track) return;
    const asset = track.assets.find((a) => a.id === assetId);
    if (!asset) return;
    const newAsset: Asset = {
      ...asset,
      id: crypto.randomUUID(),
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
  },

  insertBlankFrame: (trackId, position) => {
    set((s) => ({
      tracks: s.tracks.map((t) =>
        t.id === trackId
          ? { ...t, assets: t.assets.map((a) => a.startFrame >= position ? { ...a, startFrame: a.startFrame + 1 } : a) }
          : t
      ),
    }));
    get().recalcTotalFrames();
  },

  setCurrentFrame: (frame) => set({ currentFrame: frame }),
  togglePlay: () => set((s) => ({ isPlaying: !s.isPlaying })),
  setPlaying: (playing) => set({ isPlaying: playing }),
  setFps: (fps) => set({ fps }),
  recalcTotalFrames: () => {
    const tracks = get().tracks;
    let maxFrame = 0;
    for (const track of tracks) {
      if (track.assets.length > maxFrame) maxFrame = track.assets.length;
    }
    set({ totalFrames: maxFrame });
  },
  setViewport: (partial) => set((s) => ({ viewport: { ...s.viewport, ...partial } })),
  setSelectedTrack: (id) => set({ selectedTrackId: id }),
  setSelectedAsset: (id) => set({ selectedAssetId: id }),
}));
