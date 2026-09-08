import assert from "node:assert/strict";
import test from "node:test";
import { convertLegacyProject } from "../src/core/animationDocument.ts";
import { createAnimationDocumentStore } from "../src/stores/animationDocumentStore.ts";
import type { AnimationDocument } from "../src/types/animationDocument.ts";
import type { Project } from "../src/types/project.ts";
import type { Track } from "../src/types/timeline.ts";

interface RecordValue {
  projectId: string;
  schemaVersion: number;
  revision: number;
  documentJson: string;
  updatedAt: number;
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

async function eventually(predicate: () => boolean) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("condition was not reached");
}

function project(id: string): Project {
  return {
    id,
    name: id,
    createdAt: 1,
    updatedAt: 1,
    canvasWidth: 16,
    canvasHeight: 16,
    fps: 12,
    baselinePoints: [],
  };
}

function documentFor(projectValue: Project) {
  return convertLegacyProject(projectValue, [], 1).document;
}

function recordFor(document: AnimationDocument): RecordValue {
  return {
    projectId: document.projectId,
    schemaVersion: document.schemaVersion,
    revision: document.revision,
    documentJson: JSON.stringify(document),
    updatedAt: 1,
  };
}

class FakeDocumentBackend {
  records = new Map<string, RecordValue>();
  saves: { projectId: string; revision: number }[] = [];
  gates = new Map<string, ReturnType<typeof deferred>>();
  failures = new Set<string>();
  readGates = new Map<string, ReturnType<typeof deferred>>();
  reads = new Map<string, number>();

  invoke = async <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
    const projectId = String(args?.projectId);
    if (command === "get_animation_document") {
      this.reads.set(projectId, (this.reads.get(projectId) ?? 0) + 1);
      const gate = this.readGates.get(projectId);
      if (gate) await gate.promise;
      return (this.records.get(projectId) ?? null) as T;
    }
    if (command !== "save_animation_document") throw new Error(`unexpected command: ${command}`);
    const document = JSON.parse(String(args?.documentJson)) as AnimationDocument;
    this.saves.push({ projectId, revision: document.revision });
    const gate = this.gates.get(`${projectId}:${document.revision}`);
    if (gate) await gate.promise;
    const failureKey = `${projectId}:${document.revision}`;
    if (this.failures.delete(failureKey)) throw new Error("simulated save failure");
    const current = this.records.get(projectId);
    const expected = args?.expectedRevision as number | null;
    assert.equal(current?.revision ?? null, expected);
    const record = recordFor(document);
    this.records.set(projectId, record);
    return record as T;
  };
}

function trackWithAsset(projectId: string): Track {
  return {
    id: "track", projectId, name: "Layer", trackType: "image_sequence",
    visible: true, locked: false, opacity: 1, trackOrder: 0,
    assets: [{
      id: "asset", trackId: "track", name: "Frame", sourceType: "image",
      sourcePath: "C:/fixture/original.png", thumbnailPath: "C:/fixture/original.png",
      startFrame: 0, durationFrames: 1, width: 8, height: 8,
      transformX: 0, transformY: 0, transformScaleX: 1, transformScaleY: 1,
      transformRotation: 0, alignmentDx: 0, alignmentDy: 0, matchedFps: true,
    }],
  };
}

function editCanvasWidth(
  store: ReturnType<typeof createAnimationDocumentStore>,
  width: number,
) {
  const current = store.getState().document!;
  store.getState().execute({
    type: "replace_document",
    document: { ...current, canvas: { ...current.canvas, width } },
  });
}

test("same-project reload waits for every queued save", async () => {
  const backend = new FakeDocumentBackend();
  const projectValue = project("queue-stable-project");
  backend.records.set(projectValue.id, recordFor(documentFor(projectValue)));
  const firstSave = deferred();
  backend.gates.set(`${projectValue.id}:1`, firstSave);
  const store = createAnimationDocumentStore(backend.invoke);

  await store.getState().loadForProject(projectValue, []);
  editCanvasWidth(store, 17);
  editCanvasWidth(store, 18);
  const reload = store.getState().loadForProject(projectValue, []);
  await eventually(() => backend.saves.some((save) => save.revision === 1));
  firstSave.resolve();
  await reload;

  assert.deepEqual(backend.saves.map((save) => save.revision), [1, 2]);
  assert.equal(store.getState().document?.revision, 2);
  assert.equal(store.getState().document?.canvas.width, 18);
  assert.equal(store.getState().persistedRevision, 2);
  assert.equal(store.getState().saveStatus, "saved");
});

test("save response from another project never replaces the active project", async () => {
  const backend = new FakeDocumentBackend();
  const projectA = project("cross-project-a");
  const projectB = project("cross-project-b");
  backend.records.set(projectA.id, recordFor(documentFor(projectA)));
  backend.records.set(projectB.id, recordFor(documentFor(projectB)));
  const saveA = deferred();
  backend.gates.set(`${projectA.id}:1`, saveA);
  const store = createAnimationDocumentStore(backend.invoke);

  await store.getState().loadForProject(projectA, []);
  editCanvasWidth(store, 19);
  await eventually(() => backend.saves.length === 1);
  await store.getState().loadForProject(projectB, []);
  saveA.resolve();
  await eventually(() => backend.records.get(projectA.id)?.revision === 1);

  assert.equal(store.getState().document?.projectId, projectB.id);
  assert.equal(store.getState().document?.revision, 0);
  await store.getState().loadForProject(projectA, []);
  assert.equal(store.getState().document?.canvas.width, 19);
  assert.equal(store.getState().document?.revision, 1);
});

