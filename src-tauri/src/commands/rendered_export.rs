use super::ffmpeg::resolve_ffmpeg_tool;
use base64::Engine;
use std::{
    io::{BufReader, BufWriter, Cursor, Read},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    thread,
};

const MAX_EXPORT_FRAMES: usize = 10_000;
const MAX_DECODED_FRAME_BYTES: usize = 64 * 1024 * 1024;
const MAX_EXPORT_TOTAL_BYTES: u64 = 1024 * 1024 * 1024;
const MAX_EXPORT_CANVAS_PIXELS: u64 = 16_777_216;

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
    operation_id: String,
    output_path: String,
    fps: u32,
    frames: Vec<String>,
) -> Result<usize, String> {
    tauri::async_runtime::spawn_blocking(move || {
        write_rendered_mp4_blocking(operation_id, output_path, fps, frames)
    })
    .await
    .map_err(|error| format!("MP4 导出工作线程失败: {}", error))?
}

fn write_rendered_mp4_blocking(
    operation_id: String,
    output_path: String,
    fps: u32,
    frames: Vec<String>,
) -> Result<usize, String> {
    validate_frame_count(&frames)?;
    validate_operation_id(&operation_id)?;
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
    let status = match child.wait() {
        Ok(status) => status,
        Err(error) => {
            let _ = child.kill();
            let _ = child.wait();
            let _ = stderr_reader.join();
            return Err(format!("等待 FFmpeg MP4 编码失败: {}", error));
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

#[cfg(test)]
mod tests {
    use super::{create_mp4_staging, validate_mp4_fps};

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
}
