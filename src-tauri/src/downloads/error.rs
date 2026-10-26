use serde::Serialize;
use thiserror::Error;

use crate::bili::error::BiliError;

#[derive(Debug, Error)]
pub enum DownloadError {
    #[error("download network request failed")]
    Network,
    #[error("download server returned HTTP {0}")]
    HttpStatus(u16),
    #[error("download task storage failed")]
    Database,
    #[error("download file system operation failed: {0}")]
    Io(#[from] std::io::Error),
    #[error("invalid download request: {0}")]
    InvalidInput(String),
    #[error("download path is outside the configured root: {0}")]
    UnsafePath(String),
    #[error("download is missing or expired")]
    TaskMissing,
    #[error("an equivalent download task already exists")]
    DuplicateTask,
    #[error("download URL host is not allowed")]
    UnsupportedHost,
    #[error("download was paused")]
    Paused,
    #[error("download was cancelled")]
    Cancelled,
    #[error("download integrity check failed: {0}")]
    Integrity(String),
    #[error("FFmpeg failed: {0}")]
    Ffmpeg(String),
    #[error("download metadata is invalid")]
    InvalidMetadata,
    #[error("{0}")]
    Source(String),
    #[error("native download operation failed")]
    Native,
}

impl From<reqwest::Error> for DownloadError {
    fn from(_: reqwest::Error) -> Self {
        // Reqwest errors can contain signed query strings. Never expose them.
        Self::Network
    }
}

impl From<rusqlite::Error> for DownloadError {
    fn from(_: rusqlite::Error) -> Self {
        Self::Database
    }
}

impl From<serde_json::Error> for DownloadError {
    fn from(_: serde_json::Error) -> Self {
        Self::InvalidMetadata
    }
}

impl From<BiliError> for DownloadError {
    fn from(error: BiliError) -> Self {
        Self::Source(error.to_string())
    }
}

impl DownloadError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::Network => "network_error",
            Self::HttpStatus(404) => "not_found",
            Self::HttpStatus(_) => "http_error",
            Self::Database => "database_error",
            Self::Io(_) => "file_error",
            Self::InvalidInput(_) => "invalid_input",
            Self::UnsafePath(_) => "unsafe_path",
            Self::TaskMissing => "task_missing",
            Self::DuplicateTask => "duplicate_task",
            Self::UnsupportedHost => "unsupported_host",
            Self::Paused => "download_paused",
            Self::Cancelled => "download_cancelled",
            Self::Integrity(_) => "integrity_error",
            Self::Ffmpeg(_) => "ffmpeg_error",
            Self::InvalidMetadata => "invalid_metadata",
            Self::Source(_) => "source_error",
            Self::Native => "native_error",
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadCommandError {
    pub code: &'static str,
    pub message: String,
}

impl From<DownloadError> for DownloadCommandError {
    fn from(error: DownloadError) -> Self {
        let code = error.code();

        Self {
            code,
            message: error.to_string(),
        }
    }
}
