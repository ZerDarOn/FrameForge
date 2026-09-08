export type CloseDecision = "allow" | "wait" | "confirm";

interface CloseState {
  hasDocument: boolean;
  saveStatus: "idle" | "saving" | "saved" | "error";
  documentRevision: number | null;
  persistedRevision: number | null;
}

export function decideCloseAction(state: CloseState): CloseDecision {
  if (!state.hasDocument) return "allow";
  if (
    state.saveStatus === "saved" &&
    state.documentRevision === state.persistedRevision
  ) {
    return "allow";
  }
  if (state.saveStatus === "saving") return "wait";
  return "confirm";
}
