use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    process,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};

use crate::domain::HistoryEntry;

const LIBRARY_FILE: &str = "library.json";
const LIBRARY_BACKUP_FILE: &str = "library.bak.json";
const LEGACY_HISTORY_FILE: &str = "history.json";
const LIBRARY_VERSION: u32 = 1;
const MAX_HISTORY_ENTRIES: usize = 200;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LibraryDocument {
    version: u32,
    #[serde(default)]
    history: Vec<HistoryEntry>,
}

impl LibraryDocument {
    fn empty() -> Self {
        Self {
            version: LIBRARY_VERSION,
            history: Vec::new(),
        }
    }
}

pub(crate) fn data_dir() -> Result<PathBuf, String> {
    let dir = dirs::data_local_dir()
        .map(|path| path.join("ailicili"))
        .ok_or_else(|| "Cannot resolve local data directory".to_string())?;
    fs::create_dir_all(&dir).map_err(|err| err.to_string())?;
    Ok(dir)
}

pub fn list_history() -> Result<Vec<HistoryEntry>, String> {
    list_history_in(&data_dir()?)
}

pub fn save_history_entry(entry: HistoryEntry) -> Result<Vec<HistoryEntry>, String> {
    save_history_entry_in(&data_dir()?, entry)
}

fn list_history_in(root: &Path) -> Result<Vec<HistoryEntry>, String> {
    Ok(load_library(root)?.history)
}

fn save_history_entry_in(root: &Path, entry: HistoryEntry) -> Result<Vec<HistoryEntry>, String> {
    let mut document = load_library(root)?;
    document
        .history
        .retain(|item| item.card.video_id != entry.card.video_id);
    document.history.insert(0, entry);
    document.history.truncate(MAX_HISTORY_ENTRIES);
    write_library(root, &document)?;
    Ok(document.history)
}

fn load_library(root: &Path) -> Result<LibraryDocument, String> {
    let path = root.join(LIBRARY_FILE);
    if path.exists() {
        return match read_document(&path) {
            Ok(document) => Ok(document),
            Err(primary_error) => {
                let backup = root.join(LIBRARY_BACKUP_FILE);
                if !backup.exists() {
                    return Err(primary_error);
                }
                let recovered = read_document(&backup).map_err(|backup_error| {
                    format!("{primary_error}; backup recovery failed: {backup_error}")
                })?;
                fs::copy(&backup, &path).map_err(|err| err.to_string())?;
                Ok(recovered)
            }
        };
    }

    migrate_legacy_history(root)
}

fn migrate_legacy_history(root: &Path) -> Result<LibraryDocument, String> {
    let path = root.join(LEGACY_HISTORY_FILE);
    if !path.exists() {
        return Ok(LibraryDocument::empty());
    }

    let content = fs::read_to_string(&path).map_err(|err| err.to_string())?;
    let history: Vec<HistoryEntry> =
        serde_json::from_str(&content).map_err(|err| err.to_string())?;
    let document = LibraryDocument {
        version: LIBRARY_VERSION,
        history,
    };
    write_library(root, &document)?;
    Ok(document)
}

fn read_document(path: &Path) -> Result<LibraryDocument, String> {
    let content = fs::read_to_string(path).map_err(|err| err.to_string())?;
    let document: LibraryDocument =
        serde_json::from_str(&content).map_err(|err| err.to_string())?;
    if document.version != LIBRARY_VERSION {
        return Err(format!("unsupported library version {}", document.version));
    }
    Ok(document)
}

fn write_library(root: &Path, document: &LibraryDocument) -> Result<(), String> {
    fs::create_dir_all(root).map_err(|err| err.to_string())?;
    let path = root.join(LIBRARY_FILE);
    if path.exists() {
        fs::copy(&path, root.join(LIBRARY_BACKUP_FILE)).map_err(|err| err.to_string())?;
    }

    let content = serde_json::to_vec_pretty(document).map_err(|err| err.to_string())?;
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|err| err.to_string())?
        .as_nanos();
    let temporary = root.join(format!(".library.{}.{}.tmp", process::id(), stamp));
    let mut file = fs::File::create(&temporary).map_err(|err| err.to_string())?;
    file.write_all(&content).map_err(|err| err.to_string())?;
    file.sync_all().map_err(|err| err.to_string())?;
    drop(file);

    if let Err(rename_error) = fs::rename(&temporary, &path) {
        fs::copy(&temporary, &path)
            .map_err(|copy_error| format!("{rename_error}; fallback copy failed: {copy_error}"))?;
        fs::remove_file(&temporary).map_err(|err| err.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::{Platform, VideoCard, VideoSourceKind, VideoStats};
    use uuid::Uuid;

    struct TestDir(PathBuf);

    impl TestDir {
        fn new() -> Self {
            let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("target")
                .join("storage-tests")
                .join(Uuid::new_v4().to_string());
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn history_entry(video_id: &str, progress_seconds: i64) -> HistoryEntry {
        HistoryEntry {
            card: VideoCard {
                platform: Platform::Bilibili,
                video_id: video_id.to_string(),
                title: format!("Video {video_id}"),
                cover_url: None,
                duration: Some(120),
                published_at: None,
                owner: None,
                stats: VideoStats::default(),
                cid: Some(10),
                source_kind: VideoSourceKind::Detail,
            },
            page_cid: 10,
            page_title: "Fixture page".to_string(),
            progress_seconds,
            duration_seconds: 120,
            updated_at: 1,
        }
    }

    #[test]
    fn legacy_history_migrates_without_losing_entries() {
        let test_dir = TestDir::new();
        let legacy = serde_json::to_vec_pretty(&vec![history_entry("BV1", 42)]).unwrap();
        fs::write(test_dir.0.join(LEGACY_HISTORY_FILE), legacy).unwrap();

        let entries = list_history_in(&test_dir.0).unwrap();

        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].progress_seconds, 42);
        assert!(test_dir.0.join(LIBRARY_FILE).exists());
        assert!(test_dir.0.join(LEGACY_HISTORY_FILE).exists());
        let document = read_document(&test_dir.0.join(LIBRARY_FILE)).unwrap();
        assert_eq!(document.version, LIBRARY_VERSION);
    }

    #[test]
    fn history_round_trips_and_deduplicates_by_video() {
        let test_dir = TestDir::new();

        save_history_entry_in(&test_dir.0, history_entry("BV1", 10)).unwrap();
        let entries = save_history_entry_in(&test_dir.0, history_entry("BV1", 30)).unwrap();

        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].progress_seconds, 30);
        assert_eq!(
            list_history_in(&test_dir.0).unwrap()[0].progress_seconds,
            30
        );
    }

    #[test]
    fn corrupt_library_recovers_from_previous_backup() {
        let test_dir = TestDir::new();
        save_history_entry_in(&test_dir.0, history_entry("BV1", 10)).unwrap();
        save_history_entry_in(&test_dir.0, history_entry("BV2", 20)).unwrap();
        fs::write(test_dir.0.join(LIBRARY_FILE), b"{broken").unwrap();

        let entries = list_history_in(&test_dir.0).unwrap();

        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].card.video_id, "BV1");
        assert!(read_document(&test_dir.0.join(LIBRARY_FILE)).is_ok());
    }
}
