import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useRef } from "react";
import { decideCloseAction } from "../core/unsavedClose";
import { useAnimationDocumentStore } from "../stores/animationDocumentStore";

function currentCloseDecision() {
  const state = useAnimationDocumentStore.getState();
  return decideCloseAction({
    hasDocument: state.document !== null,
    saveStatus: state.saveStatus,
    documentRevision: state.document?.revision ?? null,
    persistedRevision: state.persistedRevision,
  });
}

export function useUnsavedChangesGuard() {
  const allowCloseRef = useRef(false);

  useEffect(() => {
    let disposed = false;
    let unlistenPromise: Promise<(() => void) | null> = Promise.resolve(null);
    try {
      const appWindow = getCurrentWindow();
      unlistenPromise = appWindow.onCloseRequested(async (event) => {
        if (allowCloseRef.current) return;
        const decision = currentCloseDecision();
        if (decision === "allow") return;
        event.preventDefault();

        if (decision === "wait") {
          const saved = await useAnimationDocumentStore.getState().flushCurrentProject();
          if (saved && !disposed) {
            allowCloseRef.current = true;
            await appWindow.close();
            return;
          }
        }

        if (!disposed && window.confirm("当前动画仍有未保存的修改。确定放弃这些修改并关闭吗？")) {
          allowCloseRef.current = true;
          await appWindow.close();
        }
      }).catch((error) => {
        console.info("[FrameForge] native close guard unavailable", {
          error: error instanceof Error ? error.message : String(error),
        });
        return null;
      });
    } catch (error) {
      console.info("[FrameForge] native close guard unavailable", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (allowCloseRef.current || currentCloseDecision() === "allow") return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      disposed = true;
      window.removeEventListener("beforeunload", handleBeforeUnload);
      void unlistenPromise.then((unlisten) => unlisten?.());
    };
  }, []);
}
