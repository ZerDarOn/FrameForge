use super::ffmpeg::resolve_ffmpeg_tool;
use base64::Engine;
use serde::Serialize;
use std::{
    collections::HashMap,
    io::{BufReader, BufWriter, Cursor, Read},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager, State};

const MAX_EXPORT_FRAMES: usize = 10_000;
const MAX_DECODED_FRAME_BYTES: usize = 64 * 1024 * 1024;
const MAX_EXPORT_TOTAL_BYTES: u64 = 1024 * 1024 * 1024;
const MAX_EXPORT_CANVAS_PIXELS: u64 = 16_777_216;
const MP4_EXPORT_CANCELLED: &str = "MP4_EXPORT_CANCELLED";

struct Mp4ExportRecord {
    project_id: String,
    cancellation: Arc<AtomicBool>,
}

#[derive(Default)]
pub struct Mp4ExportRegistry {
    operations: Mutex<HashMap<String, Mp4ExportRecord>>,
}

impl Mp4ExportRegistry {
    fn register(&self, operation_id: &str, project_id: &str) -> Result<Arc<AtomicBool>, String> {
        let mut operations = self
            .operations
            .lock()
            .map_err(|error| format!("MP4 导出注册表锁定失败: {}", error))?;
        if operations.contains_key(operation_id) {
            return Err("MP4 导出 operationId 已存在".to_string());
        }
        let cancellation = Arc::new(AtomicBool::new(false));
        operations.insert(
            operation_id.to_string(),
            Mp4ExportRecord {
                project_id: project_id.to_string(),
                cancellation: cancellation.clone(),
            },
        );
        Ok(cancellation)
    }

    fn request_cancel(&self, operation_id: &str, project_id: &str) -> Result<bool, String> {
        let operations = self
            .operations
            .lock()
            .map_err(|error| format!("MP4 导出注册表锁定失败: {}", error))?;
        let Some(record) = operations.get(operation_id) else {
            return Ok(false);
        };
        if record.project_id != project_id {
            return Ok(false);
        }
        record.cancellation.store(true, Ordering::Release);
        Ok(true)
    }

    fn finish(&self, operation_id: &str, project_id: &str) -> bool {
        let Ok(mut operations) = self.operations.lock() else {
            log::error!("MP4 export registry lock poisoned while finishing");
            return false;
        };
        let matches_project = operations
            .get(operation_id)
            .is_some_and(|record| record.project_id == project_id);
        if !matches_project {
            return false;
        }
        operations
            .remove(operation_id)
            .is_some_and(|record| !record.cancellation.load(Ordering::Acquire))
    }
}

struct Mp4ExportRegistration<'a> {
    registry: &'a Mp4ExportRegistry,
    operation_id: String,
    project_id: String,
    cancellation: Arc<AtomicBool>,
    active: bool,
}

impl<'a> Mp4ExportRegistration<'a> {
    fn new(
        registry: &'a Mp4ExportRegistry,
        operation_id: &str,
        project_id: &str,
    ) -> Result<Self, String> {
        Ok(Self {
            registry,
            operation_id: operation_id.to_string(),
            project_id: project_id.to_string(),
            cancellation: registry.register(operation_id, project_id)?,
            active: true,
        })
    }

    fn is_cancelled(&self) -> bool {
        self.cancellation.load(Ordering::Acquire)
    }

    fn claim_commit(&mut self) -> bool {
        let can_commit = self.registry.finish(&self.operation_id, &self.project_id);
        self.active = false;
        can_commit
    }
}

