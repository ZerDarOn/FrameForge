import type { Asset } from "../types/asset.ts";
import type {
  AnimationCel,
  AnimationDocument,
  AnimationDocumentCommand,
  AnimationDocumentMigrationReport,
  AnimationSequence,
  AnimationStep,
  CelTransform,
  ContentRevision,
  EvaluatedLayer,
  Material,
} from "../types/animationDocument.ts";
import { ANIMATION_DOCUMENT_SCHEMA_VERSION } from "../types/animationDocument.ts";
import type { Project } from "../types/project.ts";
import type { Track } from "../types/timeline.ts";

export interface LegacyDocumentConversion {
  document: AnimationDocument;
  report: AnimationDocumentMigrationReport;
}

export interface AppliedAnimationDocumentCommand {
  document: AnimationDocument;
  inverse: AnimationDocumentCommand;
}

function assertFinite(value: number, label: string) {
  if (!Number.isFinite(value)) {
    throw new Error(`${label} must be finite`);
  }
}

function findAnimation(document: AnimationDocument, animationId: string) {
  const animation = document.animations.find((candidate) => candidate.id === animationId);
  if (!animation) {
    throw new Error(`Animation not found: ${animationId}`);
  }
  return animation;
}

export function createBottomAlignedCelTransforms(
  document: AnimationDocument,
  animationId: string,
  celIds: string[],
): Array<{ celId: string; transform: CelTransform }> {
  const animation = findAnimation(document, animationId);
  const selectedIds = new Set(celIds);
  const cels = animation.cels.filter((cel) => selectedIds.has(cel.id));
  if (cels.length !== selectedIds.size) {
    const foundIds = new Set(cels.map((cel) => cel.id));
    const missingId = celIds.find((celId) => !foundIds.has(celId));
    throw new Error("Cel not found: " + missingId);
  }
  if (cels.length < 2) return [];

  const contents = new Map(document.contentRevisions.map((content) => [content.id, content]));
  const entries = cels.map((cel) => {
    const content = contents.get(cel.contentRevisionId);
    if (!content) throw new Error("Content not found: " + cel.contentRevisionId);
    const radians = (cel.transform.rotationDegrees * Math.PI) / 180;
    const halfWidth = (content.width * Math.abs(cel.transform.scaleX)) / 2;
    const halfHeight = (content.height * Math.abs(cel.transform.scaleY)) / 2;
    const extentY =
      Math.abs(Math.sin(radians)) * halfWidth +
      Math.abs(Math.cos(radians)) * halfHeight;
    return { cel, extentY, bottom: cel.transform.y + extentY };
  });
  const targetBottom = Math.max(...entries.map((entry) => entry.bottom));

  return entries.map(({ cel, extentY }) => ({
    celId: cel.id,
    transform: { ...cel.transform, y: targetBottom - extentY },
  }));
}

function replaceAnimation(
  document: AnimationDocument,
  animationId: string,
  update: (animation: AnimationSequence) => AnimationSequence,
) {
  return {
    ...document,
    revision: document.revision + 1,
    animations: document.animations.map((animation) =>
      animation.id === animationId ? update(animation) : animation,
    ),
  };
}

