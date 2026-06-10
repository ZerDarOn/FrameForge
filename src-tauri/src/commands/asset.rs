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
pub fn get_project_tracks(db: State<'_, DbState>, project_id: String) -> Result<Vec<TrackInfo>, String> {
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

    Ok(format!("data:{};base64,{}", mime, base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &data)))
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
        return Ok(format!("data:{};base64,{}", orig_mime, base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &data)));
    }

    // 解码 → 缩放 → 编码
    let img = image::load_from_memory(&data)
        .map_err(|e| format!("解码图片失败: {}", e))?;
    let thumb = img.thumbnail(max_width, max_height);

    let mut buf = Vec::new();
    match img_format {
        image::ImageFormat::Jpeg => {
            let quality = jpeg_quality.unwrap_or(85).min(100);
            let encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buf, quality);
            thumb.write_with_encoder(encoder)
                .map_err(|e| format!("编码 JPEG 缩略图失败: {}", e))?;
        }
        _ => {
            thumb.write_to(&mut std::io::Cursor::new(&mut buf), image::ImageFormat::Png)
                .map_err(|e| format!("编码 PNG 缩略图失败: {}", e))?;
        }
    }

    Ok(format!("data:{};base64,{}", mime, base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &buf)))
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

/// 导出当前项目的所有帧为 PNG 序列到指定目录
#[tauri::command]
pub fn export_png_sequence(
    db: State<'_, DbState>,
    project_id: String,
    output_dir: String,
) -> Result<usize, String> {
    let conn = db.lock().map_err(|e| format!("数据库锁失败: {}", e))?;

    // 获取所有轨道的所有资产
    let mut track_stmt = conn
        .prepare("SELECT id FROM tracks WHERE project_id = ?1 ORDER BY track_order")
        .map_err(|e| format!("查询轨道失败: {}", e))?;

    let track_ids: Vec<String> = track_stmt
        .query_map(params![project_id], |row| row.get(0))
        .map_err(|e| format!("读取轨道失败: {}", e))?
        .filter_map(|t| t.ok())
        .collect();
    drop(track_stmt);

    // 创建输出目录
    std::fs::create_dir_all(&output_dir)
        .map_err(|e| format!("创建输出目录失败: {}", e))?;

    let mut exported = 0;
    let mut frame_index = 0;

    for track_id in track_ids {
        let mut asset_stmt = conn
            .prepare("SELECT source_path FROM assets WHERE track_id = ?1 ORDER BY start_frame")
            .map_err(|e| format!("查询资产失败: {}", e))?;

        let paths: Vec<String> = asset_stmt
            .query_map(params![track_id], |row| row.get(0))
            .map_err(|e| format!("读取资产失败: {}", e))?
            .filter_map(|p| p.ok())
            .collect();

        for source_path in paths {
            let src = Path::new(&source_path);
            if !src.exists() {
                continue;
            }

            let output_name = format!("frame_{:05}.png", frame_index);
            let output_path = Path::new(&output_dir).join(&output_name);

            std::fs::copy(&source_path, &output_path)
                .map_err(|e| format!("复制帧失败: {}", e))?;

            frame_index += 1;
            exported += 1;
        }
    }

    Ok(exported)
}

fn get_image_dimensions(path: &str) -> (i64, i64) {
    if let Ok(data) = std::fs::read(path) {
        if data.len() > 24 && data[0..4] == [0x89, 0x50, 0x4E, 0x47] {
            let w = ((data[16] as u32) << 24) | ((data[17] as u32) << 16) | ((data[18] as u32) << 8) | data[19] as u32;
            let h = ((data[20] as u32) << 24) | ((data[21] as u32) << 16) | ((data[22] as u32) << 8) | data[23] as u32;
            return (w as i64, h as i64);
        }
        if data.len() > 4 && data[0..2] == [0xFF, 0xD8] {
            let mut i = 2;
            while i + 9 < data.len() {
                if data[i] != 0xFF { break; }
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

/// 导出当前项目为 GIF 动画
#[tauri::command]
pub fn export_gif(
    db: State<'_, DbState>,
    project_id: String,
    output_path: String,
    fps: i64,
) -> Result<usize, String> {
    let conn = db.lock().map_err(|e| format!("数据库锁失败: {}", e))?;

    let mut track_stmt = conn
        .prepare("SELECT id FROM tracks WHERE project_id = ?1 ORDER BY track_order")
        .map_err(|e| format!("查询轨道失败: {}", e))?;

    let track_ids: Vec<String> = track_stmt
        .query_map(params![project_id], |row| row.get(0))
        .map_err(|e| format!("读取轨道失败: {}", e))?
        .filter_map(|t| t.ok())
        .collect();
    drop(track_stmt);

    let mut frame_paths: Vec<String> = Vec::new();
    for track_id in &track_ids {
        let mut asset_stmt = conn
            .prepare("SELECT source_path FROM assets WHERE track_id = ?1 ORDER BY start_frame")
            .map_err(|e| format!("查询资产失败: {}", e))?;

        let paths: Vec<String> = asset_stmt
            .query_map(params![track_id], |row| row.get(0))
            .map_err(|e| format!("读取资产失败: {}", e))?
            .filter_map(|p| p.ok())
            .collect();

        frame_paths.extend(paths);
    }

    if frame_paths.is_empty() {
        return Err("没有可导出的帧".to_string());
    }

    use std::fs::File;
    use std::io::BufWriter;

    let output_file = File::create(&output_path)
        .map_err(|e| format!("创建输出文件失败: {}", e))?;
    let writer = BufWriter::new(output_file);

    let mut encoder = image::codecs::gif::GifEncoder::new(writer);
    encoder.set_repeat(image::codecs::gif::Repeat::Infinite)
        .map_err(|e| format!("设置 GIF 循环失败: {}", e))?;

    let frame_delay_ms = (1000.0 / fps as f64).round() as u32;

    for (i, path) in frame_paths.iter().enumerate() {
        let src = Path::new(path);
        if !src.exists() { continue; }

        let img = image::ImageReader::open(path)
            .map_err(|e| format!("打开帧 {} 失败: {}", i, e))?
            .decode()
            .map_err(|e| format!("解码帧 {} 失败: {}", i, e))?;

        let rgba = img.to_rgba8();
        let frame = image::Frame::from_parts(
            rgba,
            0, 0,
            image::Delay::from_numer_denom_ms(frame_delay_ms, 1),
        );

        encoder.encode_frame(frame)
            .map_err(|e| format!("编码帧 {} 失败: {}", i, e))?;
    }

    Ok(frame_paths.len())
}
