mod commands;
mod downloader;
mod error;
mod manager;
pub(crate) mod model;
mod muxer;
mod paths;
mod repository;

pub use commands::{
    download_cancel, download_create, download_offline_library, download_options, download_pause,
    download_remove, download_resume, download_retry, download_reveal, download_set_ffmpeg_path,
    download_set_root, download_settings, download_snapshot,
};
pub use manager::DownloadManager;
