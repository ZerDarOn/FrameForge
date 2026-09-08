use crate::db::DbState;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::path::Path;
use tauri::State;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AssetInfo {
    pub id: String,
    pub track_id: String,
    pub name: String,
    pub source_type: String,
    pub source_path: String,
    pub thumbnail_path: String,
    pub start_frame: i64,
    pub duration_frames: i64,
    pub width: i64,
    pub height: i64,
    pub transform_x: f64,
    pub transform_y: f64,
    pub transform_scale_x: f64,
    pub transform_scale_y: f64,
    pub transform_rotation: f64,
    pub alignment_dx: f64,
    pub alignment_dy: f64,
    /// 是否匹配项目建议帧率（1=匹配高亮，0=不匹配灰色）
    pub matched_fps: bool,
    /// 原始时间戳（毫秒）
    pub source_timestamp: i64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackInfo {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub track_type: String,
    pub visible: bool,
    pub locked: bool,
    pub opacity: f64,
    pub track_order: i64,
    pub assets: Vec<AssetInfo>,
}

/// 扫描文件夹中的图片序列帧，返回文件路径列表
#[tauri::command]
pub fn scan_image_folder(folder_path: String) -> Result<Vec<String>, String> {
    let dir = Path::new(&folder_path);
    if !dir.is_dir() {
        return Err("路径不是文件夹".to_string());
    }

    let image_extensions = ["png", "jpg", "jpeg", "webp", "bmp"];
    let mut files: Vec<String> = std::fs::read_dir(dir)
        .map_err(|e| format!("读取文件夹失败: {}", e))?
        .filter_map(|entry| entry.ok())
        .filter(|entry| {
            entry
                .path()
                .extension()
                .and_then(|ext| ext.to_str())
                .map(|ext| image_extensions.contains(&ext.to_lowercase().as_str()))
                .unwrap_or(false)
        })
        .map(|entry| entry.path().to_string_lossy().to_string())
        .collect();

    files.sort();
    Ok(files)
}

/// 创建轨道
#[tauri::command]
pub fn create_track(
    db: State<'_, DbState>,
    project_id: String,
    name: String,
    track_type: String,
) -> Result<TrackInfo, String> {
    let id = uuid::Uuid::new_v4().to_string();

    let conn = db.lock().map_err(|e| format!("数据库锁失败: {}", e))?;

    let max_order: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(track_order), -1) FROM tracks WHERE project_id = ?1",
            params![project_id],
            |row| row.get(0),
        )
        .unwrap_or(-1);

    conn.execute(
        "INSERT INTO tracks (id, project_id, name, type, visible, locked, opacity, track_order) VALUES (?1, ?2, ?3, ?4, 1, 0, 1.0, ?5)",
        params![id, project_id, name, track_type, max_order + 1],
    )
    .map_err(|e| format!("创建轨道失败: {}", e))?;

    Ok(TrackInfo {
        id,
        project_id,
        name,
        track_type,
        visible: true,
        locked: false,
        opacity: 1.0,
        track_order: max_order + 1,
        assets: vec![],
    })
}

