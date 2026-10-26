use std::{
    path::{Path, PathBuf},
    sync::Arc,
    time::{Duration, Instant},
};

use reqwest::{
    header::{ACCEPT_ENCODING, CONTENT_LENGTH, CONTENT_RANGE, COOKIE, RANGE, REFERER},
    Response, StatusCode,
};
use serde::{Deserialize, Serialize};
use tauri::Manager;
use tokio::{
    fs::{self, OpenOptions},
    io::AsyncWriteExt,
};

use crate::bili::{client::BiliClient, danmaku::DanmakuItem, playurl::DownloadMediaSource};

use super::{
    error::DownloadError,
    manager::{unix_timestamp_millis, DownloadControl, DownloadManager},
    model::{DownloadPhase, DownloadStatus, DownloadTask},
    muxer::{detect_ffmpeg, mux_video},
    paths::validate_https_url,
};

const PROGRESS_INTERVAL: Duration = Duration::from_millis(350);
const MAX_COVER_BYTES: u64 = 20 * 1024 * 1024;
const MAX_SUBTITLE_BYTES: u64 = 5 * 1024 * 1024;
const MAX_TIMEOUT_SECONDS: u64 = 6 * 60 * 60;

pub(crate) async fn execute_download(
    manager: &DownloadManager,
    task: &mut DownloadTask,
    source: DownloadMediaSource,
    control: &Arc<DownloadControl>,
) -> Result<(), DownloadError> {
    let directory = manager.task_directory(task)?;
    let video_path = directory.join("video.m4s");
    let audio_path = directory.join("audio.m4s");
    let cover_path = directory.join("cover.jpg");
    let danmaku_path = directory.join("danmaku.json");
    let subtitle_path = directory.join("subtitle.json");
    let manifest_path = directory.join("metadata.json");
    let output_path = directory.join("video.mp4");

    ensure_running(control)?;
    task.phase = DownloadPhase::Video;
    task.video_path = Some(video_path.to_string_lossy().into_owned());
    task.audio_path = Some(audio_path.to_string_lossy().into_owned());
    task.error_code = None;
    task.error_message = None;
    task.warnings.clear();
    manager.publish(task)?;

    let mut last_emit = Instant::now();
    let mut last_bytes = task.downloaded_bytes;
    let video_size = download_media(
        manager,
        task,
        &source,
        &source.video_url,
        &video_path,
        DownloadPhase::Video,
        0,
        0,
        control,
        &mut last_emit,
        &mut last_bytes,
    )
    .await?;

    ensure_running(control)?;
    task.phase = DownloadPhase::Audio;
    task.downloaded_bytes = video_size;
    task.progress_percent = progress_percent(video_size, task.total_bytes.max(video_size));
    manager.publish(task)?;

    let audio_size = download_media(
        manager,
        task,
        &source,
        &source.audio_url,
        &audio_path,
        DownloadPhase::Audio,
        video_size,
        video_size,
        control,
        &mut last_emit,
        &mut last_bytes,
    )
    .await?;

    task.downloaded_bytes = video_size.saturating_add(audio_size);
    task.total_bytes = task.total_bytes.max(task.downloaded_bytes);
    task.progress_percent = progress_percent(task.downloaded_bytes, task.total_bytes);
    ensure_running(control)?;

    task.phase = DownloadPhase::Attachments;
    task.progress_percent = task.progress_percent.max(98);
    manager.publish(task)?;

    if !task.cover_url.trim().is_empty() {
        if let Err(error) = download_attachment(
            manager,
            &source,
            &task.cover_url,
            &cover_path,
            MAX_COVER_BYTES,
            control,
        )
        .await
        {
            attachment_warning(task, &error, "cover_unavailable");
        } else {
            task.cover_path = Some(cover_path.to_string_lossy().into_owned());
        }
    }

    let client = manager.app().state::<BiliClient>();
    match client.danmaku(task.cid, source.duration_seconds).await {
        Ok(items) => {
            if write_danmaku(&danmaku_path, &items).await.is_ok() {
                task.danmaku_path = Some(danmaku_path.to_string_lossy().into_owned());
            } else {
                task.warnings.push("danmaku_unavailable".to_owned());
            }
        }
        Err(_) => task.warnings.push("danmaku_unavailable".to_owned()),
    }

    match fetch_subtitle(&client, task, &source).await {
        Ok(Some(url)) => {
            match download_attachment(
                manager,
                &source,
                &url,
                &subtitle_path,
                MAX_SUBTITLE_BYTES,
                control,
            )
            .await
            {
                Ok(()) => {
                    task.subtitle_path = Some(subtitle_path.to_string_lossy().into_owned());
                }
                Err(_) => task.warnings.push("subtitle_unavailable".to_owned()),
            }
        }
        Ok(None) => {}
        Err(_) => task.warnings.push("subtitle_unavailable".to_owned()),
    }

    ensure_running(control)?;
    let ffmpeg = detect_ffmpeg(manager.ffmpeg_path()?.as_deref()).await?;
    if let Some(ffmpeg) = ffmpeg {
        task.status = DownloadStatus::Muxing;
        task.phase = DownloadPhase::Muxing;
        task.progress_percent = 99;
        task.speed_bytes_per_second = 0;
        task.eta_seconds = None;
        manager.publish(task)?;
        mux_video(&ffmpeg, &video_path, &audio_path, &output_path).await?;
        task.output_path = Some(output_path.to_string_lossy().into_owned());
    } else {
        task.output_path = None;
        if !task
            .warnings
            .iter()
            .any(|warning| warning == "ffmpeg_missing")
        {
            task.warnings.push("ffmpeg_missing".to_owned());
        }
    }

    ensure_running(control)?;
    write_manifest(task, &manifest_path).await?;
    task.metadata_path = Some(manifest_path.to_string_lossy().into_owned());
    task.status = DownloadStatus::Downloading;
    task.phase = DownloadPhase::Attachments;
    task.progress_percent = 99;
    task.updated_at = unix_timestamp_millis();
    manager.publish(task)?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
async fn download_media(
    manager: &DownloadManager,
    task: &mut DownloadTask,
    source: &DownloadMediaSource,
    url: &str,
    destination: &Path,
    phase: DownloadPhase,
    completed_other_bytes: u64,
    known_other_total_bytes: u64,
    control: &Arc<DownloadControl>,
    last_emit: &mut Instant,
    last_bytes: &mut u64,
) -> Result<u64, DownloadError> {
    task.phase = phase;
    task.updated_at = unix_timestamp_millis();
    manager.publish(task)?;

    let result = transfer_file(
        &manager.http,
        url,
        destination,
        &source.cookie_header,
        &source.referer,
        true,
        u64::MAX,
        Some(control),
        |downloaded, total| {
            let absolute_downloaded = completed_other_bytes.saturating_add(downloaded);
            let absolute_total = total.map(|total| known_other_total_bytes.saturating_add(total));
            task.downloaded_bytes = absolute_downloaded;
            if let Some(total) = absolute_total {
                task.total_bytes = task.total_bytes.max(total);
            }
            task.progress_percent = progress_percent(task.downloaded_bytes, task.total_bytes);

            let now = Instant::now();
            if now.duration_since(*last_emit) >= PROGRESS_INTERVAL {
                let elapsed = now.duration_since(*last_emit).as_secs_f64();
                if elapsed > 0.0 && task.downloaded_bytes >= *last_bytes {
                    task.speed_bytes_per_second =
                        ((task.downloaded_bytes - *last_bytes) as f64 / elapsed) as u64;
                    task.eta_seconds = remaining_seconds(task);
                }
                task.updated_at = unix_timestamp_millis();
                let _ = manager.publish(task);
                *last_emit = now;
                *last_bytes = task.downloaded_bytes;
            }
        },
    )
    .await?;

    task.downloaded_bytes = completed_other_bytes.saturating_add(result);
    task.total_bytes = task
        .total_bytes
        .max(known_other_total_bytes.saturating_add(result));
    task.progress_percent = progress_percent(task.downloaded_bytes, task.total_bytes);
    task.updated_at = unix_timestamp_millis();
    manager.publish(task)?;
    Ok(result)
}

#[allow(clippy::too_many_arguments)]
async fn transfer_file<F>(
    http: &reqwest::Client,
    url: &str,
    destination: &Path,
    cookie_header: &str,
    referer: &str,
    validate_host: bool,
    max_bytes: u64,
    control: Option<&Arc<DownloadControl>>,
    mut on_progress: F,
) -> Result<u64, DownloadError>
where
    F: FnMut(u64, Option<u64>),
{
    if validate_host {
        validate_https_url(url)?;
    }
    if let Some(control) = control {
        ensure_running(control)?;
    }
    if destination.is_file() {
        let length = destination.metadata()?.len();
        on_progress(length, Some(length));
        return Ok(length);
    }

    let partial = part_path(destination);
    if let Some(parent) = partial.parent() {
        fs::create_dir_all(parent).await?;
    }
    let mut existing = fs::metadata(&partial)
        .await
        .map(|value| value.len())
        .unwrap_or(0);
    let mut restarted_after_range_error = false;

    loop {
        let mut request = http
            .get(url)
            .header(ACCEPT_ENCODING, "identity")
            .header(REFERER, referer);
        if !cookie_header.trim().is_empty() {
            request = request.header(COOKIE, cookie_header);
        }
        if existing > 0 {
            request = request.header(RANGE, format!("bytes={existing}-"));
        }

        let mut response = request.send().await?;
        if response.status() == StatusCode::RANGE_NOT_SATISFIABLE
            && existing > 0
            && !restarted_after_range_error
        {
            OpenOptions::new()
                .create(true)
                .write(true)
                .truncate(true)
                .open(&partial)
                .await?
                .shutdown()
                .await?;
            existing = 0;
            restarted_after_range_error = true;
            continue;
        }
        if !response.status().is_success() {
            return Err(DownloadError::HttpStatus(response.status().as_u16()));
        }

        let (expected_total, append) = response_layout(&response, existing)?;
        let mut options = OpenOptions::new();
        options.create(true).write(true);
        if append {
            options.append(true);
        } else {
            options.truncate(true);
            existing = 0;
        }
        let mut file = options.open(&partial).await?;
        let mut downloaded = existing;
        on_progress(downloaded, expected_total);

        let started = Instant::now();
        loop {
            let chunk = if let Some(control) = control {
                tokio::select! {
                    _ = control.stopped() => {
                        file.flush().await?;
                        return Err(control
                            .stopped_error()
                            .unwrap_or(DownloadError::Cancelled));
                    }
                    chunk = response.chunk() => chunk?,
                }
            } else {
                response.chunk().await?
            };
            let Some(chunk) = chunk else {
                break;
            };
            downloaded = downloaded.saturating_add(chunk.len() as u64);
            if downloaded > max_bytes {
                return Err(DownloadError::Integrity(
                    "download exceeded the configured size limit".to_owned(),
                ));
            }
            file.write_all(&chunk).await?;
            on_progress(downloaded, expected_total);
            if started.elapsed() > Duration::from_secs(MAX_TIMEOUT_SECONDS) {
                return Err(DownloadError::Integrity(
                    "download exceeded the maximum transfer time".to_owned(),
                ));
            }
        }
        file.flush().await?;
        drop(file);

        if let Some(expected_total) = expected_total {
            if downloaded != expected_total {
                return Err(DownloadError::Integrity(format!(
                    "expected {expected_total} bytes but received {downloaded}"
                )));
            }
        }
        if destination.exists() {
            fs::remove_file(destination).await?;
        }
        fs::rename(&partial, destination).await?;
        return Ok(downloaded);
    }
}

fn response_layout(
    response: &Response,
    existing: u64,
) -> Result<(Option<u64>, bool), DownloadError> {
    if response.status() == StatusCode::PARTIAL_CONTENT {
        let value = response
            .headers()
            .get(CONTENT_RANGE)
            .and_then(|value| value.to_str().ok())
            .ok_or_else(|| {
                DownloadError::Integrity("resumed response omitted Content-Range".to_owned())
            })?;
        let (start, total) = parse_content_range(value)?;
        if start != existing {
            return Err(DownloadError::Integrity(
                "resumed response started at an unexpected byte".to_owned(),
            ));
        }
        Ok((total, true))
    } else {
        let length = response
            .headers()
            .get(CONTENT_LENGTH)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.parse::<u64>().ok());
        Ok((length, false))
    }
}

