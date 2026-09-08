use crate::ai::config::ProviderConfig;
use crate::ai::providers::{AiSuggestion, ConsistencyResult};
use std::time::Duration;

const REQUEST_TIMEOUT_SECS: u64 = 60;
const MAX_RETRIES: u32 = 2;
const RETRY_DELAY_MS: u64 = 1000;

/// 公共 HTTP 请求逻辑：超时 + 重试
fn api_post(
    client: &reqwest::blocking::Client,
    url: &str,
    api_key: &str,
    body: serde_json::Value,
    request_label: &str,
) -> Result<serde_json::Value, String> {
    let mut last_err = String::new();

    for attempt in 0..=MAX_RETRIES {
        if attempt > 0 {
            log::warn!("{request_label} 第 {attempt} 次重试...");
            std::thread::sleep(Duration::from_millis(RETRY_DELAY_MS * attempt as u64));
        }

        let result = client
            .post(url)
            .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
            .header("Authorization", format!("Bearer {}", api_key))
            .json(&body)
            .send();

        let response = match result {
            Ok(r) => r,
            Err(e) => {
                last_err = format!("{request_label} 请求失败: {e}");
                // 超时不重试
                if e.is_timeout() {
                    return Err(format!(
                        "{request_label} 请求超时 (>{REQUEST_TIMEOUT_SECS}s)"
                    ));
                }
                if attempt < MAX_RETRIES {
                    continue;
                }
                return Err(last_err);
            }
        };

        // 服务端错误（5xx）重试，客户端错误（4xx）不重试
        if response.status().is_server_error() && attempt < MAX_RETRIES {
            last_err = format!("{request_label} 服务端错误 {}，将重试", response.status());
            continue;
        }

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().unwrap_or_default();
            return Err(format!("{request_label} API 返回错误 {status}: {body}"));
        }

        return response
            .json()
            .map_err(|e| format!("{request_label} 解析响应失败: {e}"));
    }

    Err(last_err)
}

/// 调用 OpenAI GPT-4V 进行一致性检查
pub fn check_consistency_openai(
    provider_config: &ProviderConfig,
    api_key: &str,
    frames_b64: &[String],
) -> Result<ConsistencyResult, String> {
    let base_url = provider_config
        .config
        .get("baseUrl")
        .and_then(|v| v.as_str())
        .unwrap_or("https://api.openai.com/v1")
        .to_string();

    let model = provider_config
        .config
        .get("model")
        .and_then(|v| v.as_str())
        .unwrap_or("gpt-4o")
        .to_string();

    let frame_subset: Vec<&String> = frames_b64.iter().take(10).collect();

    let mut content = vec![serde_json::json!({
        "type": "text",
        "text": "你是动画帧审查专家。请分析以下连续帧的像素画角色一致性。检查：1) 角色形状/比例是否一致 2) 颜色是否一致 3) 是否有突然变化。请以 JSON 格式回复：{\"score\": 0-100, \"description\": \"描述\"}"
    })];

    for frame in frame_subset {
        content.push(serde_json::json!({
            "type": "image_url",
            "image_url": {
                "url": format!("data:image/png;base64,{}", frame)
            }
        }));
    }

    let client = reqwest::blocking::Client::new();
    let json = api_post(
        &client,
        &format!("{}/chat/completions", base_url),
        api_key,
        serde_json::json!({
            "model": model,
            "messages": [{"role": "user", "content": content}],
            "max_tokens": 500,
            "temperature": 0.3
        }),
        "一致性检查",
    )?;

    let reply = json["choices"][0]["message"]["content"]
        .as_str()
        .unwrap_or("{}");

    let parsed: serde_json::Value = serde_json::from_str(reply).unwrap_or(serde_json::json!({}));

    Ok(ConsistencyResult {
        score: parsed["score"].as_f64().unwrap_or(50.0),
        description: parsed["description"].as_str().unwrap_or(reply).to_string(),
        frame_range: (0, frames_b64.len() as i64),
    })
}

/// 调用 OpenAI 生成修复建议
pub fn generate_suggestions_openai(
    provider_config: &ProviderConfig,
    api_key: &str,
    issues: &[(i64, String, String)],
) -> Result<Vec<AiSuggestion>, String> {
    let base_url = provider_config
        .config
        .get("baseUrl")
        .and_then(|v| v.as_str())
        .unwrap_or("https://api.openai.com/v1")
        .to_string();

    let model = provider_config
        .config
        .get("model")
        .and_then(|v| v.as_str())
        .unwrap_or("gpt-4o")
        .to_string();

    let issues_text: Vec<String> = issues
        .iter()
        .map(|(idx, itype, desc)| format!("帧 {}: [{}] {}", idx, itype, desc))
        .collect();

    let client = reqwest::blocking::Client::new();
    let json = api_post(
        &client,
        &format!("{}/chat/completions", base_url),
        api_key,
        serde_json::json!({
            "model": model,
            "messages": [{
                "role": "user",
                "content": format!(
                    "你是动画帧审查专家。以下是检测到的问题：\n{}\n\n请为每个问题提供修复建议。以 JSON 数组格式回复：[{{\"frameIndex\": N, \"issueType\": \"...\", \"description\": \"...\", \"suggestion\": \"...\", \"confidence\": 0.0-1.0}}]",
                    issues_text.join("\n")
                )
            }],
            "max_tokens": 1000,
            "temperature": 0.3
        }),
        "建议生成",
    )?;

    let reply = json["choices"][0]["message"]["content"]
        .as_str()
        .unwrap_or("[]");

    let suggestions: Vec<AiSuggestion> = serde_json::from_str(reply).unwrap_or_default();

    Ok(suggestions)
}
