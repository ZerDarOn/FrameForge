use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FrameDisplacement {
    pub frame_index: i64,
    pub dx: f64,
    pub dy: f64,
    pub magnitude: f64,
    pub severity: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FlickerFrame {
    pub frame_index: i64,
    pub score: f64,
    pub severity: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ConsistencyResult {
    pub score: f64,
    pub description: String,
    pub frame_range: (i64, i64),
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AiSuggestion {
    pub frame_index: i64,
    pub issue_type: String,
    pub description: String,
    pub suggestion: String,
    pub confidence: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisReport {
    pub id: String,
    pub project_id: String,
    pub track_id: String,
    pub analyzed_at: i64,
    pub total_frames: i64,
    pub displacement: Vec<FrameDisplacement>,
    pub flicker_frames: Vec<FlickerFrame>,
    pub consistency_score: f64,
    pub suggestions: Vec<AiSuggestion>,
}

pub struct ImageInput {
    pub path: String,
    pub data: Vec<u8>,
    pub width: u32,
    pub height: u32,
}

pub trait AnalysisProvider: Send + Sync {
    fn detect_displacement(
        &self,
        frames: &[ImageInput],
    ) -> Result<Vec<FrameDisplacement>, String>;

    fn detect_flicker(
        &self,
        frames: &[ImageInput],
    ) -> Result<Vec<FlickerFrame>, String>;

    fn check_consistency(
        &self,
        frames: &[ImageInput],
    ) -> Result<ConsistencyResult, String>;

    fn generate_suggestions(
        &self,
        issues: &[(i64, String, String)],
    ) -> Result<Vec<AiSuggestion>, String>;
}
