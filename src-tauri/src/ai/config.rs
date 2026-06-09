use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProviderConfig {
    pub id: String,
    pub name: String,
    pub provider_type: String,
    pub enabled: bool,
    pub capabilities: Vec<String>,
    pub config: serde_json::Value,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AiConfigState {
    pub providers: Vec<ProviderConfig>,
    pub default_analysis_provider: String,
    pub default_generation_provider: String,
    pub api_keys: HashMap<String, String>,
}

impl Default for AiConfigState {
    fn default() -> Self {
        Self {
            providers: vec![
                ProviderConfig {
                    id: "local-onnx".to_string(),
                    name: "本地 ONNX".to_string(),
                    provider_type: "LocalOnnx".to_string(),
                    enabled: true,
                    capabilities: vec![
                        "DisplacementDetection".to_string(),
                        "FlickerDetection".to_string(),
                    ],
                    config: serde_json::json!({}),
                },
                ProviderConfig {
                    id: "openai".to_string(),
                    name: "OpenAI".to_string(),
                    provider_type: "OpenAi".to_string(),
                    enabled: false,
                    capabilities: vec![
                        "ConsistencyCheck".to_string(),
                        "SuggestionGeneration".to_string(),
                        "TextToPixel".to_string(),
                    ],
                    config: serde_json::json!({
                        "model": "gpt-4o",
                        "baseUrl": "https://api.openai.com/v1"
                    }),
                },
                ProviderConfig {
                    id: "stability".to_string(),
                    name: "Stability AI".to_string(),
                    provider_type: "StabilityAi".to_string(),
                    enabled: false,
                    capabilities: vec![
                        "TextToPixel".to_string(),
                        "ImageToPixel".to_string(),
                    ],
                    config: serde_json::json!({
                        "engine": "stable-diffusion-xl-1.0",
                        "baseUrl": "https://api.stability.ai/v1"
                    }),
                },
            ],
            default_analysis_provider: "local-onnx".to_string(),
            default_generation_provider: "openai".to_string(),
            api_keys: HashMap::new(),
        }
    }
}
