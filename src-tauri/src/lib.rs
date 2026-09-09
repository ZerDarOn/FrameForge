mod ai;
mod commands;
mod db;
mod models;

use db::DbState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            let app_dir = app.path().app_data_dir().expect("无法获取应用数据目录");
            std::fs::create_dir_all(&app_dir).ok();
            let conn = db::init_db(&app_dir).expect("数据库初始化失败");
            app.manage(DbState::new(conn));
            app.manage(ai::AiConfig::new(ai::config::AiConfigState::default()));
            app.manage(commands::generation::GenerationJobRegistry::default());
            app.manage(commands::asset::VideoImportRegistry::default());

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::project::create_project,
            commands::project::list_projects,
            commands::project::get_project,
            commands::project::delete_project,
            commands::project::update_project,
            commands::project::update_baseline_points,
            commands::project::get_baseline_points,
            commands::animation_document::get_animation_document,
            commands::animation_document::save_animation_document,
            commands::animation_document::read_content_image,
            commands::animation_document::write_content_revision,
            commands::asset::scan_image_folder,
            commands::asset::inspect_image_file,
            commands::asset::create_track,
            commands::asset::import_files_to_new_track,
            commands::asset::slice_sprite_sheet_to_new_track,
            commands::asset::import_gif_to_new_track,
            commands::asset::inspect_video_file,
            commands::asset::import_video_to_new_track,
            commands::asset::cancel_video_import,
            commands::asset::extract_asset_to_new_track,
            commands::asset::import_frames_to_track,
            commands::asset::get_project_tracks,
            commands::asset::read_image_as_base64,
            commands::asset::read_thumbnail_base64,
            commands::asset::delete_asset,
            commands::asset::delete_track,
            commands::asset::update_asset_transform,
            commands::asset::export_png_sequence,
            commands::asset::export_gif,
            commands::rendered_export::write_rendered_png_sequence,
            commands::rendered_export::write_rendered_gif,
            commands::ai_config::get_ai_config,
            commands::ai_config::set_ai_api_key,
            commands::ai_config::toggle_ai_provider,
            commands::ai_config::set_default_ai_provider,
            commands::analysis::analyze_track,
            commands::analysis::get_analysis_reports,
            commands::analysis::delete_analysis_report,
            commands::analysis::cloud_consistency_check,
            commands::generation::generate_pixel_art,
            commands::generation::cancel_generation,
            commands::generation::list_generated_assets,
            commands::generation::delete_generated_asset,
            commands::generation::add_generated_to_timeline,
        ])
        .run(tauri::generate_context!())
        .expect("启动失败");
}
