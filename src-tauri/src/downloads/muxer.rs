use std::{
    path::{Path, PathBuf},
    process::Stdio,
    time::Duration,
};

use tokio::{process::Command, time::timeout};

use super::error::DownloadError;

#[derive(Debug, Clone)]
pub struct FfmpegInfo {
    pub path: PathBuf,
    pub version: String,
}

pub async fn detect_ffmpeg(
    configured_path: Option<&Path>,
) -> Result<Option<FfmpegInfo>, DownloadError> {
    let candidates = match configured_path {
        Some(path) => {
            if !path.is_absolute() || !path.is_file() {
                return Ok(None);
            }
            vec![path.to_owned()]
        }
        None => vec![PathBuf::from("ffmpeg")],
    };

    for candidate in candidates {
        let mut command = Command::new(&candidate);
        command
            .arg("-version")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true);
        #[cfg(windows)]
        {
            command.creation_flags(0x0800_0000);
        }

        let Ok(Ok(output)) = timeout(Duration::from_secs(5), command.output()).await else {
            continue;
        };
        if !output.status.success() {
            continue;
        }
        let version = String::from_utf8_lossy(&output.stdout)
            .lines()
            .next()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("ffmpeg")
            .chars()
            .take(160)
            .collect();
        return Ok(Some(FfmpegInfo {
            path: candidate,
            version,
        }));
    }
    Ok(None)
}

pub async fn mux_video(
    ffmpeg: &FfmpegInfo,
    video_path: &Path,
    audio_path: &Path,
    output_path: &Path,
) -> Result<(), DownloadError> {
    if output_path.exists() {
        std::fs::remove_file(output_path)?;
    }
    let mut command = Command::new(&ffmpeg.path);
    command
        .args(["-hide_banner", "-loglevel", "error", "-y", "-i"])
        .arg(video_path)
        .arg("-i")
        .arg(audio_path)
        .args(["-map", "0:v:0", "-map", "1:a:0", "-c", "copy"])
        .arg(output_path)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(windows)]
    {
        command.creation_flags(0x0800_0000);
    }

    let output = timeout(Duration::from_secs(30 * 60), command.output())
        .await
        .map_err(|_| DownloadError::Ffmpeg("muxing timed out".to_owned()))??;
    if !output.status.success() || !output_path.is_file() {
        let message = String::from_utf8_lossy(&output.stderr)
            .chars()
            .take(500)
            .collect::<String>();
        return Err(DownloadError::Ffmpeg(if message.trim().is_empty() {
            "muxing failed".to_owned()
        } else {
            message
        }));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::detect_ffmpeg;

    #[tokio::test]
    async fn rejects_relative_configured_ffmpeg_paths() {
        assert!(detect_ffmpeg(Some(std::path::Path::new("ffmpeg.exe")))
            .await
            .expect("detection")
            .is_none());
    }
}
