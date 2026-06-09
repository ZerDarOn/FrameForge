import type { Asset } from "./asset";

export type TrackType = "image_sequence" | "video_clip" | "audio";

export interface Track {
  id: string;
  projectId: string;
  name: string;
  trackType: TrackType;
  visible: boolean;
  locked: boolean;
  opacity: number;
  trackOrder: number;
  assets: Asset[];
}

export interface PlaybackState {
  currentFrame: number;
  totalFrames: number;
  isPlaying: boolean;
  fps: number;
  loop: boolean;
}

export interface TimelineViewport {
  scrollX: number;
  scrollY: number;
  zoom: number;
  frameWidth: number;
  frameHeight: number;
}
