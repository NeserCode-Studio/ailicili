use std::sync::Arc;

use tauri::{
    image::Image,
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, Position, Size,
};

mod bili;
mod downloads;

use bili::{
    client::BiliClient,
    commands::{
        bili_add_watch_later, bili_auth_status, bili_clear_history, bili_coin_video, bili_comments,
        bili_danmaku, bili_delete_history, bili_dynamic_feed, bili_favorite_folders,
        bili_favorite_resources, bili_follow_user, bili_heartbeat, bili_history, bili_like_video,
        bili_live_areas, bili_live_chat_poll, bili_live_chat_start, bili_live_chat_stop,
        bili_live_playback_session, bili_live_room, bili_live_rooms, bili_login_poll,
        bili_login_start, bili_logout, bili_pgc_index, bili_pgc_season, bili_pgc_timeline,
        bili_playback_session, bili_popular_videos, bili_post_comment, bili_remove_watch_later,
        bili_resume_point, bili_search, bili_search_suggestions, bili_send_danmaku,
        bili_set_video_favorite, bili_space_profile, bili_space_videos, bili_triple_video,
        bili_video_actions, bili_video_detail, bili_watch_later,
    },
};
use downloads::{
    download_cancel, download_create, download_options, download_pause, download_remove,
    download_resume, download_retry, download_reveal, download_set_ffmpeg_path, download_set_root,
    download_settings, download_snapshot, DownloadManager,
};

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn open_devtools(app: tauri::AppHandle) -> Result<(), String> {
    app.get_webview_window("main")
        .ok_or_else(|| "Main window not found".to_string())?
        .open_devtools();
    Ok(())
}

/// 左键点击托盘图标：显隐主窗口。
///
/// 注意：最小化的窗口 `is_visible()` 仍返回 true，只看可见性会导致
/// 「最小化 → 点托盘 → 仍然最小化」的死循环。必须同时判断最小化状态：
/// - 可见且未最小化 → 隐藏（相当于收起到托盘）
/// - 不可见 或 已最小化 → 取消最小化 + 显示 + 聚焦
fn toggle_main_window(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };

    let is_visible = window.is_visible().unwrap_or(false);
    let is_minimized = window.is_minimized().unwrap_or(false);

    if is_visible && !is_minimized {
        let _ = window.hide();
    } else {
        // 先恢复再显示，否则窗口会停留在任务栏最小化态
        if is_minimized {
            let _ = window.unminimize();
        }
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let bili_client = BiliClient::new()?;
            app.manage(bili_client);

            let app_data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&app_data_dir)?;
            let download_root = app.path().download_dir()?.join("Ailicili");
            let download_manager = DownloadManager::new(
                app.handle().clone(),
                &app_data_dir.join("downloads.sqlite3"),
                &download_root,
            )?;
            app.manage(Arc::new(download_manager));

            let icon = Image::from_bytes(include_bytes!("../icons/32x32.png"))
                .expect("Failed to load tray icon");

            TrayIconBuilder::with_id("main")
                .icon(icon)
                .tooltip("Ailicili")
                .on_tray_icon_event(|tray, event| {
                    let (rx, ry, rw, is_right) = match event {
                        TrayIconEvent::Click {
                            button,
                            button_state: MouseButtonState::Up,
                            rect,
                            ..
                        } => {
                            let (rx, ry) = match &rect.position {
                                Position::Physical(p) => (p.x as f64, p.y as f64),
                                Position::Logical(p) => (p.x, p.y),
                            };
                            let rw = match &rect.size {
                                Size::Physical(s) => s.width as f64,
                                Size::Logical(s) => s.width,
                            };
                            (rx, ry, rw, matches!(button, MouseButton::Right))
                        }
                        _ => return,
                    };

                    if is_right {
                        if let Some(window) = tray.app_handle().get_webview_window("main") {
                            let _ = window.emit(
                                "tray-popup",
                                serde_json::json!({
                                    "x": (rx + rw / 2.0) as i32,
                                    "y": ry as i32,
                                }),
                            );
                        }
                    } else {
                        toggle_main_window(tray.app_handle());
                    }
                })
                .build(app)?;
            Ok(())
        })
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .register_asynchronous_uri_scheme_protocol("bilistream", |context, request, responder| {
            bili::stream::handle(context.app_handle().clone(), context, request, responder);
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            open_devtools,
            bili_popular_videos,
            bili_video_detail,
            bili_pgc_timeline,
            bili_pgc_index,
            bili_pgc_season,
            bili_playback_session,
            bili_live_areas,
            bili_live_rooms,
            bili_live_room,
            bili_live_playback_session,
            bili_live_chat_start,
            bili_live_chat_poll,
            bili_live_chat_stop,
            bili_auth_status,
            bili_login_start,
            bili_login_poll,
            bili_logout,
            bili_search,
            bili_search_suggestions,
            bili_danmaku,
            bili_dynamic_feed,
            bili_send_danmaku,
            bili_comments,
            bili_post_comment,
            bili_video_actions,
            bili_like_video,
            bili_coin_video,
            bili_triple_video,
            bili_follow_user,
            bili_favorite_folders,
            bili_set_video_favorite,
            bili_history,
            bili_delete_history,
            bili_clear_history,
            bili_watch_later,
            bili_add_watch_later,
            bili_remove_watch_later,
            bili_favorite_resources,
            bili_resume_point,
            bili_heartbeat,
            bili_space_profile,
            bili_space_videos,
            download_options,
            download_create,
            download_snapshot,
            download_settings,
            download_set_root,
            download_set_ffmpeg_path,
            download_pause,
            download_resume,
            download_retry,
            download_cancel,
            download_remove,
            download_reveal
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