#[tauri::command]
pub fn import_files_to_new_track(
    db: State<'_, DbState>,
    operation_id: String,
    project_id: String,
    name: String,
    track_type: String,
    file_paths: Vec<String>,
    start_frame: i64,
    fps: i64,
    source_fps: i64,
) -> Result<TrackInfo, String> {
    log::info!(
        "project import started: operation_id={}, project_id={}, file_count={}",
        operation_id,
        project_id,
        file_paths.len()
    );
    let result = (|| {
        if operation_id.is_empty() || operation_id.len() > 128 {
            return Err("导入 operationId 无效".to_string());
        }
        if name.trim().is_empty() || name.len() > 128 {
            return Err("轨道名称必须为 1..=128 个字符".to_string());
        }
        if track_type != "image_sequence" {
            return Err("当前仅支持导入图片序列".to_string());
        }
        if file_paths.is_empty() || file_paths.len() > 10_000 {
            return Err("导入文件数量必须为 1..=10000".to_string());
        }
        if start_frame < 0 || !(1..=240).contains(&fps) || !(0..=1000).contains(&source_fps) {
            return Err("导入帧位置或帧率参数无效".to_string());
        }

        let track_id = uuid::Uuid::new_v4().to_string();
        let mut assets = Vec::with_capacity(file_paths.len());
        for (index, path) in file_paths.iter().enumerate() {
            let metadata =
                std::fs::metadata(path).map_err(|e| format!("读取导入文件失败: {}", e))?;
            if !metadata.is_file() || metadata.len() > 64 * 1024 * 1024 {
                return Err("导入图片必须是小于 64 MiB 的文件".to_string());
            }
            let (width, height) =
                image::image_dimensions(path).map_err(|e| format!("读取图片尺寸失败: {}", e))?;
            if width == 0 || height == 0 || width > 16_384 || height > 16_384 {
                return Err("导入图片尺寸必须在 1..=16384 范围内".to_string());
            }
            let file_name = Path::new(path)
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("unknown")
                .to_string();
            let matched = if source_fps <= 0 || source_fps == fps {
                true
            } else {
                let frame_time_ms = (index as f64 / source_fps as f64) * 1000.0;
                let interval_ms = 1000.0 / fps as f64;
                let remainder = frame_time_ms % interval_ms;
                remainder < 1.0 || interval_ms - remainder < 1.0
            };
            let source_timestamp = if source_fps > 0 {
                ((index as f64 / source_fps as f64) * 1000.0) as i64
            } else {
                0
            };
            assets.push(AssetInfo {
                id: uuid::Uuid::new_v4().to_string(),
                track_id: track_id.clone(),
                name: file_name,
                source_type: "image".to_string(),
                source_path: path.clone(),
                thumbnail_path: path.clone(),
                start_frame: start_frame + index as i64,
                duration_frames: 1,
                width: i64::from(width),
                height: i64::from(height),
                transform_x: 0.0,
                transform_y: 0.0,
                transform_scale_x: 1.0,
                transform_scale_y: 1.0,
                transform_rotation: 0.0,
                alignment_dx: 0.0,
                alignment_dy: 0.0,
                matched_fps: matched,
                source_timestamp,
            });
        }

        let mut conn = db.lock().map_err(|e| format!("数据库锁失败: {}", e))?;
        let tx = conn
            .transaction()
            .map_err(|e| format!("开始导入事务失败: {}", e))?;
        let project_exists: bool = tx
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM projects WHERE id = ?1)",
                params![project_id],
                |row| row.get(0),
            )
            .map_err(|e| format!("检查项目失败: {}", e))?;
        if !project_exists {
            return Err("导入目标项目不存在".to_string());
        }
        let track_order: i64 = tx
            .query_row(
                "SELECT COALESCE(MAX(track_order), -1) + 1 FROM tracks WHERE project_id = ?1",
                params![project_id],
                |row| row.get(0),
            )
            .map_err(|e| format!("读取轨道顺序失败: {}", e))?;
        tx.execute(
            "INSERT INTO tracks (id, project_id, name, type, visible, locked, opacity, track_order)
             VALUES (?1, ?2, ?3, ?4, 1, 0, 1.0, ?5)",
            params![track_id, project_id, name, track_type, track_order],
        )
        .map_err(|e| format!("创建导入轨道失败: {}", e))?;
        for asset in &assets {
            tx.execute(
                "INSERT INTO assets (id, track_id, name, source_type, source_path, thumbnail_path, start_frame, duration_frames, width, height, matched_fps, source_timestamp)
                 VALUES (?1, ?2, ?3, 'image', ?4, ?5, ?6, 1, ?7, ?8, ?9, ?10)",
                params![
                    asset.id,
                    asset.track_id,
                    asset.name,
                    asset.source_path,
                    asset.thumbnail_path,
                    asset.start_frame,
                    asset.width,
                    asset.height,
                    asset.matched_fps as i32,
                    asset.source_timestamp
                ],
            )
            .map_err(|e| format!("写入导入帧失败: {}", e))?;
        }
        tx.commit()
            .map_err(|e| format!("提交导入事务失败: {}", e))?;
        Ok(TrackInfo {
            id: track_id,
            project_id,
            name,
            track_type,
            visible: true,
            locked: false,
            opacity: 1.0,
            track_order,
            assets,
        })
    })();
    match &result {
        Ok(track) => log::info!(
            "project import committed: operation_id={}, project_id={}, track_id={}, asset_count={}",
            operation_id,
            project_id,
            track.id,
            track.assets.len()
        ),
        Err(error) => log::warn!(
            "project import failed: operation_id={}, project_id={}, error={}",
            operation_id,
            project_id,
            error
        ),
    }
    result
}