fn parse_content_range(value: &str) -> Result<(u64, Option<u64>), DownloadError> {
    let value = value
        .strip_prefix("bytes ")
        .ok_or_else(|| DownloadError::Integrity("invalid Content-Range".to_owned()))?;
    let (range, total) = value
        .split_once('/')
        .ok_or_else(|| DownloadError::Integrity("invalid Content-Range".to_owned()))?;
    let (start, _) = range
        .split_once('-')
        .ok_or_else(|| DownloadError::Integrity("invalid Content-Range".to_owned()))?;
    let start = start
        .parse::<u64>()
        .map_err(|_| DownloadError::Integrity("invalid Content-Range".to_owned()))?;
    let total = if total == "*" {
        None
    } else {
        Some(
            total
                .parse::<u64>()
                .map_err(|_| DownloadError::Integrity("invalid Content-Range".to_owned()))?,
        )
    };
    Ok((start, total))
}

async fn download_attachment(
    manager: &DownloadManager,
    source: &DownloadMediaSource,
    url: &str,
    destination: &Path,
    max_bytes: u64,
    control: &Arc<DownloadControl>,
) -> Result<(), DownloadError> {
    transfer_file(
        &manager.http,
        url,
        destination,
        &source.cookie_header,
        &source.referer,
        true,
        max_bytes,
        Some(control),
        |_, _| {},
    )
    .await
    .map(|_| ())
}

