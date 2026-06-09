use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BaselinePoint {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub point_type: String,
    pub coordinates: Vec<f64>,
    pub frame_index: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub canvas_width: i64,
    pub canvas_height: i64,
    pub fps: i64,
    pub created_at: i64,
    pub updated_at: i64,
    #[serde(default)]
    pub baseline_points: Vec<BaselinePoint>,
}
