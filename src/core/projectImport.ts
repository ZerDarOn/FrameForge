import type { Track } from "../types/timeline";
import type { ProjectSessionToken } from "./projectSession";

export interface ProjectImportRequest {
  operationId: string;
  projectId: string;
  name: string;
  filePaths: string[];
  fps: number;
}

interface ProjectImportDependencies {
  isCurrent: (token: ProjectSessionToken, requireReady: boolean) => boolean;
  importTrack: (request: ProjectImportRequest) => Promise<Track>;
  acceptTrack: (track: Track) => void;
  log?: (message: string, details: Record<string, unknown>) => void;
}

export type ProjectImportResult = "accepted" | "committed-in-background" | "cancelled";

export async function importTrackForSession(
  token: ProjectSessionToken,
  request: ProjectImportRequest,
  dependencies: ProjectImportDependencies,
): Promise<ProjectImportResult> {
  if (token.projectId !== request.projectId) return "cancelled";
  if (!dependencies.isCurrent(token, true)) return "cancelled";
  dependencies.log?.("project import started", {
    operationId: request.operationId,
    projectId: request.projectId,
    fileCount: request.filePaths.length,
  });
  const track = await dependencies.importTrack(request);
  if (!dependencies.isCurrent(token, true)) {
    dependencies.log?.("project import committed in background", {
      operationId: request.operationId,
      projectId: request.projectId,
      assetCount: track.assets.length,
    });
    return "committed-in-background";
  }
  dependencies.acceptTrack(track);
  dependencies.log?.("project import accepted", {
    operationId: request.operationId,
    projectId: request.projectId,
    trackId: track.id,
    assetCount: track.assets.length,
  });
  return "accepted";
}
