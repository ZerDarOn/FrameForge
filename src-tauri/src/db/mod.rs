pub mod init;

use rusqlite::Connection;
use std::sync::Mutex;

pub type DbState = Mutex<Connection>;

pub fn init_db(app_dir: &std::path::Path) -> Result<Connection, String> {
    let db_path = app_dir.join("frameforge.db");
    let conn =
        Connection::open(&db_path).map_err(|e| format!("数据库打开失败: {}", e))?;
    init::create_tables(&conn)?;
    Ok(conn)
}
