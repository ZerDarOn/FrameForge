import assert from "node:assert/strict";
import test from "node:test";
import {
  createGenerationStore,
  type GenerationRetryStorage,
} from "../src/stores/generationStore.ts";
import type {
  GeneratedAsset,
  GenerationJob,
  TextToPixelParams,
} from "../src/types/generation.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((complete, fail) => {
    resolve = complete;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const params: TextToPixelParams = {
  prompt: "idle hero",
  style: "16bit",
  width: 64,
  height: 64,
  numVariants: 1,
  provider: "openai",
};

function asset(id: string, projectId: string): GeneratedAsset {
  return {
    id,
    projectId,
    name: id,
    assetType: "sprite",
    prompt: params.prompt,
    style: params.style,
    width: params.width,
    height: params.height,
    provider: "openai",
    filePath: `C:/generated/${id}.png`,
    thumbnailPath: `C:/generated/thumb-${id}.png`,
    createdAt: 1,
  };
}

function memoryRetryStorage() {
  const snapshots = new Map<string, GenerationJob>();
  const storage: GenerationRetryStorage = {
    load: (projectId) => snapshots.get(projectId) ?? null,
    save: (job) => snapshots.set(job.projectId, structuredClone(job)),
    clear: (projectId) => {
      snapshots.delete(projectId);
    },
  };
  return { snapshots, storage };
}

test("project switch ignores stale generation progress and results", async () => {
  const generation = deferred<GeneratedAsset[]>();
  const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
  const store = createGenerationStore(
    async <T>(command: string, args?: Record<string, unknown>) => {
      calls.push({ command, args });
      if (command === "generate_pixel_art") return generation.promise as Promise<T>;
      if (command === "list_generated_assets") return [] as T;
      throw new Error(`unexpected command: ${command}`);
    },
    () => "job-a",
  );

  await store.getState().loadAssets("project-a");
  const running = store.getState().generate("project-a", params);
  store.getState().handleProgress({
    jobId: "job-a",
    projectId: "project-a",
    stage: "generating",
    current: 1,
    total: 1,
  });
  assert.equal(store.getState().activeJob?.progress?.current, 1);

  await store.getState().loadAssets("project-b");
  store.getState().handleProgress({
    jobId: "job-a",
    projectId: "project-a",
    stage: "done",
    current: 1,
    total: 1,
  });
  generation.resolve([asset("candidate-a", "project-a")]);
  await running;

  assert.equal(store.getState().assetsProjectId, "project-b");
  assert.deepEqual(store.getState().assets, []);
  assert.equal(store.getState().activeJob, null);
  assert.deepEqual(calls.find((call) => call.command === "generate_pixel_art")?.args, {
    jobId: "job-a",
    projectId: "project-a",
    params,
  });
});

test("cancellation is scoped to the active job and ends without candidates", async () => {
  const generation = deferred<GeneratedAsset[]>();
  const store = createGenerationStore(
    async <T>(command: string) => {
      if (command === "generate_pixel_art") return generation.promise as Promise<T>;
      if (command === "cancel_generation") return true as T;
      if (command === "list_generated_assets") return [] as T;
      throw new Error(`unexpected command: ${command}`);
    },
    () => "job-cancel",
  );

  await store.getState().loadAssets("project-a");
  const running = store.getState().generate("project-a", params);
  await store.getState().cancelActiveJob();
  assert.equal(store.getState().activeJob?.status, "cancelling");

  generation.reject(new Error("GENERATION_CANCELLED"));
  await running;

  assert.equal(store.getState().activeJob?.status, "cancelled");
  assert.deepEqual(store.getState().assets, []);
  assert.equal(store.getState().error, null);
});

test("failed generation retries from an immutable parameter snapshot", async () => {
  const mutableParams = { ...params };
  const jobIds = ["job-first", "job-retry"];
  const generateArgs: Record<string, unknown>[] = [];
  let attempts = 0;
  const store = createGenerationStore(
    async <T>(command: string, args?: Record<string, unknown>) => {
      if (command === "list_generated_assets") return [] as T;
      if (command !== "generate_pixel_art") throw new Error(`unexpected command: ${command}`);
      generateArgs.push(args ?? {});
      attempts += 1;
      if (attempts === 1) throw new Error("provider unavailable");
      return [asset("candidate-retry", "project-a")] as T;
    },
    () => jobIds.shift()!,
  );

  await store.getState().loadAssets("project-a");
  await store.getState().generate("project-a", mutableParams);
  assert.equal(store.getState().activeJob?.status, "failed");

  mutableParams.prompt = "mutated caller value";
  await store.getState().retryActiveJob();

  assert.equal(store.getState().activeJob?.id, "job-retry");
  assert.equal(store.getState().activeJob?.status, "completed");
  assert.equal(store.getState().assets[0]?.id, "candidate-retry");
  assert.equal(
    (generateArgs[1].params as TextToPixelParams).prompt,
    "idle hero",
  );
});

test("retryable generation snapshot restores per project and clears after success", async () => {
  const { snapshots, storage } = memoryRetryStorage();
  const firstStore = createGenerationStore(
    async <T>(command: string) => {
      if (command === "list_generated_assets") return [] as T;
      if (command === "generate_pixel_art") throw new Error("provider unavailable");
      throw new Error(`unexpected command: ${command}`);
    },
    () => "job-failed",
    storage,
  );

  await firstStore.getState().loadAssets("project-a");
  await firstStore.getState().generate("project-a", params);
  assert.equal(snapshots.get("project-a")?.status, "failed");

  const generateArgs: Record<string, unknown>[] = [];
  const restoredStore = createGenerationStore(
    async <T>(command: string, args?: Record<string, unknown>) => {
      if (command === "list_generated_assets") return [] as T;
      if (command === "generate_pixel_art") {
        generateArgs.push(args ?? {});
        return [asset("candidate-restored", "project-a")] as T;
      }
      throw new Error(`unexpected command: ${command}`);
    },
    () => "job-restored",
    storage,
  );

  await restoredStore.getState().loadAssets("project-a");
  assert.equal(restoredStore.getState().activeJob?.id, "job-failed");
  assert.equal(restoredStore.getState().activeJob?.status, "failed");
  assert.equal(restoredStore.getState().error, "provider unavailable");

  await restoredStore.getState().retryActiveJob();

  assert.equal(restoredStore.getState().activeJob?.status, "completed");
  assert.equal(restoredStore.getState().assets[0]?.id, "candidate-restored");
  assert.equal(
    (generateArgs[0].params as TextToPixelParams).prompt,
    params.prompt,
  );
  assert.equal(snapshots.has("project-a"), false);
});

test("cancelled progress rejects a late successful result and keeps retry context", async () => {
  const generation = deferred<GeneratedAsset[]>();
  const { snapshots, storage } = memoryRetryStorage();
  const store = createGenerationStore(
    async <T>(command: string) => {
      if (command === "list_generated_assets") return [] as T;
      if (command === "generate_pixel_art") return generation.promise as Promise<T>;
      throw new Error(`unexpected command: ${command}`);
    },
    () => "job-late-result",
    storage,
  );

  await store.getState().loadAssets("project-a");
  const running = store.getState().generate("project-a", params);
  store.getState().handleProgress({
    jobId: "job-late-result",
    projectId: "project-a",
    stage: "cancelled",
    current: 0,
    total: 1,
  });
  generation.resolve([asset("candidate-too-late", "project-a")]);
  await running;

  assert.equal(store.getState().activeJob?.status, "cancelled");
  assert.deepEqual(store.getState().assets, []);
  assert.equal(snapshots.get("project-a")?.status, "cancelled");
});