/// Atomically move one asset into a newly-created track.
#[tauri::command]
pub fn extract_asset_to_new_track(
    db: State<'_, DbState>,
    source_track_id: String,
    asset_id: String,
    name: String,
) -> Result<TrackInfo, String> {
    let mut conn = db.lock().map_err(|e| format!("数据库锁失败: {}", e))?;
    let tx = conn
        .transaction()
        .map_err(|e| format!("开始提取帧事务失败: {}", e))?;

    let (project_id, track_type, locked): (String, String, bool) = tx
        .query_row(
            "SELECT project_id, type, locked = 1 FROM tracks WHERE id = ?1",
            params![source_track_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .map_err(|e| format!("源轨道不存在: {}", e))?;
    if locked {
        return Err("源轨道已锁定".to_string());
    }

    let mut asset = tx
        .query_row(
            "SELECT id, track_id, name, source_type, source_path, thumbnail_path, start_frame, duration_frames, width, height, transform_x, transform_y, transform_scale_x, transform_scale_y, transform_rotation, alignment_dx, alignment_dy, matched_fps, source_timestamp FROM assets WHERE id = ?1 AND track_id = ?2",
            params![asset_id, source_track_id],
            |row| {
                Ok(AssetInfo {
                    id: row.get(0)?,
                    track_id: row.get(1)?,
                    name: row.get(2)?,
                    source_type: row.get(3)?,
                    source_path: row.get(4)?,
                    thumbnail_path: row.get(5)?,
                    start_frame: row.get(6)?,
                    duration_frames: row.get(7)?,
                    width: row.get(8)?,
                    height: row.get(9)?,
                    transform_x: row.get(10)?,
                    transform_y: row.get(11)?,
                    transform_scale_x: row.get(12)?,
                    transform_scale_y: row.get(13)?,
                    transform_rotation: row.get(14)?,
                    alignment_dx: row.get(15)?,
                    alignment_dy: row.get(16)?,
                    matched_fps: row.get::<_, i64>(17)? == 1,
                    source_timestamp: row.get(18)?,
                })
            },
        )
        .map_err(|e| format!("待提取帧不存在: {}", e))?;

    let max_order: i64 = tx
        .query_row(
            "SELECT COALESCE(MAX(track_order), -1) FROM tracks WHERE project_id = ?1",
            params![project_id],
            |row| row.get(0),
        )
        .unwrap_or(-1);
    let target_track_id = uuid::Uuid::new_v4().to_string();

    tx.execute(
        "INSERT INTO tracks (id, project_id, name, type, visible, locked, opacity, track_order) VALUES (?1, ?2, ?3, ?4, 1, 0, 1.0, ?5)",
        params![target_track_id, project_id, name, track_type, max_order + 1],
    )
    .map_err(|e| format!("创建目标轨道失败: {}", e))?;
    tx.execute(
        "UPDATE assets SET track_id = ?1, start_frame = 0 WHERE id = ?2 AND track_id = ?3",
        params![target_track_id, asset_id, source_track_id],
    )
    .map_err(|e| format!("迁移帧失败: {}", e))?;
    tx.execute(
        "UPDATE assets SET start_frame = start_frame - 1 WHERE track_id = ?1 AND start_frame > ?2",
        params![source_track_id, asset.start_frame],
    )
    .map_err(|e| format!("压缩源轨道失败: {}", e))?;
    tx.commit()
        .map_err(|e| format!("提交提取帧事务失败: {}", e))?;

    asset.track_id = target_track_id.clone();
    asset.start_frame = 0;
    log::info!(
        "extracted asset: asset_id={}, source_track_id={}, target_track_id={}",
        asset.id,
        source_track_id,
        target_track_id
    );

    Ok(TrackInfo {
        id: target_track_id,
        project_id,
        name,
        track_type,
        visible: true,
        locked: false,
        opacity: 1.0,
        track_order: max_order + 1,
        assets: vec![asset],
    })
}

/// 批量导入图片帧到轨道
/// fps: 项目建议帧率，用于标记匹配帧
/// source_fps: 源素材的实际帧率（图片序列默认为0，表示全部匹配）
#[tauri::command]
pub fn import_frames_to_track(
    db: State<'_, DbState>,
    track_id: String,
    file_paths: Vec<String>,
    start_frame: i64,
    fps: i64,
    source_fps: i64,
) -> Result<Vec<AssetInfo>, String> {
    let conn = db.lock().map_err(|e| format!("数据库锁失败: {}", e))?;
    let mut assets = Vec::new();

    for (i, path) in file_paths.iter().enumerate() {
        let id = uuid::Uuid::new_v4().to_string();
        let file_name = Path::new(path)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("unknown")
            .to_string();

        let (width, height) = get_image_dimensions(path);

        // 判断是否匹配帧率
        // 如果 source_fps 为 0（图片序列），则全部匹配
        // 否则：该帧在源素材中的时间位置 = i / source_fps * 1000 ms
        //       如果该时间位置落在 fps 间隔上，则匹配
        let matched = if source_fps <= 0 || fps <= 0 || source_fps == fps {
            true
        } else {
            let frame_time_ms = (i as f64 / source_fps as f64) * 1000.0;
            let fps_interval_ms = 1000.0 / fps as f64;
            let remainder = frame_time_ms % fps_interval_ms;
            remainder < 1.0 || (fps_interval_ms - remainder) < 1.0
        };

        let source_timestamp = if source_fps > 0 {
            ((i as f64 / source_fps as f64) * 1000.0) as i64
        } else {
            0
        };

        conn.execute(
            "INSERT INTO assets (id, track_id, name, source_type, source_path, thumbnail_path, start_frame, duration_frames, width, height, matched_fps, source_timestamp) VALUES (?1, ?2, ?3, 'image', ?4, ?5, ?6, 1, ?7, ?8, ?9, ?10)",
            params![id, track_id, file_name, path, path, start_frame + i as i64, width, height, matched as i32, source_timestamp],
        )
        .map_err(|e| format!("导入帧失败: {}", e))?;

        assets.push(AssetInfo {
            id,
            track_id: track_id.clone(),
            name: file_name,
            source_type: "image".to_string(),
            source_path: path.clone(),
            thumbnail_path: path.clone(),
            start_frame: start_frame + i as i64,
            duration_frames: 1,
            width,
            height,
            transform_x: 0.0,
            transform_y: 0.0,
            transform_scale_x: 1.0,
            transform_scale_y: 1.0,
            transform_rotation: 0.0,
            alignment_dx: 0.0,
            alignment_dy: 0.0,
            matched_fps: matched,
            source_timestamp,
        });
    }

    Ok(assets)
}

/// 获取项目的所有轨道和资产
#[tauri::command]
pub fn get_project_tracks(
    db: State<'_, DbState>,
    project_id: String,
) -> Result<Vec<TrackInfo>, String> {
    let conn = db.lock().map_err(|e| format!("数据库锁失败: {}", e))?;

    let mut track_stmt = conn
        .prepare("SELECT id, project_id, name, type, visible, locked, opacity, track_order FROM tracks WHERE project_id = ?1 ORDER BY track_order")
        .map_err(|e| format!("查询轨道失败: {}", e))?;

    let tracks: Vec<TrackInfo> = track_stmt
        .query_map(params![project_id], |row| {
            Ok(TrackInfo {
                id: row.get(0)?,
                project_id: row.get(1)?,
                name: row.get(2)?,
                track_type: row.get(3)?,
                visible: row.get::<_, i64>(4)? == 1,
                locked: row.get::<_, i64>(5)? == 1,
                opacity: row.get(6)?,
                track_order: row.get(7)?,
                assets: vec![],
            })
        })
        .map_err(|e| format!("读取轨道失败: {}", e))?
        .filter_map(|t| t.ok())
        .collect();

    drop(track_stmt);

    let mut result = Vec::new();
    for mut track in tracks {
        let mut asset_stmt = conn
            .prepare(
                "SELECT id, track_id, name, source_type, source_path, thumbnail_path, start_frame, duration_frames, width, height, transform_x, transform_y, transform_scale_x, transform_scale_y, transform_rotation, alignment_dx, alignment_dy, matched_fps, source_timestamp FROM assets WHERE track_id = ?1 ORDER BY start_frame",
            )
            .map_err(|e| format!("查询资产失败: {}", e))?;

        let assets: Vec<AssetInfo> = asset_stmt
            .query_map(params![track.id], |row| {
                Ok(AssetInfo {
                    id: row.get(0)?,
                    track_id: row.get(1)?,
                    name: row.get(2)?,
                    source_type: row.get(3)?,
                    source_path: row.get(4)?,
                    thumbnail_path: row.get(5)?,
                    start_frame: row.get(6)?,
                    duration_frames: row.get(7)?,
                    width: row.get(8)?,
                    height: row.get(9)?,
                    transform_x: row.get(10)?,
                    transform_y: row.get(11)?,
                    transform_scale_x: row.get(12)?,
                    transform_scale_y: row.get(13)?,
                    transform_rotation: row.get(14)?,
                    alignment_dx: row.get(15)?,
                    alignment_dy: row.get(16)?,
                    matched_fps: row.get::<_, i64>(17)? == 1,
                    source_timestamp: row.get(18)?,
                })
            })
            .map_err(|e| format!("读取资产失败: {}", e))?
            .filter_map(|a| a.ok())
            .collect();

        track.assets = assets;
        result.push(track);
    }

    Ok(result)
}

/// 读取图片文件为 base64（视口全尺寸图的 fallback，推荐前端使用 asset protocol）
#[tauri::command]
pub fn read_image_as_base64(file_path: String) -> Result<String, String> {
    let data = std::fs::read(&file_path).map_err(|e| format!("读取图片失败: {}", e))?;
    let ext = Path::new(&file_path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("png");

    let mime = match ext.to_lowercase().as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        _ => "image/png",
    };

    Ok(format!(
        "data:{};base64,{}",
        mime,
        base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &data)
    ))
}

/// 生成缩略图（小尺寸 base64，用于时间线和资产面板）
/// jpeg_quality: JPEG 编码质量 0-100（仅 format=jpeg 时有效）
/// format: "png" 或 "jpeg"，控制输出格式
#[tauri::command]
pub fn read_thumbnail_base64(
    file_path: String,
    max_width: u32,
    max_height: u32,
    jpeg_quality: Option<u8>,
    format: Option<String>,
) -> Result<String, String> {
    let data = std::fs::read(&file_path).map_err(|e| format!("读取图片失败: {}", e))?;
    let output_format = format.as_deref().unwrap_or("jpeg");

    let (mime, img_format) = match output_format {
        "png" => ("image/png", image::ImageFormat::Png),
        _ => ("image/jpeg", image::ImageFormat::Jpeg),
    };

    // 对于小文件（<30KB），直接返回原图
    if data.len() < 30_000 {
        let orig_ext = Path::new(&file_path)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("png");
        let orig_mime = match orig_ext.to_lowercase().as_str() {
            "jpg" | "jpeg" => "image/jpeg",
            "webp" => "image/webp",
            "bmp" => "image/bmp",
            _ => "image/png",
        };
        return Ok(format!(
            "data:{};base64,{}",
            orig_mime,
            base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &data)
        ));
    }

    // 解码 → 缩放 → 编码
    let img = image::load_from_memory(&data).map_err(|e| format!("解码图片失败: {}", e))?;
    let thumb = img.thumbnail(max_width, max_height);

    let mut buf = Vec::new();
    match img_format {
        image::ImageFormat::Jpeg => {
            let quality = jpeg_quality.unwrap_or(85).min(100);
            let encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buf, quality);
            thumb
                .write_with_encoder(encoder)
                .map_err(|e| format!("编码 JPEG 缩略图失败: {}", e))?;
        }
        _ => {
            thumb
                .write_to(&mut std::io::Cursor::new(&mut buf), image::ImageFormat::Png)
                .map_err(|e| format!("编码 PNG 缩略图失败: {}", e))?;
        }
    }

    Ok(format!(
        "data:{};base64,{}",
        mime,
        base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &buf)
    ))
}

