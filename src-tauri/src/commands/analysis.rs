use crate::ai::AiConfig;
use crate::ai::analysis::displacement::detect_displacement_simple;
use crate::ai::analysis::flicker::detect_flicker_simple;
use crate::ai::providers::AnalysisReport;
use crate::db::DbState;
use rusqlite::params;
use tauri::{AppHandle, Emitter, State};

#[tauri::command]
pub fn analyze_track(
    db: State<'_, DbState>,
    _config: State<'_, AiConfig>,
    app: AppHandle,
    project_id: String,
    track_id: String,
) -> Result<AnalysisReport, String> {
    let conn = db.lock().map_err(|e| format!("数据库锁失败: {}", e))?;

    let mut stmt = conn
        .prepare("SELECT source_path FROM assets WHERE track_id = ?1 ORDER BY start_frame")
        .map_err(|e| format!("查询资产失败: {}", e))?;

    let paths: Vec<String> = stmt
        .query_map(params![track_id], |row| row.get(0))
        .map_err(|e| format!("读取路径失败: {}", e))?
        .filter_map(|p| p.ok())
        .collect();
    drop(stmt);
    drop(conn);

    if paths.is_empty() {
        return Err("轨道中没有帧".to_string());
    }

    let total = paths.len();

    // 加载图片数据
    app.emit("analysis-progress", serde_json::json!({
        "stage": "loading", "current": 0, "total": total
    })).ok();

    let mut frames_data = Vec::new();
    let mut widths = Vec::new();
    let mut heights = Vec::new();

    for (i, path) in paths.iter().enumerate() {
        let data = std::fs::read(path).map_err(|e| format!("读取帧 {} 失败: {}", i, e))?;
        let img = image::load_from_memory(&data)
            .map_err(|e| format!("解码帧 {} 失败: {}", i, e))?;
        let rgba = img.to_rgba8();
        widths.push(rgba.width());
        heights.push(rgba.height());
        frames_data.push(rgba.into_raw());

        if i % 10 == 0 {
            app.emit("analysis-progress", serde_json::json!({
                "stage": "loading", "current": i + 1, "total": total
            })).ok();
        }
    }

    // 位移检测
    app.emit("analysis-progress", serde_json::json!({
        "stage": "displacement", "current": 0, "total": total
    })).ok();

    let displacement = detect_displacement_simple(&frames_data, &widths, &heights);

    app.emit("analysis-progress", serde_json::json!({
        "stage": "displacement", "current": total, "total": total
    })).ok();

    // 闪烁检测
    app.emit("analysis-progress", serde_json::json!({
        "stage": "flicker", "current": 0, "total": total
    })).ok();

    let flicker_frames = detect_flicker_simple(&frames_data, &widths, &heights);

    app.emit("analysis-progress", serde_json::json!({
        "stage": "flicker", "current": total, "total": total
    })).ok();

    // 生成报告
    let report = AnalysisReport {
        id: uuid::Uuid::new_v4().to_string(),
        project_id: project_id.clone(),
        track_id: track_id.clone(),
        analyzed_at: chrono::Utc::now().timestamp_millis(),
        total_frames: total as i64,
        displacement,
        flicker_frames,
        consistency_score: 0.0,
        suggestions: vec![],
    };

    // 保存到数据库
    let conn2 = db.lock().map_err(|e| format!("数据库锁失败: {}", e))?;
    conn2.execute(
        "INSERT INTO analysis_reports (id, project_id, track_id, analyzed_at, total_frames, displacement_json, flicker_json, consistency_score, suggestions_json) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            report.id,
            report.project_id,
            report.track_id,
            report.analyzed_at,
            report.total_frames,
            serde_json::to_string(&report.displacement).unwrap_or("[]".to_string()),
            serde_json::to_string(&report.flicker_frames).unwrap_or("[]".to_string()),
            report.consistency_score,
            serde_json::to_string(&report.suggestions).unwrap_or("[]".to_string()),
        ],
    ).map_err(|e| format!("保存报告失败: {}", e))?;

    app.emit("analysis-progress", serde_json::json!({
        "stage": "done", "current": total, "total": total
    })).ok();

    Ok(report)
}

#[tauri::command]
pub fn get_analysis_reports(
    db: State<'_, DbState>,
    project_id: String,
) -> Result<Vec<AnalysisReport>, String> {
    let conn = db.lock().map_err(|e| format!("数据库锁失败: {}", e))?;
    let mut stmt = conn
        .prepare("SELECT id, project_id, track_id, analyzed_at, total_frames, displacement_json, flicker_json, consistency_score, suggestions_json FROM analysis_reports WHERE project_id = ?1 ORDER BY analyzed_at DESC")
        .map_err(|e| format!("查询报告失败: {}", e))?;

    let reports = stmt
        .query_map(params![project_id], |row| {
            let id: String = row.get(0)?;
            let project_id: String = row.get(1)?;
            let track_id: String = row.get(2)?;
            let analyzed_at: i64 = row.get(3)?;
            let total_frames: i64 = row.get(4)?;
            let disp_str: String = row.get(5)?;
            let flick_str: String = row.get(6)?;
            let consistency_score: f64 = row.get(7)?;
            let sug_str: String = row.get(8)?;

            Ok(AnalysisReport {
                id,
                project_id,
                track_id,
                analyzed_at,
                total_frames,
                displacement: serde_json::from_str(&disp_str).unwrap_or_default(),
                flicker_frames: serde_json::from_str(&flick_str).unwrap_or_default(),
                consistency_score,
                suggestions: serde_json::from_str(&sug_str).unwrap_or_default(),
            })
        })
        .map_err(|e| format!("读取报告失败: {}", e))?
        .filter_map(|r| r.ok())
        .collect();

    Ok(reports)
}

#[tauri::command]
pub fn delete_analysis_report(db: State<'_, DbState>, report_id: String) -> Result<(), String> {
    let conn = db.lock().map_err(|e| format!("数据库锁失败: {}", e))?;
    conn.execute("DELETE FROM analysis_reports WHERE id = ?1", params![report_id])
        .map_err(|e| format!("删除报告失败: {}", e))?;
    Ok(())
}
