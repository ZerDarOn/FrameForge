export interface BaselinePoint {
  id: string;
  name: string;
  type: "point" | "line" | "region";
  coordinates: number[];
  frameIndex: number;
}

export interface Project {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  canvasWidth: number;
  canvasHeight: number;
  /**
   * 帧率仅作为播放速度标记和导入时的智能建议。
   * 不限制实际帧数——帧数完全由用户管理。
   */
  fps: number;
  baselinePoints: BaselinePoint[];
}
