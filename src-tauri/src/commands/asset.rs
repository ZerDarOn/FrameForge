use crate::db::DbState;
use image::{AnimationDecoder, ImageDecoder};
use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::{
    fs::File,
    io::BufReader,
    path::{Path, PathBuf},
    process::{Command, Stdio},
};
use tauri::{AppHandle, Emitter, Manager, State};

const MAX_SPRITE_SHEET_FRAMES: usize = 10_000;
const MAX_SPRITE_SHEET_PIXELS: u64 = 67_108_864;
const MAX_GIF_FRAMES: usize = 10_000;
const MAX_GIF_CANVAS_PIXELS: u64 = 16_777_216;
const MAX_GIF_DECODED_PIXELS: u64 = 268_435_456;
const MAX_GIF_OUTPUT_BYTES: u64 = 1_073_741_824;
const MAX_VIDEO_FRAMES: usize = 10_000;
const MAX_VIDEO_CANVAS_PIXELS: u64 = 16_777_216;
const MAX_VIDEO_INPUT_BYTES: u64 = 4_294_967_296;
const MAX_VIDEO_OUTPUT_BYTES: u64 = 1_073_741_824;
const FFMPEG_DIRECTORY_ENV: &str = "FRAMEFORGE_FFMPEG_DIR";

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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageFileInfo {
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VideoFileInfo {
    pub width: u32,
    pub height: u32,
    pub duration_seconds: f64,
}

#[derive(Debug, Deserialize)]
struct VideoProbeOutput {
    #[serde(default)]
    streams: Vec<VideoProbeStream>,
    format: Option<VideoProbeFormat>,
}

#[derive(Debug, Deserialize)]
struct VideoProbeStream {
    width: Option<u32>,
    height: Option<u32>,
    duration: Option<String>,
}

#[derive(Debug, Deserialize)]
struct VideoProbeFormat {
    duration: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SpriteSheetImportProgress {
    operation_id: String,
    project_id: String,
    stage: String,
    completed: usize,
    total: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct GifImportProgress {
    operation_id: String,
    project_id: String,
    stage: String,
    completed: usize,
    total: Option<usize>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct VideoImportProgress {
    operation_id: String,
    project_id: String,
    stage: String,
    completed: usize,
    total: Option<usize>,
}

#[derive(Debug)]
struct PreparedImportedFrame {
    path: String,
    width: i64,
    height: i64,
    start_frame: i64,
    duration_frames: i64,
    source_timestamp: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct VideoFrameTiming {
    source_timestamp: i64,
    start_frame: i64,
    duration_frames: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct SpriteSheetSliceRect {
    index: usize,
    x: u32,
    y: u32,
    width: u32,
    height: u32,
}

fn gif_delay_to_ticks(numerator_ms: u32, denominator: u32, fps: i64) -> i64 {
    if denominator == 0 || fps <= 0 {
        return 1;
    }
    let scaled_numerator = u64::from(numerator_ms) * fps as u64;
    let scaled_denominator = u64::from(denominator) * 1_000;
    ((scaled_numerator + scaled_denominator / 2) / scaled_denominator).max(1) as i64
}

fn plan_video_frame_timing(
    start_seconds: f64,
    end_seconds: f64,
    sample_fps: f64,
    project_fps: i64,
) -> Result<Vec<VideoFrameTiming>, String> {
    if !start_seconds.is_finite()
        || !end_seconds.is_finite()
        || !sample_fps.is_finite()
        || start_seconds < 0.0
        || end_seconds <= start_seconds
    {
        return Err("视频抽帧范围无效".to_string());
    }
    if !(1..=240).contains(&project_fps) || sample_fps <= 0.0 || sample_fps > project_fps as f64 {
        return Err("抽帧帧率必须大于 0 且不高于项目帧率".to_string());
    }

    let duration_seconds = end_seconds - start_seconds;
    let expected_frames = duration_seconds * sample_fps;
    if !expected_frames.is_finite() || expected_frames <= 0.0 {
        return Err("视频抽帧范围内没有可导入帧".to_string());
    }
    let frame_count = expected_frames.ceil() as usize;
    if frame_count > MAX_VIDEO_FRAMES {
        return Err(format!("视频抽帧不能超过 {} 帧", MAX_VIDEO_FRAMES));
    }

    let mut timing = Vec::with_capacity(frame_count);
    for index in 0..frame_count {
        let source_offset_seconds = index as f64 / sample_fps;
        let next_source_offset_seconds = ((index + 1) as f64 / sample_fps).min(duration_seconds);
        let start_frame = (source_offset_seconds * project_fps as f64).round() as i64;
        let end_frame = (next_source_offset_seconds * project_fps as f64).round() as i64;
        timing.push(VideoFrameTiming {
            source_timestamp: ((start_seconds + source_offset_seconds) * 1_000.0).round() as i64,
            start_frame,
            duration_frames: (end_frame - start_frame).max(1),
        });
    }
    Ok(timing)
}

fn parse_video_probe(output: &str) -> Result<VideoFileInfo, String> {
    let probe: VideoProbeOutput =
        serde_json::from_str(output).map_err(|error| format!("解析视频信息失败: {}", error))?;
    let stream = probe
        .streams
        .first()
        .ok_or_else(|| "视频中没有可用的视频轨道".to_string())?;
    let width = stream
        .width
        .ok_or_else(|| "视频轨道缺少宽度信息".to_string())?;
    let height = stream
        .height
        .ok_or_else(|| "视频轨道缺少高度信息".to_string())?;
    let parse_duration = |value: &str| {
        value
            .parse::<f64>()
            .ok()
            .filter(|duration| duration.is_finite() && *duration > 0.0)
    };
    let duration_seconds = stream
        .duration
        .as_deref()
        .and_then(parse_duration)
        .or_else(|| {
            probe
                .format
                .as_ref()
                .and_then(|format| format.duration.as_deref())
                .and_then(parse_duration)
        })
        .ok_or_else(|| "视频缺少有效时长信息".to_string())?;
    let canvas_pixels = u64::from(width) * u64::from(height);
    if width == 0 || height == 0 || canvas_pixels > MAX_VIDEO_CANVAS_PIXELS {
        return Err("视频尺寸或时长超出安全范围".to_string());
    }
    Ok(VideoFileInfo {
        width,
        height,
        duration_seconds,
    })
}

fn resolve_ffmpeg_tool(tool_name: &str) -> Result<PathBuf, String> {
    let executable_name = if cfg!(windows) {
        format!("{}.exe", tool_name)
    } else {
        tool_name.to_string()
    };
    if let Ok(directory) = std::env::var(FFMPEG_DIRECTORY_ENV) {
        let candidate = PathBuf::from(directory).join(&executable_name);
        if candidate.is_file() {
            return Ok(candidate);
        }
    }

    let path_candidate = PathBuf::from(&executable_name);
    let available_on_path = Command::new(&path_candidate)
        .arg("-version")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|status| status.success());
    if available_on_path {
        return Ok(path_candidate);
    }

    Err(format!(
        "未找到 {}。请安装 FFmpeg，并将 {} 设置为包含 ffmpeg 与 ffprobe 的目录",
        tool_name, FFMPEG_DIRECTORY_ENV
    ))
}

fn bounded_process_error(stderr: &[u8]) -> String {
    String::from_utf8_lossy(stderr)
        .trim()
        .chars()
        .take(512)
        .collect()
}

fn inspect_video_path(source_path: &str) -> Result<VideoFileInfo, String> {
    let metadata =
        std::fs::metadata(source_path).map_err(|error| format!("读取视频失败: {}", error))?;
    if !metadata.is_file() || metadata.len() > MAX_VIDEO_INPUT_BYTES {
        return Err("视频必须是小于 4 GiB 的文件".to_string());
    }

    let ffprobe = resolve_ffmpeg_tool("ffprobe")?;
    let output = Command::new(ffprobe)
        .args([
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=width,height,duration:format=duration",
            "-of",
            "json",
        ])
        .arg(source_path)
        .stdin(Stdio::null())
        .output()
        .map_err(|error| format!("启动 ffprobe 失败: {}", error))?;
    if !output.status.success() {
        let details = bounded_process_error(&output.stderr);
        return Err(if details.is_empty() {
            "ffprobe 无法读取视频".to_string()
        } else {
            format!("ffprobe 无法读取视频: {}", details)
        });
    }
    let stdout = String::from_utf8(output.stdout)
        .map_err(|_| "ffprobe 返回了无效的 UTF-8 数据".to_string())?;
    parse_video_probe(&stdout)
}

#[tauri::command]
pub async fn inspect_video_file(source_path: String) -> Result<VideoFileInfo, String> {
    tauri::async_runtime::spawn_blocking(move || inspect_video_path(&source_path))
        .await
        .map_err(|error| format!("视频检查工作线程失败: {}", error))?
}

fn plan_sprite_sheet_slices(
    sheet_width: u32,
    sheet_height: u32,
    cell_width: u32,
    cell_height: u32,
    offset_x: u32,
    offset_y: u32,
    spacing_x: u32,
    spacing_y: u32,
    frame_count: Option<u32>,
) -> Result<Vec<SpriteSheetSliceRect>, String> {
    if cell_width == 0 || cell_height == 0 {
        return Err("切片宽高必须为正整数".to_string());
    }
    let available_width = sheet_width.saturating_sub(offset_x);
    let available_height = sheet_height.saturating_sub(offset_y);
    let columns = (u64::from(available_width) + u64::from(spacing_x))
        / (u64::from(cell_width) + u64::from(spacing_x));
    let rows = (u64::from(available_height) + u64::from(spacing_y))
        / (u64::from(cell_height) + u64::from(spacing_y));
    let available_cells = columns.saturating_mul(rows);
    if available_cells == 0 {
        return Err("精灵图网格中没有完整画格".to_string());
    }
    let requested_count =
        u64::from(frame_count.unwrap_or(available_cells.min(u64::from(u32::MAX)) as u32));
    if requested_count == 0 || requested_count > available_cells {
        return Err(format!("请求帧数必须在 1 到 {} 之间", available_cells));
    }
    if requested_count > MAX_SPRITE_SHEET_FRAMES as u64 {
        return Err(format!("单次切片不能超过 {} 帧", MAX_SPRITE_SHEET_FRAMES));
    }

    let mut slices = Vec::with_capacity(requested_count as usize);
    for index in 0..requested_count {
        let column = index % columns;
        let row = index / columns;
        let x = u64::from(offset_x) + column * (u64::from(cell_width) + u64::from(spacing_x));
        let y = u64::from(offset_y) + row * (u64::from(cell_height) + u64::from(spacing_y));
        slices.push(SpriteSheetSliceRect {
            index: index as usize,
            x: u32::try_from(x).map_err(|_| "精灵图横向切片坐标超出范围".to_string())?,
            y: u32::try_from(y).map_err(|_| "精灵图纵向切片坐标超出范围".to_string())?,
            width: cell_width,
            height: cell_height,
        });
    }
    Ok(slices)
}

fn inspect_sprite_sheet(path: &str) -> Result<ImageFileInfo, String> {
    let metadata = std::fs::metadata(path).map_err(|e| format!("读取精灵图失败: {}", e))?;
    if !metadata.is_file() || metadata.len() > 64 * 1024 * 1024 {
        return Err("精灵图必须是小于 64 MiB 的文件".to_string());
    }
    let (width, height) =
        image::image_dimensions(path).map_err(|e| format!("读取精灵图尺寸失败: {}", e))?;
    if width == 0
        || height == 0
        || width > 16_384
        || height > 16_384
        || u64::from(width) * u64::from(height) > MAX_SPRITE_SHEET_PIXELS
    {
        return Err("精灵图尺寸或像素总量超出安全范围".to_string());
    }
    Ok(ImageFileInfo { width, height })
}

#[tauri::command]
pub fn inspect_image_file(file_path: String) -> Result<ImageFileInfo, String> {
    inspect_sprite_sheet(&file_path)
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
        if name.trim().is_empty() || name.chars().count() > 128 {
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
            project_id: project_id.clone(),
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

fn cleanup_sprite_sheet_output(file_paths: &[String], output_dir: &Path) {
    for file_path in file_paths {
        if let Err(error) = std::fs::remove_file(file_path) {
            if error.kind() != std::io::ErrorKind::NotFound {
                log::warn!("sprite sheet frame cleanup failed");
            }
        }
    }
    if let Err(error) = std::fs::remove_dir(output_dir) {
        if error.kind() != std::io::ErrorKind::NotFound {
            log::warn!("sprite sheet output directory cleanup failed");
        }
    }
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn slice_sprite_sheet_to_new_track(
    app: AppHandle,
    operation_id: String,
    project_id: String,
    name: String,
    source_path: String,
    cell_width: u32,
    cell_height: u32,
    offset_x: u32,
    offset_y: u32,
    spacing_x: u32,
    spacing_y: u32,
    frame_count: Option<u32>,
    fps: i64,
) -> Result<TrackInfo, String> {
    let state_app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let db = state_app.state::<DbState>();
        slice_sprite_sheet_to_new_track_blocking(
            db,
            &state_app,
            operation_id,
            project_id,
            name,
            source_path,
            cell_width,
            cell_height,
            offset_x,
            offset_y,
            spacing_x,
            spacing_y,
            frame_count,
            fps,
        )
    })
    .await
    .map_err(|error| format!("精灵图导入工作线程失败: {}", error))?
}

#[allow(clippy::too_many_arguments)]
fn slice_sprite_sheet_to_new_track_blocking(
    db: State<'_, DbState>,
    app: &AppHandle,
    operation_id: String,
    project_id: String,
    name: String,
    source_path: String,
    cell_width: u32,
    cell_height: u32,
    offset_x: u32,
    offset_y: u32,
    spacing_x: u32,
    spacing_y: u32,
    frame_count: Option<u32>,
    fps: i64,
) -> Result<TrackInfo, String> {
    log::info!(
        "sprite sheet import started: operation_id={}, project_id={}",
        operation_id,
        project_id
    );
    if operation_id.is_empty()
        || operation_id.len() > 128
        || !operation_id.chars().all(|character| {
            character.is_ascii_alphanumeric() || character == '-' || character == '_'
        })
    {
        return Err("精灵图导入 operationId 无效".to_string());
    }
    if name.trim().is_empty() || name.chars().count() > 128 {
        return Err("轨道名称必须为 1..=128 个字符".to_string());
    }
    if !(1..=240).contains(&fps) {
        return Err("项目帧率必须在 1..=240 范围内".to_string());
    }
    {
        let conn = db.lock().map_err(|e| format!("数据库锁失败: {}", e))?;
        let project_exists: bool = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM projects WHERE id = ?1)",
                params![project_id],
                |row| row.get(0),
            )
            .map_err(|e| format!("检查项目失败: {}", e))?;
        if !project_exists {
            return Err("精灵图导入目标项目不存在".to_string());
        }
    }

    let image_info = inspect_sprite_sheet(&source_path)?;
    let slices = plan_sprite_sheet_slices(
        image_info.width,
        image_info.height,
        cell_width,
        cell_height,
        offset_x,
        offset_y,
        spacing_x,
        spacing_y,
        frame_count,
    )?;
    let source_image = image::open(&source_path).map_err(|e| format!("解码精灵图失败: {}", e))?;
    let output_root = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("获取应用目录失败: {}", e))?
        .join("processed")
        .join("sprite_sheets");
    std::fs::create_dir_all(&output_root)
        .map_err(|e| format!("创建精灵图输出根目录失败: {}", e))?;
    let output_dir = output_root.join(&operation_id);
    std::fs::create_dir(&output_dir).map_err(|e| format!("创建精灵图输出目录失败: {}", e))?;

    let mut file_paths = Vec::with_capacity(slices.len());
    let total_slices = slices.len();
    let progress_interval = (total_slices / 100).max(1);
    let _ = app.emit(
        "sprite-sheet-progress",
        SpriteSheetImportProgress {
            operation_id: operation_id.clone(),
            project_id: project_id.clone(),
            stage: "slicing".to_string(),
            completed: 0,
            total: total_slices,
        },
    );
    let prepare_result = (|| -> Result<(), String> {
        for slice in slices {
            let output_path = output_dir.join(format!("frame_{:05}.png", slice.index));
            let output_path_string = output_path.to_string_lossy().to_string();
            file_paths.push(output_path_string);
            source_image
                .crop_imm(slice.x, slice.y, slice.width, slice.height)
                .save(&output_path)
                .map_err(|e| format!("写入切片 PNG 失败: {}", e))?;
            let dimensions = image::image_dimensions(&output_path)
                .map_err(|e| format!("验证切片 PNG 失败: {}", e))?;
            if dimensions != (slice.width, slice.height) {
                return Err("切片 PNG 尺寸验证失败".to_string());
            }
            let completed = file_paths.len();
            if completed == total_slices || completed % progress_interval == 0 {
                let _ = app.emit(
                    "sprite-sheet-progress",
                    SpriteSheetImportProgress {
                        operation_id: operation_id.clone(),
                        project_id: project_id.clone(),
                        stage: "slicing".to_string(),
                        completed,
                        total: total_slices,
                    },
                );
            }
        }
        Ok(())
    })();
    if let Err(error) = prepare_result {
        cleanup_sprite_sheet_output(&file_paths, &output_dir);
        log::warn!(
            "sprite sheet import failed: operation_id={}, project_id={}, stage=prepare",
            operation_id,
            project_id
        );
        return Err(error);
    }

    let _ = app.emit(
        "sprite-sheet-progress",
        SpriteSheetImportProgress {
            operation_id: operation_id.clone(),
            project_id: project_id.clone(),
            stage: "committing".to_string(),
            completed: total_slices,
            total: total_slices,
        },
    );

    let result = import_files_to_new_track(
        db,
        operation_id.clone(),
        project_id.clone(),
        name,
        "image_sequence".to_string(),
        file_paths.clone(),
        0,
        fps,
        0,
    );
    match &result {
        Ok(track) => log::info!(
            "sprite sheet import committed: operation_id={}, project_id={}, track_id={}, frame_count={}",
            operation_id,
            project_id,
            track.id,
            track.assets.len()
        ),
        Err(_) => {
            cleanup_sprite_sheet_output(&file_paths, &output_dir);
            log::warn!(
                "sprite sheet import failed: operation_id={}, project_id={}, stage=commit",
                operation_id,
                project_id
            );
        }
    }
    result
}

fn cleanup_import_output(file_paths: &[String], output_dir: &Path, import_kind: &str) {
    for file_path in file_paths {
        if let Err(error) = std::fs::remove_file(file_path) {
            if error.kind() != std::io::ErrorKind::NotFound {
                log::warn!("{} frame cleanup failed", import_kind);
            }
        }
    }
    if let Err(error) = std::fs::remove_dir(output_dir) {
        if error.kind() != std::io::ErrorKind::NotFound {
            log::warn!("{} output directory cleanup failed", import_kind);
        }
    }
}

fn commit_imported_frames_to_new_track(
    db: State<'_, DbState>,
    project_id: &str,
    name: &str,
    frames: &[PreparedImportedFrame],
    frame_name_prefix: &str,
) -> Result<TrackInfo, String> {
    let track_id = uuid::Uuid::new_v4().to_string();
    let assets: Vec<AssetInfo> = frames
        .iter()
        .enumerate()
        .map(|(index, frame)| AssetInfo {
            id: uuid::Uuid::new_v4().to_string(),
            track_id: track_id.clone(),
            name: format!("{} {}", frame_name_prefix, index + 1),
            source_type: "image".to_string(),
            source_path: frame.path.clone(),
            thumbnail_path: frame.path.clone(),
            start_frame: frame.start_frame,
            duration_frames: frame.duration_frames,
            width: frame.width,
            height: frame.height,
            transform_x: 0.0,
            transform_y: 0.0,
            transform_scale_x: 1.0,
            transform_scale_y: 1.0,
            transform_rotation: 0.0,
            alignment_dx: 0.0,
            alignment_dy: 0.0,
            matched_fps: true,
            source_timestamp: frame.source_timestamp,
        })
        .collect();

    let mut conn = db
        .lock()
        .map_err(|error| format!("数据库锁失败: {}", error))?;
    let tx = conn
        .transaction()
        .map_err(|error| format!("开始动画帧导入事务失败: {}", error))?;
    let project_exists: bool = tx
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM projects WHERE id = ?1)",
            params![project_id],
            |row| row.get(0),
        )
        .map_err(|error| format!("检查动画帧导入项目失败: {}", error))?;
    if !project_exists {
        return Err("动画帧导入目标项目不存在".to_string());
    }
    let track_order: i64 = tx
        .query_row(
            "SELECT COALESCE(MAX(track_order), -1) + 1 FROM tracks WHERE project_id = ?1",
            params![project_id],
            |row| row.get(0),
        )
        .map_err(|error| format!("读取动画帧轨道顺序失败: {}", error))?;
    tx.execute(
        "INSERT INTO tracks (id, project_id, name, type, visible, locked, opacity, track_order)
         VALUES (?1, ?2, ?3, 'image_sequence', 1, 0, 1.0, ?4)",
        params![&track_id, project_id, name, track_order],
    )
    .map_err(|error| format!("创建动画帧轨道失败: {}", error))?;
    for asset in &assets {
        tx.execute(
            "INSERT INTO assets (id, track_id, name, source_type, source_path, thumbnail_path, start_frame, duration_frames, width, height, matched_fps, source_timestamp)
             VALUES (?1, ?2, ?3, 'image', ?4, ?5, ?6, ?7, ?8, ?9, 1, ?10)",
            params![
                &asset.id,
                &asset.track_id,
                &asset.name,
                &asset.source_path,
                &asset.thumbnail_path,
                asset.start_frame,
                asset.duration_frames,
                asset.width,
                asset.height,
                asset.source_timestamp,
            ],
        )
        .map_err(|error| format!("写入动画画格失败: {}", error))?;
    }
    tx.commit()
        .map_err(|error| format!("提交动画帧导入事务失败: {}", error))?;

    Ok(TrackInfo {
        id: track_id,
        project_id: project_id.to_string(),
        name: name.to_string(),
        track_type: "image_sequence".to_string(),
        visible: true,
        locked: false,
        opacity: 1.0,
        track_order,
        assets,
    })
}

#[tauri::command]
pub async fn import_gif_to_new_track(
    app: AppHandle,
    operation_id: String,
    project_id: String,
    name: String,
    source_path: String,
    fps: i64,
) -> Result<TrackInfo, String> {
    let state_app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let db = state_app.state::<DbState>();
        import_gif_to_new_track_blocking(
            db,
            &state_app,
            operation_id,
            project_id,
            name,
            source_path,
            fps,
        )
    })
    .await
    .map_err(|error| format!("GIF 导入工作线程失败: {}", error))?
}

