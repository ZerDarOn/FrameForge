use base64::Engine;
use std::io::BufWriter;
use std::path::Path;

const MAX_EXPORT_FRAMES: usize = 10_000;
const MAX_DECODED_FRAME_BYTES: usize = 64 * 1024 * 1024;

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
