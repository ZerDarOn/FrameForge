import { useCallback } from "react";

/**
 * 创建面板拖拽调整大小的鼠标事件处理器
 *
 * @param direction    "horizontal"（宽度，跟 clientX）| "vertical"（高度，跟 clientY 反向）
 * @param min          最小尺寸（px）
 * @param max          最大尺寸（px）
 * @param currentValue 当前尺寸值（通过闭包捕获）
 * @param setter       store setter 函数
 */
export function useResizeHandle(
  direction: "horizontal" | "vertical",
  min: number,
  max: number,
  currentValue: number,
  setter: (value: number) => void,
  inverted = false,
) {
  return useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const isHorizontal = direction === "horizontal";
      const startCoord = isHorizontal ? e.clientX : e.clientY;

      const onMove = (ev: MouseEvent) => {
        let delta = isHorizontal
          ? ev.clientX - startCoord
          : startCoord - ev.clientY;
        if (inverted) delta = -delta;
        setter(Math.max(min, Math.min(max, currentValue + delta)));
      };

      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [direction, min, max, setter, currentValue, inverted],
  );
}
