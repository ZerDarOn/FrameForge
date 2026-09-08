use crate::db::DbState;
use base64::Engine;
use rusqlite::{params, OptionalExtension};
use serde::Serialize;
use serde_json::Value;
use std::collections::HashSet;
use std::io::Cursor;
use std::path::Path;
use tauri::{AppHandle, Manager, State};

const MAX_CONTENT_BYTES: usize = 64 * 1024 * 1024;
const MAX_CONTENT_EDGE: u32 = 16_384;
const MAX_CONTENT_PIXELS: u64 = 64 * 1024 * 1024;
const MAX_EDITABLE_PIXELS: u64 = 4 * 1024 * 1024;
const MAX_DOCUMENT_BYTES: usize = 16 * 1024 * 1024;
const SUPPORTED_SCHEMA_VERSION: i64 = 1;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnimationDocumentRecord {
    project_id: String,
    schema_version: i64,
    revision: i64,
    document_json: String,
    updated_at: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentImage {
    png_data_url: String,
    width: u32,
    height: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WrittenContentRevision {
    source_path: String,
    width: u32,
    height: u32,
}

fn validate_path_id(value: &str, label: &str) -> Result<(), String> {
    if value.is_empty()
        || value.len() > 128
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
    {
        return Err(format!("{} 只能包含字母、数字、连字符和下划线", label));
    }
    Ok(())
}

fn register_id(value: &Value, label: &str, ids: &mut HashSet<String>) -> Result<String, String> {
    let id = value
        .get("id")
        .and_then(Value::as_str)
        .filter(|id| !id.is_empty() && id.len() <= 256)
        .ok_or_else(|| format!("{} id 无效", label))?;
    if !ids.insert(id.to_string()) {
        return Err(format!("动画文档存在重复 id: {}", id));
    }
    Ok(id.to_string())
}

fn required_array<'a>(value: &'a Value, field: &str) -> Result<&'a Vec<Value>, String> {
    value
        .get(field)
        .and_then(Value::as_array)
        .ok_or_else(|| format!("动画文档缺少数组 {}", field))
}

fn required_positive_integer(value: &Value, field: &str, maximum: i64) -> Result<i64, String> {
    value
        .get(field)
        .and_then(Value::as_i64)
        .filter(|number| *number > 0 && *number <= maximum)
        .ok_or_else(|| format!("{} 必须是 1..={} 的整数", field, maximum))
}

fn required_finite(value: &Value, field: &str) -> Result<f64, String> {
    value
        .get(field)
        .and_then(Value::as_f64)
        .filter(|number| number.is_finite())
        .ok_or_else(|| format!("{} 必须是有限数值", field))
}