impl Drop for Mp4ExportRegistration<'_> {
    fn drop(&mut self) {
        if self.active {
            let _ = self.registry.finish(&self.operation_id, &self.project_id);
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Mp4ExportProgress {
    operation_id: String,
    project_id: String,
    stage: String,
}

fn decode_png_data_url(frame: &str) -> Result<Vec<u8>, String> {
    let encoded = frame
        .strip_prefix("data:image/png;base64,")
        .ok_or("导出帧不是 PNG data URL")?;
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .map_err(|e| format!("导出帧 base64 无效: {}", e))?;
    if decoded.len() > MAX_DECODED_FRAME_BYTES {
        return Err("单帧导出数据超过 64MB 限制".to_string());
    }
    Ok(decoded)
}

fn validate_frame_count(frames: &[String]) -> Result<(), String> {
    if frames.is_empty() {
        return Err("没有可导出的帧".to_string());
    }
    if frames.len() > MAX_EXPORT_FRAMES {
        return Err(format!("导出帧数超过 {} 帧限制", MAX_EXPORT_FRAMES));
    }
    Ok(())
}

fn validate_operation_id(operation_id: &str) -> Result<(), String> {
    if operation_id.is_empty()
        || operation_id.len() > 64
        || !operation_id
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '-')
    {
        return Err("导出 operationId 无效".to_string());
    }
    Ok(())
}

fn validate_project_id(project_id: &str) -> Result<(), String> {
    if project_id.is_empty()
        || project_id.len() > 128
        || !project_id.chars().all(|character| {
            character.is_ascii_alphanumeric() || character == '-' || character == '_'
        })
    {
        return Err("MP4 导出 projectId 无效".to_string());
    }
    Ok(())
}

fn validate_mp4_fps(fps: u32) -> Result<(), String> {
    if !(1..=240).contains(&fps) {
        return Err("MP4 帧率必须为 1..=240".to_string());
    }
    Ok(())
}

fn inspect_export_png(bytes: &[u8], index: usize) -> Result<(u32, u32), String> {
    let reader = image::ImageReader::with_format(Cursor::new(bytes), image::ImageFormat::Png);
    let (width, height) = reader
        .into_dimensions()
        .map_err(|error| format!("读取导出帧 {} 尺寸失败: {}", index, error))?;
    let pixels = u64::from(width) * u64::from(height);
    if width == 0 || height == 0 || pixels > MAX_EXPORT_CANVAS_PIXELS {
        return Err(format!("导出帧 {} 尺寸超出安全范围", index));
    }
    Ok((width, height))
}

fn read_bounded_stderr(stderr: std::process::ChildStderr) -> thread::JoinHandle<Vec<u8>> {
    thread::spawn(move || {
        let mut reader = BufReader::new(stderr);
        let mut stderr = Vec::with_capacity(4_096);
        let mut buffer = [0_u8; 1_024];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(read) => {
                    let remaining = 4_096_usize.saturating_sub(stderr.len());
                    stderr.extend_from_slice(&buffer[..read.min(remaining)]);
                }
            }
        }
        stderr
    })
}

fn bounded_process_error(stderr: &[u8]) -> String {
    String::from_utf8_lossy(stderr)
        .trim()
        .chars()
        .take(512)
        .collect()
}

struct Mp4ExportStaging {
    directory: PathBuf,
}

impl Drop for Mp4ExportStaging {
    fn drop(&mut self) {
        if let Err(error) = std::fs::remove_dir_all(&self.directory) {
            if error.kind() != std::io::ErrorKind::NotFound {
                log::warn!("MP4 export staging cleanup failed");
            }
        }
    }
}

fn create_mp4_staging(directory: PathBuf) -> Result<Mp4ExportStaging, String> {
    std::fs::create_dir(&directory).map_err(|error| format!("创建 MP4 暂存目录失败: {}", error))?;
    Ok(Mp4ExportStaging { directory })
}

#[tauri::command]
pub fn write_rendered_png_sequence(
    operation_id: String,
    output_dir: String,
    frames: Vec<String>,
) -> Result<usize, String> {
    validate_frame_count(&frames)?;
    validate_operation_id(&operation_id)?;
    let output = Path::new(&output_dir);
    std::fs::create_dir_all(output).map_err(|e| format!("创建输出目录失败: {}", e))?;
    log::info!(
        "rendered PNG export started: operation_id={}, frame_count={}",
        operation_id,
        frames.len()
    );

    let mut staged_paths = Vec::with_capacity(frames.len());
    for (index, frame) in frames.iter().enumerate() {
        let result = decode_png_data_url(frame).and_then(|bytes| {
            let path = output.join(format!(".frameforge-{}-{:05}.tmp", operation_id, index));
            std::fs::write(&path, bytes)
                .map_err(|e| format!("暂存导出帧 {} 失败: {}", index, e))?;
            staged_paths.push(path);
            Ok(())
        });
        if let Err(error) = result {
            for path in &staged_paths {
                let _ = std::fs::remove_file(path);
            }
            return Err(error);
        }
    }

    for (index, staged_path) in staged_paths.iter().enumerate() {
        let final_path = output.join(format!("frame_{:05}.png", index));
        if final_path.exists() {
            std::fs::remove_file(&final_path)
                .map_err(|e| format!("替换导出帧 {} 失败: {}", index, e))?;
        }
        std::fs::rename(staged_path, &final_path)
            .map_err(|e| format!("提交导出帧 {} 失败: {}", index, e))?;
    }

    log::info!(
        "rendered PNG export completed: operation_id={}, frame_count={}",
        operation_id,
        frames.len()
    );
    Ok(frames.len())
}

