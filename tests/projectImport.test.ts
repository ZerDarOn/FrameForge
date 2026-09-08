import assert from "node:assert/strict";
import test from "node:test";
import { importTrackForSession } from "../src/core/projectImport.ts";
import { ProjectSessionController } from "../src/core/projectSession.ts";
import type { Track } from "../src/types/timeline.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}

function track(projectId: string): Track {
  return {
    id: "track-1", projectId, name: "Imported", trackType: "image_sequence",
    visible: true, locked: false, opacity: 1, trackOrder: 0, assets: [],
  };
}

const request = {
  operationId: "import-1", projectId: "project-a", name: "Imported",
  filePaths: ["C:/fixture/a.png"], fps: 12,
};

test("a completed import is not accepted into a newer project session", async () => {
  const sessions = new ProjectSessionController();
  const tokenA = sessions.begin("project-a");
  sessions.markReady(tokenA);
  const pending = deferred<Track>();
  const accepted: Track[] = [];
  const importing = importTrackForSession(tokenA, request, {
    isCurrent: (token, ready) => sessions.isCurrent(token, ready),
    importTrack: () => pending.promise,
    acceptTrack: (value) => accepted.push(value),
  });
  const tokenB = sessions.begin("project-b");
  sessions.markReady(tokenB);
  pending.resolve(track("project-a"));
  assert.equal(await importing, "committed-in-background");
  assert.deepEqual(accepted, []);
  assert.equal(sessions.snapshot()?.projectId, "project-b");
});

test("an import only starts for the current ready session", async () => {
  const sessions = new ProjectSessionController();
  const token = sessions.begin("project-a");
  let calls = 0;
  const result = await importTrackForSession(token, request, {
    isCurrent: (candidate, ready) => sessions.isCurrent(candidate, ready),
    importTrack: async () => { calls += 1; return track("project-a"); },
    acceptTrack: () => undefined,
  });
  assert.equal(result, "cancelled");
  assert.equal(calls, 0);
});

test("a request cannot target a project different from its session", async () => {
  const sessions = new ProjectSessionController();
  const token = sessions.begin("project-a");
  sessions.markReady(token);
  let calls = 0;
  const result = await importTrackForSession(token, { ...request, projectId: "project-b" }, {
    isCurrent: (candidate, ready) => sessions.isCurrent(candidate, ready),
    importTrack: async () => { calls += 1; return track("project-b"); },
    acceptTrack: () => undefined,
  });
  assert.equal(result, "cancelled");
  assert.equal(calls, 0);
});

test("an active import is accepted exactly once", async () => {
  const sessions = new ProjectSessionController();
  const token = sessions.begin("project-a");
  sessions.markReady(token);
  let accepted = 0;
  const result = await importTrackForSession(token, request, {
    isCurrent: (candidate, ready) => sessions.isCurrent(candidate, ready),
    importTrack: async () => track("project-a"),
    acceptTrack: () => { accepted += 1; },
  });
  assert.equal(result, "accepted");
  assert.equal(accepted, 1);
});
