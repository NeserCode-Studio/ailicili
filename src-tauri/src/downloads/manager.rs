use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU8, Ordering},
        Arc, RwLock,
    },
    time::{SystemTime, UNIX_EPOCH},
};

use reqwest::redirect::Policy;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_notification::NotificationExt;
use tokio::sync::{Notify, Semaphore};
use uuid::Uuid;

use crate::bili::client::BiliClient;

use super::{
    downloader::execute_download,
    error::DownloadError,
    model::{
        DownloadPhase, DownloadProgressEvent, DownloadSettings, DownloadSnapshot, DownloadStatus,
        DownloadTask, NewDownloadTask,
    },
    muxer::detect_ffmpeg,
    paths::{canonical_download_root, create_task_directory, ensure_within_root},
    repository::DownloadRepository,
};

const ROOT_SETTING: &str = "download_root";
const FFMPEG_SETTING: &str = "ffmpeg_path";
const CONTROL_RUNNING: u8 = 0;
const CONTROL_PAUSED: u8 = 1;
const CONTROL_CANCELLED: u8 = 2;
const PROGRESS_EVENT: &str = "download-progress";
pub const MAX_CONCURRENT_DOWNLOADS: u8 = 2;

pub(crate) struct DownloadControl {
    state: AtomicU8,
    notify: Notify,
}

impl DownloadControl {
    fn new() -> Self {
        Self {
            state: AtomicU8::new(CONTROL_RUNNING),
            notify: Notify::new(),
        }
    }

    pub(crate) fn pause(&self) {
        if self
            .state
            .compare_exchange(
                CONTROL_RUNNING,
                CONTROL_PAUSED,
                Ordering::SeqCst,
                Ordering::SeqCst,
            )
            .is_ok()
        {
            self.notify.notify_waiters();
        }
    }

    pub(crate) fn cancel(&self) {
        self.state.store(CONTROL_CANCELLED, Ordering::SeqCst);
        self.notify.notify_waiters();
    }

    pub(crate) fn is_running(&self) -> bool {
        self.state.load(Ordering::SeqCst) == CONTROL_RUNNING
    }

    pub(crate) fn stopped_error(&self) -> Option<DownloadError> {
        match self.state.load(Ordering::SeqCst) {
            CONTROL_PAUSED => Some(DownloadError::Paused),
            CONTROL_CANCELLED => Some(DownloadError::Cancelled),
            _ => None,
        }
    }

    pub(crate) async fn stopped(&self) {
        if !self.is_running() {
            return;
        }
        self.notify.notified().await;
    }
}

pub struct DownloadManager {
    app: AppHandle,
    repository: DownloadRepository,
    root: RwLock<PathBuf>,
    ffmpeg_path: RwLock<Option<PathBuf>>,
    active: RwLock<HashMap<String, Arc<DownloadControl>>>,
    semaphore: Arc<Semaphore>,
    pub(crate) http: reqwest::Client,
}

impl DownloadManager {
    pub fn new(
        app: AppHandle,
        database_path: &Path,
        default_root: &Path,
    ) -> Result<Self, DownloadError> {
        let repository = DownloadRepository::open(database_path)?;
        let configured_root = repository
            .setting(ROOT_SETTING)?
            .filter(|value| !value.trim().is_empty())
            .map(PathBuf::from);
        let root = configured_root
            .as_deref()
            .and_then(|path| canonical_download_root(path).ok())
            .unwrap_or(canonical_download_root(default_root)?);
        repository.set_setting(ROOT_SETTING, &root.to_string_lossy())?;

        let ffmpeg_path = repository
            .setting(FFMPEG_SETTING)?
            .filter(|value| !value.trim().is_empty())
            .map(PathBuf::from)
            .filter(|path| path.is_absolute() && path.is_file());

        repository.mark_interrupted_paused(unix_timestamp_millis())?;

        let http = reqwest::Client::builder()
            .connect_timeout(std::time::Duration::from_secs(20))
            .redirect(Policy::custom(|attempt| {
                if attempt.previous().len() >= 5 {
                    attempt.stop()
                } else if super::paths::validate_https_url(attempt.url().as_str()).is_ok() {
                    attempt.follow()
                } else {
                    attempt.stop()
                }
            }))
            .build()
            .map_err(|_| DownloadError::Network)?;

        Ok(Self {
            app,
            repository,
            root: RwLock::new(root),
            ffmpeg_path: RwLock::new(ffmpeg_path),
            active: RwLock::new(HashMap::new()),
            semaphore: Arc::new(Semaphore::new(MAX_CONCURRENT_DOWNLOADS as usize)),
            http,
        })
    }