async fn write_danmaku(path: &Path, items: &[DanmakuItem]) -> Result<(), DownloadError> {
    let bytes = serde_json::to_vec_pretty(items)?;
    write_atomic(path, &bytes).await
}

#[derive(Debug, Deserialize)]
struct PlayerEnvelope {
    code: i64,
    data: Option<PlayerData>,
}

#[derive(Debug, Deserialize)]
struct PlayerData {
    subtitle: Option<SubtitleData>,
}

#[derive(Debug, Deserialize)]
struct SubtitleData {
    #[serde(default)]
    subtitles: Vec<SubtitleEntry>,
}

#[derive(Debug, Deserialize)]
struct SubtitleEntry {
    #[serde(default)]
    lan: String,
    #[serde(default)]
    subtitle_url: String,
}

async fn fetch_subtitle(
    client: &BiliClient,
    task: &DownloadTask,
    source: &DownloadMediaSource,
) -> Result<Option<String>, DownloadError> {
    let cookie = client.session.cookie_header().await.unwrap_or_default();
    let response = client
        .http
        .get("https://api.bilibili.com/x/player/v2")
        .query(&[("cid", task.cid.to_string()), ("bvid", task.bvid.clone())])
        .header(REFERER, &source.referer)
        .header(COOKIE, cookie)
        .send()
        .await?;
    if !response.status().is_success() {
        return Err(DownloadError::HttpStatus(response.status().as_u16()));
    }
    let envelope: PlayerEnvelope = response.json().await?;
    if envelope.code != 0 {
        return Err(DownloadError::Source(format!(
            "Bilibili player metadata returned code {}",
            envelope.code
        )));
    }
    let mut subtitles = envelope
        .data
        .and_then(|data| data.subtitle)
        .map(|subtitle| subtitle.subtitles)
        .unwrap_or_default();
    subtitles.sort_by_key(|entry| {
        if entry.lan.to_ascii_lowercase().starts_with("zh") {
            0
        } else {
            1
        }
    });
    let entry = subtitles
        .into_iter()
        .find(|entry| !entry.subtitle_url.trim().is_empty());
    let Some(entry) = entry else {
        return Ok(None);
    };
    let url = if let Some(rest) = entry.subtitle_url.strip_prefix("//") {
        format!("https://{rest}")
    } else {
        entry.subtitle_url
    };
    validate_https_url(&url)?;
    Ok(Some(url))
}

