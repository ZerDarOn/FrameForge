use crate::db::DbState;
use crate::models::project::Project;
use rusqlite::params;
use serde::Deserialize;
use std::collections::HashSet;
use tauri::State;

const MAX_BASELINE_POINTS: usize = 1_000;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BaselinePointInput {
    id: String,
    name: String,
    #[serde(rename = "type")]
    point_type: String,
    coordinates: Vec<f64>,
    frame_index: i64,
}

fn validate_project_settings(
    name: &str,
    canvas_width: i64,
    canvas_height: i64,
    fps: i64,
) -> Result<(), String> {
    if name.trim().is_empty() || name.chars().count() > 128 {
        return Err("项目名称必须为 1 到 128 个字符".to_string());
    }
    if !(1..=16_384).contains(&canvas_width) || !(1..=16_384).contains(&canvas_height) {
        return Err("画布尺寸必须在 1 到 16384 像素之间".to_string());
    }
    if !(1..=240).contains(&fps) {
        return Err("帧率必须在 1 到 240 之间".to_string());
    }
    Ok(())
}

#[tauri::command]
pub fn create_project(
    db: State<'_, DbState>,
    name: String,
    canvas_width: i64,
    canvas_height: i64,
    fps: i64,
) -> Result<Project, String> {
    validate_project_settings(&name, canvas_width, canvas_height, fps)?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().timestamp_millis();

    let project = Project {
        id: id.clone(),
        name,
        canvas_width,
        canvas_height,
        fps,
        created_at: now,
        updated_at: now,
        baseline_points: vec![],
    };

    let conn = db.lock().map_err(|e| format!("数据库锁失败: {}", e))?;
    conn.execute(
        "INSERT INTO projects (id, name, canvas_width, canvas_height, fps, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![project.id, project.name, project.canvas_width, project.canvas_height, project.fps, project.created_at, project.updated_at],
    )
    .map_err(|e| format!("创建项目失败: {}", e))?;

    Ok(project)
}

#[tauri::command]
pub fn list_projects(db: State<'_, DbState>) -> Result<Vec<Project>, String> {
    let conn = db.lock().map_err(|e| format!("数据库锁失败: {}", e))?;
    let mut stmt = conn
        .prepare("SELECT id, name, canvas_width, canvas_height, fps, created_at, updated_at FROM projects ORDER BY updated_at DESC")
        .map_err(|e| format!("查询项目失败: {}", e))?;

    let projects = stmt
        .query_map([], |row| {
            Ok(Project {
                id: row.get(0)?,
                name: row.get(1)?,
                canvas_width: row.get(2)?,
                canvas_height: row.get(3)?,
                fps: row.get(4)?,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
                baseline_points: vec![],
            })
        })
        .map_err(|e| format!("读取项目失败: {}", e))?
        .filter_map(|p| p.ok())
        .collect();

    Ok(projects)
}

#[tauri::command]
pub fn get_project(db: State<'_, DbState>, id: String) -> Result<Project, String> {
    let conn = db.lock().map_err(|e| format!("数据库锁失败: {}", e))?;
    let mut stmt = conn
        .prepare("SELECT id, name, canvas_width, canvas_height, fps, created_at, updated_at FROM projects WHERE id = ?1")
        .map_err(|e| format!("查询项目失败: {}", e))?;

    let project = stmt
        .query_row(params![id], |row| {
            Ok(Project {
                id: row.get(0)?,
                name: row.get(1)?,
                canvas_width: row.get(2)?,
                canvas_height: row.get(3)?,
                fps: row.get(4)?,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
                baseline_points: vec![],
            })
        })
        .map_err(|e| format!("项目不存在: {}", e))?;

    Ok(project)
}