#[tauri::command]
pub fn write_rendered_gif(
    operation_id: String,
    output_path: String,
    frame_delay_ms: u32,
    frames: Vec<String>,
) -> Result<usize, String> {
    validate_frame_count(&frames)?;
    validate_operation_id(&operation_id)?;
    if frame_delay_ms == 0 || frame_delay_ms > 60_000 {
        return Err("GIF 帧延迟无效".to_string());
    }
    log::info!(
        "rendered GIF export started: operation_id={}, frame_count={}, frame_delay_ms={}",
        operation_id,
        frames.len(),
        frame_delay_ms
    );
    let output = Path::new(&output_path);
    let file_name = output
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or("GIF 输出路径无效")?;
    let temporary_path = output.with_file_name(format!(".{}.{}.tmp", file_name, operation_id));
    let file =
        std::fs::File::create(&temporary_path).map_err(|e| format!("创建 GIF 文件失败: {}", e))?;
    let mut encoder = image::codecs::gif::GifEncoder::new(BufWriter::new(file));
    encoder
        .set_repeat(image::codecs::gif::Repeat::Infinite)
        .map_err(|e| format!("设置 GIF 循环失败: {}", e))?;

    for (index, frame) in frames.iter().enumerate() {
        let bytes = decode_png_data_url(frame)?;
        let image = image::load_from_memory_with_format(&bytes, image::ImageFormat::Png)
            .map_err(|e| format!("解码导出帧 {} 失败: {}", index, e))?
            .to_rgba8();
        encoder
            .encode_frame(image::Frame::from_parts(
                image,
                0,
                0,
                image::Delay::from_numer_denom_ms(frame_delay_ms, 1),
            ))
            .map_err(|e| format!("编码 GIF 帧 {} 失败: {}", index, e))?;
    }
    drop(encoder);
    if output.exists() {
        std::fs::remove_file(output).map_err(|e| format!("替换旧 GIF 失败: {}", e))?;
    }
    if let Err(error) = std::fs::rename(&temporary_path, output) {
        let _ = std::fs::remove_file(&temporary_path);
        return Err(format!("提交 GIF 文件失败: {}", error));
    }

    log::info!(
        "rendered GIF export completed: operation_id={}, frame_count={}",
        operation_id,
        frames.len()
    );
    Ok(frames.len())
}

#[tauri::command]
pub async fn write_rendered_mp4(
    app: AppHandle,
    operation_id: String,
    project_id: String,
    output_path: String,
    fps: u32,
    frames: Vec<String>,
) -> Result<usize, String> {
    let state_app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let operations = state_app.state::<Mp4ExportRegistry>();
        write_rendered_mp4_blocking(
            operations,
            &state_app,
            operation_id,
            project_id,
            output_path,
            fps,
            frames,
        )
    })
    .await
    .map_err(|error| format!("MP4 导出工作线程失败: {}", error))?
}

