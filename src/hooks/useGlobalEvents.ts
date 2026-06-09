import { useEffect } from "react";

/**
 * 全局事件处理：点击空白处关闭右键菜单等
 */
export function useGlobalEvents() {
  useEffect(() => {
    const handleClick = () => {
      window.dispatchEvent(new CustomEvent("frameforge:close-context-menu"));
    };
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, []);
}
