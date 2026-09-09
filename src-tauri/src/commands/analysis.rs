use crate::ai::analysis::cloud;
use crate::ai::analysis::displacement::{detect_displacement_pair, load_frame_rgba};
use crate::ai::analysis::flicker::{compute_brightness, detect_flicker_from_brightnesses};
use crate::ai::providers::AnalysisReport;
use crate::ai::AiConfig;
use crate::db::DbState;
use rusqlite::{params, Connection};
use tauri::{AppHandle, Emitter, State};

fn load_track_paths(
    conn: &Connection,
    project_id: &str,
    track_id: &str,
) -> Result<Vec<String>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT assets.source_path
             FROM assets
             INNER JOIN tracks ON tracks.id = assets.track_id
             WHERE assets.track_id = ?1 AND tracks.project_id = ?2
             ORDER BY assets.start_frame",
        )
        .map_err(|e| format!("查询资产失败: {}", e))?;
    let rows = stmt
        .query_map(params![track_id, project_id], |row| row.get(0))
        .map_err(|e| format!("读取路径失败: {}", e))?;
    let mut paths = Vec::new();
    for row in rows {
        paths.push(row.map_err(|e| format!("读取资产路径行失败: {}", e))?);
    }
    Ok(paths)
}

#[tauri::command]
pub fn analyze_track(
    db: State<'_, DbState>,
    _config: State<'_, AiConfig>,
    app: AppHandle,
    project_id: String,
    track_id: String,
) -> Result<AnalysisReport, String> {
    let conn = db.lock().map_err(|e| format!("数据库锁失败: {}", e))?;

    let paths = load_track_paths(&conn, &project_id, &track_id)?;
    drop(conn);

    if paths.is_empty() {
        return Err("轨道中没有帧".to_string());
    }

    let total = paths.len();

    app.emit(
        "analysis-progress",
        serde_json::json!({
            "projectId": project_id, "stage": "loading", "current": 0, "total": total
        }),
    )
    .ok();

    // ── 第 1 遍：逐帧计算亮度（仅保留 f64 序列，~8 bytes/帧）──
    let mut brightnesses: Vec<f64> = Vec::with_capacity(total);

    for (i, path) in paths.iter().enumerate() {
        let (data, w, h) = load_frame_rgba(path)?;
        brightnesses.push(compute_brightness(&data, w, h));
        // data 在此处自动 drop，释放 ~W*H*4 字节

        if i % 10 == 0 || i == total - 1 {
            app.emit(
                "analysis-progress",
                serde_json::json!({
                    "projectId": project_id, "stage": "loading", "current": i + 1, "total": total
                }),
            )
            .ok();
        }
    }

    // ── 第 2 遍：逐对加载帧做位移检测（内存中最多 2 帧）──
    app.emit(
        "analysis-progress",
        serde_json::json!({
            "projectId": project_id, "stage": "displacement", "current": 0, "total": total
        }),
    )
    .ok();

    let mut displacement = Vec::with_capacity(total.saturating_sub(1));

    if total > 1 {
        let (mut prev_data, mut prev_w, mut prev_h) = load_frame_rgba(&paths[0])?;

        for i in 1..total {
            let (cur_data, cur_w, cur_h) = load_frame_rgba(&paths[i])?;
            displacement.push(detect_displacement_pair(
                &prev_data, prev_w, prev_h, &cur_data, cur_w, cur_h, i as i64,
            ));
            // 释放前一帧，替换为当前帧用于下轮迭代
            prev_data = cur_data;
            prev_w = cur_w;
            prev_h = cur_h;

            if i % 10 == 0 || i == total - 1 {
                app.emit(
                    "analysis-progress",
                    serde_json::json!({
                        "projectId": project_id, "stage": "displacement", "current": i + 1, "total": total
                    }),
                )
                .ok();
            }
        }
    }

    // ── 闪烁检测：基于已收集的亮度序列（内存占用可忽略）──
    app.emit(
        "analysis-progress",
        serde_json::json!({
            "projectId": project_id, "stage": "flicker", "current": 0, "total": total
        }),
    )
    .ok();

    let flicker_frames = detect_flicker_from_brightnesses(&brightnesses);

    app.emit(
        "analysis-progress",
        serde_json::json!({
            "projectId": project_id, "stage": "flicker", "current": total, "total": total
        }),
    )
    .ok();

    // ── 生成报告 ──
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

    app.emit(
        "analysis-progress",
        serde_json::json!({
            "projectId": project_id, "stage": "done", "current": total, "total": total
        }),
    )
    .ok();

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
    conn.execute(
        "DELETE FROM analysis_reports WHERE id = ?1",
        params![report_id],
    )
    .map_err(|e| format!("删除报告失败: {}", e))?;
    Ok(())
}

