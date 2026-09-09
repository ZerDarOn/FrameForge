import assert from "node:assert/strict";
import test from "node:test";
import { AnimationCanvasRenderer } from "../src/engines/animationCanvasRenderer.ts";
import type { AnimationDocument } from "../src/types/animationDocument.ts";

class FakeImage {
  static instances: FakeImage[] = [];
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  width = 4;
  height = 4;
  src = "";

  constructor() {
    FakeImage.instances.push(this);
  }
}

class FakeCanvas {
  width = 0;
  height = 0;
  content = "";
  readonly context = {
    globalAlpha: 1,
    imageSmoothingEnabled: false,
    clearRect: () => {
      this.content = "";
    },
    save: () => undefined,
    restore: () => undefined,
    translate: () => undefined,
    rotate: () => undefined,
    scale: () => undefined,
    drawImage: (source: FakeImage | FakeCanvas) => {
      this.content = source instanceof FakeImage ? source.src : source.content;
    },
  };

  getContext() {
    return this.context;
  }

  toDataURL() {
    return `data:image/png;base64,${this.content}`;
  }
}

function renderDocument(): AnimationDocument {
  return {
    schemaVersion: 1,
    projectId: "renderer-project",
    revision: 0,
    canvas: { width: 16, height: 16, originX: 8, originY: 8 },
    palette: [],
    materials: [
      { id: "material-first", name: "first", sourcePath: "data:first" },
      { id: "material-second", name: "second", sourcePath: "data:second" },
    ],
    contentRevisions: [
      {
        id: "content-first",
        materialId: "material-first",
        sourcePath: "data:first",
        width: 4,
        height: 4,
        createdAt: 1,
      },
      {
        id: "content-second",
        materialId: "material-second",
        sourcePath: "data:second",
        width: 4,
        height: 4,
        createdAt: 1,
      },
    ],
    animations: [
      {
        id: "animation",
        name: "animation",
        direction: null,
        fps: 12,
        playbackMode: "once",
        steps: [
          { id: "step-first", order: 0, durationTicks: 1 },
          { id: "step-second", order: 1, durationTicks: 1 },
        ],
        layers: [
          { id: "layer", name: "layer", order: 0, visible: true, locked: false, opacity: 1 },
        ],
        cels: [
          {
            id: "cel-first",
            layerId: "layer",
            stepId: "step-first",
            contentRevisionId: "content-first",
            transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotationDegrees: 0 },
          },
          {
            id: "cel-second",
            layerId: "layer",
            stepId: "step-second",
            contentRevisionId: "content-second",
            transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotationDegrees: 0 },
          },
        ],
      },
    ],
  };
}

test("late frame rendering cannot overwrite a newer target generation", async () => {
  FakeImage.instances = [];
  Object.assign(globalThis, {
    Image: FakeImage,
    window: { document: { createElement: () => new FakeCanvas() } },
  });
  const renderer = new AnimationCanvasRenderer();
  const target = new FakeCanvas();
  const document = renderDocument();
  const first = renderer.renderFrame(document, "animation", 0, target as unknown as HTMLCanvasElement);
  const second = renderer.renderFrame(document, "animation", 1, target as unknown as HTMLCanvasElement);
  const firstImage = FakeImage.instances.find((image) => image.src === "data:first")!;
  const secondImage = FakeImage.instances.find((image) => image.src === "data:second")!;

  secondImage.onload?.();
  await second;
  assert.equal(target.content, "data:second");
  firstImage.onload?.();
  await first;
  assert.equal(target.content, "data:second");
});

test("a rejected image load is evicted so a later render can retry", async () => {
  FakeImage.instances = [];
  Object.assign(globalThis, {
    Image: FakeImage,
    window: { document: { createElement: () => new FakeCanvas() } },
  });
  const renderer = new AnimationCanvasRenderer();
  const document = renderDocument();
  const failed = renderer.renderFrame(document, "animation", 0);
  FakeImage.instances[0].onerror?.();
  await assert.rejects(failed, /无法加载素材/);

  const retry = renderer.renderFrame(document, "animation", 0);
  assert.equal(FakeImage.instances.length, 2);
  FakeImage.instances[1].onload?.();
  await retry;
});

test("project switch does not reuse a same-id image from the previous project", async () => {
  FakeImage.instances = [];
  Object.assign(globalThis, {
    Image: FakeImage,
    window: { document: { createElement: () => new FakeCanvas() } },
  });
  const renderer = new AnimationCanvasRenderer();
  const firstDocument = renderDocument();
  const secondDocument = structuredClone(firstDocument);
  secondDocument.projectId = "renderer-project-two";
  secondDocument.contentRevisions[0].sourcePath = "data:project-two";
  const target = new FakeCanvas();
  const first = renderer.renderFrame(
    firstDocument,
    "animation",
    0,
    target as unknown as HTMLCanvasElement,
  );
  const second = renderer.renderFrame(
    secondDocument,
    "animation",
    0,
    target as unknown as HTMLCanvasElement,
  );
  const firstImage = FakeImage.instances.find((image) => image.src === "data:first")!;
  const secondImage = FakeImage.instances.find((image) => image.src === "data:project-two")!;

  secondImage.onload?.();
  await second;
  firstImage.onload?.();
  await first;
  assert.equal(target.content, "data:project-two");
});

test("PNG frame rendering aborts without waiting for a pending image", async () => {
  FakeImage.instances = [];
  Object.assign(globalThis, {
    Image: FakeImage,
    window: { document: { createElement: () => new FakeCanvas() } },
  });
  const renderer = new AnimationCanvasRenderer();
  const controller = new AbortController();
  const rendering = renderer.renderPngFrames(
    renderDocument(),
    "animation",
    controller.signal,
  );

  assert.equal(FakeImage.instances.length, 1);
  controller.abort();
  await assert.rejects(rendering, /EXPORT_CANCELLED/);
  assert.equal(FakeImage.instances.length, 1);
});
