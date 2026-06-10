use crate::ai::config::ProviderConfig;
use crate::ai::providers::{AiSuggestion, ConsistencyResult};

/// 调用 OpenAI GPT-4V 进行一致性检查
pub fn check_consistency_openai(
    provider_config: &ProviderConfig,
    api_key: &str,
    frames_b64: &[String],
) -> Result<ConsistencyResult, String> {
    let base_url = provider_config.config.get("baseUrl")
        .and_then(|v| v.as_str())
        .unwrap_or("https://api.openai.com/v1")
        .to_string();

    let model = provider_config.config.get("model")
        .and_then(|v| v.as_str())
        .unwrap_or("gpt-4o")
        .to_string();

    // 最多检查 10 帧
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
    let response = client
        .post(format!("{}/chat/completions", base_url))
        .header("Authorization", format!("Bearer {}", api_key))
        .json(&serde_json::json!({
            "model": model,
            "messages": [{
                "role": "user",
                "content": content
            }],
            "max_tokens": 500,
            "temperature": 0.3
        }))
        .send()
        .map_err(|e| format!("OpenAI API 请求失败: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().unwrap_or_default();
        return Err(format!("OpenAI API 返回错误 {}: {}", status, body));
    }

    let json: serde_json::Value = response.json()
        .map_err(|e| format!("解析响应失败: {}", e))?;

    let reply = json["choices"][0]["message"]["content"]
        .as_str()
        .unwrap_or("{}");

    // 尝试解析 JSON 回复
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
    issues: &[(i64, String, String)], // (frame_index, issue_type, description)
) -> Result<Vec<AiSuggestion>, String> {
    let base_url = provider_config.config.get("baseUrl")
        .and_then(|v| v.as_str())
        .unwrap_or("https://api.openai.com/v1")
        .to_string();

    let model = provider_config.config.get("model")
        .and_then(|v| v.as_str())
        .unwrap_or("gpt-4o")
        .to_string();

    let issues_text: Vec<String> = issues.iter()
        .map(|(idx, itype, desc)| format!("帧 {}: [{}] {}", idx, itype, desc))
        .collect();

    let client = reqwest::blocking::Client::new();
    let response = client
        .post(format!("{}/chat/completions", base_url))
        .header("Authorization", format!("Bearer {}", api_key))
        .json(&serde_json::json!({
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
        }))
        .send()
        .map_err(|e| format!("OpenAI API 请求失败: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().unwrap_or_default();
        return Err(format!("OpenAI API 返回错误 {}: {}", status, body));
    }

    let json: serde_json::Value = response.json()
        .map_err(|e| format!("解析响应失败: {}", e))?;

    let reply = json["choices"][0]["message"]["content"]
        .as_str()
        .unwrap_or("[]");

    let suggestions: Vec<AiSuggestion> = serde_json::from_str(reply).unwrap_or_default();

    Ok(suggestions)
}
