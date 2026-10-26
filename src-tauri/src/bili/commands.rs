use tauri::State;

use super::{
    auth::{AuthStatus, QrLoginPoll, QrLoginStart},
    client::BiliClient,
    comments::CommentPage,
    danmaku::DanmakuItem,
    dynamic::DynamicPage,
    error::BiliCommandError,
    library::{
        FavoriteResourcePage, HistoryPage, ResumePoint, SpaceProfile, SpaceVideoPage,
        WatchLaterPage,
    },
    playurl::PlaybackSession,
    search::{SearchKind, SearchPage, SearchSuggestion},
    social::{FavoriteFolder, TripleResult, VideoActionState},
    types::{PopularPage, VideoDetail},
};

#[tauri::command]
pub async fn bili_popular_videos(
    client: State<'_, BiliClient>,
    page: Option<u32>,
    page_size: Option<u32>,
) -> Result<PopularPage, BiliCommandError> {
    client
        .popular_videos(page.unwrap_or(1), page_size.unwrap_or(20))
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn bili_video_detail(
    client: State<'_, BiliClient>,
    bvid: String,
) -> Result<VideoDetail, BiliCommandError> {
    client.video_detail(&bvid).await.map_err(Into::into)
}

#[tauri::command]
pub async fn bili_playback_session(
    client: State<'_, BiliClient>,
    bvid: String,
    cid: u64,
    qn: Option<u32>,
) -> Result<PlaybackSession, BiliCommandError> {
    client
        .create_playback_session(&bvid, cid, qn.unwrap_or(80))
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn bili_auth_status(
    client: State<'_, BiliClient>,
) -> Result<AuthStatus, BiliCommandError> {
    client.auth_status().await.map_err(Into::into)
}

#[tauri::command]
pub async fn bili_login_start(
    client: State<'_, BiliClient>,
) -> Result<QrLoginStart, BiliCommandError> {
    client.login_start().await.map_err(Into::into)
}

#[tauri::command]
pub async fn bili_login_poll(
    client: State<'_, BiliClient>,
    attempt_id: String,
) -> Result<QrLoginPoll, BiliCommandError> {
    client.login_poll(&attempt_id).await.map_err(Into::into)
}

#[tauri::command]
pub async fn bili_logout(client: State<'_, BiliClient>) -> Result<(), BiliCommandError> {
    client.logout().await.map_err(Into::into)
}

#[tauri::command]
pub async fn bili_search(
    client: State<'_, BiliClient>,
    query: String,
    search_type: String,
    page: Option<u32>,
) -> Result<SearchPage, BiliCommandError> {
    let kind = SearchKind::parse(&search_type).map_err(BiliCommandError::from)?;
    client
        .search(&query, kind, page.unwrap_or(1))
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn bili_search_suggestions(
    client: State<'_, BiliClient>,
    term: String,
) -> Result<Vec<SearchSuggestion>, BiliCommandError> {
    client.search_suggestions(&term).await.map_err(Into::into)
}

#[tauri::command]
pub async fn bili_danmaku(
    client: State<'_, BiliClient>,
    cid: u64,
    duration_seconds: u64,
) -> Result<Vec<DanmakuItem>, BiliCommandError> {
    client
        .danmaku(cid, duration_seconds)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn bili_dynamic_feed(
    client: State<'_, BiliClient>,
    offset: Option<String>,
) -> Result<DynamicPage, BiliCommandError> {
    client.dynamic_feed(offset).await.map_err(Into::into)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn bili_send_danmaku(
    client: State<'_, BiliClient>,
    aid: u64,
    cid: u64,
    bvid: String,
    message: String,
    progress_ms: u64,
    mode: u8,
    color: u32,
    font_size: u16,
) -> Result<String, BiliCommandError> {
    client
        .send_danmaku(
            aid,
            cid,
            &bvid,
            &message,
            progress_ms,
            mode,
            color,
            font_size,
        )
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn bili_comments(
    client: State<'_, BiliClient>,
    aid: u64,
    page: Option<u32>,
    sort: Option<String>,
) -> Result<CommentPage, BiliCommandError> {
    client
        .comments(aid, page.unwrap_or(1), sort.as_deref().unwrap_or("hot"))
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn bili_post_comment(
    client: State<'_, BiliClient>,
    aid: u64,
    message: String,
    root: Option<u64>,
    parent: Option<u64>,
) -> Result<String, BiliCommandError> {
    client
        .post_comment(aid, &message, root, parent)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn bili_video_actions(
    client: State<'_, BiliClient>,
    bvid: String,
    author_mid: u64,
) -> Result<VideoActionState, BiliCommandError> {
    client
        .video_action_state(&bvid, author_mid)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn bili_like_video(
    client: State<'_, BiliClient>,
    bvid: String,
    liked: bool,
) -> Result<(), BiliCommandError> {
    client.like_video(&bvid, liked).await.map_err(Into::into)
}

#[tauri::command]
pub async fn bili_coin_video(
    client: State<'_, BiliClient>,
    bvid: String,
    multiply: u8,
    with_like: bool,
) -> Result<(), BiliCommandError> {
    client
        .coin_video(&bvid, multiply, with_like)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn bili_triple_video(
    client: State<'_, BiliClient>,
    bvid: String,
) -> Result<TripleResult, BiliCommandError> {
    client.triple_video(&bvid).await.map_err(Into::into)
}

#[tauri::command]
pub async fn bili_follow_user(
    client: State<'_, BiliClient>,
    mid: u64,
    follow: bool,
) -> Result<(), BiliCommandError> {
    client.follow_user(mid, follow).await.map_err(Into::into)
}

#[tauri::command]
pub async fn bili_favorite_folders(
    client: State<'_, BiliClient>,
) -> Result<Vec<FavoriteFolder>, BiliCommandError> {
    client.favorite_folders().await.map_err(Into::into)
}

#[tauri::command]
pub async fn bili_set_video_favorite(
    client: State<'_, BiliClient>,
    aid: u64,
    add_media_ids: Vec<String>,
    remove_media_ids: Vec<String>,
) -> Result<(), BiliCommandError> {
    client
        .set_video_favorite(aid, &add_media_ids, &remove_media_ids)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn bili_history(
    client: State<'_, BiliClient>,
    max: i64,
    view_at: i64,
) -> Result<HistoryPage, BiliCommandError> {
    client.history(max, view_at).await.map_err(Into::into)
}

#[tauri::command]
pub async fn bili_delete_history(
    client: State<'_, BiliClient>,
    aid: u64,
) -> Result<(), BiliCommandError> {
    client.delete_history(aid).await.map_err(Into::into)
}

#[tauri::command]
pub async fn bili_clear_history(client: State<'_, BiliClient>) -> Result<(), BiliCommandError> {
    client.clear_history().await.map_err(Into::into)
}

#[tauri::command]
pub async fn bili_watch_later(
    client: State<'_, BiliClient>,
) -> Result<WatchLaterPage, BiliCommandError> {
    client.watch_later().await.map_err(Into::into)
}

#[tauri::command]
pub async fn bili_add_watch_later(
    client: State<'_, BiliClient>,
    bvid: String,
) -> Result<(), BiliCommandError> {
    client.add_watch_later(&bvid).await.map_err(Into::into)
}

#[tauri::command]
pub async fn bili_remove_watch_later(
    client: State<'_, BiliClient>,
    aid: u64,
) -> Result<(), BiliCommandError> {
    client.remove_watch_later(aid).await.map_err(Into::into)
}

#[tauri::command]
pub async fn bili_favorite_resources(
    client: State<'_, BiliClient>,
    media_id: String,
    page: Option<u32>,
) -> Result<FavoriteResourcePage, BiliCommandError> {
    client
        .favorite_resources(&media_id, page.unwrap_or(1))
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn bili_resume_point(
    client: State<'_, BiliClient>,
    bvid: String,
    cid: u64,
) -> Result<ResumePoint, BiliCommandError> {
    client.resume_point(&bvid, cid).await.map_err(Into::into)
}

#[tauri::command]
pub async fn bili_heartbeat(
    client: State<'_, BiliClient>,
    aid: u64,
    cid: u64,
    bvid: String,
    played_seconds: u32,
    duration_seconds: u32,
    play_type: Option<u8>,
) -> Result<(), BiliCommandError> {
    client
        .report_heartbeat(
            aid,
            cid,
            &bvid,
            played_seconds,
            duration_seconds,
            play_type.unwrap_or(0),
        )
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn bili_space_profile(
    client: State<'_, BiliClient>,
    mid: u64,
) -> Result<SpaceProfile, BiliCommandError> {
    client.space_profile(mid).await.map_err(Into::into)
}

#[tauri::command]
pub async fn bili_space_videos(
    client: State<'_, BiliClient>,
    mid: u64,
    page: Option<u32>,
) -> Result<SpaceVideoPage, BiliCommandError> {
    client
        .space_videos(mid, page.unwrap_or(1))
        .await
        .map_err(Into::into)
}
