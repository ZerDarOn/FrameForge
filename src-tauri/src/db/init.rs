use rusqlite::Connection;

pub fn create_tables(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS projects (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            canvas_width INTEGER NOT NULL DEFAULT 1920,
            canvas_height INTEGER NOT NULL DEFAULT 1080,
            fps INTEGER NOT NULL DEFAULT 24,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS tracks (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL,
            name TEXT NOT NULL,
            type TEXT NOT NULL DEFAULT 'image_sequence',
            visible INTEGER NOT NULL DEFAULT 1,
            locked INTEGER NOT NULL DEFAULT 0,
            opacity REAL NOT NULL DEFAULT 1.0,
            track_order INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY (project_id) REFERENCES projects(id)
        );

        CREATE TABLE IF NOT EXISTS assets (
            id TEXT PRIMARY KEY,
            track_id TEXT NOT NULL,
            name TEXT NOT NULL,
            source_type TEXT NOT NULL,
            source_path TEXT NOT NULL,
            thumbnail_path TEXT NOT NULL,
            start_frame INTEGER NOT NULL DEFAULT 0,
            duration_frames INTEGER NOT NULL DEFAULT 1,
            width INTEGER NOT NULL DEFAULT 0,
            height INTEGER NOT NULL DEFAULT 0,
            transform_x REAL NOT NULL DEFAULT 0.0,
            transform_y REAL NOT NULL DEFAULT 0.0,
            transform_scale_x REAL NOT NULL DEFAULT 1.0,
            transform_scale_y REAL NOT NULL DEFAULT 1.0,
            transform_rotation REAL NOT NULL DEFAULT 0.0,
            alignment_dx REAL NOT NULL DEFAULT 0.0,
            alignment_dy REAL NOT NULL DEFAULT 0.0,
            matched_fps INTEGER NOT NULL DEFAULT 1,
            source_timestamp INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY (track_id) REFERENCES tracks(id)
        );

        CREATE TABLE IF NOT EXISTS baseline_points (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL,
            name TEXT NOT NULL,
            type TEXT NOT NULL DEFAULT 'point',
            coordinates TEXT NOT NULL DEFAULT '[]',
            frame_index INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY (project_id) REFERENCES projects(id)
        );

        CREATE TABLE IF NOT EXISTS analysis_reports (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL,
            track_id TEXT NOT NULL,
            analyzed_at INTEGER NOT NULL,
            total_frames INTEGER NOT NULL,
            displacement_json TEXT NOT NULL DEFAULT '[]',
            flicker_json TEXT NOT NULL DEFAULT '[]',
            consistency_score REAL NOT NULL DEFAULT 0.0,
            suggestions_json TEXT NOT NULL DEFAULT '[]',
            FOREIGN KEY (project_id) REFERENCES projects(id),
            FOREIGN KEY (track_id) REFERENCES tracks(id)
        );

        CREATE TABLE IF NOT EXISTS generated_assets (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL,
            name TEXT NOT NULL,
            asset_type TEXT NOT NULL DEFAULT 'sprite',
            prompt TEXT NOT NULL,
            negative_prompt TEXT,
            style TEXT NOT NULL,
            width INTEGER NOT NULL,
            height INTEGER NOT NULL,
            palette TEXT,
            seed INTEGER,
            provider TEXT NOT NULL,
            file_path TEXT NOT NULL,
            thumbnail_path TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            metadata TEXT,
            FOREIGN KEY (project_id) REFERENCES projects(id)
        );
        ",
    )
    .map_err(|e| format!("创建表失败: {}", e))?;
    Ok(())
}