    pub fn app(&self) -> &AppHandle {
        &self.app
    }

    pub fn root(&self) -> Result<PathBuf, DownloadError> {
        self.root
            .read()
            .map(|value| value.clone())
            .map_err(|_| DownloadError::InvalidMetadata)
    }

    pub fn ffmpeg_path(&self) -> Result<Option<PathBuf>, DownloadError> {
        self.ffmpeg_path
            .read()
            .map(|value| value.clone())
            .map_err(|_| DownloadError::InvalidMetadata)
    }

    pub fn snapshot(&self) -> Result<DownloadSnapshot, DownloadError> {
        let tasks = self.repository.list(500)?;
        let active_count = tasks
            .iter()
            .filter(|task| {
                matches!(
                    task.status,
                    DownloadStatus::Downloading | DownloadStatus::Muxing
                )
            })
            .count();
        let queued_count = tasks
            .iter()
            .filter(|task| task.status == DownloadStatus::Queued)
            .count();
        let completed_count = tasks
            .iter()
            .filter(|task| task.status == DownloadStatus::Completed)
            .count();
        Ok(DownloadSnapshot {
            tasks,
            active_count,
            queued_count,
            completed_count,
        })
    }

    pub async fn settings(&self) -> Result<DownloadSettings, DownloadError> {
        let root = self.root()?;
        let configured = self.ffmpeg_path()?;
        let detected = detect_ffmpeg(configured.as_deref()).await?;
        Ok(DownloadSettings {
            root_path: root.to_string_lossy().into_owned(),
            ffmpeg_path: configured.map(|path| path.to_string_lossy().into_owned()),
            ffmpeg_available: detected.is_some(),
            ffmpeg_version: detected.map(|info| info.version),
            max_concurrent: MAX_CONCURRENT_DOWNLOADS,
        })
    }

    pub async fn set_root(&self, value: &str) -> Result<DownloadSettings, DownloadError> {
        if self.repository.has_incomplete()? {
            return Err(DownloadError::InvalidInput(
                "remove incomplete download records before changing the folder".to_owned(),
            ));
        }

        let root = canonical_download_root(Path::new(value.trim()))?;
        self.repository
            .set_setting(ROOT_SETTING, &root.to_string_lossy())?;
        *self
            .root
            .write()
            .map_err(|_| DownloadError::InvalidMetadata)? = root;
        self.settings().await
    }

