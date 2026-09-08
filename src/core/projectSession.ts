export type ProjectLoadStatus = "idle" | "loading" | "ready" | "error";

export interface ProjectSessionToken {
  projectId: string;
  sessionId: number;
}

export class ProjectSessionController {
  private sequence = 0;
  private active: ProjectSessionToken | null = null;
  private status: ProjectLoadStatus = "idle";

  begin(projectId: string): ProjectSessionToken {
    const token = { projectId, sessionId: ++this.sequence };
    this.active = token;
    this.status = "loading";
    return token;
  }

  clear() {
    this.sequence += 1;
    this.active = null;
    this.status = "idle";
  }

  markReady(token: ProjectSessionToken) {
    if (!this.isCurrent(token)) return false;
    this.status = "ready";
    return true;
  }

  markError(token: ProjectSessionToken) {
    if (!this.isCurrent(token)) return false;
    this.status = "error";
    return true;
  }

  isCurrent(token: ProjectSessionToken, requireReady = false) {
    return (
      this.active?.projectId === token.projectId &&
      this.active.sessionId === token.sessionId &&
      (!requireReady || this.status === "ready")
    );
  }

  isReadyFor(projectId: string) {
    return this.active?.projectId === projectId && this.status === "ready";
  }

  snapshot() {
    return this.active ? { ...this.active } : null;
  }
}

export const projectSessionController = new ProjectSessionController();
