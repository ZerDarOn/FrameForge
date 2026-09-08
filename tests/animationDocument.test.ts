import assert from "node:assert/strict";
import test from "node:test";
import {
  applyAnimationDocumentCommand,
  animationDocumentToTracks,
  animationDocumentToTimelineState,
  convertLegacyProject,
  createBottomAlignedCelTransforms,
  duplicateCelWithStep,
  evaluateAnimation,
  resolveAnimationStep,
  insertAnimationStep,
  validateAnimationDocument,
} from "../src/core/animationDocument.ts";
import type { Asset } from "../src/types/asset.ts";
import type { Project } from "../src/types/project.ts";
import type { Track } from "../src/types/timeline.ts";

const project: Project = {
  id: "project-1",
  name: "Fixture",
  createdAt: 1,
  updatedAt: 1,
  canvasWidth: 16,
  canvasHeight: 16,
  fps: 12,
  baselinePoints: [],
};

function asset(id: string, trackId: string, startFrame: number, durationFrames: number): Asset {
  return {
    id,
    trackId,
    name: id,
    sourceType: "image",
    sourcePath: `C:/fixture/${id}.png`,
    thumbnailPath: `C:/fixture/${id}.png`,
    startFrame,
    durationFrames,
    width: 8,
    height: 8,
    transformX: 0,
    transformY: 0,
    transformScaleX: 1,
    transformScaleY: 1,
    transformRotation: 0,
    alignmentDx: 0,
    alignmentDy: 0,
    matchedFps: true,
  };
}

const tracks: Track[] = [
  {
    id: "bottom",
    projectId: project.id,
    name: "Bottom",
    trackType: "image_sequence",
    visible: true,
    locked: false,
    opacity: 1,
    trackOrder: 0,
    assets: [asset("held", "bottom", 0, 3), asset("after-gap", "bottom", 5, 1)],
  },
  {
    id: "top",
    projectId: project.id,
    name: "Top",
    trackType: "image_sequence",
    visible: true,
    locked: false,
    opacity: 0.5,
    trackOrder: 1,
    assets: [asset("overlay", "top", 1, 2)],
  },
];

test("legacy conversion preserves long holds, gaps, and layer order", () => {
  const { document, report } = convertLegacyProject(project, tracks, 100);
  assert.deepEqual(report.conflicts, []);
  assert.deepEqual(validateAnimationDocument(document), []);
  const animation = document.animations[0];

  assert.deepEqual(
    animation.steps.map((step) => step.durationTicks),
    [1, 2, 2, 1],
  );
  assert.deepEqual(
    evaluateAnimation(document, animation.id, 1).map((entry) => entry.content.sourcePath),
    ["C:/fixture/held.png", "C:/fixture/overlay.png"],
  );
  assert.deepEqual(evaluateAnimation(document, animation.id, 3), []);
  assert.equal(evaluateAnimation(document, animation.id, 5)[0].content.sourcePath, "C:/fixture/after-gap.png");
});

test("step lookup uses left-closed right-open ranges and loops", () => {
  const { document } = convertLegacyProject(project, tracks, 100);
  const animation = document.animations[0];

  assert.equal(resolveAnimationStep(animation, 0)?.step.id, "legacy-step-0");
  assert.equal(resolveAnimationStep(animation, 1)?.step.id, "legacy-step-1");
  assert.equal(resolveAnimationStep(animation, 2)?.step.id, "legacy-step-1");
  assert.equal(resolveAnimationStep(animation, 3)?.step.id, "legacy-step-3");
  assert.equal(resolveAnimationStep(animation, 6)?.step.id, "legacy-step-0");
});

test("commands are reversible and reject invalid durations", () => {
  const { document } = convertLegacyProject(project, tracks, 100);
  const animation = document.animations[0];
  const cel = animation.cels[0];
  const moved = applyAnimationDocumentCommand(document, {
    type: "move_cel",
    animationId: animation.id,
    celId: cel.id,
    x: 4,
    y: -2,
  });
  assert.deepEqual(
    moved.document.animations[0].cels.find((candidate) => candidate.id === cel.id)?.transform,
    { ...cel.transform, x: 4, y: -2 },
  );

  const restored = applyAnimationDocumentCommand(moved.document, moved.inverse);
  assert.deepEqual(
    restored.document.animations[0].cels.find((candidate) => candidate.id === cel.id)?.transform,
    cel.transform,
  );
  assert.throws(
    () =>
      applyAnimationDocumentCommand(document, {
        type: "set_step_duration",
        animationId: animation.id,
        stepId: animation.steps[0].id,
        durationTicks: 0,
      }),
    /positive integer/,
  );
});

