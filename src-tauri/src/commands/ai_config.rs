use crate::ai::config::AiConfigState;
use crate::ai::AiConfig;
use std::collections::HashMap;
use tauri::State;

/// 返回给前端的配置视图——api_keys 中的真实值被脱敏为 "configured"/""
/// 前端永远不应获取到真实 API Key
#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AiConfigView {
    pub providers: Vec<crate::ai::config::ProviderConfig>,
    pub default_analysis_provider: String,
    pub default_generation_provider: String,
    /// key 为 provider_id，value 为 "configured"（已配置）或 ""（未配置）
    pub api_keys: HashMap<String, String>,
}

fn mask_api_key(real_key: &str) -> String {
    if real_key.is_empty() {
        String::new()
    } else {
        "configured".to_string()
    }
}

#[tauri::command]
pub fn get_ai_config(config: State<'_, AiConfig>) -> Result<AiConfigView, String> {
    let cfg = config.lock().map_err(|e| format!("配置锁失败: {}", e))?;
    let masked_keys: HashMap<String, String> = cfg
        .api_keys
        .iter()
        .map(|(k, v)| (k.clone(), mask_api_key(v)))
        .collect();

    Ok(AiConfigView {
        providers: cfg.providers.clone(),
        default_analysis_provider: cfg.default_analysis_provider.clone(),
        default_generation_provider: cfg.default_generation_provider.clone(),
        api_keys: masked_keys,
    })
}

#[tauri::command]
pub fn set_ai_api_key(
    config: State<'_, AiConfig>,
    provider_id: String,
    key: String,
) -> Result<(), String> {
    let mut cfg = config.lock().map_err(|e| format!("配置锁失败: {}", e))?;
    cfg.api_keys.insert(provider_id, key);
    Ok(())
}

#[tauri::command]
pub fn toggle_ai_provider(
    config: State<'_, AiConfig>,
    provider_id: String,
) -> Result<AiConfigState, String> {
    let mut cfg = config.lock().map_err(|e| format!("配置锁失败: {}", e))?;
    for p in &mut cfg.providers {
        if p.id == provider_id {
            p.enabled = !p.enabled;
            break;
        }
    }
    Ok(cfg.clone())
}

#[tauri::command]
pub fn set_default_ai_provider(
    config: State<'_, AiConfig>,
    provider_type: String,
    provider_id: String,
) -> Result<AiConfigState, String> {
    let mut cfg = config.lock().map_err(|e| format!("配置锁失败: {}", e))?;
    if provider_type == "analysis" {
        cfg.default_analysis_provider = provider_id;
    } else {
        cfg.default_generation_provider = provider_id;
    }
    Ok(cfg.clone())
}
