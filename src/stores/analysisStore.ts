import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { projectSessionController, type ProjectSessionToken } from "../core/projectSession.ts";
import type { AnalysisReport } from "../types/analysis.ts";

export interface AnalysisProgressEvent {
  projectId: string;
  stage: string;
  current: number;
  total: number;
}

interface AnalysisSessionController {
  snapshot: () => ProjectSessionToken | null;
  isCurrent: (token: ProjectSessionToken, requireReady?: boolean) => boolean;
  isReadyFor: (projectId: string) => boolean;
}

export type AnalysisInvoke = <T>(
  command: string,
  args?: Record<string, unknown>,
) => Promise<T>;

interface AnalysisState {
  reports: AnalysisReport[];
  reportsProjectId: string | null;
  activeReportId: string | null;
  isAnalyzing: boolean;
  progress: Omit<AnalysisProgressEvent, "projectId"> | null;
  error: string | null;
  beginProject: (projectId: string | null) => void;
  setActiveReport: (id: string | null) => void;
  handleProgress: (progress: AnalysisProgressEvent) => void;
  loadReports: (projectId: string) => Promise<void>;
  analyzeTrack: (projectId: string, trackId: string) => Promise<void>;
  analyzeCloudTrack: (projectId: string, trackId: string) => Promise<void>;
  deleteReport: (reportId: string) => Promise<void>;
}

function describeError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isOwnedReport(report: AnalysisReport, projectId: string, trackId?: string) {
  return (
    report.projectId === projectId &&
    (!trackId || report.trackId === trackId) &&
    typeof report.id === "string" &&
    report.id.length > 0
  );
}

export function createAnalysisStore(
  invokeCommand: AnalysisInvoke = invoke,
  sessions: AnalysisSessionController = projectSessionController,
) {
  let operationSequence = 0;
  return create<AnalysisState>((set, get) => {
    const runAnalysis = async (
      command: "analyze_track" | "cloud_consistency_check",
      projectId: string,
      trackId: string,
    ) => {
      const token = sessions.snapshot();
      if (
        !token ||
        token.projectId !== projectId ||
        !sessions.isCurrent(token, true) ||
        get().isAnalyzing
      ) {
        return;
      }
      const sequence = ++operationSequence;
      set({
        reportsProjectId: projectId,
        isAnalyzing: true,
        progress: null,
        error: null,
      });
      console.info("[FrameForge] analysis started", {
        projectId,
        trackId,
        operation: command,
      });
      try {
        const report = await invokeCommand<AnalysisReport>(command, { projectId, trackId });
        if (
          sequence !== operationSequence ||
          !sessions.isCurrent(token, true) ||
          get().reportsProjectId !== projectId
        ) {
          return;
        }
        if (!isOwnedReport(report, projectId, trackId)) {
          throw new Error("分析结果与当前项目或轨道不匹配");
        }
        set((state) => ({
          reports: [report, ...state.reports.filter((item) => item.id !== report.id)],
          activeReportId: report.id,
          isAnalyzing: false,
          progress: null,
          error: null,
        }));
        console.info("[FrameForge] analysis completed", {
          projectId,
          trackId,
          operation: command,
          reportId: report.id,
        });
      } catch (error) {
        if (
          sequence !== operationSequence ||
          !sessions.isCurrent(token, true) ||
          get().reportsProjectId !== projectId
        ) {
          return;
        }
        set({
          isAnalyzing: false,
          progress: null,
          error: describeError(error),
        });
        console.info("[FrameForge] analysis failed", {
          projectId,
          trackId,
          operation: command,
        });
      }
    };

    return {
      reports: [],
      reportsProjectId: null,
      activeReportId: null,
      isAnalyzing: false,
      progress: null,
      error: null,

      beginProject: (projectId) => {
        operationSequence += 1;
        set({
          reports: [],
          reportsProjectId: projectId,
          activeReportId: null,
          isAnalyzing: false,
          progress: null,
          error: null,
        });
      },
      setActiveReport: (id) => {
        if (id && !get().reports.some((report) => report.id === id)) return;
        set({ activeReportId: id });
      },
      handleProgress: ({ projectId, stage, current, total }) => {
        if (
          !get().isAnalyzing ||
          get().reportsProjectId !== projectId ||
          !sessions.isReadyFor(projectId) ||
          typeof stage !== "string" ||
          !Number.isInteger(current) ||
          !Number.isInteger(total) ||
          current < 0 ||
          total < 0 ||
          current > total
        ) {
          return;
        }
        set({ progress: { stage, current, total } });
      },
      loadReports: async (projectId) => {
        const token = sessions.snapshot();
        if (!token || token.projectId !== projectId || !sessions.isCurrent(token)) return;
        const sequence = ++operationSequence;
        set({
          reports: [],
          reportsProjectId: projectId,
          activeReportId: null,
          isAnalyzing: false,
          progress: null,
          error: null,
        });
        try {
          const reports = await invokeCommand<AnalysisReport[]>("get_analysis_reports", {
            projectId,
          });
          if (
            sequence !== operationSequence ||
            !sessions.isCurrent(token) ||
            get().reportsProjectId !== projectId
          ) {
            return;
          }
          const ownedReports = reports.filter((report) => isOwnedReport(report, projectId));
          set({
            reports: ownedReports,
            activeReportId: ownedReports[0]?.id ?? null,
            error: null,
          });
        } catch (error) {
          if (
            sequence !== operationSequence ||
            !sessions.isCurrent(token) ||
            get().reportsProjectId !== projectId
          ) {
            return;
          }
          set({ error: describeError(error) });
          console.info("[FrameForge] analysis report load failed", { projectId });
        }
      },
      analyzeTrack: (projectId, trackId) => runAnalysis("analyze_track", projectId, trackId),
      analyzeCloudTrack: (projectId, trackId) =>
        runAnalysis("cloud_consistency_check", projectId, trackId),
      deleteReport: async (reportId) => {
        const projectId = get().reportsProjectId;
        const token = sessions.snapshot();
        if (
          !projectId ||
          !token ||
          token.projectId !== projectId ||
          !sessions.isCurrent(token, true) ||
          !get().reports.some((report) => report.id === reportId)
        ) {
          return;
        }
        try {
          await invokeCommand("delete_analysis_report", { reportId });
          if (!sessions.isCurrent(token, true) || get().reportsProjectId !== projectId) return;
          set((state) => ({
            reports: state.reports.filter((report) => report.id !== reportId),
            activeReportId:
              state.activeReportId === reportId
                ? state.reports.find((report) => report.id !== reportId)?.id ?? null
                : state.activeReportId,
            error: null,
          }));
        } catch (error) {
          if (!sessions.isCurrent(token, true) || get().reportsProjectId !== projectId) return;
          set({ error: describeError(error) });
          console.info("[FrameForge] analysis report deletion failed", {
            projectId,
            reportId,
          });
        }
      },
    };
  });
}

export const useAnalysisStore = createAnalysisStore();