export function validateAnimationDocument(document: AnimationDocument): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();

  if (document.schemaVersion !== ANIMATION_DOCUMENT_SCHEMA_VERSION) {
    errors.push(`Unsupported schema version: ${document.schemaVersion}`);
  }
  if (!document.projectId) errors.push("projectId is required");
  if (!Number.isInteger(document.revision) || document.revision < 0) {
    errors.push("revision must be a non-negative integer");
  }
  if (!Number.isInteger(document.canvas.width) || document.canvas.width <= 0) {
    errors.push("canvas.width must be a positive integer");
  }
  if (!Number.isInteger(document.canvas.height) || document.canvas.height <= 0) {
    errors.push("canvas.height must be a positive integer");
  }

  const registerId = (id: string, label: string) => {
    if (!id) {
      errors.push(`${label} id is required`);
    } else if (ids.has(id)) {
      errors.push(`Duplicate id: ${id}`);
    } else {
      ids.add(id);
    }
  };

  for (const material of document.materials) registerId(material.id, "material");
  const materialIds = new Set(document.materials.map((material) => material.id));

  for (const content of document.contentRevisions) {
    registerId(content.id, "content revision");
    if (!materialIds.has(content.materialId)) {
      errors.push(`Missing material for content revision: ${content.id}`);
    }
  }
  const contentIds = new Set(document.contentRevisions.map((content) => content.id));

  for (const animation of document.animations) {
    registerId(animation.id, "animation");
    if (!Number.isFinite(animation.fps) || animation.fps <= 0) {
      errors.push(`Animation fps must be positive: ${animation.id}`);
    }
    const stepIds = new Set<string>();
    for (const step of animation.steps) {
      registerId(step.id, "step");
      stepIds.add(step.id);
      if (!Number.isInteger(step.durationTicks) || step.durationTicks <= 0) {
        errors.push(`Step duration must be a positive integer: ${step.id}`);
      }
    }
    const layerIds = new Set<string>();
    for (const layer of animation.layers) {
      registerId(layer.id, "layer");
      layerIds.add(layer.id);
      if (!Number.isFinite(layer.opacity) || layer.opacity < 0 || layer.opacity > 1) {
        errors.push(`Layer opacity is out of range: ${layer.id}`);
      }
    }
    const celKeys = new Set<string>();
    for (const cel of animation.cels) {
      registerId(cel.id, "cel");
      if (!stepIds.has(cel.stepId)) errors.push(`Missing step for cel: ${cel.id}`);
      if (!layerIds.has(cel.layerId)) errors.push(`Missing layer for cel: ${cel.id}`);
      if (!contentIds.has(cel.contentRevisionId)) {
        errors.push(`Missing content revision for cel: ${cel.id}`);
      }
      const key = `${cel.layerId}:${cel.stepId}`;
      if (celKeys.has(key)) errors.push(`Multiple cels occupy ${key}`);
      celKeys.add(key);
      for (const [label, value] of Object.entries(cel.transform)) {
        if (!Number.isFinite(value)) errors.push(`Cel ${cel.id} has invalid ${label}`);
      }
    }
  }

  return errors;
}

function assetCoversTick(asset: Asset, tick: number) {
  const duration = Math.max(1, asset.durationFrames);
  return tick >= asset.startFrame && tick < asset.startFrame + duration;
}

function createMaterial(
  asset: Asset,
  materialByPath: Map<string, Material>,
  contentByPath: Map<string, ContentRevision>,
  createdAt: number,
  usedMaterialIds: Set<string>,
  usedContentIds: Set<string>,
) {
  const existing = contentByPath.get(asset.sourcePath);
  if (existing) return existing;

  let suffix = materialByPath.size;
  while (
    usedMaterialIds.has(`legacy-material-${suffix}`) ||
    usedContentIds.has(`legacy-content-${suffix}`)
  ) {
    suffix += 1;
  }
  const material: Material = {
    id: `legacy-material-${suffix}`,
    name: asset.name,
    sourcePath: asset.sourcePath,
  };
  const content: ContentRevision = {
    id: `legacy-content-${suffix}`,
    materialId: material.id,
    sourcePath: asset.sourcePath,
    width: asset.width,
    height: asset.height,
    createdAt,
  };
  materialByPath.set(asset.sourcePath, material);
  contentByPath.set(asset.sourcePath, content);
  usedMaterialIds.add(material.id);
  usedContentIds.add(content.id);
  return content;
}

