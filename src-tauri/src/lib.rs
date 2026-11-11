use std::sync::{Arc, RwLock};
use tauri::{
    image::Image,
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, Position, Size,
};

mod account;
mod bilibili;
mod device;
mod domain;
mod live;
mod live_media;
mod platforms;
mod storage;
mod wbi;

struct AppState {
    bilibili: bilibili::BilibiliClient,
    platforms: platforms::PlatformRegistry,
    account: account::AccountManager,
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn get_platform_catalog(state: tauri::State<'_, AppState>) -> Vec<domain::PlatformDescriptor> {
    state.platforms.catalog()
}

#[tauri::command]
fn get_account_center_snapshot(
    state: tauri::State<'_, AppState>,
) -> Result<domain::AccountCenterSnapshot, domain::CommandError> {
    state.account.account_center_snapshot().map_err(Into::into)
}

#[tauri::command]
fn get_platform_login_capabilities(
    state: tauri::State<'_, AppState>,
    platform_id: String,
) -> Result<domain::LoginCapabilities, domain::CommandError> {
    let platform_id = explicit_platform_id(platform_id)?;
    state
        .account
        .login_capabilities(&platform_id)
        .map_err(Into::into)
}

#[tauri::command]
async fn refresh_platform_account(
    state: tauri::State<'_, AppState>,
    platform_id: String,
) -> Result<domain::AccountCenterSnapshot, domain::CommandError> {
    let platform_id = explicit_platform_id(platform_id)?;
    state
        .account
        .refresh_platform_account(&platform_id)
        .await
        .map_err(Into::into)
}

#[tauri::command]
fn logout_platform_account(
    state: tauri::State<'_, AppState>,
    platform_id: String,
) -> Result<domain::AccountCenterSnapshot, domain::CommandError> {
    let platform_id = explicit_platform_id(platform_id)?;
    state
        .account
        .logout_platform_account(&platform_id)
        .map_err(Into::into)
}

#[tauri::command]
fn reset_platform_device_identity(
    state: tauri::State<'_, AppState>,
    platform_id: String,
) -> Result<(), domain::CommandError> {
    let platform_id = explicit_platform_id(platform_id)?;
    state
        .account
        .reset_platform_device_identity(&platform_id)
        .map_err(Into::into)
}

#[tauri::command]
async fn start_platform_login(
    state: tauri::State<'_, AppState>,
    platform_id: String,
    method: domain::LoginMethod,
) -> Result<domain::PlatformLoginStart, domain::CommandError> {
    let platform_id = explicit_platform_id(platform_id)?;
    state
        .account
        .start_platform_login(&platform_id, method)
        .await
        .map_err(Into::into)
}

#[tauri::command]
async fn poll_platform_login(
    state: tauri::State<'_, AppState>,
    platform_id: String,
    flow_id: String,
) -> Result<domain::PlatformLoginEvent, domain::CommandError> {
    let platform_id = explicit_platform_id(platform_id)?;
    state
        .account
        .poll_platform_login(&platform_id, &flow_id)
        .await
        .map_err(Into::into)
}

#[tauri::command]
async fn submit_platform_login_input(
    state: tauri::State<'_, AppState>,
    platform_id: String,
    flow_id: String,
    input: domain::PlatformLoginInput,
) -> Result<domain::PlatformLoginEvent, domain::CommandError> {
    let platform_id = explicit_platform_id(platform_id)?;
    state
        .account
        .submit_platform_login_input(&platform_id, &flow_id, input)
        .await
        .map_err(Into::into)
}

#[tauri::command]
fn cancel_platform_login(
    state: tauri::State<'_, AppState>,
    platform_id: String,
    flow_id: String,
) -> Result<(), domain::CommandError> {
    let platform_id = explicit_platform_id(platform_id)?;
    state
        .account
        .cancel_platform_login(&platform_id, &flow_id)
        .map_err(Into::into)
}

#[tauri::command]
fn open_devtools(app: tauri::AppHandle) -> Result<(), String> {
    app.get_webview_window("main")
        .ok_or_else(|| "Main window not found".to_string())?
        .open_devtools();
    Ok(())
}

#[tauri::command]
async fn get_popular_videos(
    state: tauri::State<'_, AppState>,
    page: u32,
) -> Result<domain::PagedVideos, domain::CommandError> {
    state.bilibili.popular(page).await.map_err(Into::into)
}

#[tauri::command]
async fn get_recommended_videos(
    state: tauri::State<'_, AppState>,
    page: u32,
) -> Result<domain::PagedVideos, domain::CommandError> {
    state.bilibili.recommend(page).await.map_err(Into::into)
}

#[tauri::command]
async fn get_region_videos(
    state: tauri::State<'_, AppState>,
    region_id: i64,
    page: u32,
) -> Result<domain::PagedVideos, domain::CommandError> {
    state
        .bilibili
        .region_feed(region_id, page)
        .await
        .map_err(Into::into)
}

#[tauri::command]
async fn get_video_playback(
    state: tauri::State<'_, AppState>,
    video_id: String,
    cid: i64,
    quality: i64,
) -> Result<domain::PlaybackInfo, domain::CommandError> {
    state
        .bilibili
        .video_playback(&video_id, cid, quality)
        .await
        .map_err(Into::into)
}

#[tauri::command]
async fn get_video_detail(
    state: tauri::State<'_, AppState>,
    video_id: String,
) -> Result<domain::VideoDetail, domain::CommandError> {
    state
        .bilibili
        .video_detail(&video_id)
        .await
        .map_err(Into::into)
}

#[tauri::command]
async fn get_video_comments(
    state: tauri::State<'_, AppState>,
    aid: i64,
    sort: domain::CommentSort,
    next: Option<String>,
) -> Result<domain::CommentPage, domain::CommandError> {
    state
        .bilibili
        .video_comments(aid, sort, next.as_deref())
        .await
        .map_err(Into::into)
}

#[tauri::command]
async fn get_comment_replies(
    state: tauri::State<'_, AppState>,
    aid: i64,
    root_rpid: i64,
    page: u32,
) -> Result<domain::CommentReplyPage, domain::CommandError> {
    state
        .bilibili
        .comment_replies(aid, root_rpid, page)
        .await
        .map_err(Into::into)
}

#[tauri::command]
async fn get_search_videos(
    state: tauri::State<'_, AppState>,
    keyword: String,
    page: u32,
) -> Result<domain::PagedVideos, domain::CommandError> {
    state
        .bilibili
        .search(&keyword, page)
        .await
        .map_err(Into::into)
}

#[tauri::command]
async fn get_live_discovery(
    state: tauri::State<'_, AppState>,
    platform_id: Option<String>,
) -> Result<domain::LiveDiscovery, domain::CommandError> {
    let platform_id = requested_platform_id(platform_id)?;
    state
        .platforms
        .live_adapter(&platform_id)?
        .discover()
        .await
        .map_err(Into::into)
}

#[tauri::command]
async fn search_live_rooms(
    state: tauri::State<'_, AppState>,
    keyword: String,
    page: u32,
    platform_id: Option<String>,
) -> Result<domain::PagedLiveRooms, domain::CommandError> {
    let platform_id = requested_platform_id(platform_id)?;
    state
        .platforms
        .live_adapter(&platform_id)?
        .search(&keyword, page)
        .await
        .map_err(Into::into)
}

#[tauri::command]
async fn get_live_room_info(
    state: tauri::State<'_, AppState>,
    room_id: String,
    platform_id: Option<String>,
) -> Result<domain::LiveRoomInfo, domain::CommandError> {
    let platform_id = requested_platform_id(platform_id)?;
    state
        .platforms
        .live_adapter(&platform_id)?
        .room_info(&room_id)
        .await
        .map_err(Into::into)
}

#[tauri::command]
async fn get_live_room_playback(
    state: tauri::State<'_, AppState>,
    room_id: String,
    quality: i64,
    platform_id: Option<String>,
) -> Result<domain::LivePlaybackInfo, domain::CommandError> {
    let platform_id = requested_platform_id(platform_id)?;
    state
        .platforms
        .live_adapter(&platform_id)?
        .room_playback(&room_id, quality)
        .await
        .map_err(Into::into)
}

#[tauri::command]
fn get_bilibili_login_capabilities(
    state: tauri::State<'_, AppState>,
) -> Result<domain::LoginCapabilities, domain::CommandError> {
    state
        .account
        .login_capabilities(&domain::PlatformId::bilibili())
        .map_err(Into::into)
}

#[tauri::command]
async fn get_bilibili_account(
    state: tauri::State<'_, AppState>,
) -> Result<domain::BilibiliAccount, domain::CommandError> {
    refresh_bilibili_account(state).await
}

#[tauri::command]
async fn refresh_bilibili_account(
    state: tauri::State<'_, AppState>,
) -> Result<domain::BilibiliAccount, domain::CommandError> {
    let platform_id = domain::PlatformId::bilibili();
    state.account.refresh_platform_account(&platform_id).await?;
    let entry = state.account.platform_account_entry(&platform_id)?;
    Ok(account::legacy_account(&entry))
}

#[tauri::command]
async fn start_bilibili_qr_login(
    state: tauri::State<'_, AppState>,
) -> Result<domain::QrLoginStart, domain::CommandError> {
    let start = state
        .account
        .start_platform_login(&domain::PlatformId::bilibili(), domain::LoginMethod::Qr)
        .await?;
    let domain::PlatformLoginChallenge::Qr { image_data_url } = start.challenge else {
        return Err(invalid_login_flow());
    };
    Ok(domain::QrLoginStart {
        login_id: start.flow_id,
        image_data_url,
        expires_in_seconds: start.expires_in_seconds,
    })
}

#[tauri::command]
async fn poll_bilibili_qr_login(
    state: tauri::State<'_, AppState>,
    login_id: String,
) -> Result<domain::QrLoginPoll, domain::CommandError> {
    let event = state
        .account
        .poll_platform_login(&domain::PlatformId::bilibili(), &login_id)
        .await?;
    let (status, account) = match event.state {
        domain::PlatformLoginState::Pending => (domain::QrLoginStatus::Pending, None),
        domain::PlatformLoginState::Scanned => (domain::QrLoginStatus::Scanned, None),
        domain::PlatformLoginState::Expired => (domain::QrLoginStatus::Expired, None),
        domain::PlatformLoginState::Succeeded { account } => (
            domain::QrLoginStatus::Succeeded,
            Some(account::legacy_account(&account)),
        ),
        domain::PlatformLoginState::Failed | domain::PlatformLoginState::SmsCodeSent { .. } => {
            (domain::QrLoginStatus::Failed, None)
        }
    };
    Ok(domain::QrLoginPoll {
        login_id: event.flow_id,
        status,
        account,
        message_code: event.message_code,
    })
}

#[tauri::command]
fn cancel_bilibili_qr_login(
    state: tauri::State<'_, AppState>,
    login_id: String,
) -> Result<(), domain::CommandError> {
    state
        .account
        .cancel_platform_login(&domain::PlatformId::bilibili(), &login_id)
        .map_err(Into::into)
}

#[tauri::command]
async fn create_bilibili_sms_challenge(
    state: tauri::State<'_, AppState>,
) -> Result<domain::SmsChallenge, domain::CommandError> {
    let start = state
        .account
        .start_platform_login(&domain::PlatformId::bilibili(), domain::LoginMethod::Sms)
        .await?;
    let domain::PlatformLoginChallenge::SmsCaptcha {
        provider,
        gt,
        challenge,
        tencent_app_id,
    } = start.challenge
    else {
        return Err(invalid_login_flow());
    };
    Ok(domain::SmsChallenge {
        challenge_id: start.flow_id,
        provider,
        gt,
        challenge,
        tencent_app_id,
        expires_in_seconds: start.expires_in_seconds,
    })
}

#[tauri::command]
async fn send_bilibili_sms_code(
    state: tauri::State<'_, AppState>,
    challenge_id: String,
    country_code: String,
    phone: String,
    challenge: String,
    validate: String,
    seccode: String,
) -> Result<domain::SmsCodeSent, domain::CommandError> {
    let event = state
        .account
        .submit_platform_login_input(
            &domain::PlatformId::bilibili(),
            &challenge_id,
            domain::PlatformLoginInput::SmsCaptcha {
                country_code,
                phone,
                challenge,
                validate,
                seccode,
            },
        )
        .await?;
    let domain::PlatformLoginState::SmsCodeSent {
        retry_after_seconds,
        expires_in_seconds,
    } = event.state
    else {
        return Err(invalid_login_flow());
    };
    Ok(domain::SmsCodeSent {
        sms_flow_id: event.flow_id,
        retry_after_seconds,
        expires_in_seconds,
    })
}

#[tauri::command]
async fn login_bilibili_with_sms(
    state: tauri::State<'_, AppState>,
    sms_flow_id: String,
    code: String,
) -> Result<domain::BilibiliAccount, domain::CommandError> {
    let event = state
        .account
        .submit_platform_login_input(
            &domain::PlatformId::bilibili(),
            &sms_flow_id,
            domain::PlatformLoginInput::SmsCode { code },
        )
        .await?;
    match event.state {
        domain::PlatformLoginState::Succeeded { account } => Ok(account::legacy_account(&account)),
        domain::PlatformLoginState::Expired => Err(platforms::PlatformError::LoginExpired.into()),
        _ => Err(invalid_login_flow()),
    }
}

#[tauri::command]
fn cancel_bilibili_sms_login(
    state: tauri::State<'_, AppState>,
    challenge_id: Option<String>,
    sms_flow_id: Option<String>,
) -> Result<(), domain::CommandError> {
    let platform_id = domain::PlatformId::bilibili();
    for flow_id in challenge_id.iter().chain(sms_flow_id.iter()) {
        state.account.cancel_platform_login(&platform_id, flow_id)?;
    }
    Ok(())
}

#[tauri::command]
fn logout_bilibili(
    state: tauri::State<'_, AppState>,
) -> Result<domain::BilibiliAccount, domain::CommandError> {
    let platform_id = domain::PlatformId::bilibili();
    state.account.logout_platform_account(&platform_id)?;
    let entry = state.account.platform_account_entry(&platform_id)?;
    Ok(account::legacy_account(&entry))
}

#[tauri::command]
fn reset_bilibili_device_identity(
    state: tauri::State<'_, AppState>,
) -> Result<(), domain::CommandError> {
    state
        .account
        .reset_platform_device_identity(&domain::PlatformId::bilibili())
        .map_err(Into::into)
}

#[tauri::command]
async fn list_local_history() -> Result<Vec<domain::HistoryEntry>, domain::CommandError> {
    tauri::async_runtime::spawn_blocking(storage::list_history)
        .await
        .map_err(|err| storage_error(err.to_string()))?
        .map_err(storage_error)
}

#[tauri::command]
async fn save_local_history(
    detail: domain::VideoDetail,
    page_cid: i64,
    page_title: String,
    progress_seconds: i64,
    duration_seconds: i64,
) -> Result<Vec<domain::HistoryEntry>, domain::CommandError> {
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
        .map_err(|err| storage_error(err.to_string()))?
        .map_err(storage_error)
}

#[tauri::command]
async fn clear_local_history() -> Result<Vec<domain::HistoryEntry>, domain::CommandError> {
    tauri::async_runtime::spawn_blocking(storage::clear_history)
        .await
        .map_err(|err| storage_error(err.to_string()))?
        .map_err(storage_error)
}

#[tauri::command]
async fn list_local_favorites() -> Result<Vec<domain::FavoriteEntry>, domain::CommandError> {
    tauri::async_runtime::spawn_blocking(storage::list_favorites)
        .await
        .map_err(|err| storage_error(err.to_string()))?
        .map_err(storage_error)
}

#[tauri::command]
async fn add_local_favorite(
    favorite: domain::FavoriteDraft,
) -> Result<Vec<domain::FavoriteEntry>, domain::CommandError> {
    let entry = favorite_entry(favorite)?;
    tauri::async_runtime::spawn_blocking(move || storage::save_favorite(entry))
        .await
        .map_err(|err| storage_error(err.to_string()))?
        .map_err(storage_error)
}

#[tauri::command]
async fn remove_local_favorite(
    target: domain::FavoriteTarget,
) -> Result<Vec<domain::FavoriteEntry>, domain::CommandError> {
    let target = normalize_favorite_target(target)?;
    tauri::async_runtime::spawn_blocking(move || storage::remove_favorite(target))
        .await
        .map_err(|err| storage_error(err.to_string()))?
        .map_err(storage_error)
}

fn favorite_entry(
    favorite: domain::FavoriteDraft,
) -> Result<domain::FavoriteEntry, domain::CommandError> {
    let target = normalize_favorite_target(favorite.target)?;
    let title = favorite.title.trim();
    if title.is_empty() {
        return Err(invalid_favorite_error());
    }

    Ok(domain::FavoriteEntry {
        target,
        title: title.to_string(),
        cover_url: normalize_optional_text(favorite.cover_url),
        owner_name: normalize_optional_text(favorite.owner_name),
        owner_avatar_url: normalize_optional_text(favorite.owner_avatar_url),
        saved_at: chrono::Utc::now().timestamp(),
    })
}

fn normalize_favorite_target(
    target: domain::FavoriteTarget,
) -> Result<domain::FavoriteTarget, domain::CommandError> {
    let target_id = target.target_id.trim();
    if target_id.is_empty() {
        return Err(invalid_favorite_error());
    }

    Ok(domain::FavoriteTarget {
        platform: target.platform,
        kind: target.kind,
        target_id: target_id.to_string(),
    })
}

fn normalize_optional_text(value: Option<String>) -> Option<String> {
    value
        .map(|text| text.trim().to_string())
        .filter(|text| !text.is_empty())
}

fn invalid_favorite_error() -> domain::CommandError {
    domain::CommandError::new("invalidFavorite", "收藏目标或标题不能为空。")
}

fn invalid_login_flow() -> domain::CommandError {
    domain::CommandError::new("invalidLoginFlow", "登录流程状态与当前平台不匹配。")
}

fn requested_platform_id(
    value: Option<String>,
) -> Result<domain::PlatformId, domain::CommandError> {
    let value = value.unwrap_or_else(|| domain::PlatformId::BILIBILI.to_string());
    explicit_platform_id(value)
}

fn explicit_platform_id(value: String) -> Result<domain::PlatformId, domain::CommandError> {
    domain::PlatformId::new(value.clone()).map_err(|_| {
        domain::CommandError::with_action(
            "platformUnavailable",
            format!("平台 {value} 当前不可用。"),
            "retryLater",
        )
    })
}

fn storage_error(_detail: String) -> domain::CommandError {
    domain::CommandError::new("storageError", "本地数据读写失败，请检查应用数据目录权限。")
}

#[cfg(target_os = "windows")]
fn install_bilibili_media_referer(window: &tauri::WebviewWindow) -> tauri::Result<()> {
    use webview2_com::{
        Microsoft::Web::WebView2::Win32::COREWEBVIEW2_WEB_RESOURCE_CONTEXT_MEDIA,
        WebResourceRequestedEventHandler,
    };
    use windows_core::HSTRING;

    window.with_webview(|webview| {
        let result = (|| -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
            let core = unsafe { webview.controller().CoreWebView2()? };
            unsafe {
                core.AddWebResourceRequestedFilter(
                    &HSTRING::from("*"),
                    COREWEBVIEW2_WEB_RESOURCE_CONTEXT_MEDIA,
                )?;
            }

            let mut token = 0;
            unsafe {
                core.add_WebResourceRequested(
                    &WebResourceRequestedEventHandler::create(Box::new(|_, args| {
                        let Some(args) = args else {
                            return Ok(());
                        };
                        let request = args.Request()?;
                        // The current player only serves Bilibili media. Revisit this
                        // handler when P4 introduces other platform media sources.
                        request.Headers()?.SetHeader(
                            &HSTRING::from("Referer"),
                            &HSTRING::from("https://www.bilibili.com/"),
                        )?;
                        Ok(())
                    })),
                    &mut token,
                )?;
            }
            Ok(())
        })();

        if let Err(error) = result {
            log::warn!("failed to install Bilibili media referer: {error}");
        }
    })
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
    let _ = env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info"))
        .format_timestamp_secs()
        .try_init();

