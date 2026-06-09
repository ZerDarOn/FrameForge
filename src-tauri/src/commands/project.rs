use crate::db::DbState;
use crate::models::project::Project;
use rusqlite::params;
use tauri::State;

#[tauri::command]
pub fn create_project(
    db: State<'_, DbState>,
    name: String,
    canvas_width: i64,
    canvas_height: i64,
    fps: i64,
) -> Result<Project, String> {
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
    let conn = db.lock().map_err(|e| format!("数据库锁失败: {}", e))?;
    let now = chrono::Utc::now().timestamp_millis();
    conn.execute(
        "UPDATE projects SET name = ?1, canvas_width = ?2, canvas_height = ?3, fps = ?4, updated_at = ?5 WHERE id = ?6",
        params![name, canvas_width, canvas_height, fps, now, id],
    )
    .map_err(|e| format!("更新项目失败: {}", e))?;
    Ok(())
}
