pub mod init;
pub mod migrate;

use rusqlite::Connection;
use std::sync::Mutex;

pub type DbState = Mutex<Connection>;

pub fn init_db(app_dir: &std::path::Path) -> Result<Connection, String> {
    let db_path = app_dir.join("frameforge.db");
    let conn = Connection::open(&db_path).map_err(|e| format!("数据库打开失败: {}", e))?;
    // 用迁移机制创建表（兼容旧数据，v1_initial.sql 使用 IF NOT EXISTS）
    let applied = migrate::run_migrations(&conn)?;
    if !applied.is_empty() {
        log::info!("已应用数据库迁移: {:?}", applied);
    }
    Ok(conn)
}