#[tauri::command]
pub fn delete_project(db: State<'_, DbState>, id: String) -> Result<(), String> {
    let conn = db.lock().map_err(|e| format!("数据库锁失败: {}", e))?;
    conn.execute("DELETE FROM projects WHERE id = ?1", params![id])
        .map_err(|e| format!("删除项目失败: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn update_project(
    db: State<'_, DbState>,
    id: String,
    name: String,
    canvas_width: i64,
    canvas_height: i64,
    fps: i64,
) -> Result<(), String> {
    validate_project_settings(&name, canvas_width, canvas_height, fps)?;
    let conn = db.lock().map_err(|e| format!("数据库锁失败: {}", e))?;
    let now = chrono::Utc::now().timestamp_millis();
    conn.execute(
        "UPDATE projects SET name = ?1, canvas_width = ?2, canvas_height = ?3, fps = ?4, updated_at = ?5 WHERE id = ?6",
        params![name, canvas_width, canvas_height, fps, now, id],
    )
    .map_err(|e| format!("更新项目失败: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn update_baseline_points(
    db: State<'_, DbState>,
    project_id: String,
    points_json: String,
) -> Result<(), String> {
    let mut conn = db.lock().map_err(|e| format!("数据库锁失败: {}", e))?;
    replace_baseline_points(&mut conn, &project_id, &points_json)
}

fn replace_baseline_points(
    conn: &mut rusqlite::Connection,
    project_id: &str,
    points_json: &str,
) -> Result<(), String> {
    let points: Vec<BaselinePointInput> =
        serde_json::from_str(points_json).map_err(|e| format!("解析基准点失败: {}", e))?;
    if points.len() > MAX_BASELINE_POINTS {
        return Err(format!("基准点不能超过 {} 个", MAX_BASELINE_POINTS));
    }
    let mut ids = HashSet::with_capacity(points.len());
    for point in &points {
        if point.id.is_empty()
            || point.id.len() > 128
            || !point.id.chars().all(|character| {
                character.is_ascii_alphanumeric() || character == '-' || character == '_'
            })
            || !ids.insert(point.id.as_str())
        {
            return Err("基准点 ID 无效或重复".to_string());
        }
        if point.name.trim().is_empty() || point.name.chars().count() > 128 {
            return Err("基准点名称必须为 1..=128 个字符".to_string());
        }
        let expected_coordinates = match point.point_type.as_str() {
            "point" => 2,
            "line" | "region" => 4,
            _ => return Err("基准点类型无效".to_string()),
        };
        if point.coordinates.len() != expected_coordinates
            || point
                .coordinates
                .iter()
                .any(|coordinate| !coordinate.is_finite() || !(0.0..=1.0).contains(coordinate))
        {
            return Err("基准点坐标无效".to_string());
        }
        if point.point_type == "region"
            && (point.coordinates[0] > point.coordinates[2]
                || point.coordinates[1] > point.coordinates[3])
        {
            return Err("基准区域坐标顺序无效".to_string());
        }
        if !(0..=1_000_000).contains(&point.frame_index) {
            return Err("基准点帧索引无效".to_string());
        }
    }

    let tx = conn
        .transaction()
        .map_err(|e| format!("开始基准点事务失败: {}", e))?;
    let project_exists: bool = tx
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM projects WHERE id = ?1)",
            params![project_id],
            |row| row.get(0),
        )
        .map_err(|e| format!("检查基准点项目失败: {}", e))?;
    if !project_exists {
        return Err("基准点目标项目不存在".to_string());
    }
    tx.execute(
        "DELETE FROM baseline_points WHERE project_id = ?1",
        params![project_id],
    )
    .map_err(|e| format!("删除旧基准点失败: {}", e))?;
    for point in points {
        let coordinates = serde_json::to_string(&point.coordinates)
            .map_err(|e| format!("序列化基准点坐标失败: {}", e))?;
        tx.execute(
            "INSERT INTO baseline_points (id, project_id, name, type, coordinates, frame_index) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                point.id,
                project_id,
                point.name.trim(),
                point.point_type,
                coordinates,
                point.frame_index
            ],
        )
        .map_err(|e| format!("插入基准点失败: {}", e))?;
    }
    tx.commit()
        .map_err(|e| format!("提交基准点事务失败: {}", e))
}

#[tauri::command]
pub fn get_baseline_points(
    db: State<'_, DbState>,
    project_id: String,
) -> Result<Vec<serde_json::Value>, String> {
    let conn = db.lock().map_err(|e| format!("数据库锁失败: {}", e))?;
    let mut stmt = conn
        .prepare("SELECT id, name, type, coordinates, frame_index FROM baseline_points WHERE project_id = ?1 ORDER BY frame_index, id")
        .map_err(|e| format!("查询基准点失败: {}", e))?;
    let rows = stmt
        .query_map(params![project_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, i64>(4)?,
            ))
        })
        .map_err(|e| format!("读取基准点失败: {}", e))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("读取基准点行失败: {}", e))?;
    let mut points = Vec::with_capacity(rows.len());
    for (id, name, point_type, coordinates_json, frame_index) in rows {
        let coordinates: Vec<f64> = serde_json::from_str(&coordinates_json)
            .map_err(|e| format!("解析已保存基准点坐标失败: {}", e))?;
        points.push(serde_json::json!({
            "id": id,
            "name": name,
            "type": point_type,
            "coordinates": coordinates,
            "frameIndex": frame_index,
        }));
    }
    Ok(points)
}

#[cfg(test)]
mod tests {
    use super::replace_baseline_points;
    use rusqlite::{params, Connection};

    fn baseline_database() -> Connection {
        let connection = Connection::open_in_memory().expect("in-memory database");
        connection
            .execute_batch(
                "PRAGMA foreign_keys = ON;
                 CREATE TABLE projects (id TEXT PRIMARY KEY);
                 CREATE TABLE baseline_points (
                    id TEXT PRIMARY KEY,
                    project_id TEXT NOT NULL,
                    name TEXT NOT NULL,
                    type TEXT NOT NULL,
                    coordinates TEXT NOT NULL,
                    frame_index INTEGER NOT NULL,
                    FOREIGN KEY (project_id) REFERENCES projects(id)
                 );
                 INSERT INTO projects (id) VALUES ('project-a'), ('project-b');
                 INSERT INTO baseline_points
                    (id, project_id, name, type, coordinates, frame_index)
                 VALUES
                    ('existing', 'project-a', 'Existing', 'point', '[0.5,0.5]', 0),
                    ('collision', 'project-b', 'Other', 'point', '[0.2,0.2]', 0);",
            )
            .expect("schema and fixtures");
        connection
    }

    #[test]
    fn invalid_baseline_payload_never_deletes_existing_points() {
        let mut connection = baseline_database();
        assert!(replace_baseline_points(
            &mut connection,
            "project-a",
            r#"[{"id":"bad","name":"Bad","type":"unknown","coordinates":[0.1,0.2],"frameIndex":0}]"#,
        )
        .is_err());

        let count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM baseline_points WHERE project_id = ?1",
                params!["project-a"],
                |row| row.get(0),
            )
            .expect("count");
        assert_eq!(count, 1);
    }

    #[test]
    fn baseline_replacement_rolls_back_when_an_insert_fails() {
        let mut connection = baseline_database();
        assert!(replace_baseline_points(
            &mut connection,
            "project-a",
            r#"[{"id":"collision","name":"Collision","type":"point","coordinates":[0.1,0.2],"frameIndex":0}]"#,
        )
        .is_err());

        let existing_name: String = connection
            .query_row(
                "SELECT name FROM baseline_points WHERE id = 'existing'",
                [],
                |row| row.get(0),
            )
            .expect("existing point restored");
        assert_eq!(existing_name, "Existing");
    }
}
