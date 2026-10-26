use std::sync::Arc;

use tauri::State;

use crate::bili::client::BiliClient;

use super::{
    error::DownloadCommandError,
    manager::DownloadManager,
    model::{
        DownloadOptions, DownloadSettings, DownloadSnapshot, DownloadTask, NewDownloadTask,
        OfflineLibraryEntry,
    },
};

#[tauri::command]
pub async fn download_options(
    client: State<'_, BiliClient>,
    bvid: String,
    cid: u64,
) -> Result<DownloadOptions, DownloadCommandError> {
    client
        .download_options(&bvid, cid)
        .await
        .map_err(|error| DownloadCommandError::from(super::error::DownloadError::from(error)))
}

#[tauri::command]
pub async fn download_create(
    client: State<'_, BiliClient>,
    manager: State<'_, Arc<DownloadManager>>,
    bvid: String,
    cid: u64,
    quality_id: u32,
) -> Result<DownloadTask, DownloadCommandError> {
    let detail = client
        .video_detail(&bvid)
        .await
        .map_err(|error| DownloadCommandError::from(super::error::DownloadError::from(error)))?;
    let part = detail.parts.iter().find(|part| part.cid == cid).cloned();
    if part.is_none() && detail.video.cid != Some(cid) {
        return Err(DownloadCommandError::from(
            super::error::DownloadError::InvalidInput(
                "download part does not belong to this video".to_owned(),
            ),
        ));
    }

    let options = client
        .download_options(&bvid, cid)
        .await
        .map_err(|error| DownloadCommandError::from(super::error::DownloadError::from(error)))?;
    let quality = options
        .qualities
        .into_iter()
        .find(|quality| quality.id == quality_id)
        .ok_or_else(|| {
            DownloadCommandError::from(super::error::DownloadError::InvalidInput(
                "selected quality is unavailable".to_owned(),
            ))
        })?;

    let manager = manager.inner().clone();
    manager
        .create(NewDownloadTask {
            bvid: detail.video.bvid,
            cid,
            aid: detail.video.aid,
            title: detail.video.title,
            part_title: part
                .as_ref()
                .map(|part| part.title.clone())
                .unwrap_or_default(),
            cover_url: detail.video.cover_url,
            duration_seconds: part
                .as_ref()
                .map(|part| part.duration_seconds)
                .unwrap_or(detail.video.duration_seconds),
            quality,
        })
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub fn download_snapshot(
    manager: State<'_, Arc<DownloadManager>>,
) -> Result<DownloadSnapshot, DownloadCommandError> {
    manager.snapshot().map_err(Into::into)
}

#[tauri::command]
pub fn download_offline_library(
    manager: State<'_, Arc<DownloadManager>>,
) -> Result<Vec<OfflineLibraryEntry>, DownloadCommandError> {
    manager.offline_library().map_err(Into::into)
}

#[tauri::command]
pub async fn download_settings(
    manager: State<'_, Arc<DownloadManager>>,
) -> Result<DownloadSettings, DownloadCommandError> {
    manager.settings().await.map_err(Into::into)
}

#[tauri::command]
pub async fn download_set_root(
    manager: State<'_, Arc<DownloadManager>>,
    path: String,
) -> Result<DownloadSettings, DownloadCommandError> {
    manager.set_root(&path).await.map_err(Into::into)
}

#[tauri::command]
pub async fn download_set_ffmpeg_path(
    manager: State<'_, Arc<DownloadManager>>,
    path: Option<String>,
) -> Result<DownloadSettings, DownloadCommandError> {
    manager.set_ffmpeg_path(path).await.map_err(Into::into)
}

#[tauri::command]
pub fn download_pause(
    manager: State<'_, Arc<DownloadManager>>,
    id: String,
) -> Result<DownloadTask, DownloadCommandError> {
    manager.pause(&id).map_err(Into::into)
}

#[tauri::command]
pub fn download_resume(
    manager: State<'_, Arc<DownloadManager>>,
    id: String,
) -> Result<DownloadTask, DownloadCommandError> {
    manager.inner().resume(&id).map_err(Into::into)
}

#[tauri::command]
pub fn download_retry(
    manager: State<'_, Arc<DownloadManager>>,
    id: String,
) -> Result<DownloadTask, DownloadCommandError> {
    manager.inner().retry(&id).map_err(Into::into)
}

#[tauri::command]
pub fn download_cancel(
    manager: State<'_, Arc<DownloadManager>>,
    id: String,
) -> Result<DownloadTask, DownloadCommandError> {
    manager.cancel(&id).map_err(Into::into)
}

#[tauri::command]
pub fn download_remove(
    manager: State<'_, Arc<DownloadManager>>,
    id: String,
) -> Result<(), DownloadCommandError> {
    manager.remove(&id).map_err(Into::into)
}

#[tauri::command]
pub fn download_reveal(
    manager: State<'_, Arc<DownloadManager>>,
    id: String,
) -> Result<(), DownloadCommandError> {
    manager.reveal(&id).map_err(Into::into)
}
