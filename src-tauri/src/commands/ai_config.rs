use crate::ai::AiConfig;
use crate::ai::config::AiConfigState;
use tauri::State;

#[tauri::command]
pub fn get_ai_config(config: State<'_, AiConfig>) -> Result<AiConfigState, String> {
    let cfg = config.lock().map_err(|e| format!("配置锁失败: {}", e))?;
    Ok(cfg.clone())
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