fn import_gif_to_new_track_blocking(
    db: State<'_, DbState>,
    app: &AppHandle,
    operation_id: String,
    project_id: String,
    name: String,
    source_path: String,
    fps: i64,
) -> Result<TrackInfo, String> {
    log::info!(
        "gif import started: operation_id={}, project_id={}",
        operation_id,
        project_id
    );
    if operation_id.is_empty()
        || operation_id.len() > 128
        || !operation_id.chars().all(|character| {
            character.is_ascii_alphanumeric() || character == '-' || character == '_'
        })
    {
        return Err("GIF 导入 operationId 无效".to_string());
    }
    if name.trim().is_empty() || name.chars().count() > 128 {
        return Err("轨道名称必须为 1..=128 个字符".to_string());
    }
    if !(1..=240).contains(&fps) {
        return Err("项目帧率必须在 1..=240 范围内".to_string());
    }
    {
        let conn = db
            .lock()
            .map_err(|error| format!("数据库锁失败: {}", error))?;
        let project_exists: bool = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM projects WHERE id = ?1)",
                params![&project_id],
                |row| row.get(0),
            )
            .map_err(|error| format!("检查 GIF 导入项目失败: {}", error))?;
        if !project_exists {
            return Err("GIF 导入目标项目不存在".to_string());
        }
    }

    let source_metadata =
        std::fs::metadata(&source_path).map_err(|error| format!("读取 GIF 失败: {}", error))?;
    if !source_metadata.is_file() || source_metadata.len() > 64 * 1024 * 1024 {
        return Err("GIF 必须是小于 64 MiB 的文件".to_string());
    }
    let source_file =
        File::open(&source_path).map_err(|error| format!("打开 GIF 失败: {}", error))?;
    let decoder = image::codecs::gif::GifDecoder::new(BufReader::new(source_file))
        .map_err(|error| format!("解码 GIF 头失败: {}", error))?;
    let (width, height) = decoder.dimensions();
    let canvas_pixels = u64::from(width) * u64::from(height);
    if width == 0 || height == 0 || canvas_pixels > MAX_GIF_CANVAS_PIXELS {
        return Err("GIF 画布尺寸或像素总量超出安全范围".to_string());
    }

    let output_root = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("获取应用目录失败: {}", error))?
        .join("processed")
        .join("gifs");
    std::fs::create_dir_all(&output_root)
        .map_err(|error| format!("创建 GIF 输出根目录失败: {}", error))?;
    let output_dir = output_root.join(&operation_id);
    std::fs::create_dir(&output_dir)
        .map_err(|error| format!("创建 GIF 输出目录失败: {}", error))?;

    let mut file_paths = Vec::new();
    let result = (|| -> Result<TrackInfo, String> {
        let _ = app.emit(
            "gif-import-progress",
            GifImportProgress {
                operation_id: operation_id.clone(),
                project_id: project_id.clone(),
                stage: "decoding".to_string(),
                completed: 0,
                total: None,
            },
        );
        let mut prepared_frames = Vec::new();
        let mut decoded_pixels = 0_u64;
        let mut output_bytes = 0_u64;
        let mut timeline_tick = 0_i64;
        let mut source_timestamp_ms = 0_f64;

        for (index, frame_result) in decoder.into_frames().enumerate() {
            if index >= MAX_GIF_FRAMES {
                return Err(format!("GIF 不能超过 {} 帧", MAX_GIF_FRAMES));
            }
            let frame = frame_result.map_err(|error| format!("解码 GIF 帧失败: {}", error))?;
            let (delay_numerator, delay_denominator) = frame.delay().numer_denom_ms();
            let duration_frames = gif_delay_to_ticks(delay_numerator, delay_denominator, fps);
            let buffer = frame.into_buffer();
            if buffer.width() != width || buffer.height() != height {
                return Err("GIF 解码帧与画布尺寸不一致".to_string());
            }
            decoded_pixels = decoded_pixels
                .checked_add(canvas_pixels)
                .ok_or_else(|| "GIF 解码像素计数溢出".to_string())?;
            if decoded_pixels > MAX_GIF_DECODED_PIXELS {
                return Err("GIF 解码后的总像素量超出安全范围".to_string());
            }

            let output_path = output_dir.join(format!("frame_{:05}.png", index));
            let output_path_string = output_path.to_string_lossy().to_string();
            file_paths.push(output_path_string.clone());
            buffer
                .save(&output_path)
                .map_err(|error| format!("写入 GIF 帧 PNG 失败: {}", error))?;
            output_bytes = output_bytes
                .checked_add(
                    std::fs::metadata(&output_path)
                        .map_err(|error| format!("检查 GIF 帧文件失败: {}", error))?
                        .len(),
                )
                .ok_or_else(|| "GIF 输出体积计数溢出".to_string())?;
            if output_bytes > MAX_GIF_OUTPUT_BYTES {
                return Err("GIF 解码后的文件总量超过 1 GiB".to_string());
            }

            prepared_frames.push(PreparedImportedFrame {
                path: output_path_string,
                width: i64::from(width),
                height: i64::from(height),
                start_frame: timeline_tick,
                duration_frames,
                source_timestamp: source_timestamp_ms.round() as i64,
            });
            timeline_tick = timeline_tick
                .checked_add(duration_frames)
                .ok_or_else(|| "GIF 时间线长度溢出".to_string())?;
            source_timestamp_ms += f64::from(delay_numerator) / f64::from(delay_denominator.max(1));

            let completed = prepared_frames.len();
            if completed == 1 || completed % 10 == 0 {
                let _ = app.emit(
                    "gif-import-progress",
                    GifImportProgress {
                        operation_id: operation_id.clone(),
                        project_id: project_id.clone(),
                        stage: "decoding".to_string(),
                        completed,
                        total: None,
                    },
                );
            }
        }
        if prepared_frames.is_empty() {
            return Err("GIF 中没有可导入的动画帧".to_string());
        }

        let _ = app.emit(
            "gif-import-progress",
            GifImportProgress {
                operation_id: operation_id.clone(),
                project_id: project_id.clone(),
                stage: "committing".to_string(),
                completed: prepared_frames.len(),
                total: Some(prepared_frames.len()),
            },
        );
        commit_imported_frames_to_new_track(
            db,
            &project_id,
            name.trim(),
            &prepared_frames,
            "GIF 帧",
        )
    })();

    match &result {
        Ok(track) => log::info!(
            "gif import committed: operation_id={}, project_id={}, track_id={}, frame_count={}, timeline_ticks={}",
            operation_id,
            project_id,
            track.id,
            track.assets.len(),
            track.assets.iter().map(|asset| asset.duration_frames).sum::<i64>()
        ),
        Err(_) => {
            cleanup_import_output(&file_paths, &output_dir, "gif");
            log::warn!(
                "gif import failed: operation_id={}, project_id={}",
                operation_id,
                project_id
            );
        }
    }
    result
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn import_video_to_new_track(
    app: AppHandle,
    operation_id: String,
    project_id: String,
    name: String,
    source_path: String,
    start_seconds: f64,
    end_seconds: f64,
    sample_fps: f64,
    project_fps: i64,
) -> Result<TrackInfo, String> {
    let state_app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let db = state_app.state::<DbState>();
        import_video_to_new_track_blocking(
            db,
            &state_app,
            operation_id,
            project_id,
            name,
            source_path,
            start_seconds,
            end_seconds,
            sample_fps,
            project_fps,
        )
    })
    .await
    .map_err(|error| format!("视频导入工作线程失败: {}", error))?
}