/// 云端一致性检查（OpenAI GPT-4V）
#[tauri::command]
pub fn cloud_consistency_check(
    config: State<'_, AiConfig>,
    app: AppHandle,
    project_id: String,
    track_id: String,
    db: State<'_, DbState>,
) -> Result<AnalysisReport, String> {
    let cfg = config.lock().map_err(|e| format!("配置锁失败: {}", e))?;
    let openai_provider = cfg
        .providers
        .iter()
        .find(|p| p.id == "openai")
        .ok_or("未找到 OpenAI Provider")?
        .clone();
    let api_key = cfg
        .api_keys
        .get("openai")
        .ok_or("未配置 OpenAI API Key")?
        .clone();
    drop(cfg);

    let conn = db.lock().map_err(|e| format!("数据库锁失败: {}", e))?;
    let paths = load_track_paths(&conn, &project_id, &track_id)?;
    drop(conn);

    if paths.is_empty() {
        return Err("轨道中没有帧".to_string());
    }

    app.emit(
        "analysis-progress",
        serde_json::json!({
            "projectId": project_id, "stage": "loading", "current": 0, "total": paths.len()
        }),
    )
    .ok();

    // 编码帧为 base64
    let mut frames_b64 = Vec::new();
    for (i, path) in paths.iter().enumerate() {
        let data = std::fs::read(path).map_err(|e| format!("读取帧 {} 失败: {}", i, e))?;
        let b64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &data);
        frames_b64.push(b64);
    }

    app.emit(
        "analysis-progress",
        serde_json::json!({
            "projectId": project_id, "stage": "consistency", "current": 0, "total": 1
        }),
    )
    .ok();

    // 调用云端分析
    let consistency = cloud::check_consistency_openai(&openai_provider, &api_key, &frames_b64)?;

    // 生成建议
    let issues: Vec<(i64, String, String)> = vec![(
        0,
        "consistency".to_string(),
        consistency.description.clone(),
    )];
    let suggestions =
        cloud::generate_suggestions_openai(&openai_provider, &api_key, &issues).unwrap_or_default();

    let report = AnalysisReport {
        id: uuid::Uuid::new_v4().to_string(),
        project_id: project_id.clone(),
        track_id,
        analyzed_at: chrono::Utc::now().timestamp_millis(),
        total_frames: paths.len() as i64,
        displacement: vec![],
        flicker_frames: vec![],
        consistency_score: consistency.score,
        suggestions,
    };

    // 保存
    let conn2 = db.lock().map_err(|e| format!("数据库锁失败: {}", e))?;
    conn2.execute(
        "INSERT INTO analysis_reports (id, project_id, track_id, analyzed_at, total_frames, displacement_json, flicker_json, consistency_score, suggestions_json) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            report.id, report.project_id, report.track_id, report.analyzed_at,
            report.total_frames, "[]", "[]", report.consistency_score,
            serde_json::to_string(&report.suggestions).unwrap_or("[]".to_string()),
        ],
    ).map_err(|e| format!("保存报告失败: {}", e))?;

    app.emit(
        "analysis-progress",
        serde_json::json!({
            "projectId": project_id, "stage": "done", "current": 1, "total": 1
        }),
    )
    .ok();

    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::load_track_paths;
    use rusqlite::{params, Connection};

    #[test]
    fn track_paths_require_matching_project_ownership() {
        let conn = Connection::open_in_memory().expect("open database");
        conn.execute_batch(
            "CREATE TABLE tracks (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL
            );
            CREATE TABLE assets (
                id TEXT PRIMARY KEY,
                track_id TEXT NOT NULL,
                source_path TEXT NOT NULL,
                start_frame INTEGER NOT NULL
            );",
        )
        .expect("create schema");
        conn.execute(
            "INSERT INTO tracks (id, project_id) VALUES (?1, ?2)",
            params!["track-b", "project-b"],
        )
        .expect("insert track");
        conn.execute(
            "INSERT INTO assets (id, track_id, source_path, start_frame)
             VALUES (?1, ?2, ?3, ?4)",
            params!["asset-b", "track-b", "B:/frame.png", 0],
        )
        .expect("insert asset");

        assert!(load_track_paths(&conn, "project-a", "track-b")
            .expect("mismatched project query")
            .is_empty());
        assert_eq!(
            load_track_paths(&conn, "project-b", "track-b").expect("owned track query"),
            vec!["B:/frame.png".to_string()],
        );
    }
}