/// 删除帧
#[tauri::command]
pub fn delete_asset(db: State<'_, DbState>, asset_id: String) -> Result<(), String> {
    let conn = db.lock().map_err(|e| format!("数据库锁失败: {}", e))?;
    conn.execute("DELETE FROM assets WHERE id = ?1", params![asset_id])
        .map_err(|e| format!("删除帧失败: {}", e))?;
    Ok(())
}

/// 删除轨道（含所有帧）
#[tauri::command]
pub fn delete_track(db: State<'_, DbState>, track_id: String) -> Result<(), String> {
    let conn = db.lock().map_err(|e| format!("数据库锁失败: {}", e))?;
    conn.execute("DELETE FROM assets WHERE track_id = ?1", params![track_id])
        .map_err(|e| format!("删除轨道帧失败: {}", e))?;
    conn.execute("DELETE FROM tracks WHERE id = ?1", params![track_id])
        .map_err(|e| format!("删除轨道失败: {}", e))?;
    Ok(())
}

/// 更新帧的变换参数
#[tauri::command]
pub fn update_asset_transform(
    db: State<'_, DbState>,
    asset_id: String,
    transform_x: f64,
    transform_y: f64,
    transform_scale_x: f64,
    transform_scale_y: f64,
    transform_rotation: f64,
    alignment_dx: f64,
    alignment_dy: f64,
) -> Result<(), String> {
    let conn = db.lock().map_err(|e| format!("数据库锁失败: {}", e))?;
    conn.execute(
        "UPDATE assets SET transform_x = ?1, transform_y = ?2, transform_scale_x = ?3, transform_scale_y = ?4, transform_rotation = ?5, alignment_dx = ?6, alignment_dy = ?7 WHERE id = ?8",
        params![transform_x, transform_y, transform_scale_x, transform_scale_y, transform_rotation, alignment_dx, alignment_dy, asset_id],
    )
    .map_err(|e| format!("更新帧变换失败: {}", e))?;
    Ok(())
}

