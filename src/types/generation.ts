export interface TextToPixelParams {
  prompt: string;
  negativePrompt?: string;
  style: string;
  width: number;
  height: number;
  palette?: string[];
  seed?: number;
  numVariants: number;
  provider?: string;
}

export interface GeneratedAsset {
  id: string;
  projectId: string;
  name: string;
  assetType: string;
  prompt: string;
  negativePrompt?: string;
  style: string;
  width: number;
  height: number;
  palette?: string[];
  seed?: number;
  provider: string;
  filePath: string;
  thumbnailPath: string;
  createdAt: number;
  metadata?: Record<string, unknown>;
}

export type GenerationJobStatus = "running" | "cancelling" | "cancelled" | "failed" | "completed";

export interface GenerationProgress {
  jobId: string;
  projectId: string;
  stage: "generating" | "done" | "cancelled";
  current: number;
  total: number;
}

export interface GenerationJob {
  id: string;
  projectId: string;
  params: TextToPixelParams;
  status: GenerationJobStatus;
  progress: GenerationProgress | null;
  error: string | null;
}
