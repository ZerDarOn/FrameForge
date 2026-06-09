export interface TextToPixelParams {
  prompt: string;
  negativePrompt?: string;
  style: string;
  width: number;
  height: number;
  palette?: string[];
  seed?: number;
  numVariants: number;
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
