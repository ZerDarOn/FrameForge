import { useEffect } from "react";
import { animationDocumentToTimelineState } from "../core/animationDocument";
import { useAnimationDocumentStore } from "../stores/animationDocumentStore";
import { useProjectStore } from "../stores/projectStore";
import { useTimelineStore } from "../stores/timelineStore";

export function useAnimationDocumentTimelineSync() {
  useEffect(() => {
    return useAnimationDocumentStore.subscribe((state, previous) => {
      const document = state.document;
      if (!document || document === previous.document) return;
      if (useProjectStore.getState().project?.id !== document.projectId) return;
      const timeline = animationDocumentToTimelineState(document);
      useTimelineStore.getState().setTracks(timeline.tracks);
      useTimelineStore.setState({
        totalFrames: timeline.totalFrames,
        fps: timeline.fps,
      });
    });
  }, []);
}