export function convertLegacyProject(
  project: Project,
  tracks: Track[],
  createdAt = Date.now(),
  existingDocument?: AnimationDocument,
): LegacyDocumentConversion {
  const report: AnimationDocumentMigrationReport = {
    warnings: [],
    conflicts: [],
    missingSourcePaths: [],
  };
  const boundaries = new Set<number>([0]);
  let maxTick = 0;

  for (const track of tracks) {
    const sortedAssets = [...track.assets].sort((a, b) => a.startFrame - b.startFrame);
    let previousEnd = 0;
    for (const asset of sortedAssets) {
      const duration = Math.max(1, asset.durationFrames);
      const end = asset.startFrame + duration;
      boundaries.add(asset.startFrame);
      boundaries.add(end);
      maxTick = Math.max(maxTick, end);
      if (asset.startFrame < previousEnd) {
        report.conflicts.push(
          `Track ${track.id} has overlapping asset ${asset.id} at tick ${asset.startFrame}`,
        );
      }
      previousEnd = Math.max(previousEnd, end);
      if (!asset.sourcePath) report.missingSourcePaths.push(asset.id);
    }
  }

  boundaries.add(maxTick);
  const orderedBoundaries = [...boundaries]
    .filter((tick) => Number.isInteger(tick) && tick >= 0 && tick <= maxTick)
    .sort((a, b) => a - b);
  const steps: AnimationStep[] = [];
  for (let index = 0; index < orderedBoundaries.length - 1; index += 1) {
    const start = orderedBoundaries[index];
    const end = orderedBoundaries[index + 1];
    if (end > start) {
      steps.push({
        id: `legacy-step-${start}`,
        order: steps.length,
        durationTicks: end - start,
      });
    }
  }
  if (steps.length === 0) {
    steps.push({ id: "legacy-step-0", order: 0, durationTicks: 1 });
  }

  const materialByPath = new Map<string, Material>();
  const contentByPath = new Map<string, ContentRevision>();
  const usedMaterialIds = new Set(existingDocument?.materials.map((material) => material.id));
  const usedContentIds = new Set(
    existingDocument?.contentRevisions.map((content) => content.id),
  );
  const existingMaterials = new Map(
    existingDocument?.materials.map((material) => [material.id, material]),
  );
  for (const content of existingDocument?.contentRevisions ?? []) {
    const material = existingMaterials.get(content.materialId);
    if (!material) continue;
    materialByPath.set(content.sourcePath, material);
    contentByPath.set(content.sourcePath, content);
  }
  for (const material of existingDocument?.materials ?? []) {
    if (!materialByPath.has(material.sourcePath)) {
      materialByPath.set(material.sourcePath, material);
    }
  }
  const cels: AnimationCel[] = [];

  for (const track of tracks) {
    for (const step of steps) {
      const stepStart = Number(step.id.slice("legacy-step-".length));
      const matching = track.assets.filter((asset) => assetCoversTick(asset, stepStart));
      if (matching.length > 1) {
        report.conflicts.push(
          `Track ${track.id} has ${matching.length} assets at tick ${stepStart}`,
        );
      }
      const asset = matching[matching.length - 1];
      if (!asset) continue;
      const content = createMaterial(
        asset,
        materialByPath,
        contentByPath,
        createdAt,
        usedMaterialIds,
        usedContentIds,
      );
      cels.push({
        id: asset.documentCelId ?? `legacy-cel-${asset.id}-${step.id}`,
        layerId: track.id,
        stepId: step.id,
        contentRevisionId: content.id,
        transform: {
          x: asset.transformX + asset.alignmentDx,
          y: asset.transformY + asset.alignmentDy,
          scaleX: asset.transformScaleX,
          scaleY: asset.transformScaleY,
          rotationDegrees: asset.transformRotation,
        },
      });
    }
  }

  const animation: AnimationSequence = {
    id: "legacy-animation-main",
    name: "Main",
    direction: null,
    fps: project.fps,
    playbackMode: "loop",
    steps,
    layers: tracks.map((track) => ({
      id: track.id,
      name: track.name,
      order: track.trackOrder,
      visible: track.visible,
      locked: track.locked,
      opacity: track.opacity,
    })),
    cels,
  };
  const document: AnimationDocument = {
    schemaVersion: ANIMATION_DOCUMENT_SCHEMA_VERSION,
    projectId: project.id,
    revision: 0,
    canvas: {
      width: project.canvasWidth,
      height: project.canvasHeight,
      originX: Math.floor(project.canvasWidth / 2),
      originY: Math.floor(project.canvasHeight / 2),
    },
    palette: existingDocument?.palette ?? [],
    materials: [
      ...new Map(
        [...(existingDocument?.materials ?? []), ...materialByPath.values()].map((material) => [
          material.id,
          material,
        ]),
      ).values(),
    ],
    contentRevisions: [
      ...new Map(
        [
          ...(existingDocument?.contentRevisions ?? []),
          ...contentByPath.values(),
        ].map((content) => [content.id, content]),
      ).values(),
    ],
    animations: [animation],
  };
  report.warnings.push(...validateAnimationDocument(document));
  return { document, report };
}