fn validate_document_structure(value: &Value) -> Result<(), String> {
    let canvas = value.get("canvas").ok_or("动画文档缺少 canvas")?;
    required_positive_integer(canvas, "width", i64::from(MAX_CONTENT_EDGE))?;
    required_positive_integer(canvas, "height", i64::from(MAX_CONTENT_EDGE))?;
    required_finite(canvas, "originX")?;
    required_finite(canvas, "originY")?;
    required_array(value, "palette")?;

    let mut all_ids = HashSet::new();
    let mut material_ids = HashSet::new();
    for material in required_array(value, "materials")? {
        let id = register_id(material, "material", &mut all_ids)?;
        material_ids.insert(id);
        material
            .get("sourcePath")
            .and_then(Value::as_str)
            .ok_or("material sourcePath 无效")?;
    }

    let mut content_ids = HashSet::new();
    for content in required_array(value, "contentRevisions")? {
        let id = register_id(content, "content revision", &mut all_ids)?;
        content_ids.insert(id);
        let material_id = content
            .get("materialId")
            .and_then(Value::as_str)
            .ok_or("content revision materialId 无效")?;
        if !material_ids.contains(material_id) {
            return Err(format!(
                "content revision 引用了不存在的 material: {}",
                material_id
            ));
        }
        content
            .get("sourcePath")
            .and_then(Value::as_str)
            .ok_or("content revision sourcePath 无效")?;
        required_positive_integer(content, "width", i64::from(MAX_CONTENT_EDGE))?;
        required_positive_integer(content, "height", i64::from(MAX_CONTENT_EDGE))?;
        required_finite(content, "createdAt")?;
    }

    let animations = required_array(value, "animations")?;
    if animations.is_empty() {
        return Err("动画文档至少需要一个 animation".to_string());
    }
    for animation in animations {
        register_id(animation, "animation", &mut all_ids)?;
        let fps = required_finite(animation, "fps")?;
        if fps <= 0.0 || fps > 240.0 {
            return Err("animation fps 必须在 0..=240 范围内".to_string());
        }
        let steps = required_array(animation, "steps")?;
        if steps.is_empty() {
            return Err("animation 至少需要一个 step".to_string());
        }
        let mut step_ids = HashSet::new();
        for step in steps {
            let id = register_id(step, "step", &mut all_ids)?;
            step_ids.insert(id);
            required_positive_integer(step, "durationTicks", 1_000_000)?;
            let order = step
                .get("order")
                .and_then(Value::as_i64)
                .filter(|order| *order >= 0)
                .ok_or("step order 无效")?;
            if order > 1_000_000 {
                return Err("step order 超出上限".to_string());
            }
        }

        let mut layer_ids = HashSet::new();
        for layer in required_array(animation, "layers")? {
            let id = register_id(layer, "layer", &mut all_ids)?;
            layer_ids.insert(id);
            let opacity = required_finite(layer, "opacity")?;
            if !(0.0..=1.0).contains(&opacity) {
                return Err("layer opacity 必须在 0..=1 范围内".to_string());
            }
            layer
                .get("order")
                .and_then(Value::as_i64)
                .filter(|order| *order >= 0 && *order <= 1_000_000)
                .ok_or("layer order 无效")?;
            layer
                .get("visible")
                .and_then(Value::as_bool)
                .ok_or("layer visible 无效")?;
            layer
                .get("locked")
                .and_then(Value::as_bool)
                .ok_or("layer locked 无效")?;
        }

        let mut occupied = HashSet::new();
        for cel in required_array(animation, "cels")? {
            register_id(cel, "cel", &mut all_ids)?;
            let layer_id = cel
                .get("layerId")
                .and_then(Value::as_str)
                .ok_or("cel layerId 无效")?;
            let step_id = cel
                .get("stepId")
                .and_then(Value::as_str)
                .ok_or("cel stepId 无效")?;
            let content_id = cel
                .get("contentRevisionId")
                .and_then(Value::as_str)
                .ok_or("cel contentRevisionId 无效")?;
            if !layer_ids.contains(layer_id) || !step_ids.contains(step_id) {
                return Err("cel 引用了不存在的 layer 或 step".to_string());
            }
            if !content_ids.contains(content_id) {
                return Err("cel 引用了不存在的 content revision".to_string());
            }
            if !occupied.insert((layer_id.to_string(), step_id.to_string())) {
                return Err(format!(
                    "同一 layer+step 存在多个 cel: {}:{}",
                    layer_id, step_id
                ));
            }
            let transform = cel.get("transform").ok_or("cel 缺少 transform")?;
            for field in ["x", "y", "scaleX", "scaleY", "rotationDegrees"] {
                required_finite(transform, field)?;
            }
        }
    }
    Ok(())
}

fn decode_png_data_url(value: &str) -> Result<Vec<u8>, String> {
    let encoded = value
        .strip_prefix("data:image/png;base64,")
        .ok_or("内容必须是 PNG data URL")?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .map_err(|e| format!("PNG base64 无效: {}", e))?;
    if bytes.len() > MAX_CONTENT_BYTES {
        return Err("PNG 内容超过 64 MiB 上限".to_string());
    }
    if !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Err("内容不是有效 PNG 文件".to_string());
    }
    Ok(bytes)
}