test("batch cel transforms update and undo multiple cels as one revision", () => {
  const { document } = convertLegacyProject(project, tracks, 100);
  const animation = document.animations[0];
  const cels = animation.cels.slice(0, 2);
  const applied = applyAnimationDocumentCommand(document, {
    type: "set_cel_transforms",
    animationId: animation.id,
    entries: cels.map((cel, index) => ({
      celId: cel.id,
      transform: { ...cel.transform, x: 10 + index, y: 20 + index },
    })),
  });

  assert.equal(applied.document.revision, document.revision + 1);
  assert.deepEqual(
    applied.document.animations[0].cels.slice(0, 2).map((cel) => [cel.transform.x, cel.transform.y]),
    [[10, 20], [11, 21]],
  );
  const restored = applyAnimationDocumentCommand(applied.document, applied.inverse);
  assert.deepEqual(
    restored.document.animations[0].cels.slice(0, 2).map((cel) => cel.transform),
    cels.map((cel) => cel.transform),
  );
});

test("batch cel transforms reject the entire batch when one layer is locked", () => {
  const { document } = convertLegacyProject(project, tracks, 100);
  const animation = document.animations[0];
  const cels = animation.cels.slice(0, 2);
  const lockedDocument = {
    ...document,
    animations: [{
      ...animation,
      layers: animation.layers.map((layer) =>
        layer.id === cels[1].layerId ? { ...layer, locked: true } : layer,
      ),
    }],
  };

  assert.throws(
    () => applyAnimationDocumentCommand(lockedDocument, {
      type: "set_cel_transforms",
      animationId: animation.id,
      entries: cels.map((cel) => ({
        celId: cel.id,
        transform: { ...cel.transform, x: cel.transform.x + 1 },
      })),
    }),
    /Layer is locked/,
  );
  assert.deepEqual(lockedDocument.animations[0].cels, animation.cels);
});

test("bottom alignment uses rotated and scaled visual bounds", () => {
  const { document } = convertLegacyProject(project, tracks, 100);
  const animation = document.animations[0];
  const [first, second] = animation.cels.slice(0, 2);
  first.transform = { ...first.transform, y: 3, scaleX: 2, scaleY: 1, rotationDegrees: 90 };
  second.transform = { ...second.transform, y: 10, scaleX: 1, scaleY: 0.5, rotationDegrees: 0 };

  const entries = createBottomAlignedCelTransforms(document, animation.id, [first.id, second.id]);
  const contentByCel = new Map(
    animation.cels.map((cel) => [
      cel.id,
      document.contentRevisions.find((content) => content.id === cel.contentRevisionId)!,
    ]),
  );
  const bottoms = entries.map((entry) => {
    const content = contentByCel.get(entry.celId)!;
    const radians = (entry.transform.rotationDegrees * Math.PI) / 180;
    const extentY =
      Math.abs(Math.sin(radians)) * content.width * Math.abs(entry.transform.scaleX) / 2 +
      Math.abs(Math.cos(radians)) * content.height * Math.abs(entry.transform.scaleY) / 2;
    return entry.transform.y + extentY;
  });

  assert.equal(entries.length, 2);
  assert.ok(Math.abs(bottoms[0] - bottoms[1]) < 1e-9);
  assert.equal(bottoms[0], 12);
});

test("document adapter preserves evaluated timing and transforms", () => {
  const { document } = convertLegacyProject(project, tracks, 100);
  const animation = document.animations[0];
  const cel = animation.cels[0];
  const moved = applyAnimationDocumentCommand(document, {
    type: "set_cel_transform",
    animationId: animation.id,
    celId: cel.id,
    transform: { ...cel.transform, x: 3, y: 4 },
  }).document;
  const resized = applyAnimationDocumentCommand(moved, {
    type: "set_step_duration",
    animationId: animation.id,
    stepId: animation.steps[0].id,
    durationTicks: 4,
  }).document;
  const adapted = animationDocumentToTracks(resized);
  const adaptedCel = adapted
    .flatMap((track) => track.assets)
    .find((candidate) => candidate.id === cel.id);

  assert.equal(adaptedCel?.durationFrames, 4);
  assert.equal(adaptedCel?.transformX, 3);
  assert.equal(adaptedCel?.transformY, 4);
});

test("moving into an occupied step swaps cels and is reversible", () => {
  const { document } = convertLegacyProject(project, tracks, 100);
  const animation = document.animations[0];
  const layerCels = animation.cels.filter(
    (candidate) => candidate.layerId === animation.layers[0].id,
  );
  const first = layerCels[0];
  const second = layerCels[1];
  const moved = applyAnimationDocumentCommand(document, {
    type: "move_cel_to_step",
    animationId: animation.id,
    celId: first.id,
    stepId: second.stepId,
  });

  assert.equal(
    moved.document.animations[0].cels.find((candidate) => candidate.id === first.id)?.stepId,
    second.stepId,
  );
  assert.equal(
    moved.document.animations[0].cels.find((candidate) => candidate.id === second.id)?.stepId,
    first.stepId,
  );
  const restored = applyAnimationDocumentCommand(moved.document, moved.inverse);
  assert.equal(
    restored.document.animations[0].cels.find((candidate) => candidate.id === first.id)?.stepId,
    first.stepId,
  );
});