test("failed project restores its latest draft and retries as one rebased save", async () => {
  const backend = new FakeDocumentBackend();
  const failedProject = project("failed-draft-project");
  const otherProject = project("failed-draft-other");
  backend.records.set(failedProject.id, recordFor(documentFor(failedProject)));
  backend.records.set(otherProject.id, recordFor(documentFor(otherProject)));
  backend.failures.add(`${failedProject.id}:1`);
  const store = createAnimationDocumentStore(backend.invoke);

  await store.getState().loadForProject(failedProject, []);
  editCanvasWidth(store, 17);
  await eventually(() => store.getState().saveStatus === "error");
  editCanvasWidth(store, 18);
  await store.getState().loadForProject(otherProject, []);
  await store.getState().loadForProject(failedProject, []);

  assert.equal(store.getState().saveStatus, "error");
  assert.equal(store.getState().document?.canvas.width, 18);
  assert.equal(store.getState().undoStack.length, 2);
  store.getState().retrySave();
  await eventually(() => store.getState().saveStatus === "saved");

  const persisted = JSON.parse(
    backend.records.get(failedProject.id)!.documentJson,
  ) as AnimationDocument;
  assert.equal(persisted.revision, 1);
  assert.equal(persisted.canvas.width, 18);
});

test("a delayed reload clears the document and cannot overwrite interim edits", async () => {
  const backend = new FakeDocumentBackend();
  const projectValue = project("delayed-read-project");
  backend.records.set(projectValue.id, recordFor(documentFor(projectValue)));
  const store = createAnimationDocumentStore(backend.invoke);
  await store.getState().loadForProject(projectValue, []);
  const readGate = deferred();
  backend.readGates.set(projectValue.id, readGate);
  const loading = store.getState().loadForProject(projectValue, []);
  await eventually(() => backend.reads.get(projectValue.id) === 2);
  assert.equal(store.getState().document, null);
  store.getState().execute({ type: "replace_document", document: documentFor(projectValue) });
  assert.equal(store.getState().document, null);
  readGate.resolve();
  assert.equal(await loading, true);
  assert.equal(store.getState().document?.canvas.width, 16);
});

test("persistence failures are isolated between store factory instances", async () => {
  const projectValue = project("factory-isolation");
  const failedBackend = new FakeDocumentBackend();
  const healthyBackend = new FakeDocumentBackend();
  failedBackend.records.set(projectValue.id, recordFor(documentFor(projectValue)));
  healthyBackend.records.set(projectValue.id, recordFor(documentFor(projectValue)));
  failedBackend.failures.add(projectValue.id + ":1");
  const failedStore = createAnimationDocumentStore(failedBackend.invoke);
  const healthyStore = createAnimationDocumentStore(healthyBackend.invoke);
  await Promise.all([
    failedStore.getState().loadForProject(projectValue, []),
    healthyStore.getState().loadForProject(projectValue, []),
  ]);
  editCanvasWidth(failedStore, 17);
  editCanvasWidth(healthyStore, 18);
  await eventually(() => failedStore.getState().saveStatus === "error");
  await eventually(() => healthyStore.getState().saveStatus === "saved");
  assert.equal(failedStore.getState().saveStatus, "error");
  assert.equal(healthyBackend.records.get(projectValue.id)?.revision, 1);
  assert.equal(healthyStore.getState().document?.canvas.width, 18);
});

test("content edit undo redo persists and survives reopening", async () => {
  const backend = new FakeDocumentBackend();
  const projectValue = project("content-reopen");
  const tracks = [trackWithAsset(projectValue.id)];
  const initial = convertLegacyProject(projectValue, tracks, 1).document;
  backend.records.set(projectValue.id, recordFor(initial));
  const store = createAnimationDocumentStore(backend.invoke);
  await store.getState().loadForProject(projectValue, tracks);
  const animation = store.getState().document!.animations[0];
  const cel = animation.cels[0];
  const originalContentId = cel.contentRevisionId;
  const original = store.getState().document!.contentRevisions.find((candidate) => candidate.id === originalContentId)!;
  store.getState().execute({
    type: "set_cel_content", animationId: animation.id, celId: cel.id,
    contentRevision: { ...original, id: "edited-content", sourcePath: "C:/fixture/edited.png", createdAt: 2 },
  });
  assert.equal(await store.getState().flushCurrentProject(), true);
  store.getState().undo();
  assert.equal(await store.getState().flushCurrentProject(), true);
  assert.equal(store.getState().document!.animations[0].cels[0].contentRevisionId, originalContentId);
  store.getState().redo();
  assert.equal(await store.getState().flushCurrentProject(), true);
  assert.equal(store.getState().document!.animations[0].cels[0].contentRevisionId, "edited-content");
  await store.getState().loadForProject(projectValue, tracks);
  assert.equal(store.getState().document!.animations[0].cels[0].contentRevisionId, "edited-content");
  assert.equal(store.getState().saveStatus, "saved");
});
