export type ProviderType = "LocalOnnx" | "OpenAi" | "StabilityAi" | "LocalDiffusion" | "ComfyUi" | "CustomApi";

export type Capability =
  | "DisplacementDetection"
  | "FlickerDetection"
  | "ConsistencyCheck"
  | "SuggestionGeneration"
  | "TextToPixel"
  | "ImageToPixel"
  | "BatchGeneration";

export interface ProviderConfig {
  id: string;
  name: string;
  providerType: ProviderType;
  enabled: boolean;
  capabilities: Capability[];
  config: Record<string, unknown>;
}

export interface AiConfig {
  providers: ProviderConfig[];
  defaultAnalysisProvider: string;
  defaultGenerationProvider: string;
  apiKeys: Record<string, string>;
}