export function getAnimationDurationTicks(animation: AnimationSequence) {
  return animation.steps.reduce((total, step) => total + step.durationTicks, 0);
}

export function resolveAnimationStep(animation: AnimationSequence, requestedTick: number) {
  const duration = getAnimationDurationTicks(animation);
  if (duration <= 0) return null;
  assertFinite(requestedTick, "requestedTick");

  let tick = Math.max(0, Math.floor(requestedTick));
  if (animation.playbackMode === "loop") {
    tick %= duration;
  } else {
    tick = Math.min(tick, duration - 1);
  }

  let cursor = 0;
  for (const step of [...animation.steps].sort((a, b) => a.order - b.order)) {
    const end = cursor + step.durationTicks;
    if (tick >= cursor && tick < end) {
      return { step, tick, localTick: tick - cursor, startTick: cursor, endTick: end };
    }
    cursor = end;
  }
  return null;
}

export function evaluateAnimation(
  document: AnimationDocument,
  animationId: string,
  tick: number,
): EvaluatedLayer[] {
  const animation = findAnimation(document, animationId);
  const resolved = resolveAnimationStep(animation, tick);
  if (!resolved) return [];
  const contents = new Map(document.contentRevisions.map((content) => [content.id, content]));

  return [...animation.layers]
    .filter((layer) => layer.visible)
    .sort((a, b) => a.order - b.order)
    .flatMap((layer) => {
      const cel = animation.cels.find(
        (candidate) => candidate.layerId === layer.id && candidate.stepId === resolved.step.id,
      );
      if (!cel) return [];
      const content = contents.get(cel.contentRevisionId);
      return content ? [{ layer, cel, content }] : [];
    });
}

