use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    process,
    sync::{Mutex, OnceLock},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};

use crate::domain::{FavoriteEntry, FavoriteTarget, HistoryEntry};

const LIBRARY_FILE: &str = "library.json";
const LIBRARY_BACKUP_FILE: &str = "library.bak.json";
const LEGACY_HISTORY_FILE: &str = "history.json";
const LIBRARY_VERSION_V1: u32 = 1;
const LIBRARY_VERSION: u32 = 2;
const MAX_HISTORY_ENTRIES: usize = 200;
static LIBRARY_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LibraryDocument {
    version: u32,
    #[serde(default)]
    history: Vec<HistoryEntry>,
    #[serde(default)]
    favorites: Vec<FavoriteEntry>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LibraryDocumentV1 {
    #[serde(default)]
    history: Vec<HistoryEntry>,
}

impl LibraryDocument {
    fn empty() -> Self {
        Self {
            version: LIBRARY_VERSION,
            history: Vec::new(),
            favorites: Vec::new(),
        }
    }

    fn from_v1(document: LibraryDocumentV1) -> Self {
        Self {
            version: LIBRARY_VERSION,
            history: document.history,
            favorites: Vec::new(),
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
    with_data_dir(|root| list_history_in(root))
}

pub fn save_history_entry(entry: HistoryEntry) -> Result<Vec<HistoryEntry>, String> {
    with_data_dir(move |root| save_history_entry_in(root, entry))
}

pub fn list_favorites() -> Result<Vec<FavoriteEntry>, String> {
    with_data_dir(|root| list_favorites_in(root))
}

pub fn save_favorite(entry: FavoriteEntry) -> Result<Vec<FavoriteEntry>, String> {
    with_data_dir(move |root| save_favorite_in(root, entry))
}

pub fn remove_favorite(target: FavoriteTarget) -> Result<Vec<FavoriteEntry>, String> {
    with_data_dir(move |root| remove_favorite_in(root, target))
}

fn with_library_lock<T>(operation: impl FnOnce() -> Result<T, String>) -> Result<T, String> {
    let lock = LIBRARY_LOCK.get_or_init(|| Mutex::new(()));
    let _guard = lock
        .lock()
        .map_err(|_| "library storage lock poisoned".to_string())?;
    operation()
}

fn with_data_dir<T>(operation: impl FnOnce(&Path) -> Result<T, String>) -> Result<T, String> {
    with_library_lock(|| {
        let root = data_dir()?;
        operation(&root)
    })
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

fn list_favorites_in(root: &Path) -> Result<Vec<FavoriteEntry>, String> {
    Ok(load_library(root)?.favorites)
}

fn save_favorite_in(root: &Path, entry: FavoriteEntry) -> Result<Vec<FavoriteEntry>, String> {
    let mut document = load_library(root)?;
    document
        .favorites
        .retain(|item| item.target != entry.target);
    document.favorites.insert(0, entry);
    write_library(root, &document)?;
    Ok(document.favorites)
}

fn remove_favorite_in(root: &Path, target: FavoriteTarget) -> Result<Vec<FavoriteEntry>, String> {
    let mut document = load_library(root)?;
    let previous_len = document.favorites.len();
    document.favorites.retain(|item| item.target != target);
    if document.favorites.len() != previous_len {
        write_library(root, &document)?;
    }
    Ok(document.favorites)
}

fn load_library(root: &Path) -> Result<LibraryDocument, String> {
    let path = root.join(LIBRARY_FILE);
    if path.exists() {
        return match read_document(&path) {
            Ok((document, upgraded)) => {
                if upgraded {
                    write_library(root, &document)?;
                }
                Ok(document)
            }
            Err(primary_error) => {
                let backup = root.join(LIBRARY_BACKUP_FILE);
                if !backup.exists() {
                    return Err(primary_error);
                }
                let recovered = read_document(&backup).map_err(|backup_error| {
                    format!("{primary_error}; backup recovery failed: {backup_error}")
                })?;
                fs::copy(&backup, &path).map_err(|err| err.to_string())?;
                if recovered.1 {
                    write_library(root, &recovered.0)?;
                }
                Ok(recovered.0)
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
        favorites: Vec::new(),
    };
    write_library(root, &document)?;
    Ok(document)
}

fn read_document(path: &Path) -> Result<(LibraryDocument, bool), String> {
    let content = fs::read_to_string(path).map_err(|err| err.to_string())?;
    let value: serde_json::Value = serde_json::from_str(&content).map_err(|err| err.to_string())?;
    let version = value
        .get("version")
        .and_then(serde_json::Value::as_u64)
        .ok_or_else(|| "library document has no valid version".to_string())?;

    match version {
        version if version == u64::from(LIBRARY_VERSION_V1) => {
            let document: LibraryDocumentV1 =
                serde_json::from_value(value).map_err(|err| err.to_string())?;
            Ok((LibraryDocument::from_v1(document), true))
        }
        version if version == u64::from(LIBRARY_VERSION) => {
            let document: LibraryDocument =
                serde_json::from_value(value).map_err(|err| err.to_string())?;
            Ok((document, false))
        }
        version => Err(format!("unsupported library version {version}")),
    }
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
    use crate::domain::{FavoriteKind, Platform, VideoCard, VideoSourceKind, VideoStats};
    use std::thread;
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

    fn favorite_entry(
        kind: FavoriteKind,
        target_id: &str,
        title: &str,
        saved_at: i64,
    ) -> FavoriteEntry {
        FavoriteEntry {
            target: FavoriteTarget {
                platform: Platform::Bilibili,
                kind,
                target_id: target_id.to_string(),
            },
            title: title.to_string(),
            cover_url: None,
            owner_name: None,
            saved_at,
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
        let (document, upgraded) = read_document(&test_dir.0.join(LIBRARY_FILE)).unwrap();
        assert!(!upgraded);
        assert_eq!(document.version, LIBRARY_VERSION);
        assert!(document.favorites.is_empty());
    }

    #[test]
    fn v1_library_migrates_to_v2_without_losing_history() {
        let test_dir = TestDir::new();
        let v1 = serde_json::json!({
            "version": LIBRARY_VERSION_V1,
            "history": [history_entry("BV1", 42)],
        });
        fs::write(
            test_dir.0.join(LIBRARY_FILE),
            serde_json::to_vec_pretty(&v1).unwrap(),
        )
        .unwrap();

        let entries = list_history_in(&test_dir.0).unwrap();

        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].progress_seconds, 42);
        let (document, upgraded) = read_document(&test_dir.0.join(LIBRARY_FILE)).unwrap();
        assert!(!upgraded);
        assert_eq!(document.version, LIBRARY_VERSION);
        assert!(document.favorites.is_empty());
        assert!(test_dir.0.join(LIBRARY_BACKUP_FILE).exists());
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
    fn favorites_round_trip_and_deduplicate_by_target() {
        let test_dir = TestDir::new();

        save_favorite_in(
            &test_dir.0,
            favorite_entry(FavoriteKind::Video, "BV1", "Video", 10),
        )
        .unwrap();
        save_favorite_in(
            &test_dir.0,
            favorite_entry(FavoriteKind::LiveRoom, "BV1", "Live room", 20),
        )
        .unwrap();
        let entries = save_favorite_in(
            &test_dir.0,
            favorite_entry(FavoriteKind::Video, "BV1", "Updated video", 30),
        )
        .unwrap();

        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].title, "Updated video");
        assert_eq!(entries[0].target.kind, FavoriteKind::Video);
        assert_eq!(entries[1].target.kind, FavoriteKind::LiveRoom);
        assert_eq!(list_favorites_in(&test_dir.0).unwrap(), entries);
    }

    #[test]
    fn removing_favorite_only_removes_matching_target() {
        let test_dir = TestDir::new();
        let video = favorite_entry(FavoriteKind::Video, "42", "Video", 10);
        let live = favorite_entry(FavoriteKind::LiveRoom, "42", "Live room", 20);
        save_favorite_in(&test_dir.0, video.clone()).unwrap();
        save_favorite_in(&test_dir.0, live.clone()).unwrap();

        let entries = remove_favorite_in(&test_dir.0, video.target.clone()).unwrap();

        assert_eq!(entries, vec![live]);
    }

    #[test]
    fn history_and_favorites_share_the_library_document() {
        let test_dir = TestDir::new();
        let favorite = favorite_entry(FavoriteKind::Video, "BV1", "Favorite", 10);

        save_history_entry_in(&test_dir.0, history_entry("BV1", 10)).unwrap();
        save_favorite_in(&test_dir.0, favorite.clone()).unwrap();
        save_history_entry_in(&test_dir.0, history_entry("BV1", 30)).unwrap();

        assert_eq!(
            list_history_in(&test_dir.0).unwrap()[0].progress_seconds,
            30
        );
        assert_eq!(list_favorites_in(&test_dir.0).unwrap(), vec![favorite]);
    }

    #[test]
    fn concurrent_history_and_favorite_writes_are_serialized() {
        let test_dir = TestDir::new();
        let history_root = test_dir.0.clone();
        let favorite_root = test_dir.0.clone();

        let history_thread = thread::spawn(move || {
            with_library_lock(|| save_history_entry_in(&history_root, history_entry("BV1", 30)))
        });
        let favorite_thread = thread::spawn(move || {
            with_library_lock(|| {
                save_favorite_in(
                    &favorite_root,
                    favorite_entry(FavoriteKind::Video, "BV1", "Favorite", 10),
                )
            })
        });

        history_thread.join().unwrap().unwrap();
        favorite_thread.join().unwrap().unwrap();

        assert_eq!(
            list_history_in(&test_dir.0).unwrap()[0].progress_seconds,
            30
        );
        assert_eq!(list_favorites_in(&test_dir.0).unwrap().len(), 1);
    }

    #[test]
    fn corrupt_library_recovers_from_previous_backup() {
        let test_dir = TestDir::new();
        let favorite = favorite_entry(FavoriteKind::Video, "BV1", "Favorite", 10);
        save_history_entry_in(&test_dir.0, history_entry("BV1", 10)).unwrap();
        save_favorite_in(&test_dir.0, favorite.clone()).unwrap();
        save_history_entry_in(&test_dir.0, history_entry("BV2", 20)).unwrap();
        fs::write(test_dir.0.join(LIBRARY_FILE), b"{broken").unwrap();

        let entries = list_history_in(&test_dir.0).unwrap();

        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].card.video_id, "BV1");
        assert_eq!(list_favorites_in(&test_dir.0).unwrap(), vec![favorite]);
        assert!(read_document(&test_dir.0.join(LIBRARY_FILE)).is_ok());
    }
}