    tauri::Builder::default()
        .setup(|app| {
            let session = Arc::new(RwLock::new(None));
            let bilibili = bilibili::BilibiliClient::new(session.clone())?;
            let platforms = platforms::PlatformRegistry::register_builtins(bilibili.clone())
                .expect("built-in platform registry must be valid");
            let account_adapters = platforms.account_adapters();
            let account = account::AccountManager::new(platforms.catalog(), account_adapters);
            app.manage(AppState {
                bilibili,
                platforms,
                account,
            });
            app.manage(live_media::LiveMediaRequests::default());

            #[cfg(target_os = "windows")]
            if let Some(window) = app.get_webview_window("main") {
                if let Err(error) = install_bilibili_media_referer(&window) {
                    log::warn!("failed to attach Bilibili media referer handler: {error}");
                }
            }

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
        .invoke_handler(tauri::generate_handler![
            greet,
            get_platform_catalog,
            get_account_center_snapshot,
            get_platform_login_capabilities,
            refresh_platform_account,
            logout_platform_account,
            reset_platform_device_identity,
            start_platform_login,
            poll_platform_login,
            submit_platform_login_input,
            cancel_platform_login,
            open_devtools,
            get_popular_videos,
            get_recommended_videos,
            get_region_videos,
            get_video_playback,
            get_video_detail,
            get_video_comments,
            get_comment_replies,
            get_search_videos,
            get_live_discovery,
            search_live_rooms,
            get_live_room_info,
            get_live_room_playback,
            live_media::open_live_media_stream,
            live_media::read_live_media_stream,
            live_media::close_live_media_stream,
            list_local_history,
            save_local_history,
            clear_local_history,
            list_local_favorites,
            add_local_favorite,
            remove_local_favorite,
            get_bilibili_login_capabilities,
            get_bilibili_account,
            refresh_bilibili_account,
            start_bilibili_qr_login,
            poll_bilibili_qr_login,
            cancel_bilibili_qr_login,
            create_bilibili_sms_challenge,
            send_bilibili_sms_code,
            login_bilibili_with_sms,
            cancel_bilibili_sms_login,
            logout_bilibili,
            reset_bilibili_device_identity
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
