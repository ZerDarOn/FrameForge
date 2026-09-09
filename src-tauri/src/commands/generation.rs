use crate::ai::config::ProviderConfig;
use crate::ai::AiConfig;
use crate::db::DbState;
use base64::Engine;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};

const MAX_PROMPT_CHARS: usize = 2_000;
const MAX_GENERATION_DIMENSION: u32 = 1_024;
const MAX_VARIANTS: u32 = 4;
const GENERATION_CANCELLED: &str = "GENERATION_CANCELLED";

#[derive(Debug)]
struct GenerationJobRecord {
    project_id: String,
    cancelled: bool,
}

#[derive(Default)]
pub struct GenerationJobRegistry {
    jobs: Mutex<HashMap<String, GenerationJobRecord>>,
}

impl GenerationJobRegistry {
    fn register(&self, job_id: &str, project_id: &str) -> Result<(), String> {
        let mut jobs = self
            .jobs
            .lock()
            .map_err(|_| "生成任务状态锁失败".to_string())?;
        if jobs.contains_key(job_id) {
            return Err("生成任务 ID 已存在".to_string());
        }
        jobs.insert(
            job_id.to_string(),
            GenerationJobRecord {
                project_id: project_id.to_string(),
                cancelled: false,
            },
        );
        Ok(())
    }

    fn request_cancel(&self, job_id: &str, project_id: &str) -> Result<bool, String> {
        let mut jobs = self
            .jobs
            .lock()
            .map_err(|_| "生成任务状态锁失败".to_string())?;
        let Some(job) = jobs.get_mut(job_id) else {
            return Ok(false);
        };
        if job.project_id != project_id {
            return Ok(false);
        }
        job.cancelled = true;
        Ok(true)
    }

    fn ensure_active(&self, job_id: &str, project_id: &str) -> Result<(), String> {
        let jobs = self
            .jobs
            .lock()
            .map_err(|_| "生成任务状态锁失败".to_string())?;
        match jobs.get(job_id) {
            Some(job) if job.project_id == project_id && !job.cancelled => Ok(()),
            _ => Err(GENERATION_CANCELLED.to_string()),
        }
    }

    fn finish(&self, job_id: &str, project_id: &str) -> bool {
        let Ok(mut jobs) = self.jobs.lock() else {
            return false;
        };
        matches!(
            jobs.remove(job_id),
            Some(job) if job.project_id == project_id && !job.cancelled
        )
    }
}

fn validate_generation_request(
    db: &DbState,
    project_id: &str,
    params: &TextToPixelParams,
) -> Result<(), String> {
    let prompt_length = params.prompt.trim().chars().count();
    if prompt_length == 0 || prompt_length > MAX_PROMPT_CHARS {
        return Err(format!(
            "提示词长度必须在 1 到 {} 个字符之间",
            MAX_PROMPT_CHARS
        ));
    }
    if params.width == 0
        || params.height == 0
        || params.width > MAX_GENERATION_DIMENSION
        || params.height > MAX_GENERATION_DIMENSION
    {
        return Err(format!(
            "生成尺寸必须在 1 到 {} 像素之间",
            MAX_GENERATION_DIMENSION
        ));
    }
    if params.num_variants == 0 || params.num_variants > MAX_VARIANTS {
        return Err(format!("候选数量必须在 1 到 {} 之间", MAX_VARIANTS));
    }
    let conn = db.lock().map_err(|e| format!("数据库锁失败: {}", e))?;
    let project_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM projects WHERE id = ?1",
            params![project_id],
            |row| row.get(0),
        )
        .map_err(|e| format!("验证项目失败: {}", e))?;
    if project_count != 1 {
        return Err("项目不存在".to_string());
    }
    Ok(())
}