    pub async fn set_ffmpeg_path(
        &self,
        value: Option<String>,
    ) -> Result<DownloadSettings, DownloadError> {
        let candidate = value
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty())
            .map(PathBuf::from)
            .map(|path| path.canonicalize().map_err(DownloadError::from))
            .transpose()?;
        if let Some(ref path) = candidate {
            if !path.is_file() || detect_ffmpeg(Some(path)).await?.is_none() {
                return Err(DownloadError::InvalidInput(
                    "selected FFmpeg executable is not runnable".to_owned(),
                ));
            }
        }
        self.repository.set_setting(
            FFMPEG_SETTING,
            candidate
                .as_deref()
                .map(|path| path.to_string_lossy().into_owned())
                .as_deref()
                .unwrap_or(""),
        )?;
        *self
            .ffmpeg_path
            .write()
            .map_err(|_| DownloadError::InvalidMetadata)? = candidate;
        self.settings().await
    }

    pub async fn create(
        self: &Arc<Self>,
        input: NewDownloadTask,
    ) -> Result<DownloadTask, DownloadError> {
        if self
            .repository
            .has_equivalent(&input.bvid, input.cid, input.quality.id)?
        {
            return Err(DownloadError::DuplicateTask);
        }

        let id = Uuid::new_v4().to_string();
        let root = self.root()?;
        let directory = create_task_directory(
            &root,
            &input.title,
            &input.part_title,
            &input.bvid,
            input.cid,
            &id,
        )?;
        let now = unix_timestamp_millis();
        let task = DownloadTask {
            id: id.clone(),
            bvid: input.bvid,
            cid: input.cid,
            aid: input.aid,
            title: input.title,
            part_title: input.part_title,
            cover_url: input.cover_url,
            duration_seconds: input.duration_seconds,
            quality_id: input.quality.id,
            quality_label: input.quality.label,
            width: input.quality.width,
            height: input.quality.height,
            status: DownloadStatus::Queued,
            phase: DownloadPhase::Preparing,
            progress_percent: 0,
            downloaded_bytes: 0,
            total_bytes: 0,
            speed_bytes_per_second: 0,
            eta_seconds: None,
            directory_path: directory.to_string_lossy().into_owned(),
            output_path: None,
            video_path: None,
            audio_path: None,
            cover_path: None,
            danmaku_path: None,
            subtitle_path: None,
            metadata_path: None,
            error_code: None,
            error_message: None,
            warnings: Vec::new(),
            created_at: now,
            updated_at: now,
            completed_at: None,
        };
        self.repository.insert(&task)?;
        self.publish(&task)?;
        self.schedule(id)?;
        Ok(task)
    }

    pub fn pause(&self, id: &str) -> Result<DownloadTask, DownloadError> {
        let mut task = self.repository.get(id)?;
        if !matches!(
            task.status,
            DownloadStatus::Queued | DownloadStatus::Downloading
        ) {
            return Err(DownloadError::InvalidInput(
                "only queued or downloading tasks can be paused".to_owned(),
            ));
        }
        if let Some(control) = self.control(id) {
            control.pause();
        }
        task.status = DownloadStatus::Paused;
        task.speed_bytes_per_second = 0;
        task.eta_seconds = None;
        task.error_code = None;
        task.error_message = None;
        task.updated_at = unix_timestamp_millis();
        self.publish(&task)?;
        Ok(task)
    }

    pub fn cancel(&self, id: &str) -> Result<DownloadTask, DownloadError> {
        let mut task = self.repository.get(id)?;
        if task.terminal() {
            return Ok(task);
        }
        if let Some(control) = self.control(id) {
            control.cancel();
        }
        task.status = DownloadStatus::Cancelled;
        task.speed_bytes_per_second = 0;
        task.eta_seconds = None;
        task.error_code = Some("cancelled".to_owned());
        task.error_message = Some("Download was cancelled.".to_owned());
        task.updated_at = unix_timestamp_millis();
        self.publish(&task)?;
        Ok(task)
    }

    pub fn resume(self: &Arc<Self>, id: &str) -> Result<DownloadTask, DownloadError> {
        let mut task = self.repository.get(id)?;
        if task.status != DownloadStatus::Paused {
            return Err(DownloadError::InvalidInput(
                "only paused tasks can be resumed".to_owned(),
            ));
        }
        task.status = DownloadStatus::Queued;
        task.speed_bytes_per_second = 0;
        task.eta_seconds = None;
        task.error_code = None;
        task.error_message = None;
        task.updated_at = unix_timestamp_millis();
        self.publish(&task)?;
        self.schedule(id.to_owned())?;
        Ok(task)
    }

    pub fn retry(self: &Arc<Self>, id: &str) -> Result<DownloadTask, DownloadError> {
        let mut task = self.repository.get(id)?;
        if !matches!(
            task.status,
            DownloadStatus::Failed | DownloadStatus::Cancelled
        ) {
            return Err(DownloadError::InvalidInput(
                "only failed or cancelled tasks can be retried".to_owned(),
            ));
        }
        task.status = DownloadStatus::Queued;
        task.phase = DownloadPhase::Preparing;
        task.speed_bytes_per_second = 0;
        task.eta_seconds = None;
        task.error_code = None;
        task.error_message = None;
        task.completed_at = None;
        task.updated_at = unix_timestamp_millis();
        self.publish(&task)?;
        self.schedule(id.to_owned())?;
        Ok(task)
    }

    pub fn remove(&self, id: &str) -> Result<(), DownloadError> {
        let task = self.repository.get(id)?;
        if !task.terminal() {
            return Err(DownloadError::InvalidInput(
                "active downloads cannot be removed".to_owned(),
            ));
        }
        self.repository.delete(id)?;
        self.refresh_tray();
        Ok(())
    }

    pub fn reveal(&self, id: &str) -> Result<(), DownloadError> {
        let task = self.repository.get(id)?;
        let directory = PathBuf::from(&task.directory_path);
        let target = [
            task.output_path.as_deref(),
            task.video_path.as_deref(),
            task.metadata_path.as_deref(),
        ]
        .into_iter()
        .flatten()
        .map(PathBuf::from)
        .find(|path| path.exists())
        .filter(|path| path.starts_with(&directory))
        .unwrap_or(directory);

        #[cfg(windows)]
        {
            let mut command = std::process::Command::new("explorer.exe");
            if target.is_file() {
                command.arg(format!("/select,{}", target.display()));
            } else {
                command.arg(&target);
            }
            command
                .spawn()
                .map(|_| ())
                .map_err(|_| DownloadError::Native)
        }
        #[cfg(not(windows))]
        {
            let _ = target;
            Err(DownloadError::Native)
        }
    }

    pub(crate) fn publish(&self, task: &DownloadTask) -> Result<(), DownloadError> {
        self.repository.update(task)?;
        let _ = self
            .app
            .emit(PROGRESS_EVENT, DownloadProgressEvent { task: task.clone() });
        self.refresh_tray();
        Ok(())
    }

    pub(crate) fn task_directory(&self, task: &DownloadTask) -> Result<PathBuf, DownloadError> {
        let root = self.root()?;
        let directory = PathBuf::from(&task.directory_path);
        std::fs::create_dir_all(&directory)?;
        let canonical = directory.canonicalize()?;
        ensure_within_root(&root, &canonical)?;
        Ok(canonical)
    }

    fn control(&self, id: &str) -> Option<Arc<DownloadControl>> {
        self.active
            .read()
            .ok()
            .and_then(|active| active.get(id).cloned())
    }

    fn schedule(self: &Arc<Self>, id: String) -> Result<(), DownloadError> {
        let mut active = self
            .active
            .write()
            .map_err(|_| DownloadError::InvalidMetadata)?;
        if active.contains_key(&id) {
            return Ok(());
        }
        let control = Arc::new(DownloadControl::new());
        active.insert(id.clone(), control.clone());
        drop(active);

        let manager = Arc::clone(self);
        tauri::async_runtime::spawn(async move {
            manager.clone().run_job(id.clone(), control).await;
            if let Ok(mut active) = manager.active.write() {
                active.remove(&id);
            }
            if manager
                .repository
                .get(&id)
                .is_ok_and(|task| task.status == DownloadStatus::Queued)
            {
                let _ = manager.schedule(id);
            }
            manager.refresh_tray();
        });
        Ok(())
    }

    async fn run_job(self: Arc<Self>, id: String, control: Arc<DownloadControl>) {
        let permit = tokio::select! {
            permit = self.semaphore.clone().acquire_owned() => permit,
            _ = control.stopped() => return,
        };
        let Ok(_permit) = permit else {
            return;
        };

        let Ok(mut task) = self.repository.get(&id) else {
            return;
        };
        if task.status != DownloadStatus::Queued || !control.is_running() {
            return;
        }

        task.status = DownloadStatus::Downloading;
        task.phase = DownloadPhase::Preparing;
        task.error_code = None;
        task.error_message = None;
        task.updated_at = unix_timestamp_millis();
        if self.publish(&task).is_err() {
            return;
        }

        let client = self.app.state::<BiliClient>();
        let source_result = client
            .resolve_download_source(&task.bvid, task.cid, task.quality_id)
            .await;
        let result = match source_result {
            Ok(source) => execute_download(&self, &mut task, source, &control).await,
            Err(error) => Err(error.into()),
        };

        let _ = self.finish_job(&mut task, result);
    }

    fn finish_job(
        &self,
        task: &mut DownloadTask,
        result: Result<(), DownloadError>,
    ) -> Result<(), DownloadError> {
        if let Ok(current) = self.repository.get(&task.id) {
            if matches!(
                current.status,
                DownloadStatus::Cancelled | DownloadStatus::Paused
            ) {
                *task = current;
                self.publish(task)?;
                return Ok(());
            }
        }
        task.speed_bytes_per_second = 0;
        task.eta_seconds = None;
        task.updated_at = unix_timestamp_millis();
        match result {
            Ok(()) => {
                task.status = DownloadStatus::Completed;
                task.phase = DownloadPhase::Complete;
                task.progress_percent = 100;
                if task.total_bytes > 0 {
                    task.downloaded_bytes = task.total_bytes;
                }
                task.error_code = None;
                task.error_message = None;
                task.completed_at = Some(task.updated_at);
                self.publish(task)?;
                self.notify(
                    "Download complete",
                    &format!("{} is ready offline.", task_display_name(task)),
                );
            }
            Err(DownloadError::Paused) => {
                task.status = DownloadStatus::Paused;
                task.error_code = None;
                task.error_message = None;
                self.publish(task)?;
            }
            Err(DownloadError::Cancelled) => {
                task.status = DownloadStatus::Cancelled;
                task.error_code = Some("cancelled".to_owned());
                task.error_message = Some("Download was cancelled.".to_owned());
                self.publish(task)?;
            }
            Err(error) => {
                task.status = DownloadStatus::Failed;
                task.error_code = Some(error.code().to_owned());
                task.error_message = Some(error.to_string());
                self.publish(task)?;
                self.notify(
                    "Download failed",
                    &format!("{} could not be downloaded.", task_display_name(task)),
                );
            }
        }
        Ok(())
    }

    fn notify(&self, title: &str, body: &str) {
        let _ = self
            .app
            .notification()
            .builder()
            .title(title)
            .body(body)
            .show();
    }

    fn refresh_tray(&self) {
        let Some(tray) = self.app.tray_by_id("main") else {
            return;
        };
        let Ok(snapshot) = self.snapshot() else {
            return;
        };
        let tooltip = if snapshot.active_count == 0 && snapshot.queued_count == 0 {
            "Ailicili".to_owned()
        } else {
            format!(
                "Ailicili - {} active, {} queued",
                snapshot.active_count, snapshot.queued_count
            )
        };
        let _ = tray.set_tooltip(Some(tooltip));
    }
}

fn task_display_name(task: &DownloadTask) -> String {
    if task.part_title.trim().is_empty() || task.part_title.trim() == task.title.trim() {
        task.title.chars().take(120).collect()
    } else {
        format!("{} - {}", task.title, task.part_title)
            .chars()
            .take(120)
            .collect()
    }
}

pub fn unix_timestamp_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(i64::MAX as u128) as i64
}

#[cfg(test)]
mod tests {
    use super::{unix_timestamp_millis, DownloadControl};
    use crate::downloads::error::DownloadError;

    #[test]
    fn timestamps_are_positive() {
        assert!(unix_timestamp_millis() > 0);
    }

    #[test]
    fn control_prioritizes_cancel_over_pause() {
        let control = DownloadControl::new();
        control.pause();
        assert!(matches!(
            control.stopped_error(),
            Some(DownloadError::Paused)
        ));
        control.cancel();
        assert!(matches!(
            control.stopped_error(),
            Some(DownloadError::Cancelled)
        ));
    }
}
