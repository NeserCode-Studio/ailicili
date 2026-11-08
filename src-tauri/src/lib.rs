use tauri::{
    Manager,
    image::Image,
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Position, Size,
};

mod bilibili;
mod domain;
mod storage;

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

#[tauri::command]
async fn get_popular_videos(page: u32) -> Result<domain::PagedVideos, String> {
    bilibili::BilibiliClient::new()
        .map_err(|err| err.to_string())?
        .popular(page)
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
async fn get_video_playback(
    video_id: String,
    cid: i64,
    quality: i64,
) -> Result<domain::PlaybackInfo, String> {
    bilibili::BilibiliClient::new()
        .map_err(|err| err.to_string())?
        .video_playback(&video_id, cid, quality)
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
async fn get_video_detail(video_id: String) -> Result<domain::VideoDetail, String> {
    bilibili::BilibiliClient::new()
        .map_err(|err| err.to_string())?
        .video_detail(&video_id)
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
async fn get_search_videos(keyword: String, page: u32) -> Result<domain::PagedVideos, String> {
    bilibili::BilibiliClient::new()
        .map_err(|err| err.to_string())?
        .search(&keyword, page)
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
async fn list_local_history() -> Result<Vec<domain::HistoryEntry>, String> {
    tauri::async_runtime::spawn_blocking(storage::list_history)
        .await
        .map_err(|err| err.to_string())?
}

#[tauri::command]
async fn save_local_history(
    detail: domain::VideoDetail,
    page_cid: i64,
    page_title: String,
    progress_seconds: i64,
    duration_seconds: i64,
) -> Result<Vec<domain::HistoryEntry>, String> {
    let entry = domain::HistoryEntry {
        card: detail.card,
        page_cid,
        page_title,
        progress_seconds,
        duration_seconds,
        updated_at: chrono::Utc::now().timestamp(),
    };
    tauri::async_runtime::spawn_blocking(move || storage::save_history_entry(entry))
        .await
        .map_err(|err| err.to_string())?
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
            let icon = Image::from_bytes(include_bytes!("../icons/32x32.png"))
                .expect("Failed to load tray icon");

            TrayIconBuilder::new()
                .icon(icon)
                .tooltip("App Template")
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
                            let _ = window.emit("tray-popup", serde_json::json!({
                                "x": (rx + rw / 2.0) as i32,
                                "y": ry as i32,
                            }));
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
        .invoke_handler(tauri::generate_handler![
            greet,
            open_devtools,
            get_popular_videos,
            get_video_playback,
            get_video_detail,
            get_search_videos,
            list_local_history,
            save_local_history
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