export function applyAnimationDocumentCommand(
  document: AnimationDocument,
  command: AnimationDocumentCommand,
): AppliedAnimationDocumentCommand {
  if (command.type === "replace_document") {
    if (command.document.projectId !== document.projectId) {
      throw new Error("Replacement document belongs to another project");
    }
    const validationErrors = validateAnimationDocument(command.document);
    if (validationErrors.length > 0) {
      throw new Error(`Replacement document is invalid: ${validationErrors.join("; ")}`);
    }
    return {
      document: { ...command.document, revision: document.revision + 1 },
      inverse: { type: "replace_document", document },
    };
  }

  const animation = findAnimation(document, command.animationId);

  if (command.type === "move_cel") {
    assertFinite(command.x, "x");
    assertFinite(command.y, "y");
    const cel = animation.cels.find((candidate) => candidate.id === command.celId);
    if (!cel) throw new Error(`Cel not found: ${command.celId}`);
    const layer = animation.layers.find((candidate) => candidate.id === cel.layerId);
    if (layer?.locked) throw new Error(`Layer is locked: ${layer.id}`);
    return {
      document: replaceAnimation(document, animation.id, (current) => ({
        ...current,
        cels: current.cels.map((candidate) =>
          candidate.id === cel.id
            ? { ...candidate, transform: { ...candidate.transform, x: command.x, y: command.y } }
            : candidate,
        ),
      })),
      inverse: {
        type: "move_cel",
        animationId: animation.id,
        celId: cel.id,
        x: cel.transform.x,
        y: cel.transform.y,
      },
    };
  }

  if (command.type === "set_cel_transform") {
    for (const [label, value] of Object.entries(command.transform)) {
      assertFinite(value, label);
    }
    const cel = animation.cels.find((candidate) => candidate.id === command.celId);
    if (!cel) throw new Error(`Cel not found: ${command.celId}`);
    const layer = animation.layers.find((candidate) => candidate.id === cel.layerId);
    if (layer?.locked) throw new Error(`Layer is locked: ${layer.id}`);
    return {
      document: replaceAnimation(document, animation.id, (current) => ({
        ...current,
        cels: current.cels.map((candidate) =>
          candidate.id === cel.id
            ? { ...candidate, transform: { ...command.transform } }
            : candidate,
        ),
      })),
      inverse: {
        type: "set_cel_transform",
        animationId: animation.id,
        celId: cel.id,
        transform: { ...cel.transform },
      },
    };
  }

  if (command.type === "set_cel_transforms") {
    if (command.entries.length === 0) {
      throw new Error("Batch cel transform requires at least one entry");
    }
    const seenCelIds = new Set<string>();
    const previousEntries: Array<{ celId: string; transform: CelTransform }> = [];
    for (const entry of command.entries) {
      if (seenCelIds.has(entry.celId)) {
        throw new Error(`Duplicate cel in batch transform: ${entry.celId}`);
      }
      seenCelIds.add(entry.celId);
      for (const [label, value] of Object.entries(entry.transform)) {
        assertFinite(value, label);
      }
      const cel = animation.cels.find((candidate) => candidate.id === entry.celId);
      if (!cel) throw new Error(`Cel not found: ${entry.celId}`);
      const layer = animation.layers.find((candidate) => candidate.id === cel.layerId);
      if (layer?.locked) throw new Error(`Layer is locked: ${layer.id}`);
      previousEntries.push({ celId: cel.id, transform: { ...cel.transform } });
    }
    const transforms = new Map(
      command.entries.map((entry) => [entry.celId, entry.transform]),
    );
    return {
      document: replaceAnimation(document, animation.id, (current) => ({
        ...current,
        cels: current.cels.map((candidate) => {
          const transform = transforms.get(candidate.id);
          return transform ? { ...candidate, transform: { ...transform } } : candidate;
        }),
      })),
      inverse: {
        type: "set_cel_transforms",
        animationId: animation.id,
        entries: previousEntries,
      },
    };
  }

  if (command.type === "move_cel_to_step") {
    const cel = animation.cels.find((candidate) => candidate.id === command.celId);
    if (!cel) throw new Error(`Cel not found: ${command.celId}`);
    if (!animation.steps.some((step) => step.id === command.stepId)) {
      throw new Error(`Step not found: ${command.stepId}`);
    }
    const layer = animation.layers.find((candidate) => candidate.id === cel.layerId);
    if (layer?.locked) throw new Error(`Layer is locked: ${layer.id}`);
    const occupant = animation.cels.find(
      (candidate) =>
        candidate.id !== cel.id &&
        candidate.layerId === cel.layerId &&
        candidate.stepId === command.stepId,
    );
    return {
      document: replaceAnimation(document, animation.id, (current) => ({
        ...current,
        cels: current.cels.map((candidate) => {
          if (candidate.id === cel.id) return { ...candidate, stepId: command.stepId };
          if (occupant && candidate.id === occupant.id) {
            return { ...candidate, stepId: cel.stepId };
          }
          return candidate;
        }),
      })),
      inverse: {
        type: "move_cel_to_step",
        animationId: animation.id,
        celId: cel.id,
        stepId: cel.stepId,
      },
    };
  }

  if (command.type === "update_layer") {
    const layer = animation.layers.find((candidate) => candidate.id === command.layerId);
    if (!layer) throw new Error(`Layer not found: ${command.layerId}`);
    if (!Number.isFinite(command.opacity) || command.opacity < 0 || command.opacity > 1) {
      throw new Error("opacity must be between 0 and 1");
    }
    return {
      document: replaceAnimation(document, animation.id, (current) => ({
        ...current,
        layers: current.layers.map((candidate) =>
          candidate.id === layer.id
            ? {
                ...candidate,
                name: command.name,
                visible: command.visible,
                locked: command.locked,
                opacity: command.opacity,
              }
            : candidate,
        ),
      })),
      inverse: {
        type: "update_layer",
        animationId: animation.id,
        layerId: layer.id,
        name: layer.name,
        visible: layer.visible,
        locked: layer.locked,
        opacity: layer.opacity,
      },
    };
  }

  if (command.type === "set_step_duration") {
    if (!Number.isInteger(command.durationTicks) || command.durationTicks <= 0) {
      throw new Error("durationTicks must be a positive integer");
    }
    const step = animation.steps.find((candidate) => candidate.id === command.stepId);
    if (!step) throw new Error(`Step not found: ${command.stepId}`);
    return {
      document: replaceAnimation(document, animation.id, (current) => ({
        ...current,
        steps: current.steps.map((candidate) =>
          candidate.id === step.id
            ? { ...candidate, durationTicks: command.durationTicks }
            : candidate,
        ),
      })),
      inverse: {
        type: "set_step_duration",
        animationId: animation.id,
        stepId: step.id,
        durationTicks: step.durationTicks,
      },
    };
  }

  if (command.type === "delete_cel") {
    const cel = animation.cels.find((candidate) => candidate.id === command.celId);
    if (!cel) throw new Error(`Cel not found: ${command.celId}`);
    const layer = animation.layers.find((candidate) => candidate.id === cel.layerId);
    if (layer?.locked) throw new Error(`Layer is locked: ${layer.id}`);
    return {
      document: replaceAnimation(document, animation.id, (current) => ({
        ...current,
        cels: current.cels.filter((candidate) => candidate.id !== cel.id),
      })),
      inverse: { type: "restore_cel", animationId: animation.id, cel },
    };
  }

  if (command.type === "set_cel_content") {
    const cel = animation.cels.find((candidate) => candidate.id === command.celId);
    if (!cel) throw new Error(`Cel not found: ${command.celId}`);
    const layer = animation.layers.find((candidate) => candidate.id === cel.layerId);
    if (layer?.locked) throw new Error(`Layer is locked: ${layer.id}`);
    const previousContent = document.contentRevisions.find(
      (candidate) => candidate.id === cel.contentRevisionId,
    );
    if (!previousContent) {
      throw new Error(`Content revision not found: ${cel.contentRevisionId}`);
    }
    if (
      command.contentRevision.materialId !== previousContent.materialId ||
      !command.contentRevision.sourcePath ||
      !Number.isInteger(command.contentRevision.width) ||
      command.contentRevision.width <= 0 ||
      !Number.isInteger(command.contentRevision.height) ||
      command.contentRevision.height <= 0
    ) {
      throw new Error("Content revision is invalid or belongs to another material");
    }
    const existing = document.contentRevisions.find(
      (candidate) => candidate.id === command.contentRevision.id,
    );
    if (
      existing &&
      (existing.materialId !== command.contentRevision.materialId ||
        existing.sourcePath !== command.contentRevision.sourcePath)
    ) {
      throw new Error(`Content revision id collision: ${command.contentRevision.id}`);
    }
    return {
      document: {
        ...document,
        revision: document.revision + 1,
        contentRevisions: existing
          ? document.contentRevisions
          : [...document.contentRevisions, command.contentRevision],
        animations: document.animations.map((candidate) =>
          candidate.id === animation.id
            ? {
                ...candidate,
                cels: candidate.cels.map((candidateCel) =>
                  candidateCel.id === cel.id
                    ? {
                        ...candidateCel,
                        contentRevisionId: command.contentRevision.id,
                      }
                    : candidateCel,
                ),
              }
            : candidate,
        ),
      },
      inverse: {
        type: "set_cel_content",
        animationId: animation.id,
        celId: cel.id,
        contentRevision: previousContent,
      },
    };
  }

  if (animation.cels.some((candidate) => candidate.id === command.cel.id)) {
    throw new Error(`Cel already exists: ${command.cel.id}`);
  }
  return {
    document: replaceAnimation(document, animation.id, (current) => ({
      ...current,
      cels: [...current.cels, command.cel],
    })),
    inverse: {
      type: "delete_cel",
      animationId: animation.id,
      celId: command.cel.id,
    },
  };
}