#[allow(clippy::too_many_arguments)]
fn import_video_to_new_track_blocking(
    db: State<'_, DbState>,
    app: &AppHandle,
    operation_id: String,
    project_id: String,
    name: String,
    source_path: String,
    start_seconds: f64,
    end_seconds: f64,
    sample_fps: f64,
    project_fps: i64,
) -> Result<TrackInfo, String> {
    log::info!(
        "video import started: operation_id={}, project_id={}",
        operation_id,
        project_id
    );
    if operation_id.is_empty()
        || operation_id.len() > 128
        || !operation_id.chars().all(|character| {
            character.is_ascii_alphanumeric() || character == '-' || character == '_'
        })
    {
        return Err("视频导入 operationId 无效".to_string());
    }
    if name.trim().is_empty() || name.chars().count() > 128 {
        return Err("轨道名称必须为 1..=128 个字符".to_string());
    }
    {
        let conn = db
            .lock()
            .map_err(|error| format!("数据库锁失败: {}", error))?;
        let project_exists: bool = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM projects WHERE id = ?1)",
                params![&project_id],
                |row| row.get(0),
            )
            .map_err(|error| format!("检查视频导入项目失败: {}", error))?;
        if !project_exists {
            return Err("视频导入目标项目不存在".to_string());
        }
    }

    let _ = app.emit(
        "video-import-progress",
        VideoImportProgress {
            operation_id: operation_id.clone(),
            project_id: project_id.clone(),
            stage: "probing".to_string(),
            completed: 0,
            total: None,
        },
    );
    let video_info = inspect_video_path(&source_path)?;
    if end_seconds > video_info.duration_seconds + 0.001 {
        return Err(format!(
            "抽帧结束时间不能超过视频时长 {:.3} 秒",
            video_info.duration_seconds
        ));
    }
    let timing = plan_video_frame_timing(start_seconds, end_seconds, sample_fps, project_fps)?;
    let ffmpeg = resolve_ffmpeg_tool("ffmpeg")?;
    let output_root = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("获取应用目录失败: {}", error))?
        .join("processed")
        .join("videos");
    std::fs::create_dir_all(&output_root)
        .map_err(|error| format!("创建视频输出根目录失败: {}", error))?;
    let output_dir = output_root.join(&operation_id);
    std::fs::create_dir(&output_dir).map_err(|error| format!("创建视频输出目录失败: {}", error))?;
    let file_paths: Vec<String> = (0..timing.len())
        .map(|index| {
            output_dir
                .join(format!("frame_{:05}.png", index))
                .to_string_lossy()
                .to_string()
        })
        .collect();
    let output_pattern = output_dir.join("frame_%05d.png");
    let duration_seconds = end_seconds - start_seconds;

    let _ = app.emit(
        "video-import-progress",
        VideoImportProgress {
            operation_id: operation_id.clone(),
            project_id: project_id.clone(),
            stage: "extracting".to_string(),
            completed: 0,
            total: Some(timing.len()),
        },
    );
    log::info!(
        "video extraction started: operation_id={}, project_id={}, frame_count={}",
        operation_id,
        project_id,
        timing.len()
    );
    let extraction = Command::new(ffmpeg)
        .args(["-hide_banner", "-loglevel", "error", "-nostdin"])
        .arg("-ss")
        .arg(format!("{:.6}", start_seconds))
        .arg("-i")
        .arg(&source_path)
        .arg("-t")
        .arg(format!("{:.6}", duration_seconds))
        .args(["-map", "0:v:0", "-an", "-vf"])
        .arg(format!("fps={:.6}", sample_fps))
        .arg("-frames:v")
        .arg(timing.len().to_string())
        .args(["-start_number", "0", "-y"])
        .arg(&output_pattern)
        .stdin(Stdio::null())
        .output();
    match extraction {
        Ok(output) if output.status.success() => {}
        Ok(output) => {
            cleanup_import_output(&file_paths, &output_dir, "video");
            log::warn!(
                "video extraction failed: operation_id={}, project_id={}",
                operation_id,
                project_id
            );
            let details = bounded_process_error(&output.stderr);
            return Err(if details.is_empty() {
                "FFmpeg 视频抽帧失败".to_string()
            } else {
                format!("FFmpeg 视频抽帧失败: {}", details)
            });
        }
        Err(error) => {
            cleanup_import_output(&file_paths, &output_dir, "video");
            log::warn!(
                "video extraction failed to start: operation_id={}, project_id={}",
                operation_id,
                project_id
            );
            return Err(format!("启动 FFmpeg 失败: {}", error));
        }
    }

    let validation_result = (|| -> Result<Vec<PreparedImportedFrame>, String> {
        let mut output_bytes = 0_u64;
        let mut output_dimensions = None;
        let mut frames = Vec::with_capacity(timing.len());
        for (index, frame_timing) in timing.iter().enumerate() {
            let frame_path = &file_paths[index];
            let metadata = std::fs::metadata(frame_path)
                .map_err(|error| format!("检查视频抽帧输出失败: {}", error))?;
            if !metadata.is_file() {
                return Err("视频抽帧输出不是普通文件".to_string());
            }
            output_bytes = output_bytes
                .checked_add(metadata.len())
                .ok_or_else(|| "视频抽帧输出体积计数溢出".to_string())?;
            if output_bytes > MAX_VIDEO_OUTPUT_BYTES {
                return Err("视频抽帧输出文件总量超过 1 GiB".to_string());
            }
            let (width, height) = image::image_dimensions(frame_path)
                .map_err(|error| format!("验证视频抽帧 PNG 失败: {}", error))?;
            let frame_pixels = u64::from(width) * u64::from(height);
            if width == 0 || height == 0 || frame_pixels > MAX_VIDEO_CANVAS_PIXELS {
                return Err("视频抽帧 PNG 尺寸超出安全范围".to_string());
            }
            match output_dimensions {
                Some(dimensions) if dimensions != (width, height) => {
                    return Err("视频抽帧 PNG 尺寸不一致".to_string());
                }
                None => output_dimensions = Some((width, height)),
                _ => {}
            }
            frames.push(PreparedImportedFrame {
                path: frame_path.clone(),
                width: i64::from(width),
                height: i64::from(height),
                start_frame: frame_timing.start_frame,
                duration_frames: frame_timing.duration_frames,
                source_timestamp: frame_timing.source_timestamp,
            });
        }
        Ok(frames)
    })();
    let prepared_frames = match validation_result {
        Ok(frames) => frames,
        Err(error) => {
            cleanup_import_output(&file_paths, &output_dir, "video");
            log::warn!(
                "video import failed: operation_id={}, project_id={}, stage=validate",
                operation_id,
                project_id
            );
            return Err(error);
        }
    };

    let _ = app.emit(
        "video-import-progress",
        VideoImportProgress {
            operation_id: operation_id.clone(),
            project_id: project_id.clone(),
            stage: "committing".to_string(),
            completed: prepared_frames.len(),
            total: Some(prepared_frames.len()),
        },
    );
    let result = commit_imported_frames_to_new_track(
        db,
        &project_id,
        name.trim(),
        &prepared_frames,
        "视频帧",
    );
    match &result {
        Ok(track) => log::info!(
            "video import committed: operation_id={}, project_id={}, track_id={}, frame_count={}",
            operation_id,
            project_id,
            track.id,
            track.assets.len()
        ),
        Err(_) => {
            cleanup_import_output(&file_paths, &output_dir, "video");
            log::warn!(
                "video import failed: operation_id={}, project_id={}, stage=commit",
                operation_id,
                project_id
            );
        }
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

        for (source_path, tx, ty, sx, sy, _rot) in layers {
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

#[cfg(test)]
mod tests {
    use super::{
        gif_delay_to_ticks, parse_video_probe, plan_sprite_sheet_slices, plan_video_frame_timing,
        SpriteSheetSliceRect, VideoFileInfo, VideoFrameTiming,
    };

    #[test]
    fn quantizes_gif_delay_to_project_ticks_with_a_one_tick_minimum() {
        assert_eq!(gif_delay_to_ticks(100, 1, 24), 2);
        assert_eq!(gif_delay_to_ticks(125, 1, 24), 3);
        assert_eq!(gif_delay_to_ticks(125, 2, 24), 2);
        assert_eq!(gif_delay_to_ticks(0, 1, 24), 1);
        assert_eq!(gif_delay_to_ticks(100, 0, 24), 1);
    }

    #[test]
    fn plans_sprite_sheet_cells_in_row_major_order() {
        let slices = plan_sprite_sheet_slices(35, 18, 16, 8, 1, 1, 1, 1, None).unwrap();

        assert_eq!(
            slices,
            vec![
                SpriteSheetSliceRect {
                    index: 0,
                    x: 1,
                    y: 1,
                    width: 16,
                    height: 8,
                },
                SpriteSheetSliceRect {
                    index: 1,
                    x: 18,
                    y: 1,
                    width: 16,
                    height: 8,
                },
                SpriteSheetSliceRect {
                    index: 2,
                    x: 1,
                    y: 10,
                    width: 16,
                    height: 8,
                },
                SpriteSheetSliceRect {
                    index: 3,
                    x: 18,
                    y: 10,
                    width: 16,
                    height: 8,
                },
            ]
        );
    }

    #[test]
    fn rejects_invalid_or_excessive_sprite_sheet_plans() {
        assert!(plan_sprite_sheet_slices(64, 64, 0, 16, 0, 0, 0, 0, None).is_err());
        assert!(plan_sprite_sheet_slices(64, 64, 16, 16, 0, 0, 0, 0, Some(17)).is_err());
        assert!(plan_sprite_sheet_slices(200, 100, 1, 1, 0, 0, 0, 0, Some(10_001)).is_err());
    }

    #[test]
    fn large_spacing_does_not_overflow_coordinates() {
        let slices =
            plan_sprite_sheet_slices(16, 16, 16, 16, 0, 0, u32::MAX, u32::MAX, None).unwrap();

        assert_eq!(slices.len(), 1);
        assert_eq!(slices[0].x, 0);
        assert_eq!(slices[0].y, 0);
    }

    #[test]
    fn plans_video_samples_without_timeline_overlap() {
        let timing = plan_video_frame_timing(1.0, 2.0, 10.0, 24).unwrap();

        assert_eq!(timing.len(), 10);
        assert_eq!(
            timing[0],
            VideoFrameTiming {
                source_timestamp: 1_000,
                start_frame: 0,
                duration_frames: 2,
            }
        );
        assert_eq!(timing[1].start_frame, 2);
        assert_eq!(timing[1].duration_frames, 3);
        assert_eq!(
            timing
                .iter()
                .map(|frame| frame.duration_frames)
                .sum::<i64>(),
            24
        );
        for pair in timing.windows(2) {
            assert_eq!(
                pair[0].start_frame + pair[0].duration_frames,
                pair[1].start_frame
            );
        }
    }

    #[test]
    fn rejects_invalid_or_excessive_video_sampling_plans() {
        assert!(plan_video_frame_timing(2.0, 1.0, 10.0, 24).is_err());
        assert!(plan_video_frame_timing(0.0, 1.0, 25.0, 24).is_err());
        assert!(plan_video_frame_timing(0.0, 1_001.0, 10.0, 24).is_err());
        assert!(plan_video_frame_timing(f64::NAN, 1.0, 10.0, 24).is_err());
    }

    #[test]
    fn parses_video_probe_and_falls_back_to_container_duration() {
        let info = parse_video_probe(
            r#"{
                "streams": [{ "width": 64, "height": 32, "duration": "N/A" }],
                "format": { "duration": "3.25" }
            }"#,
        )
        .unwrap();

        assert_eq!(
            info,
            VideoFileInfo {
                width: 64,
                height: 32,
                duration_seconds: 3.25,
            }
        );
        assert!(parse_video_probe(r#"{ "streams": [], "format": {} }"#).is_err());
        assert!(parse_video_probe(
            r#"{ "streams": [{ "width": 0, "height": 32, "duration": "1" }] }"#
        )
        .is_err());
    }
}
