use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DownloadStatus {
    Queued,
    Downloading,
    Paused,
    Muxing,
    Completed,
    Failed,
    Cancelled,
}

impl DownloadStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Queued => "queued",
            Self::Downloading => "downloading",
            Self::Paused => "paused",
            Self::Muxing => "muxing",
            Self::Completed => "completed",
            Self::Failed => "failed",
            Self::Cancelled => "cancelled",
        }
    }

    pub fn from_str(value: &str) -> Option<Self> {
        match value {
            "queued" => Some(Self::Queued),
            "downloading" => Some(Self::Downloading),
            "paused" => Some(Self::Paused),
            "muxing" => Some(Self::Muxing),
            "completed" => Some(Self::Completed),
            "failed" => Some(Self::Failed),
            "cancelled" => Some(Self::Cancelled),
            _ => None,
        }
    }

    pub fn is_terminal(self) -> bool {
        matches!(self, Self::Completed | Self::Failed | Self::Cancelled)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DownloadPhase {
    Preparing,
    Video,
    Audio,
    Attachments,
    Muxing,
    Complete,
}

impl DownloadPhase {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Preparing => "preparing",
            Self::Video => "video",
            Self::Audio => "audio",
            Self::Attachments => "attachments",
            Self::Muxing => "muxing",
            Self::Complete => "complete",
        }
    }

    pub fn from_str(value: &str) -> Option<Self> {
        match value {
            "preparing" => Some(Self::Preparing),
            "video" => Some(Self::Video),
            "audio" => Some(Self::Audio),
            "attachments" => Some(Self::Attachments),
            "muxing" => Some(Self::Muxing),
            "complete" => Some(Self::Complete),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadTask {
    pub id: String,
    pub bvid: String,
    pub cid: u64,
    pub aid: u64,
    pub title: String,
    pub part_title: String,
    pub cover_url: String,
    pub duration_seconds: u32,
    pub quality_id: u32,
    pub quality_label: String,
    pub width: u32,
    pub height: u32,
    pub status: DownloadStatus,
    pub phase: DownloadPhase,
    pub progress_percent: u8,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub speed_bytes_per_second: u64,
    pub eta_seconds: Option<u64>,
    pub directory_path: String,
    pub output_path: Option<String>,
    pub video_path: Option<String>,
    pub audio_path: Option<String>,
    pub cover_path: Option<String>,
    pub danmaku_path: Option<String>,
    pub subtitle_path: Option<String>,
    pub metadata_path: Option<String>,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
    pub warnings: Vec<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub completed_at: Option<i64>,
}

impl DownloadTask {
    pub fn terminal(&self) -> bool {
        self.status.is_terminal()
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadQualityOption {
    pub id: u32,
    pub label: String,
    pub width: u32,
    pub height: u32,
    pub bandwidth: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadOptions {
    pub qualities: Vec<DownloadQualityOption>,
    pub default_quality: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadSettings {
    pub root_path: String,
    pub ffmpeg_path: Option<String>,
    pub ffmpeg_available: bool,
    pub ffmpeg_version: Option<String>,
    pub max_concurrent: u8,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadSnapshot {
    pub tasks: Vec<DownloadTask>,
    pub active_count: usize,
    pub queued_count: usize,
    pub completed_count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgressEvent {
    pub task: DownloadTask,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OfflineLibraryEntry {
    pub id: String,
    pub bvid: String,
    pub cid: u64,
    pub aid: u64,
    pub title: String,
    pub part_title: String,
    pub cover_url: String,
    pub duration_seconds: u32,
    pub quality_label: String,
    pub width: u32,
    pub height: u32,
    pub total_bytes: u64,
    pub completed_at: Option<i64>,
    pub has_directory: bool,
    pub has_merged_mp4: bool,
    pub has_video_stream: bool,
    pub has_audio_stream: bool,
    pub has_cover: bool,
    pub has_danmaku: bool,
    pub has_subtitle: bool,
    pub has_metadata: bool,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct NewDownloadTask {
    pub bvid: String,
    pub cid: u64,
    pub aid: u64,
    pub title: String,
    pub part_title: String,
    pub cover_url: String,
    pub duration_seconds: u32,
    pub quality: DownloadQualityOption,
}