export function animationDocumentToTracks(document: AnimationDocument): Track[] {
  const animation = document.animations[0];
  if (!animation) return [];
  const contents = new Map(document.contentRevisions.map((content) => [content.id, content]));
  const materials = new Map(document.materials.map((material) => [material.id, material]));
  const orderedSteps = [...animation.steps].sort((a, b) => a.order - b.order);
  const stepStarts = new Map<string, number>();
  let startFrame = 0;
  for (const step of orderedSteps) {
    stepStarts.set(step.id, startFrame);
    startFrame += step.durationTicks;
  }

  return [...animation.layers]
    .sort((a, b) => a.order - b.order)
    .map((layer) => ({
      id: layer.id,
      projectId: document.projectId,
      name: layer.name,
      trackType: "image_sequence",
      visible: layer.visible,
      locked: layer.locked,
      opacity: layer.opacity,
      trackOrder: layer.order,
      assets: animation.cels
        .filter((cel) => cel.layerId === layer.id)
        .flatMap((cel): Asset[] => {
          const step = animation.steps.find((candidate) => candidate.id === cel.stepId);
          const content = contents.get(cel.contentRevisionId);
          if (!step || !content) return [];
          const material = materials.get(content.materialId);
          return [
            {
              id: cel.id,
              trackId: layer.id,
              name: material?.name ?? cel.id,
              sourceType: "image",
              sourcePath: content.sourcePath,
              thumbnailPath: content.sourcePath,
              startFrame: stepStarts.get(step.id) ?? 0,
              durationFrames: step.durationTicks,
              width: content.width,
              height: content.height,
              transformX: cel.transform.x,
              transformY: cel.transform.y,
              transformScaleX: cel.transform.scaleX,
              transformScaleY: cel.transform.scaleY,
              transformRotation: cel.transform.rotationDegrees,
              alignmentDx: 0,
              alignmentDy: 0,
              matchedFps: true,
              sourceTimestamp: 0,
              documentCelId: cel.id,
            },
          ];
        })
        .sort((a, b) => a.startFrame - b.startFrame),
    }));
}