test("legacy adapter round trip keeps stable layer and cel identities", () => {
  const first = convertLegacyProject(project, tracks, 100).document;
  const adapted = animationDocumentToTracks(first);
  const second = convertLegacyProject(project, adapted, 200).document;

  assert.deepEqual(
    second.animations[0].layers.map((layer) => layer.id),
    first.animations[0].layers.map((layer) => layer.id),
  );
  assert.deepEqual(
    second.animations[0].cels.map((cel) => cel.id),
    first.animations[0].cels.map((cel) => cel.id),
  );
  assert.deepEqual(validateAnimationDocument(second), []);
});

test("content revisions are immutable and cel content changes are reversible", () => {
  const document = convertLegacyProject(project, tracks, 100).document;
  const animation = document.animations[0];
  const cel = animation.cels[0];
  const previous = document.contentRevisions.find(
    (candidate) => candidate.id === cel.contentRevisionId,
  )!;
  const next = {
    ...previous,
    id: "content-revision-edited",
    sourcePath: "C:/project/revisions/content-revision-edited.png",
    createdAt: previous.createdAt + 1,
  };

  const applied = applyAnimationDocumentCommand(document, {
    type: "set_cel_content",
    animationId: animation.id,
    celId: cel.id,
    contentRevision: next,
  });
  assert.equal(applied.document.contentRevisions.length, document.contentRevisions.length + 1);
  assert.equal(applied.document.animations[0].cels[0].contentRevisionId, next.id);
  assert.equal(document.animations[0].cels[0].contentRevisionId, previous.id);

  const undone = applyAnimationDocumentCommand(applied.document, applied.inverse);
  assert.equal(undone.document.animations[0].cels[0].contentRevisionId, previous.id);
  assert.ok(undone.document.contentRevisions.some((candidate) => candidate.id === next.id));
});

test("legacy structural adapter keeps immutable content history", () => {
  const document = convertLegacyProject(project, tracks, 100).document;
  const animation = document.animations[0];
  const cel = animation.cels[0];
  const previous = document.contentRevisions.find(
    (candidate) => candidate.id === cel.contentRevisionId,
  )!;
  const editedContent = {
    ...previous,
    id: "content-revision-preserved",
    sourcePath: "C:/project/revisions/content-revision-preserved.png",
    createdAt: 200,
  };
  const edited = applyAnimationDocumentCommand(document, {
    type: "set_cel_content",
    animationId: animation.id,
    celId: cel.id,
    contentRevision: editedContent,
  }).document;
  const adapted = animationDocumentToTracks(edited);
  const converted = convertLegacyProject(project, adapted, 300, edited).document;
  const convertedCel = converted.animations[0].cels.find(
    (candidate) => candidate.id === cel.id,
  );

  assert.equal(convertedCel?.contentRevisionId, editedContent.id);
  assert.ok(converted.contentRevisions.some((candidate) => candidate.id === previous.id));
  assert.ok(converted.contentRevisions.some((candidate) => candidate.id === editedContent.id));
});

test("duplicating a long hold inserts one equally long step without overlapping legacy assets", () => {
  const document = convertLegacyProject(project, [tracks[0]], 100).document;
  const animation = document.animations[0];
  const sourceCel = animation.cels[0];
  const sourceStep = animation.steps.find((step) => step.id === sourceCel.stepId)!;
  const duplicated = duplicateCelWithStep(
    document,
    animation.id,
    sourceCel.id,
    "duplicated-step",
    "duplicated-cel",
  );
  const duplicatedAnimation = duplicated.animations[0];
  const duplicatedStep = duplicatedAnimation.steps.find(
    (step) => step.id === "duplicated-step",
  );
  const duplicatedCel = duplicatedAnimation.cels.find(
    (cel) => cel.id === "duplicated-cel",
  );

  assert.equal(duplicatedStep?.durationTicks, sourceStep.durationTicks);
  assert.equal(duplicatedCel?.contentRevisionId, sourceCel.contentRevisionId);
  assert.equal(
    animationDocumentToTracks(duplicated)[0].assets.some(
      (asset, index, assets) =>
        index > 0 &&
        asset.startFrame < assets[index - 1].startFrame + assets[index - 1].durationFrames,
    ),
    false,
  );
});

test("a trailing blank step remains part of document timeline duration", () => {
  const document = convertLegacyProject(project, [tracks[0]], 100).document;
  const animation = document.animations[0];
  const withBlank = insertAnimationStep(
    document,
    animation.id,
    { id: "trailing-blank", order: animation.steps.length, durationTicks: 2 },
    null,
  );
  const timeline = animationDocumentToTimelineState(withBlank);
  const lastAssetEnd = Math.max(
    ...timeline.tracks.flatMap((track) =>
      track.assets.map((asset) => asset.startFrame + asset.durationFrames),
    ),
  );

  assert.equal(timeline.totalFrames, lastAssetEnd + 2);
  assert.equal(timeline.fps, animation.fps);
});
