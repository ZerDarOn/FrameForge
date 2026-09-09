import assert from "node:assert/strict";
import test from "node:test";
import { ProjectSessionController } from "../src/core/projectSession.ts";
import { createAnalysisStore } from "../src/stores/analysisStore.ts";
import type { AnalysisReport } from "../src/types/analysis.ts";

function report(projectId: string, trackId = "track-a"): AnalysisReport {
  return {
    id: `report-${projectId}`,
    projectId,
    trackId,
    analyzedAt: 1,
    totalFrames: 2,
    displacement: [],
    flickerFrames: [],
    consistencyScore: 1,
    suggestions: [],
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

test("analysis result from an old project cannot enter the new project", async () => {
  const pending = deferred<AnalysisReport>();
  const sessions = new ProjectSessionController();
  const tokenA = sessions.begin("project-a");
  sessions.markReady(tokenA);
  const store = createAnalysisStore(async () => pending.promise, sessions);
  store.getState().beginProject("project-a");

  const analyzing = store.getState().analyzeTrack("project-a", "track-a");
  const tokenB = sessions.begin("project-b");
  sessions.markReady(tokenB);
  store.getState().beginProject("project-b");
  pending.resolve(report("project-a"));
  await analyzing;

  assert.equal(store.getState().reportsProjectId, "project-b");
  assert.deepEqual(store.getState().reports, []);
  assert.equal(store.getState().isAnalyzing, false);
});

test("report loading restores only reports owned by the current project", async () => {
  const sessions = new ProjectSessionController();
  const token = sessions.begin("project-a");
  sessions.markReady(token);
  const store = createAnalysisStore(
    async () => [report("project-a"), report("project-b")],
    sessions,
  );
  store.getState().beginProject("project-a");

  await store.getState().loadReports("project-a");

  assert.deepEqual(store.getState().reports.map((item) => item.id), ["report-project-a"]);
  assert.equal(store.getState().activeReportId, "report-project-a");
});

test("analysis progress is accepted only for the active project request", async () => {
  const pending = deferred<AnalysisReport>();
  const sessions = new ProjectSessionController();
  const token = sessions.begin("project-a");
  sessions.markReady(token);
  const store = createAnalysisStore(async () => pending.promise, sessions);
  store.getState().beginProject("project-a");
  const analyzing = store.getState().analyzeTrack("project-a", "track-a");

  store.getState().handleProgress({
    projectId: "project-b",
    stage: "loading",
    current: 1,
    total: 2,
  });
  assert.equal(store.getState().progress, null);
  store.getState().handleProgress({
    projectId: "project-a",
    stage: "loading",
    current: 1,
    total: 2,
  });
  assert.deepEqual(store.getState().progress, {
    stage: "loading",
    current: 1,
    total: 2,
  });

  pending.resolve(report("project-a"));
  await analyzing;
});