export function animationDocumentToTimelineState(document: AnimationDocument) {
  const animation = document.animations[0];
  return {
    tracks: animationDocumentToTracks(document),
    totalFrames: animation ? getAnimationDurationTicks(animation) : 0,
    fps: animation?.fps ?? 0,
  };
}

export function insertAnimationStep(
  document: AnimationDocument,
  animationId: string,
  step: AnimationStep,
  beforeStepId: string | null,
) {
  if (!Number.isInteger(step.durationTicks) || step.durationTicks <= 0) {
    throw new Error("durationTicks must be a positive integer");
  }
  const animation = findAnimation(document, animationId);
  if (animation.steps.some((candidate) => candidate.id === step.id)) {
    throw new Error(`Step already exists: ${step.id}`);
  }
  const ordered = [...animation.steps].sort((a, b) => a.order - b.order);
  const beforeIndex =
    beforeStepId === null
      ? ordered.length
      : ordered.findIndex((candidate) => candidate.id === beforeStepId);
  if (beforeIndex < 0) throw new Error(`Step not found: ${beforeStepId}`);
  ordered.splice(beforeIndex, 0, step);
  return {
    ...document,
    animations: document.animations.map((candidate) =>
      candidate.id === animationId
        ? {
            ...candidate,
            steps: ordered.map((candidateStep, order) => ({
              ...candidateStep,
              order,
            })),
          }
        : candidate,
    ),
  };
}

export function duplicateCelWithStep(
  document: AnimationDocument,
  animationId: string,
  celId: string,
  newStepId: string,
  newCelId: string,
) {
  const animation = findAnimation(document, animationId);
  const cel = animation.cels.find((candidate) => candidate.id === celId);
  if (!cel) throw new Error(`Cel not found: ${celId}`);
  const layer = animation.layers.find((candidate) => candidate.id === cel.layerId);
  if (layer?.locked) throw new Error(`Layer is locked: ${layer.id}`);
  const ordered = [...animation.steps].sort((a, b) => a.order - b.order);
  const sourceIndex = ordered.findIndex((candidate) => candidate.id === cel.stepId);
  if (sourceIndex < 0) throw new Error(`Step not found: ${cel.stepId}`);
  const sourceStep = ordered[sourceIndex];
  const beforeStepId = ordered[sourceIndex + 1]?.id ?? null;
  const withStep = insertAnimationStep(
    document,
    animationId,
    {
      id: newStepId,
      order: sourceIndex + 1,
      durationTicks: sourceStep.durationTicks,
    },
    beforeStepId,
  );
  return {
    ...withStep,
    animations: withStep.animations.map((candidate) =>
      candidate.id === animationId
        ? {
            ...candidate,
            cels: [
              ...candidate.cels,
              {
                ...cel,
                id: newCelId,
                stepId: newStepId,
                transform: { ...cel.transform },
              },
            ],
          }
        : candidate,
    ),
  };
}
