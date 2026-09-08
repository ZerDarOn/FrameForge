export const ANIMATION_DOCUMENT_SCHEMA_VERSION = 1;

export type AnimationPlaybackMode = "loop" | "once" | "ping_pong";

export interface AnimationCanvas {
  width: number;
  height: number;
  originX: number;
  originY: number;
}

export interface Material {
  id: string;
  name: string;
  sourcePath: string;
}

export interface ContentRevision {
  id: string;
  materialId: string;
  sourcePath: string;
  width: number;
  height: number;
  createdAt: number;
}

export interface CelTransform {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotationDegrees: number;
}

export interface AnimationCel {
  id: string;
  layerId: string;
  stepId: string;
  contentRevisionId: string;
  transform: CelTransform;
}

export interface AnimationLayer {
  id: string;
  name: string;
  order: number;
  visible: boolean;
  locked: boolean;
  opacity: number;
}

export interface AnimationStep {
  id: string;
  order: number;
  durationTicks: number;
}

export interface AnimationSequence {
  id: string;
  name: string;
  direction: string | null;
  fps: number;
  playbackMode: AnimationPlaybackMode;
  steps: AnimationStep[];
  layers: AnimationLayer[];
  cels: AnimationCel[];
}

export interface AnimationDocument {
  schemaVersion: number;
  projectId: string;
  revision: number;
  canvas: AnimationCanvas;
  palette: string[];
  materials: Material[];
  contentRevisions: ContentRevision[];
  animations: AnimationSequence[];
}

export interface AnimationDocumentMigrationReport {
  warnings: string[];
  conflicts: string[];
  missingSourcePaths: string[];
}

export interface EvaluatedLayer {
  layer: AnimationLayer;
  cel: AnimationCel;
  content: ContentRevision;
}

export type AnimationDocumentCommand =
  | {
      type: "replace_document";
      document: AnimationDocument;
    }
  | {
      type: "move_cel";
      animationId: string;
      celId: string;
      x: number;
      y: number;
    }
  | {
      type: "set_cel_transform";
      animationId: string;
      celId: string;
      transform: CelTransform;
    }
  | {
      type: "set_cel_transforms";
      animationId: string;
      entries: Array<{ celId: string; transform: CelTransform }>;
    }
  | {
      type: "move_cel_to_step";
      animationId: string;
      celId: string;
      stepId: string;
    }
  | {
      type: "update_layer";
      animationId: string;
      layerId: string;
      name: string;
      visible: boolean;
      locked: boolean;
      opacity: number;
    }
  | {
      type: "set_step_duration";
      animationId: string;
      stepId: string;
      durationTicks: number;
    }
  | {
      type: "delete_cel";
      animationId: string;
      celId: string;
    }
  | {
      type: "set_cel_content";
      animationId: string;
      celId: string;
      contentRevision: ContentRevision;
    }
  | {
      type: "restore_cel";
      animationId: string;
      cel: AnimationCel;
    };