fn decode_reader<R: std::io::BufRead + std::io::Seek>(
    mut reader: image::ImageReader<R>,
    max_pixels: u64,
) -> Result<image::DynamicImage, String> {
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(MAX_CONTENT_EDGE);
    limits.max_image_height = Some(MAX_CONTENT_EDGE);
    limits.max_alloc = Some(max_pixels * 4);
    reader.limits(limits);
    let image = reader
        .decode()
        .map_err(|e| format!("图片解码失败: {}", e))?;
    if u64::from(image.width()) * u64::from(image.height()) > max_pixels {
        return Err(format!("图片像素数超过 {} 上限", max_pixels));
    }
    Ok(image)
}

fn decode_png(bytes: &[u8]) -> Result<image::DynamicImage, String> {
    let mut reader = image::ImageReader::new(Cursor::new(bytes));
    reader.set_format(image::ImageFormat::Png);
    decode_reader(reader, MAX_CONTENT_PIXELS)
}

#[tauri::command]
pub fn read_content_image(file_path: String) -> Result<ContentImage, String> {
    let path = Path::new(&file_path);
    if !path.is_file() {
        return Err("内容文件不存在".to_string());
    }
    let metadata = std::fs::metadata(path).map_err(|e| format!("读取内容元数据失败: {}", e))?;
    if metadata.len() > MAX_CONTENT_BYTES as u64 {
        return Err("内容文件超过 64 MiB 上限".to_string());
    }
    let reader = image::ImageReader::open(path)
        .map_err(|e| format!("打开内容图片失败: {}", e))?
        .with_guessed_format()
        .map_err(|e| format!("识别内容图片格式失败: {}", e))?;
    let image = decode_reader(reader, MAX_EDITABLE_PIXELS)?;
    let width = image.width();
    let height = image.height();
    let mut encoded = Cursor::new(Vec::new());
    image
        .write_to(&mut encoded, image::ImageFormat::Png)
        .map_err(|e| format!("规范化内容图片失败: {}", e))?;
    let png_data_url = format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(encoded.into_inner())
    );
    Ok(ContentImage {
        png_data_url,
        width,
        height,
    })
}

#[tauri::command]
pub fn write_content_revision(
    app: AppHandle,
    project_id: String,
    revision_id: String,
    png_data_url: String,
) -> Result<WrittenContentRevision, String> {
    validate_path_id(&project_id, "projectId")?;
    validate_path_id(&revision_id, "revisionId")?;
    let bytes = decode_png_data_url(&png_data_url)?;
    let image = decode_png(&bytes)?;
    let width = image.width();
    let height = image.height();

    let directory = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法获取应用数据目录: {}", e))?
        .join("content-revisions")
        .join(&project_id);
    std::fs::create_dir_all(&directory).map_err(|e| format!("创建内容目录失败: {}", e))?;
    let destination = directory.join(format!("{}.png", revision_id));
    if destination.exists() {
        return Err("内容修订已存在，拒绝覆盖".to_string());
    }
    let temporary = directory.join(format!("{}.{}.tmp", revision_id, uuid::Uuid::new_v4()));
    std::fs::write(&temporary, &bytes).map_err(|e| format!("暂存内容修订失败: {}", e))?;
    if let Err(error) = std::fs::rename(&temporary, &destination) {
        let _ = std::fs::remove_file(&temporary);
        return Err(format!("提交内容修订失败: {}", error));
    }
    log::info!(
        "content revision written: project_id={}, revision_id={}, width={}, height={}, bytes={}",
        project_id,
        revision_id,
        width,
        height,
        bytes.len()
    );
    Ok(WrittenContentRevision {
        source_path: destination.to_string_lossy().into_owned(),
        width,
        height,
    })
}