fn cleanup_generated_assets(db: &DbState, assets: &[GeneratedAsset]) {
    if let Ok(conn) = db.lock() {
        for asset in assets {
            let deleted = match conn.execute(
                "DELETE FROM generated_assets WHERE id = ?1 AND project_id = ?2",
                params![asset.id, asset.project_id],
            ) {
                Ok(_) => true,
                Err(error) => {
                    log::warn!(
                        "generated asset rollback database cleanup failed: asset_id={}, project_id={}, error={}",
                        asset.id,
                        asset.project_id,
                        error
                    );
                    false
                }
            };
            if !deleted {
                continue;
            }
            if let Err(error) = std::fs::remove_file(&asset.file_path) {
                if error.kind() != std::io::ErrorKind::NotFound {
                    log::warn!(
                        "generated asset rollback file cleanup failed: asset_id={}, project_id={}",
                        asset.id,
                        asset.project_id
                    );
                }
            }
            if let Err(error) = std::fs::remove_file(&asset.thumbnail_path) {
                if error.kind() != std::io::ErrorKind::NotFound {
                    log::warn!(
                        "generated asset rollback thumbnail cleanup failed: asset_id={}, project_id={}",
                        asset.id,
                        asset.project_id
                    );
                }
            }
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TextToPixelParams {
    pub prompt: String,
    pub negative_prompt: Option<String>,
    pub style: String,
    pub width: u32,
    pub height: u32,
    pub palette: Option<Vec<String>>,
    pub seed: Option<u64>,
    pub num_variants: u32,
    pub provider: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ImageToPixelParams {
    pub reference_image_path: String,
    pub prompt: Option<String>,
    pub style: String,
    pub denoise_strength: f64,
    pub width: u32,
    pub height: u32,
    pub palette: Option<Vec<String>>,
    pub seed: Option<u64>,
    pub num_variants: u32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GeneratedAsset {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub asset_type: String,
    pub prompt: String,
    pub negative_prompt: Option<String>,
    pub style: String,
    pub width: u32,
    pub height: u32,
    pub palette: Option<Vec<String>>,
    pub seed: Option<u64>,
    pub provider: String,
    pub file_path: String,
    pub thumbnail_path: String,
    pub created_at: i64,
    pub metadata: Option<serde_json::Value>,
}

/// 构建 OpenAI DALL-E 请求的增强 prompt
fn build_pixel_prompt(params: &TextToPixelParams) -> String {
    let style_desc = match params.style.as_str() {
        "8bit" => "8-bit pixel art, NES style, limited color palette, crisp pixels",
        "16bit" => "16-bit pixel art, SNES style, detailed pixel art, vibrant colors",
        "32bit" => "32-bit pixel art, GBA style, smooth pixel transitions",
        "hd" => "high definition pixel art, detailed, modern pixel art style",
        other => other,
    };

    let palette_desc = params
        .palette
        .as_ref()
        .map(|p| format!("limited to these exact colors: {}", p.join(", ")))
        .unwrap_or_default();

    let neg = params
        .negative_prompt
        .as_ref()
        .map(|n| format!("NOT {}", n))
        .unwrap_or_default();

    format!(
        "{}, {}, {}, pixel art sprite, transparent background, {}x{} pixels, no anti-aliasing, sharp pixel edges. {}",
        params.prompt, style_desc, palette_desc,
        params.width, params.height, neg
    )
}

/// 通过 OpenAI DALL-E API 生成像素画
#[tauri::command]
pub async fn generate_pixel_art(
    db: State<'_, DbState>,
    config: State<'_, AiConfig>,
    jobs: State<'_, GenerationJobRegistry>,
    app: AppHandle,
    job_id: String,
    project_id: String,
    params: TextToPixelParams,
) -> Result<Vec<GeneratedAsset>, String> {
    validate_generation_request(&db, &project_id, &params)?;
    jobs.register(&job_id, &project_id)?;
    log::info!(
        "generation job started: job_id={}, project_id={}, variants={}",
        job_id,
        project_id,
        params.num_variants
    );
    let mut results = Vec::new();
    let mut outcome = async {
      let (provider_id, api_key, provider_config) = {
        let cfg = config.lock().map_err(|e| format!("配置锁失败: {}", e))?;
        let provider_id = params.provider.as_deref()
            .unwrap_or(&cfg.default_generation_provider)
            .to_string();

        let provider_config = cfg.providers.iter()
            .find(|p| p.id == provider_id)
            .ok_or(format!("未找到 Provider: {}", provider_id))?
            .clone();
        if !provider_config.enabled
            || !provider_config
                .capabilities
                .iter()
                .any(|capability| capability == "TextToPixel")
        {
            return Err(format!("Provider {} 未启用像素画生成能力", provider_id));
        }
        let api_key = cfg.api_keys.get(&provider_id)
            .ok_or(format!("未配置 {} API Key，请在 AI 设置中配置", provider_id))?
            .clone();

        (provider_id, api_key, provider_config)
    }; // cfg 自动 drop

      let enhanced_prompt = build_pixel_prompt(&params);

      let count = params.num_variants;
      for i in 0..count {
        jobs.ensure_active(&job_id, &project_id)?;
        app.emit("generation-progress", serde_json::json!({
            "jobId": job_id, "projectId": project_id,
            "stage": "generating", "current": i + 1, "total": count
        })).ok();

        let seed = params.seed.unwrap_or_else(|| {
            use std::time::{SystemTime, UNIX_EPOCH};
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs() + i as u64
        });

        // 根据后端类型调用不同 API
        let img_bytes = if provider_id == "stability" {
            generate_stability(&provider_config, &api_key, &enhanced_prompt, &params, seed).await?
        } else {
            generate_openai(&provider_config, &api_key, &enhanced_prompt, &params).await?
        };
        jobs.ensure_active(&job_id, &project_id)?;

        // 降采样到目标尺寸（DALL-E 最小 1024x1024）
        let img = image::load_from_memory(&img_bytes)
            .map_err(|e| format!("加载图片失败: {}", e))?;
        let resized = img.resize_exact(params.width, params.height, image::imageops::FilterType::Nearest);
        let pixelated = resized.to_rgba8();

        // 保存文件
        let app_dir = app.path().app_data_dir()
            .map_err(|e| format!("获取应用目录失败: {}", e))?;
        let gen_dir = app_dir.join("generated");
        std::fs::create_dir_all(&gen_dir).ok();

        let asset_id = uuid::Uuid::new_v4().to_string();
        let file_name = format!("{}_{}.png", asset_id, seed);
        let file_path = gen_dir.join(&file_name);
        pixelated.save(&file_path)
            .map_err(|e| format!("保存图片失败: {}", e))?;

        // 生成缩略图
        let thumb_size = 64;
        let thumb = img.resize_exact(thumb_size, thumb_size, image::imageops::FilterType::Nearest);
        let thumb_name = format!("thumb_{}", file_name);
        let thumb_path = gen_dir.join(&thumb_name);
        thumb.save(&thumb_path)
            .map_err(|e| format!("保存缩略图失败: {}", e))?;
        if let Err(error) = jobs.ensure_active(&job_id, &project_id) {
            let _ = std::fs::remove_file(&file_path);
            let _ = std::fs::remove_file(&thumb_path);
            return Err(error);
        }

        let asset = GeneratedAsset {
            id: asset_id.clone(),
            project_id: project_id.clone(),
            name: format!("像素画 {}", i + 1),
            asset_type: "sprite".to_string(),
            prompt: params.prompt.clone(),
            negative_prompt: params.negative_prompt.clone(),
            style: params.style.clone(),
            width: params.width,
            height: params.height,
            palette: params.palette.clone(),
            seed: Some(seed),
            provider: provider_id.clone(),
            file_path: file_path.to_string_lossy().to_string(),
            thumbnail_path: thumb_path.to_string_lossy().to_string(),
            created_at: chrono::Utc::now().timestamp_millis(),
            metadata: Some(serde_json::json!({
                "enhancedPrompt": enhanced_prompt,
                "model": "dall-e-3"
            })),
        };

        // 保存到数据库
        let conn = db.lock().map_err(|e| format!("数据库锁失败: {}", e))?;
        let insert_result = conn.execute(
            "INSERT INTO generated_assets (id, project_id, name, asset_type, prompt, negative_prompt, style, width, height, palette, seed, provider, file_path, thumbnail_path, created_at, metadata) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)",
            params![
                asset.id,
                asset.project_id,
                asset.name,
                asset.asset_type,
                asset.prompt,
                asset.negative_prompt,
                asset.style,
                asset.width,
                asset.height,
                asset.palette.as_ref().map(|p| serde_json::to_string(p).unwrap_or_default()),
                asset.seed,
                asset.provider,
                asset.file_path,
                asset.thumbnail_path,
                asset.created_at,
                asset.metadata.as_ref().map(|m| serde_json::to_string(m).unwrap_or_default()),
            ],
        );
        drop(conn);
        if let Err(error) = insert_result {
            let _ = std::fs::remove_file(&file_path);
            let _ = std::fs::remove_file(&thumb_path);
            return Err(format!("保存生成资产失败: {}", error));
        }

        results.push(asset);
      }

      app.emit("generation-progress", serde_json::json!({
          "jobId": job_id, "projectId": project_id,
          "stage": "done", "current": count, "total": count
      })).ok();

      Ok(results.clone())
    }
    .await;

    let completed_while_active = jobs.finish(&job_id, &project_id);
    if outcome.is_ok() && !completed_while_active {
        outcome = Err(GENERATION_CANCELLED.to_string());
    }
    if outcome.is_err() {
        cleanup_generated_assets(&db, &results);
    }
    if outcome
        .as_ref()
        .err()
        .is_some_and(|error| error == GENERATION_CANCELLED)
    {
        app.emit(
            "generation-progress",
            serde_json::json!({
                "jobId": job_id, "projectId": project_id,
                "stage": "cancelled", "current": 0, "total": params.num_variants
            }),
        )
        .ok();
        log::info!(
            "generation job cancelled: job_id={}, project_id={}",
            job_id,
            project_id
        );
    } else if outcome.is_err() {
        log::warn!(
            "generation job failed: job_id={}, project_id={}",
            job_id,
            project_id
        );
    } else {
        log::info!(
            "generation job completed: job_id={}, project_id={}, candidates={}",
            job_id,
            project_id,
            results.len()
        );
    }
    outcome
}

#[tauri::command]
pub fn cancel_generation(
    jobs: State<'_, GenerationJobRegistry>,
    job_id: String,
    project_id: String,
) -> Result<bool, String> {
    let accepted = jobs.request_cancel(&job_id, &project_id)?;
    log::info!(
        "generation cancellation received: job_id={}, project_id={}, accepted={}",
        job_id,
        project_id,
        accepted
    );
    Ok(accepted)
}

#[tauri::command]
pub fn list_generated_assets(
    db: State<'_, DbState>,
    project_id: String,
) -> Result<Vec<GeneratedAsset>, String> {
    let conn = db.lock().map_err(|e| format!("数据库锁失败: {}", e))?;
    let mut stmt = conn
        .prepare("SELECT id, project_id, name, asset_type, prompt, negative_prompt, style, width, height, palette, seed, provider, file_path, thumbnail_path, created_at, metadata FROM generated_assets WHERE project_id = ?1 ORDER BY created_at DESC")
        .map_err(|e| format!("查询生成资产失败: {}", e))?;

    let assets = stmt
        .query_map(params![project_id], |row| {
            let id: String = row.get(0)?;
            let project_id: String = row.get(1)?;
            let name: String = row.get(2)?;
            let asset_type: String = row.get(3)?;
            let prompt: String = row.get(4)?;
            let negative_prompt: Option<String> = row.get(5)?;
            let style: String = row.get(6)?;
            let width: u32 = row.get(7)?;
            let height: u32 = row.get(8)?;
            let palette_str: Option<String> = row.get(9)?;
            let seed: Option<i64> = row.get(10)?;
            let provider: String = row.get(11)?;
            let file_path: String = row.get(12)?;
            let thumbnail_path: String = row.get(13)?;
            let created_at: i64 = row.get(14)?;
            let metadata_str: Option<String> = row.get(15)?;

            Ok(GeneratedAsset {
                id,
                project_id,
                name,
                asset_type,
                prompt,
                negative_prompt,
                style,
                width,
                height,
                palette: palette_str
                    .and_then(|s: String| serde_json::from_str::<Vec<String>>(&s).ok()),
                seed: seed.map(|s| s as u64),
                provider,
                file_path,
                thumbnail_path,
                created_at,
                metadata: metadata_str
                    .and_then(|s: String| serde_json::from_str::<serde_json::Value>(&s).ok()),
            })
        })
        .map_err(|e| format!("读取生成资产失败: {}", e))?
        .filter_map(|a| a.ok())
        .collect();

    Ok(assets)
}

#[tauri::command]
pub fn delete_generated_asset(
    db: State<'_, DbState>,
    asset_id: String,
    project_id: String,
) -> Result<(), String> {
    let conn = db.lock().map_err(|e| format!("数据库锁失败: {}", e))?;
    let (file_path, thumbnail_path): (String, String) = conn
        .query_row(
            "SELECT file_path, thumbnail_path FROM generated_assets WHERE id = ?1 AND project_id = ?2",
            params![asset_id, project_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|e| format!("查找资产失败: {}", e))?;
    let timeline_reference_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM assets WHERE source_path = ?1",
            params![file_path],
            |row| row.get(0),
        )
        .map_err(|e| format!("检查资产引用失败: {}", e))?;
    conn.execute(
        "DELETE FROM generated_assets WHERE id = ?1 AND project_id = ?2",
        params![asset_id, project_id],
    )
    .map_err(|e| format!("删除资产失败: {}", e))?;
    drop(conn);
    let paths = if timeline_reference_count == 0 {
        vec![file_path.as_str(), thumbnail_path.as_str()]
    } else {
        log::info!(
            "generated source retained for timeline references: asset_id={}, project_id={}, references={}",
            asset_id,
            project_id,
            timeline_reference_count
        );
        vec![thumbnail_path.as_str()]
    };
    for path in paths {
        if let Err(error) = std::fs::remove_file(path) {
            if error.kind() != std::io::ErrorKind::NotFound {
                log::warn!(
                    "generated asset file cleanup failed: asset_id={}, project_id={}",
                    asset_id,
                    project_id
                );
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub fn add_generated_to_timeline(
    db: State<'_, DbState>,
    asset_id: String,
    track_id: Option<String>,
    project_id: String,
) -> Result<String, String> {
    let conn = db.lock().map_err(|e| format!("数据库锁失败: {}", e))?;

    // 获取生成资产信息
    let (file_path, name, width, height): (String, String, u32, u32) = conn.query_row(
        "SELECT file_path, name, width, height FROM generated_assets WHERE id = ?1 AND project_id = ?2",
        params![asset_id, project_id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
    ).map_err(|e| format!("查找资产失败: {}", e))?;

    let create_track = track_id.is_none();
    let tid = match track_id {
        Some(id) => {
            let track_count: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM tracks WHERE id = ?1 AND project_id = ?2",
                    params![id, project_id],
                    |row| row.get(0),
                )
                .map_err(|e| format!("验证轨道失败: {}", e))?;
            if track_count != 1 {
                return Err("目标轨道不属于当前项目".to_string());
            }
            id
        }
        None => uuid::Uuid::new_v4().to_string(),
    };

    // 导入到轨道
    let new_asset_id = uuid::Uuid::new_v4().to_string();
    let start_frame: i64 = conn.query_row(
        "SELECT COALESCE(MAX(start_frame + duration_frames), 0) FROM assets WHERE track_id = ?1",
        params![tid],
        |row| row.get(0),
    ).unwrap_or(0);

    // 生成缩略图到项目目录
    let thumb_dir = std::path::Path::new(&file_path)
        .parent()
        .map(|p| p.join("thumbs"))
        .unwrap_or_else(|| std::path::PathBuf::from("thumbs"));
    std::fs::create_dir_all(&thumb_dir).ok();
    let thumb_path = thumb_dir.join(format!("thumb_{}.png", new_asset_id));

    let img = image::open(&file_path).map_err(|e| format!("打开图片失败: {}", e))?;
    let thumb = img.resize_exact(120, 68, image::imageops::FilterType::Nearest);
    thumb
        .save(&thumb_path)
        .map_err(|e| format!("保存缩略图失败: {}", e))?;

    let persist_result = (|| -> Result<(), String> {
        let transaction = conn
            .unchecked_transaction()
            .map_err(|e| format!("开始采用候选事务失败: {}", e))?;
        if create_track {
            let track_order: i64 = transaction
                .query_row(
                    "SELECT COALESCE(MAX(track_order), -1) + 1 FROM tracks WHERE project_id = ?1",
                    params![project_id],
                    |row| row.get(0),
                )
                .unwrap_or(0);
            transaction
                .execute(
                    "INSERT INTO tracks (id, project_id, name, type, track_order) VALUES (?1, ?2, ?3, 'image_sequence', ?4)",
                    params![tid, project_id, format!("生成: {}", name), track_order],
                )
                .map_err(|e| format!("创建轨道失败: {}", e))?;
        }
        transaction
            .execute(
                "INSERT INTO assets (id, track_id, name, source_type, source_path, thumbnail_path, start_frame, width, height) VALUES (?1, ?2, ?3, 'generated', ?4, ?5, ?6, ?7, ?8)",
                params![new_asset_id, tid, name, file_path, thumb_path.to_string_lossy().to_string(), start_frame, width, height],
            )
            .map_err(|e| format!("导入资产失败: {}", e))?;
        transaction
            .commit()
            .map_err(|e| format!("提交采用候选事务失败: {}", e))
    })();
    if let Err(error) = persist_result {
        let _ = std::fs::remove_file(&thumb_path);
        return Err(error);
    }
    log::info!(
        "generated candidate adopted: asset_id={}, project_id={}, track_id={}",
        asset_id,
        project_id,
        tid
    );

    Ok(tid)
}
/// 调用 OpenAI DALL-E API
async fn generate_openai(
    provider_config: &ProviderConfig,
    api_key: &str,
    prompt: &str,
    params: &TextToPixelParams,
) -> Result<Vec<u8>, String> {
    let base_url = provider_config
        .config
        .get("baseUrl")
        .and_then(|v| v.as_str())
        .unwrap_or("https://api.openai.com/v1")
        .to_string();

    let client = reqwest::Client::new();
    let response = client
        .post(format!("{}/images/generations", base_url))
        .header("Authorization", format!("Bearer {}", api_key))
        .json(&serde_json::json!({
            "model": "dall-e-3",
            "prompt": prompt,
            "n": 1,
            "size": format!("{}x{}", params.width.max(1024), params.height.max(1024)),
            "quality": "standard",
            "response_format": "b64_json"
        }))
        .send()
        .await
        .map_err(|e| format!("OpenAI API 请求失败: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("OpenAI API 返回错误 {}: {}", status, body));
    }

    let json: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("解析响应失败: {}", e))?;

    let b64_data = json["data"][0]["b64_json"]
        .as_str()
        .ok_or("响应中缺少图片数据")?;

    base64::engine::general_purpose::STANDARD
        .decode(b64_data)
        .map_err(|e| format!("解码图片失败: {}", e))
}

/// 调用 Stability AI API
async fn generate_stability(
    provider_config: &ProviderConfig,
    api_key: &str,
    prompt: &str,
    params: &TextToPixelParams,
    seed: u64,
) -> Result<Vec<u8>, String> {
    let base_url = provider_config
        .config
        .get("baseUrl")
        .and_then(|v| v.as_str())
        .unwrap_or("https://api.stability.ai/v1")
        .to_string();

    let engine = provider_config
        .config
        .get("engine")
        .and_then(|v| v.as_str())
        .unwrap_or("stable-diffusion-xl-1.0")
        .to_string();

    let client = reqwest::Client::new();
    let response = client
        .post(format!("{}/generation/{}/text-to-image", base_url, engine))
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .header("Accept", "application/json")
        .json(&serde_json::json!({
            "text_prompts": [
                { "text": prompt, "weight": 1.0 }
            ],
            "cfg_scale": 7,
            "height": params.height.max(512),
            "width": params.width.max(512),
            "samples": 1,
            "steps": 30,
            "seed": seed,
            "style_preset": "pixel-art"
        }))
        .send()
        .await
        .map_err(|e| format!("Stability AI 请求失败: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Stability AI 返回错误 {}: {}", status, body));
    }

    let json: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("解析响应失败: {}", e))?;

    let b64_data = json["artifacts"][0]["base64"]
        .as_str()
        .ok_or("响应中缺少图片数据")?;

    base64::engine::general_purpose::STANDARD
        .decode(b64_data)
        .map_err(|e| format!("解码图片失败: {}", e))
}

#[cfg(test)]
mod tests {
    use super::{validate_generation_request, GenerationJobRegistry, TextToPixelParams};
    use rusqlite::Connection;
    use std::sync::Mutex;

    fn params() -> TextToPixelParams {
        TextToPixelParams {
            prompt: "idle hero".to_string(),
            negative_prompt: None,
            style: "16bit".to_string(),
            width: 64,
            height: 64,
            palette: None,
            seed: Some(1),
            num_variants: 1,
            provider: Some("openai".to_string()),
        }
    }

    #[test]
    fn cancellation_requires_matching_job_and_project() {
        let jobs = GenerationJobRegistry::default();
        jobs.register("job-a", "project-a").expect("register");

        assert!(!jobs
            .request_cancel("job-a", "project-b")
            .expect("wrong project"));
        assert!(jobs.ensure_active("job-a", "project-a").is_ok());
        assert!(jobs
            .request_cancel("job-a", "project-a")
            .expect("matching project"));
        assert_eq!(
            jobs.ensure_active("job-a", "project-a").unwrap_err(),
            "GENERATION_CANCELLED"
        );
        assert!(!jobs.finish("job-a", "project-a"));
    }

    #[test]
    fn generation_request_validation_rejects_missing_projects_and_unsafe_bounds() {
        let connection = Connection::open_in_memory().expect("database");
        connection
            .execute("CREATE TABLE projects (id TEXT PRIMARY KEY)", [])
            .expect("projects table");
        connection
            .execute("INSERT INTO projects (id) VALUES ('project-a')", [])
            .expect("project");
        let db = Mutex::new(connection);

        assert!(validate_generation_request(&db, "project-a", &params()).is_ok());
        let mut invalid = params();
        invalid.num_variants = 5;
        assert!(validate_generation_request(&db, "project-a", &invalid).is_err());
        assert!(validate_generation_request(&db, "missing", &params()).is_err());
    }
}
