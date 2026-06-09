import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type { AnalysisReport } from "../types/analysis";

interface AnalysisState {
  reports: AnalysisReport[];
  activeReportId: string | null;
  isAnalyzing: boolean;
  progress: { stage: string; current: number; total: number } | null;

  setReports: (reports: AnalysisReport[]) => void;
  setActiveReport: (id: string | null) => void;
  loadReports: (projectId: string) => Promise<void>;
  analyzeTrack: (projectId: string, trackId: string) => Promise<void>;
  deleteReport: (reportId: string) => Promise<void>;
}

export const useAnalysisStore = create<AnalysisState>((set) => ({
  reports: [],
  activeReportId: null,
  isAnalyzing: false,
  progress: null,

  setReports: (reports) => set({ reports }),
  setActiveReport: (id) => set({ activeReportId: id }),

  loadReports: async (projectId) => {
    try {
      const reports = await invoke<AnalysisReport[]>("get_analysis_reports", { projectId });
      set({ reports });
    } catch (err) {
      console.error("加载分析报告失败:", err);
    }
  },

  analyzeTrack: async (projectId, trackId) => {
    set({ isAnalyzing: true, progress: null });
    try {
      const report = await invoke<AnalysisReport>("analyze_track", { projectId, trackId });
      set((s) => ({
        reports: [report, ...s.reports],
        activeReportId: report.id,
        isAnalyzing: false,
        progress: null,
      }));
    } catch (err) {
      console.error("分析失败:", err);
      set({ isAnalyzing: false, progress: null });
    }
  },

  deleteReport: async (reportId) => {
    try {
      await invoke("delete_analysis_report", { reportId });
      set((s) => ({
        reports: s.reports.filter((r) => r.id !== reportId),
        activeReportId: s.activeReportId === reportId ? null : s.activeReportId,
      }));
    } catch (err) {
      console.error("删除报告失败:", err);
    }
  },
}));
