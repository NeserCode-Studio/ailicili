use std::{
    fs,
    path::{Path, PathBuf},
};

use reqwest::Url;

use super::error::DownloadError;

const MAX_COMPONENT_CHARS: usize = 96;
const WINDOWS_RESERVED_NAMES: [&str; 22] = [
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

pub fn canonical_download_root(path: &Path) -> Result<PathBuf, DownloadError> {
    if !path.is_absolute() {
        return Err(DownloadError::InvalidInput(
            "download root must be an absolute path".to_owned(),
        ));
    }
    fs::create_dir_all(path)?;
    let canonical = path.canonicalize()?;
    if !canonical.is_dir() {
        return Err(DownloadError::InvalidInput(
            "download root must be a directory".to_owned(),
        ));
    }
    Ok(canonical)
}

pub fn create_task_directory(
    canonical_root: &Path,
    title: &str,
    part_title: &str,
    bvid: &str,
    cid: u64,
    task_id: &str,
) -> Result<PathBuf, DownloadError> {
    let display_title = if part_title.trim().is_empty() || part_title.trim() == title.trim() {
        title.to_owned()
    } else {
        format!("{title} - {part_title}")
    };
    let safe_title = sanitize_component(&display_title, "Bilibili video");
    let token = task_id.chars().take(8).collect::<String>();
    let directory = canonical_root.join(format!("{safe_title} [{bvid}-{cid}-{token}]"));
    fs::create_dir_all(&directory)?;
    let canonical_directory = directory.canonicalize()?;
    ensure_within_root(canonical_root, &canonical_directory)?;
    Ok(canonical_directory)
}

pub fn ensure_within_root(root: &Path, path: &Path) -> Result<(), DownloadError> {
    if path == root || path.starts_with(root) {
        Ok(())
    } else {
        Err(DownloadError::UnsafePath(
            path.to_string_lossy().into_owned(),
        ))
    }
}

pub fn sanitize_component(value: &str, fallback: &str) -> String {
    let mut output = String::new();
    let mut previous_was_separator = false;
    for character in value.chars() {
        let invalid = character.is_control()
            || matches!(
                character,
                '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*'
            );
        let next = if invalid { '_' } else { character };
        if next.is_whitespace() {
            if previous_was_separator {
                continue;
            }
            output.push(' ');
            previous_was_separator = true;
        } else {
            output.push(next);
            previous_was_separator = false;
        }
        if output.chars().count() >= MAX_COMPONENT_CHARS {
            break;
        }
    }

    let mut cleaned = output.trim().trim_end_matches(['.', ' ']).trim().to_owned();
    if cleaned.is_empty() || matches!(cleaned.as_str(), "." | "..") {
        cleaned = fallback.to_owned();
    } else if cleaned.starts_with('.') {
        cleaned.insert(0, '_');
    }

    let stem = cleaned
        .split('.')
        .next()
        .unwrap_or_default()
        .trim()
        .to_ascii_uppercase();
    if WINDOWS_RESERVED_NAMES.contains(&stem.as_str()) {
        cleaned.insert(0, '_');
    }
    cleaned
}

pub fn validate_https_url(value: &str) -> Result<Url, DownloadError> {
    let url = Url::parse(value).map_err(|_| DownloadError::UnsupportedHost)?;
    if url.scheme() != "https" || url.username() != "" || url.password().is_some() {
        return Err(DownloadError::UnsupportedHost);
    }
    let host = url
        .host_str()
        .map(str::to_ascii_lowercase)
        .ok_or(DownloadError::UnsupportedHost)?;
    if allowed_host(&host) {
        Ok(url)
    } else {
        Err(DownloadError::UnsupportedHost)
    }
}

fn allowed_host(host: &str) -> bool {
    [
        "bilibili.com",
        "bilivideo.com",
        "bilivideo.cn",
        "hdslb.com",
        "akamaized.net",
    ]
    .iter()
    .any(|suffix| host == *suffix || host.ends_with(&format!(".{suffix}")))
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        path::PathBuf,
        sync::atomic::{AtomicU64, Ordering},
        time::{SystemTime, UNIX_EPOCH},
    };

    use super::{
        canonical_download_root, create_task_directory, sanitize_component, validate_https_url,
    };

    fn temp_root() -> PathBuf {
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let token = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let sequence = COUNTER.fetch_add(1, Ordering::Relaxed);
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../.agent/test-tmp")
            .join(format!("download-paths-{token}-{sequence}"))
    }

    #[test]
    fn sanitizes_windows_invalid_and_reserved_names() {
        assert_eq!(
            sanitize_component("../CON: bad\\name?. ", "fallback"),
            "_.._CON_ bad_name_"
        );
        assert_eq!(sanitize_component("CON", "fallback"), "_CON");
        assert_eq!(sanitize_component("...", "fallback"), "fallback");
        assert!(
            sanitize_component(&"中".repeat(200), "fallback")
                .chars()
                .count()
                <= 96
        );
    }

    #[test]
    fn creates_task_directories_only_inside_canonical_root() {
        let root = temp_root();
        let canonical = canonical_download_root(&root).expect("root");
        let task = create_task_directory(
            &canonical,
            "..\\outside",
            "P1",
            "BV1xx411c7mD",
            42,
            "12345678-1234-1234-1234-123456789abc",
        )
        .expect("task directory");
        assert!(task.starts_with(&canonical));
        assert!(!task.to_string_lossy().contains("..\\"));

        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn accepts_only_https_bilibili_hosts() {
        assert!(validate_https_url("https://upos.bilivideo.com/video.m4s").is_ok());
        assert!(validate_https_url("https://i0.hdslb.com/cover.jpg").is_ok());
        assert!(validate_https_url("http://i0.hdslb.com/cover.jpg").is_err());
        assert!(validate_https_url("https://hdslb.com.example.org/cover.jpg").is_err());
        assert!(validate_https_url("https://user@i0.hdslb.com/cover.jpg").is_err());
    }
}