fn write_rendered_mp4_blocking(
    operations: State<'_, Mp4ExportRegistry>,
    app: &AppHandle,
    operation_id: String,
    project_id: String,
    output_path: String,
    fps: u32,
    frames: Vec<String>,
) -> Result<usize, String> {
    validate_frame_count(&frames)?;
    validate_operation_id(&operation_id)?;
    validate_project_id(&project_id)?;
    validate_mp4_fps(fps)?;

    let output = Path::new(&output_path);
    let output_parent = output
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty() && parent.is_dir())
        .ok_or("MP4 输出目录不存在")?;
    output
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or("MP4 输出路径无效")?;
    let mut registration = Mp4ExportRegistration::new(&operations, &operation_id, &project_id)?;
    let _ = app.emit(
        "mp4-export-progress",
        Mp4ExportProgress {
            operation_id: operation_id.clone(),
            project_id: project_id.clone(),
            stage: "preparing".to_string(),
        },
    );

    let staging_directory = output_parent.join(format!(".frameforge-{}-mp4", operation_id));
    let staging = create_mp4_staging(staging_directory)?;

    log::info!(
        "rendered MP4 export started: operation_id={}, frame_count={}, fps={}",
        operation_id,
        frames.len(),
        fps
    );

    let mut total_bytes = 0_u64;
    let mut dimensions = None;
    for (index, frame) in frames.iter().enumerate() {
        if registration.is_cancelled() {
            log::info!(
                "rendered MP4 export cancelled: operation_id={}, project_id={}, stage=preparing",
                operation_id,
                project_id
            );
            return Err(MP4_EXPORT_CANCELLED.to_string());
        }
        let bytes = decode_png_data_url(frame)?;
        total_bytes = total_bytes
            .checked_add(bytes.len() as u64)
            .ok_or("MP4 导出帧总量计数溢出")?;
        if total_bytes > MAX_EXPORT_TOTAL_BYTES {
            return Err("MP4 导出帧总量超过 1 GiB".to_string());
        }
        let frame_dimensions = inspect_export_png(&bytes, index)?;
        match dimensions {
            Some(expected) if expected != frame_dimensions => {
                return Err("MP4 导出帧尺寸不一致".to_string());
            }
            None => dimensions = Some(frame_dimensions),
            _ => {}
        }
        let frame_path = staging.directory.join(format!("frame_{:05}.png", index));
        std::fs::write(frame_path, bytes)
            .map_err(|error| format!("暂存 MP4 帧 {} 失败: {}", index, error))?;
    }

    let ffmpeg = resolve_ffmpeg_tool("ffmpeg")?;
    let _ = app.emit(
        "mp4-export-progress",
        Mp4ExportProgress {
            operation_id: operation_id.clone(),
            project_id: project_id.clone(),
            stage: "encoding".to_string(),
        },
    );
    let encoded_path = staging.directory.join("rendered.mp4");
    let input_pattern = staging.directory.join("frame_%05d.png");
    let mut child = Command::new(ffmpeg)
        .args(["-hide_banner", "-loglevel", "error", "-nostdin"])
        .arg("-framerate")
        .arg(fps.to_string())
        .arg("-start_number")
        .arg("0")
        .arg("-i")
        .arg(input_pattern)
        .arg("-frames:v")
        .arg(frames.len().to_string())
        .args(["-an", "-c:v", "libx264", "-preset", "medium", "-crf", "18"])
        .args([
            "-vf",
            "pad=ceil(iw/2)*2:ceil(ih/2)*2",
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
            "-f",
            "mp4",
            "-y",
        ])
        .arg(&encoded_path)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("启动 FFmpeg MP4 编码失败: {}", error))?;
    let stderr_reader = match child.stderr.take() {
        Some(stderr) => read_bounded_stderr(stderr),
        None => {
            let _ = child.kill();
            let _ = child.wait();
            return Err("无法读取 FFmpeg MP4 错误输出".to_string());
        }
    };
    let status = loop {
        if registration.is_cancelled() {
            let _ = child.kill();
            let _ = child.wait();
            let _ = stderr_reader.join();
            log::info!(
                "rendered MP4 export cancelled: operation_id={}, project_id={}, stage=encoding",
                operation_id,
                project_id
            );
            return Err(MP4_EXPORT_CANCELLED.to_string());
        }
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => thread::sleep(Duration::from_millis(50)),
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                let _ = stderr_reader.join();
                return Err(format!("等待 FFmpeg MP4 编码失败: {}", error));
            }
        }
    };
    let stderr = stderr_reader.join().unwrap_or_default();
    if !status.success() {
        let details = bounded_process_error(&stderr);
        log::warn!(
            "rendered MP4 export failed: operation_id={}, frame_count={}, fps={}",
            operation_id,
            frames.len(),
            fps
        );
        return Err(if details.is_empty() {
            "FFmpeg MP4 编码失败".to_string()
        } else {
            format!("FFmpeg MP4 编码失败: {}", details)
        });
    }

    if !registration.claim_commit() {
        log::info!(
            "rendered MP4 export cancelled: operation_id={}, project_id={}, stage=before_commit",
            operation_id,
            project_id
        );
        return Err(MP4_EXPORT_CANCELLED.to_string());
    }
    let _ = app.emit(
        "mp4-export-progress",
        Mp4ExportProgress {
            operation_id: operation_id.clone(),
            project_id: project_id.clone(),
            stage: "committing".to_string(),
        },
    );

    let backup_path = output_parent.join(format!(".frameforge-{}-previous.mp4", operation_id));
    let had_previous_output = output.exists();
    if had_previous_output {
        let metadata = std::fs::symlink_metadata(output)
            .map_err(|error| format!("检查旧 MP4 失败: {}", error))?;
        if !metadata.file_type().is_file() {
            return Err("MP4 输出位置不是普通文件".to_string());
        }
        if backup_path.exists() {
            return Err("MP4 备份路径已存在，请重试导出".to_string());
        }
        std::fs::rename(output, &backup_path)
            .map_err(|error| format!("暂存旧 MP4 失败: {}", error))?;
    }
    if let Err(error) = std::fs::rename(&encoded_path, output) {
        if had_previous_output {
            if let Err(restore_error) = std::fs::rename(&backup_path, output) {
                return Err(format!(
                    "提交 MP4 失败: {}；恢复旧文件失败: {}。旧文件保留在 {}",
                    error,
                    restore_error,
                    backup_path.display()
                ));
            }
        }
        return Err(format!("提交 MP4 文件失败: {}", error));
    }
    if had_previous_output {
        if let Err(error) = std::fs::remove_file(&backup_path) {
            log::warn!(
                "rendered MP4 previous-output cleanup failed: operation_id={}",
                operation_id
            );
            return Err(format!("MP4 已导出，但旧文件备份清理失败: {}", error));
        }
    }

    log::info!(
        "rendered MP4 export completed: operation_id={}, frame_count={}, fps={}",
        operation_id,
        frames.len(),
        fps
    );
    Ok(frames.len())
}

