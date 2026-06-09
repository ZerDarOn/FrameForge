export type BaselineType = "point" | "line" | "region";

export interface BaselinePoint {
  id: string;
  name: string;
  type: BaselineType;
  /** point: [x, y]; line: [x1, y1, x2, y2]; region: [x1, y1, x2, y2] */
  coordinates: number[];
  /** 标记所在帧索引 */
  frameIndex: number;
  /** 在视口中的像素颜色标记 */
  color: string;
}