/// 导出当前项目的所有帧为 PNG 序列（合成多轨道 + 应用 transform）
#[tauri::command]
pub fn export_png_sequence(
    db: State<'_, DbState>,
    project_id: String,
    output_dir: String,
) -> Result<usize, String> {
    use std::io::Cursor;

    let conn = db.lock().map_err(|e| format!("数据库锁失败: {}", e))?;

    // 获取画布尺寸
    let (canvas_w, canvas_h) = conn
        .query_row(
            "SELECT canvas_width, canvas_height FROM projects WHERE id = ?1",
            params![project_id],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
        )
        .unwrap_or((1920, 1080));

    // 获取所有轨道（按 track_order 排序）
    let mut track_stmt = conn
        .prepare("SELECT id FROM tracks WHERE project_id = ?1 ORDER BY track_order")
        .map_err(|e| format!("查询轨道失败: {}", e))?;

    let track_ids: Vec<String> = track_stmt
        .query_map(params![project_id], |row| row.get(0))
        .map_err(|e| format!("读取轨道失败: {}", e))?
        .filter_map(|t| t.ok())
        .collect();
    drop(track_stmt);

    // 构建每帧的图层映射: frame_index -> [(source_path, transform_x, transform_y, scale_x, scale_y, rotation)]
    // 按 startFrame 组织
    use std::collections::BTreeMap;
    let mut frame_layers: BTreeMap<i64, Vec<(String, f64, f64, f64, f64, f64)>> = BTreeMap::new();

    for track_id in &track_ids {
        let mut asset_stmt = conn
            .prepare("SELECT source_path, start_frame, transform_x, transform_y, transform_scale_x, transform_scale_y, transform_rotation FROM assets WHERE track_id = ?1 ORDER BY start_frame")
            .map_err(|e| format!("查询资产失败: {}", e))?;

        let rows: Vec<(String, i64, f64, f64, f64, f64, f64)> = asset_stmt
            .query_map(params![track_id], |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                    row.get(6)?,
                ))
            })
            .map_err(|e| format!("读取资产行失败: {}", e))?
            .filter_map(|r| r.ok())
            .collect();

        for (source_path, start_frame, tx, ty, sx, sy, rot) in rows {
            frame_layers
                .entry(start_frame)
                .or_default()
                .push((source_path, tx, ty, sx, sy, rot));
        }
    }

    // 创建输出目录
    std::fs::create_dir_all(&output_dir).map_err(|e| format!("创建输出目录失败: {}", e))?;

    let mut frame_index: usize = 0;

    for (_, layers) in frame_layers.iter() {
        // 创建画布（透明背景）
        let mut canvas = image::RgbaImage::new(canvas_w as u32, canvas_h as u32);

        for (source_path, tx, ty, sx, sy, rot) in layers {
            let src_path = Path::new(source_path);
            if !src_path.exists() {
                continue;
            }

            let data = std::fs::read(&source_path).map_err(|e| format!("读取帧失败: {}", e))?;
            let img = image::load_from_memory(&data).map_err(|e| format!("解码帧失败: {}", e))?;
            let rgba = img.to_rgba8();

            let (img_w, img_h) = (rgba.width() as f64, rgba.height() as f64);

            // 以画布中心为原点，叠加图层
            let cx = canvas_w as f64 / 2.0 + tx;
            let cy = canvas_h as f64 / 2.0 + ty;

            // 简化版：不做旋转（image crate 对旋转支持有限），仅做平移 + 缩放
            let scaled_w = (img_w * sx).max(1.0) as u32;
            let scaled_h = (img_h * sy).max(1.0) as u32;
            let scaled = image::imageops::resize(
                &rgba,
                scaled_w,
                scaled_h,
                image::imageops::FilterType::Lanczos3,
            );

            let x = (cx - scaled_w as f64 / 2.0).round() as i64;
            let y = (cy - scaled_h as f64 / 2.0).round() as i64;

            image::imageops::overlay(&mut canvas, &scaled, x, y);
        }

        let output_path = Path::new(&output_dir).join(format!("frame_{:05}.png", frame_index));

        let mut buf = Cursor::new(Vec::new());
        image::DynamicImage::ImageRgba8(canvas)
            .write_to(&mut buf, image::ImageFormat::Png)
            .map_err(|e| format!("编码输出 PNG 失败: {}", e))?;

        std::fs::write(&output_path, buf.into_inner())
            .map_err(|e| format!("写入输出文件失败: {}", e))?;

        frame_index += 1;
    }

    Ok(frame_index)
}