async fn write_manifest(task: &DownloadTask, path: &Path) -> Result<(), DownloadError> {
    let manifest = DownloadManifest {
        schema_version: 1,
        downloaded_at: unix_timestamp_millis(),
        bvid: &task.bvid,
        aid: task.aid,
        cid: task.cid,
        title: &task.title,
        part_title: &task.part_title,
        duration_seconds: task.duration_seconds,
        quality: ManifestQuality {
            id: task.quality_id,
            label: &task.quality_label,
            width: task.width,
            height: task.height,
        },
        files: ManifestFiles {
            output: task.output_path.as_deref(),
            video: task.video_path.as_deref(),
            audio: task.audio_path.as_deref(),
            cover: task.cover_path.as_deref(),
            danmaku: task.danmaku_path.as_deref(),
            subtitle: task.subtitle_path.as_deref(),
        },
        warnings: &task.warnings,
    };
    let bytes = serde_json::to_vec_pretty(&manifest)?;
    write_atomic(path, &bytes).await
}

async fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), DownloadError> {
    let temporary = path.with_file_name(format!(
        "{}.tmp",
        path.file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("download")
    ));
    let mut file = OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(&temporary)
        .await?;
    file.write_all(bytes).await?;
    file.flush().await?;
    drop(file);
    if path.exists() {
        fs::remove_file(path).await?;
    }
    fs::rename(temporary, path).await?;
    Ok(())
}

