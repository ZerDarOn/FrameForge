import assert from "node:assert/strict";
import test from "node:test";
import {
  chooseExportDestination,
  getAnimationExportTiming,
} from "../src/core/exportWorkflow.ts";
import { convertLegacyProject } from "../src/core/animationDocument.ts";
import type { Project } from "../src/types/project.ts";

test("GIF destination uses the save dialog and cancellation remains side-effect free", async () => {
  let openCalls = 0;
  let saveOptions: { defaultPath?: string } | null = null;
  const selected = await chooseExportDestination(
    "gif",
    "walk-cycle",
    async () => {
      openCalls += 1;
      return "wrong";
    },
    async (options) => {
      saveOptions = options;
      return null;
    },
  );

  assert.equal(selected, null);
  assert.equal(openCalls, 0);
  assert.equal(saveOptions?.defaultPath, "walk-cycle.gif");
});

test("export timing is derived from the animation document", () => {
  const project: Project = {
    id: "export-project",
    name: "export",
    createdAt: 1,
    updatedAt: 1,
    canvasWidth: 16,
    canvasHeight: 16,
    fps: 20,
    baselinePoints: [],
  };
  const document = convertLegacyProject(project, [], 1).document;
  document.animations[0].steps[0].durationTicks = 5;
  const timing = getAnimationExportTiming(document);

  assert.deepEqual(timing, {
    animationId: "legacy-animation-main",
    fps: 20,
    totalFrames: 5,
    frameDelayMs: 50,
  });
});