#[tauri::command]
pub fn cancel_rendered_mp4_export(
    operations: State<'_, Mp4ExportRegistry>,
    operation_id: String,
    project_id: String,
) -> Result<bool, String> {
    validate_operation_id(&operation_id)?;
    validate_project_id(&project_id)?;
    let accepted = operations.request_cancel(&operation_id, &project_id)?;
    log::info!(
        "rendered MP4 export cancellation requested: operation_id={}, project_id={}, accepted={}",
        operation_id,
        project_id,
        accepted
    );
    Ok(accepted)
}

#[cfg(test)]
mod tests {
    use super::{create_mp4_staging, validate_mp4_fps, Mp4ExportRegistry};

    #[test]
    fn mp4_export_rejects_unsafe_frame_rates() {
        assert!(validate_mp4_fps(0).is_err());
        assert!(validate_mp4_fps(1).is_ok());
        assert!(validate_mp4_fps(240).is_ok());
        assert!(validate_mp4_fps(241).is_err());
    }

    #[test]
    fn existing_mp4_staging_directory_is_never_claimed_or_deleted() {
        let directory = std::env::temp_dir().join(format!(
            "frameforge-existing-mp4-staging-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir(&directory).expect("create existing staging directory");
        let sentinel = directory.join("keep.txt");
        std::fs::write(&sentinel, b"keep").expect("write sentinel");

        assert!(create_mp4_staging(directory.clone()).is_err());
        assert!(sentinel.is_file());

        std::fs::remove_file(sentinel).expect("remove sentinel");
        std::fs::remove_dir(directory).expect("remove test directory");
    }

    #[test]
    fn mp4_cancellation_is_scoped_and_closes_before_commit() {
        let operations = Mp4ExportRegistry::default();
        let cancellation = operations
            .register("operation-a", "project-a")
            .expect("register");

        assert!(!operations
            .request_cancel("operation-a", "project-b")
            .expect("wrong project"));
        assert!(!cancellation.load(std::sync::atomic::Ordering::SeqCst));
        assert!(operations
            .request_cancel("operation-a", "project-a")
            .expect("matching project"));
        assert!(!operations.finish("operation-a", "project-a"));

        operations
            .register("operation-b", "project-a")
            .expect("register active export");
        assert!(operations.finish("operation-b", "project-a"));
        assert!(!operations
            .request_cancel("operation-b", "project-a")
            .expect("late cancellation"));
    }
}