fn part_path(destination: &Path) -> PathBuf {
    destination.with_file_name(format!(
        "{}.part",
        destination
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("download")
    ))
}

fn ensure_running(control: &DownloadControl) -> Result<(), DownloadError> {
    control.stopped_error().map_or(Ok(()), Err)
}

fn attachment_warning(task: &mut DownloadTask, _error: &DownloadError, code: &str) {
    if !task.warnings.iter().any(|warning| warning == code) {
        task.warnings.push(code.to_owned());
    }
}

fn progress_percent(downloaded: u64, total: u64) -> u8 {
    if total == 0 {
        0
    } else {
        ((downloaded.min(total).saturating_mul(100) / total).min(97)) as u8
    }
}

fn remaining_seconds(task: &DownloadTask) -> Option<u64> {
    if task.speed_bytes_per_second == 0 || task.total_bytes <= task.downloaded_bytes {
        None
    } else {
        Some((task.total_bytes - task.downloaded_bytes).div_ceil(task.speed_bytes_per_second))
    }
}

#[derive(Serialize)]
struct DownloadManifest<'a> {
    schema_version: u8,
    downloaded_at: i64,
    bvid: &'a str,
    aid: u64,
    cid: u64,
    title: &'a str,
    part_title: &'a str,
    duration_seconds: u32,
    quality: ManifestQuality<'a>,
    files: ManifestFiles<'a>,
    warnings: &'a [String],
}

#[derive(Serialize)]
struct ManifestQuality<'a> {
    id: u32,
    label: &'a str,
    width: u32,
    height: u32,
}

