export interface FrameDisplacement {
  frameIndex: number;
  dx: number;
  dy: number;
  magnitude: number;
  severity: "low" | "medium" | "high";
}

export interface FlickerFrame {
  frameIndex: number;
  score: number;
  severity: "low" | "medium" | "high";
}

export interface AiSuggestion {
  frameIndex: number;
  issueType: string;
  description: string;
  suggestion: string;
  confidence: number;
}

export interface AnalysisReport {
  id: string;
  projectId: string;
  trackId: string;
  analyzedAt: number;
  totalFrames: number;
  displacement: FrameDisplacement[];
  flickerFrames: FlickerFrame[];
  consistencyScore: number;
  suggestions: AiSuggestion[];
}