fn validate_document(
    project_id: &str,
    expected_revision: Option<i64>,
    document_json: &str,
) -> Result<(i64, i64), String> {
    if document_json.len() > MAX_DOCUMENT_BYTES {
        return Err("动画文档超过 16 MiB 上限".to_string());
    }
    let value: Value =
        serde_json::from_str(document_json).map_err(|e| format!("动画文档 JSON 无效: {}", e))?;
    let document_project_id = value
        .get("projectId")
        .and_then(Value::as_str)
        .ok_or("动画文档缺少 projectId")?;
    if document_project_id != project_id {
        return Err("动画文档 projectId 与保存目标不一致".to_string());
    }

    let schema_version = value
        .get("schemaVersion")
        .and_then(Value::as_i64)
        .filter(|version| *version == SUPPORTED_SCHEMA_VERSION)
        .ok_or("动画文档 schemaVersion 无效")?;
    let revision = value
        .get("revision")
        .and_then(Value::as_i64)
        .filter(|revision| *revision >= 0)
        .ok_or("动画文档 revision 无效")?;
    let required_revision = match expected_revision {
        Some(current) if current >= 0 => current
            .checked_add(1)
            .ok_or("动画文档 revision 已达到上限")?,
        Some(_) => return Err("expectedRevision 不能为负数".to_string()),
        None => 0,
    };
    if revision != required_revision {
        return Err(format!(
            "动画文档 revision 不连续: 期望 {}, 收到 {}",
            required_revision, revision
        ));
    }

    validate_document_structure(&value)?;
    Ok((schema_version, revision))
}

#[tauri::command]
pub fn get_animation_document(
    db: State<'_, DbState>,
    project_id: String,
) -> Result<Option<AnimationDocumentRecord>, String> {
    let conn = db.lock().map_err(|e| format!("数据库锁失败: {}", e))?;
    let record = conn
        .query_row(
            "SELECT project_id, schema_version, revision, document_json, updated_at FROM animation_documents WHERE project_id = ?1",
            params![project_id],
            |row| {
                Ok(AnimationDocumentRecord {
                    project_id: row.get(0)?,
                    schema_version: row.get(1)?,
                    revision: row.get(2)?,
                    document_json: row.get(3)?,
                    updated_at: row.get(4)?,
                })
            },
        )
        .optional()
        .map_err(|e| format!("读取动画文档失败: {}", e))?;
    Ok(record)
}

#[tauri::command]
pub fn save_animation_document(
    db: State<'_, DbState>,
    project_id: String,
    expected_revision: Option<i64>,
    document_json: String,
) -> Result<AnimationDocumentRecord, String> {
    let (schema_version, revision) =
        validate_document(&project_id, expected_revision, &document_json)?;
    let mut conn = db.lock().map_err(|e| format!("数据库锁失败: {}", e))?;
    let tx = conn
        .transaction()
        .map_err(|e| format!("开始动画文档保存事务失败: {}", e))?;
    let current_revision: Option<i64> = tx
        .query_row(
            "SELECT revision FROM animation_documents WHERE project_id = ?1",
            params![project_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| format!("检查动画文档版本失败: {}", e))?;

    if current_revision != expected_revision {
        log::warn!(
            "animation document save rejected: project_id={}, expected_revision={:?}, current_revision={:?}",
            project_id,
            expected_revision,
            current_revision
        );
        return Err(format!(
            "动画文档版本冲突: 期望 {:?}, 当前 {:?}",
            expected_revision, current_revision
        ));
    }

    let updated_at = chrono::Utc::now().timestamp_millis();
    tx.execute(
        "INSERT INTO animation_documents (project_id, schema_version, revision, document_json, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(project_id) DO UPDATE SET
           schema_version = excluded.schema_version,
           revision = excluded.revision,
           document_json = excluded.document_json,
           updated_at = excluded.updated_at",
        params![
            project_id,
            schema_version,
            revision,
            document_json,
            updated_at
        ],
    )
    .map_err(|e| format!("写入动画文档失败: {}", e))?;
    tx.commit()
        .map_err(|e| format!("提交动画文档保存事务失败: {}", e))?;

    log::info!(
        "animation document saved: project_id={}, revision={}, bytes={}",
        project_id,
        revision,
        document_json.len()
    );
    Ok(AnimationDocumentRecord {
        project_id,
        schema_version,
        revision,
        document_json,
        updated_at,
    })
}
