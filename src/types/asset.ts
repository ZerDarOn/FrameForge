export type AssetSourceType = "image" | "video";

/**
 * 帧是用户管理的基本单位。
 * 每一帧独立存在，用户可以自由增删改查、拖拽排序。
 * startFrame 是该帧在时间线上的位置索引（从0开始）。
 */
export interface Asset {
  id: string;
  trackId: string;
  name: string;
  sourceType: AssetSourceType;
  sourcePath: string;
  thumbnailPath: string;
  /** 帧在时间线上的位置索引 */
  startFrame: number;
  /** 帧持续时间（1 = 单帧，>1 = 持续多帧） */
  durationFrames: number;
  width: number;
  height: number;
  transformX: number;
  transformY: number;
  transformScaleX: number;
  transformScaleY: number;
  transformRotation: number;
  alignmentDx: number;
  alignmentDy: number;
  /**
   * 是否匹配项目建议帧率。
   * 导入视频时按 FPS 抽帧，落在帧率间隔上的帧为 true（高亮），
   * 其余帧为 false（灰色但可见），用户可自行选择。
   */
  matchedFps: boolean;
  /** 原始时间戳（毫秒），用于视频帧定位 */
  sourceTimestamp?: number;
}