fn get_image_dimensions(path: &str) -> (i64, i64) {
    if let Ok(data) = std::fs::read(path) {
        if data.len() > 24 && data[0..4] == [0x89, 0x50, 0x4E, 0x47] {
            let w = ((data[16] as u32) << 24)
                | ((data[17] as u32) << 16)
                | ((data[18] as u32) << 8)
                | data[19] as u32;
            let h = ((data[20] as u32) << 24)
                | ((data[21] as u32) << 16)
                | ((data[22] as u32) << 8)
                | data[23] as u32;
            return (w as i64, h as i64);
        }
        if data.len() > 4 && data[0..2] == [0xFF, 0xD8] {
            let mut i = 2;
            while i + 9 < data.len() {
                if data[i] != 0xFF {
                    break;
                }
                let marker = data[i + 1];
                if marker == 0xC0 || marker == 0xC2 {
                    let h = ((data[i + 5] as u32) << 8) | data[i + 6] as u32;
                    let w = ((data[i + 7] as u32) << 8) | data[i + 8] as u32;
                    return (w as i64, h as i64);
                }
                let len = ((data[i + 2] as usize) << 8) | data[i + 3] as usize;
                i += 2 + len;
            }
        }
    }
    (0, 0)
}

/// 导出当前项目为 GIF 动画（合成多轨道 + 应用 transform）
#[tauri::command]
pub fn export_gif(
    db: State<'_, DbState>,
    project_id: String,
    output_path: String,
    fps: i64,
) -> Result<usize, String> {
    use std::collections::BTreeMap;
    use std::fs::File;

    let conn = db.lock().map_err(|e| format!("数据库锁失败: {}", e))?;

    let (canvas_w, canvas_h) = conn
        .query_row(
            "SELECT canvas_width, canvas_height FROM projects WHERE id = ?1",
            params![project_id],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
        )
        .unwrap_or((1920, 1080));

    let mut track_stmt = conn
        .prepare("SELECT id FROM tracks WHERE project_id = ?1 ORDER BY track_order")
        .map_err(|e| format!("查询轨道失败: {}", e))?;

    let track_ids: Vec<String> = track_stmt
        .query_map(params![project_id], |row| row.get(0))
        .map_err(|e| format!("读取轨道失败: {}", e))?
        .filter_map(|t| t.ok())
        .collect();
    drop(track_stmt);

    let mut frame_layers: BTreeMap<i64, Vec<(String, f64, f64, f64, f64, f64)>> = BTreeMap::new();

    for track_id in &track_ids {
        let mut asset_stmt = conn
            .prepare("SELECT source_path, start_frame, transform_x, transform_y, transform_scale_x, transform_scale_y, transform_rotation FROM assets WHERE track_id = ?1 ORDER BY start_frame")
            .map_err(|e| format!("查询资产失败: {}", e))?;

        let rows: Vec<(String, i64, f64, f64, f64, f64, f64)> = asset_stmt
            .query_map(params![track_id], |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                    row.get(6)?,
                ))
            })
            .map_err(|e| format!("读取资产行失败: {}", e))?
            .filter_map(|r| r.ok())
            .collect();

        for (source_path, start_frame, tx, ty, sx, sy, rot) in rows {
            frame_layers
                .entry(start_frame)
                .or_default()
                .push((source_path, tx, ty, sx, sy, rot));
        }
    }

    if frame_layers.is_empty() {
        return Err("没有可导出的帧".to_string());
    }

    let output_file = File::create(&output_path).map_err(|e| format!("创建输出文件失败: {}", e))?;
    let writer = std::io::BufWriter::new(output_file);
    let mut encoder = image::codecs::gif::GifEncoder::new(writer);
    encoder
        .set_repeat(image::codecs::gif::Repeat::Infinite)
        .map_err(|e| format!("设置 GIF 循环失败: {}", e))?;

    let frame_delay_ms = (1000.0 / fps as f64).round() as u32;
    let mut exported = 0;

    for (_, layers) in frame_layers.iter() {
        let mut canvas = image::RgbaImage::new(canvas_w as u32, canvas_h as u32);

        for (source_path, tx, ty, sx, sy, _rot) in layers {
            let src_path = Path::new(source_path);
            if !src_path.exists() {
                continue;
            }
            let data = std::fs::read(&source_path).map_err(|e| format!("读取帧失败: {}", e))?;
            let img = image::load_from_memory(&data).map_err(|e| format!("解码帧失败: {}", e))?;
            let rgba = img.to_rgba8();
            let (img_w, img_h) = (rgba.width() as f64, rgba.height() as f64);
            let cx = canvas_w as f64 / 2.0 + tx;
            let cy = canvas_h as f64 / 2.0 + ty;
            let scaled_w = (img_w * sx).max(1.0) as u32;
            let scaled_h = (img_h * sy).max(1.0) as u32;
            let scaled = image::imageops::resize(
                &rgba,
                scaled_w,
                scaled_h,
                image::imageops::FilterType::Lanczos3,
            );
            let x = (cx - scaled_w as f64 / 2.0).round() as i64;
            let y = (cy - scaled_h as f64 / 2.0).round() as i64;
            image::imageops::overlay(&mut canvas, &scaled, x, y);
        }

        let frame = image::Frame::from_parts(
            canvas,
            0,
            0,
            image::Delay::from_numer_denom_ms(frame_delay_ms, 1),
        );
        encoder
            .encode_frame(frame)
            .map_err(|e| format!("编码 GIF 帧失败: {}", e))?;
        exported += 1;
    }

    Ok(exported)
}
