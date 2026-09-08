use rusqlite::Connection;

type Migration = (&'static str, &'static str);

/// 按顺序排列的迁移列表：(version_tag, sql)
/// 版本号命名：v{序号}_{描述}
/// 必须幂等：已有迁移不会重复执行
static MIGRATIONS: &[Migration] = &[
    ("v1_initial", include_str!("migrations/v1_initial.sql")),
    (
        "v2_animation_documents",
        include_str!("migrations/v2_animation_documents.sql"),
    ),
];

/// 确保 schema_version 表存在
fn ensure_schema_version_table(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_version (
            version TEXT PRIMARY KEY,
            applied_at INTEGER NOT NULL
        )",
    )
    .map_err(|e| format!("创建 schema_version 表失败: {}", e))
}

/// 运行所有未应用的迁移
pub fn run_migrations(conn: &Connection) -> Result<Vec<String>, String> {
    ensure_schema_version_table(conn)?;

    let mut applied = Vec::new();

    for (version, sql) in MIGRATIONS {
        let already: bool = conn
            .query_row(
                "SELECT COUNT(*) > 0 FROM schema_version WHERE version = ?1",
                rusqlite::params![version],
                |row| row.get(0),
            )
            .unwrap_or(false);

        if already {
            continue;
        }

        let tx = conn
            .unchecked_transaction()
            .map_err(|e| format!("开始迁移 {} 事务失败: {}", *version, e))?;
        tx.execute_batch(sql)
            .map_err(|e| format!("迁移 {} 失败: {}", *version, e))?;

        let now = chrono::Utc::now().timestamp_millis();
        tx.execute(
            "INSERT INTO schema_version (version, applied_at) VALUES (?1, ?2)",
            rusqlite::params![version, now],
        )
        .map_err(|e| format!("记录迁移 {} 失败: {}", *version, e))?;
        tx.commit()
            .map_err(|e| format!("提交迁移 {} 事务失败: {}", *version, e))?;

        applied.push(version.to_string());
    }

    Ok(applied)
}

#[cfg(test)]
mod tests {
    use super::run_migrations;
    use rusqlite::Connection;

    #[test]
    fn migrations_are_idempotent_and_create_animation_documents() {
        let conn = Connection::open_in_memory().expect("in-memory database");

        let first = run_migrations(&conn).expect("first migration run");
        let second = run_migrations(&conn).expect("second migration run");
        let table_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'animation_documents'",
                [],
                |row| row.get(0),
            )
            .expect("animation_documents table");

        assert_eq!(first, vec!["v1_initial", "v2_animation_documents"]);
        assert!(second.is_empty());
        assert_eq!(table_count, 1);
    }
}