#[derive(Serialize)]
struct ManifestFiles<'a> {
    output: Option<&'a str>,
    video: Option<&'a str>,
    audio: Option<&'a str>,
    cover: Option<&'a str>,
    danmaku: Option<&'a str>,
    subtitle: Option<&'a str>,
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        path::PathBuf,
        sync::atomic::{AtomicU64, Ordering},
        time::{SystemTime, UNIX_EPOCH},
    };

    use tokio::{
        io::{AsyncReadExt, AsyncWriteExt},
        net::TcpListener,
    };

    use super::{parse_content_range, transfer_file, write_manifest};
    use crate::downloads::model::{DownloadPhase, DownloadStatus, DownloadTask};

    fn temp_path(name: &str) -> PathBuf {
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let token = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let sequence = COUNTER.fetch_add(1, Ordering::Relaxed);
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../.agent/test-tmp")
            .join(format!("download-{token}-{sequence}"))
            .join(name)
    }

    #[test]
    fn parses_content_range_totals() {
        assert_eq!(
            parse_content_range("bytes 4-7/8").expect("range"),
            (4, Some(8))
        );
        assert_eq!(
            parse_content_range("bytes 0-0/*").expect("unknown range"),
            (0, None)
        );
    }

    #[tokio::test]
    async fn resumes_a_partial_file_with_http_range() {
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("listener");
        let address = listener.local_addr().expect("address");
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.expect("connection");
            let mut request = [0_u8; 2048];
            let read = socket.read(&mut request).await.expect("request");
            let request = String::from_utf8_lossy(&request[..read]);
            assert!(request.contains("range: bytes=4-"));
            socket
                .write_all(
                    b"HTTP/1.1 206 Partial Content\r\nContent-Length: 4\r\nContent-Range: bytes 4-7/8\r\nConnection: close\r\n\r\n",
                )
                .await
                .expect("headers");
            socket.write_all(b"efgh").await.expect("body");
        });

        let destination = temp_path("video.m4s");
        fs::create_dir_all(destination.parent().expect("parent")).expect("directory");
        fs::write(super::part_path(&destination), b"abcd").expect("partial");
        let client = reqwest::Client::new();
        let downloaded = transfer_file(
            &client,
            &format!("http://{address}/media"),
            &destination,
            "",
            "https://www.bilibili.com/",
            false,
            1024,
            None,
            |_, _| {},
        )
        .await
        .expect("resume");

        assert_eq!(downloaded, 8);
        assert_eq!(fs::read(&destination).expect("content"), b"abcdefgh");
        server.await.expect("server");
        let _ = fs::remove_dir_all(destination.parent().expect("parent"));
    }

    #[tokio::test]
    async fn a_full_response_restarts_an_existing_partial_file() {
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("listener");
        let address = listener.local_addr().expect("address");
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.expect("connection");
            let mut request = [0_u8; 2048];
            socket.read(&mut request).await.expect("request");
            socket
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 4\r\nConnection: close\r\n\r\n")
                .await
                .expect("headers");
            socket.write_all(b"wxyz").await.expect("body");
        });

        let destination = temp_path("audio.m4s");
        fs::create_dir_all(destination.parent().expect("parent")).expect("directory");
        fs::write(super::part_path(&destination), b"stale").expect("partial");
        let client = reqwest::Client::new();
        let downloaded = transfer_file(
            &client,
            &format!("http://{address}/media"),
            &destination,
            "",
            "https://www.bilibili.com/",
            false,
            1024,
            None,
            |_, _| {},
        )
        .await
        .expect("restart");

        assert_eq!(downloaded, 4);
        assert_eq!(fs::read(&destination).expect("content"), b"wxyz");
        server.await.expect("server");
        let _ = fs::remove_dir_all(destination.parent().expect("parent"));
    }

    #[tokio::test]
    async fn manifest_contains_stable_metadata_without_source_urls() {
        let path = temp_path("metadata.json");
        fs::create_dir_all(path.parent().expect("parent")).expect("directory");
        let task = DownloadTask {
            id: "123e4567-e89b-12d3-a456-426614174000".to_owned(),
            bvid: "BV1xx411c7mD".to_owned(),
            cid: 10,
            aid: 7,
            title: "测试视频".to_owned(),
            part_title: "第一部分".to_owned(),
            cover_url: "https://i0.hdslb.com/cover.jpg".to_owned(),
            duration_seconds: 120,
            quality_id: 80,
            quality_label: "1080P".to_owned(),
            width: 1920,
            height: 1080,
            status: DownloadStatus::Completed,
            phase: DownloadPhase::Complete,
            progress_percent: 100,
            downloaded_bytes: 2,
            total_bytes: 2,
            speed_bytes_per_second: 0,
            eta_seconds: None,
            directory_path: path
                .parent()
                .expect("parent")
                .to_string_lossy()
                .into_owned(),
            output_path: None,
            video_path: Some("C:\\Downloads\\video.m4s".to_owned()),
            audio_path: Some("C:\\Downloads\\audio.m4s".to_owned()),
            cover_path: None,
            danmaku_path: None,
            subtitle_path: None,
            metadata_path: Some(path.to_string_lossy().into_owned()),
            error_code: None,
            error_message: None,
            warnings: vec!["ffmpeg_missing".to_owned()],
            created_at: 1,
            updated_at: 2,
            completed_at: Some(2),
        };

        write_manifest(&task, &path).await.expect("manifest");
        let value: serde_json::Value =
            serde_json::from_slice(&fs::read(&path).expect("manifest bytes"))
                .expect("manifest JSON");
        assert_eq!(value["schema_version"], 1);
        assert_eq!(value["quality"]["id"], 80);
        assert_eq!(value["warnings"][0], "ffmpeg_missing");
        assert!(value.get("cover_url").is_none());
        assert!(value["files"].get("video").is_some());

        let _ = fs::remove_dir_all(path.parent().expect("parent"));
    }
}
