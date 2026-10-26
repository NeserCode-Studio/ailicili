use std::{
    fs,
    path::Path,
    sync::{Arc, Mutex},
    time::Duration,
};

use rusqlite::{params, types::Type, Connection, OptionalExtension, Row};

use super::{
    error::DownloadError,
    model::{DownloadPhase, DownloadStatus, DownloadTask},
};

const DATABASE_VERSION: i64 = 1;

#[derive(Clone)]
pub struct DownloadRepository {
    connection: Arc<Mutex<Connection>>,
}

impl DownloadRepository {
    pub fn open(path: &Path) -> Result<Self, DownloadError> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let connection = Connection::open(path)?;
        connection.busy_timeout(Duration::from_secs(5))?;
        connection.execute_batch(
            "
            PRAGMA journal_mode = WAL;
            PRAGMA synchronous = NORMAL;
            CREATE TABLE IF NOT EXISTS download_tasks (
                id TEXT PRIMARY KEY NOT NULL,
                bvid TEXT NOT NULL,
                cid INTEGER NOT NULL,
                aid INTEGER NOT NULL,
                title TEXT NOT NULL,
                part_title TEXT NOT NULL,
                cover_url TEXT NOT NULL,
                duration_seconds INTEGER NOT NULL,
                quality_id INTEGER NOT NULL,
                quality_label TEXT NOT NULL,
                width INTEGER NOT NULL,
                height INTEGER NOT NULL,
                status TEXT NOT NULL,
                phase TEXT NOT NULL,
                progress_percent INTEGER NOT NULL,
                downloaded_bytes INTEGER NOT NULL,
                total_bytes INTEGER NOT NULL,
                speed_bytes_per_second INTEGER NOT NULL,
                eta_seconds INTEGER,
                directory_path TEXT NOT NULL,
                output_path TEXT,
                video_path TEXT,
                audio_path TEXT,
                cover_path TEXT,
                danmaku_path TEXT,
                subtitle_path TEXT,
                metadata_path TEXT,
                error_code TEXT,
                error_message TEXT,
                warnings_json TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                completed_at INTEGER
            );
            CREATE INDEX IF NOT EXISTS download_tasks_updated_idx
                ON download_tasks(updated_at DESC);
            CREATE INDEX IF NOT EXISTS download_tasks_content_idx
                ON download_tasks(bvid, cid, quality_id);
            CREATE TABLE IF NOT EXISTS download_settings (
                key TEXT PRIMARY KEY NOT NULL,
                value TEXT NOT NULL
            );
            ",
        )?;
        connection.pragma_update(None, "user_version", DATABASE_VERSION)?;
        Ok(Self {
            connection: Arc::new(Mutex::new(connection)),
        })
    }

    fn connection(&self) -> Result<std::sync::MutexGuard<'_, Connection>, DownloadError> {
        self.connection.lock().map_err(|_| DownloadError::Database)
    }

    pub fn insert(&self, task: &DownloadTask) -> Result<(), DownloadError> {
        let warnings = serde_json::to_string(&task.warnings)?;
        self.connection()?.execute(
            "
            INSERT INTO download_tasks (
                id, bvid, cid, aid, title, part_title, cover_url, duration_seconds,
                quality_id, quality_label, width, height, status, phase,
                progress_percent, downloaded_bytes, total_bytes, speed_bytes_per_second,
                eta_seconds, directory_path, output_path, video_path, audio_path,
                cover_path, danmaku_path, subtitle_path, metadata_path, error_code,
                error_message, warnings_json, created_at, updated_at, completed_at
            ) VALUES (
                ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14,
                ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26,
                ?27, ?28, ?29, ?30, ?31, ?32, ?33
            )
            ",
            params![
                task.id,
                task.bvid,
                sql_u64(task.cid),
                sql_u64(task.aid),
                task.title,
                task.part_title,
                task.cover_url,
                task.duration_seconds,
                task.quality_id,
                task.quality_label,
                task.width,
                task.height,
                task.status.as_str(),
                task.phase.as_str(),
                task.progress_percent,
                sql_u64(task.downloaded_bytes),
                sql_u64(task.total_bytes),
                sql_u64(task.speed_bytes_per_second),
                task.eta_seconds.map(sql_u64),
                task.directory_path,
                task.output_path,
                task.video_path,
                task.audio_path,
                task.cover_path,
                task.danmaku_path,
                task.subtitle_path,
                task.metadata_path,
                task.error_code,
                task.error_message,
                warnings,
                task.created_at,
                task.updated_at,
                task.completed_at,
            ],
        )?;
        Ok(())
    }

    pub fn update(&self, task: &DownloadTask) -> Result<(), DownloadError> {
        let warnings = serde_json::to_string(&task.warnings)?;
        let changed = self.connection()?.execute(
            "
            UPDATE download_tasks SET
                status = ?2,
                phase = ?3,
                progress_percent = ?4,
                downloaded_bytes = ?5,
                total_bytes = ?6,
                speed_bytes_per_second = ?7,
                eta_seconds = ?8,
                directory_path = ?9,
                output_path = ?10,
                video_path = ?11,
                audio_path = ?12,
                cover_path = ?13,
                danmaku_path = ?14,
                subtitle_path = ?15,
                metadata_path = ?16,
                error_code = ?17,
                error_message = ?18,
                warnings_json = ?19,
                updated_at = ?20,
                completed_at = ?21
            WHERE id = ?1
            ",
            params![
                task.id,
                task.status.as_str(),
                task.phase.as_str(),
                task.progress_percent,
                sql_u64(task.downloaded_bytes),
                sql_u64(task.total_bytes),
                sql_u64(task.speed_bytes_per_second),
                task.eta_seconds.map(sql_u64),
                task.directory_path,
                task.output_path,
                task.video_path,
                task.audio_path,
                task.cover_path,
                task.danmaku_path,
                task.subtitle_path,
                task.metadata_path,
                task.error_code,
                task.error_message,
                warnings,
                task.updated_at,
                task.completed_at,
            ],
        )?;
        if changed == 0 {
            return Err(DownloadError::TaskMissing);
        }
        Ok(())
    }

    pub fn get(&self, id: &str) -> Result<DownloadTask, DownloadError> {
        self.connection()?
            .query_row(
                "SELECT * FROM download_tasks WHERE id = ?1",
                [id],
                task_from_row,
            )
            .optional()?
            .ok_or(DownloadError::TaskMissing)
    }

    pub fn list(&self, limit: u32) -> Result<Vec<DownloadTask>, DownloadError> {
        let connection = self.connection()?;
        let mut statement = connection.prepare(
            "
            SELECT * FROM download_tasks
            ORDER BY
                CASE status
                    WHEN 'downloading' THEN 0
                    WHEN 'muxing' THEN 1
                    WHEN 'queued' THEN 2
                    WHEN 'paused' THEN 3
                    WHEN 'failed' THEN 4
                    ELSE 5
                END,
                updated_at DESC
            LIMIT ?1
            ",
        )?;
        let rows = statement.query_map([limit.clamp(1, 500)], task_from_row)?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(DownloadError::from)
    }

    pub fn list_completed(&self, limit: u32) -> Result<Vec<DownloadTask>, DownloadError> {
        let connection = self.connection()?;
        let mut statement = connection.prepare(
            "
            SELECT * FROM download_tasks
            WHERE status = 'completed'
            ORDER BY COALESCE(completed_at, updated_at) DESC
            LIMIT ?1
            ",
        )?;
        let rows = statement.query_map([limit.clamp(1, 500)], task_from_row)?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(DownloadError::from)
    }

    pub fn has_equivalent(
        &self,
        bvid: &str,
        cid: u64,
        quality_id: u32,
    ) -> Result<bool, DownloadError> {
        let exists = self.connection()?.query_row(
            "
                SELECT EXISTS(
                    SELECT 1 FROM download_tasks
                    WHERE bvid = ?1 AND cid = ?2 AND quality_id = ?3
                      AND status NOT IN ('failed', 'cancelled')
                )
                ",
            params![bvid, sql_u64(cid), quality_id],
            |row| row.get::<_, bool>(0),
        )?;
        Ok(exists)
    }

    pub fn has_incomplete(&self) -> Result<bool, DownloadError> {
        let exists = self.connection()?.query_row(
            "SELECT EXISTS(SELECT 1 FROM download_tasks WHERE status != 'completed')",
            [],
            |row| row.get::<_, bool>(0),
        )?;
        Ok(exists)
    }

    pub fn delete(&self, id: &str) -> Result<(), DownloadError> {
        self.connection()?
            .execute("DELETE FROM download_tasks WHERE id = ?1", [id])?;
        Ok(())
    }

    pub fn mark_interrupted_paused(&self, now: i64) -> Result<usize, DownloadError> {
        let changed = self.connection()?.execute(
            "
            UPDATE download_tasks SET
                status = 'paused',
                speed_bytes_per_second = 0,
                eta_seconds = NULL,
                error_code = 'interrupted',
                error_message = 'The app stopped before this download completed.',
                updated_at = ?1
            WHERE status IN ('queued', 'downloading', 'muxing')
            ",
            [now],
        )?;
        Ok(changed)
    }

    pub fn setting(&self, key: &str) -> Result<Option<String>, DownloadError> {
        self.connection()?
            .query_row(
                "SELECT value FROM download_settings WHERE key = ?1",
                [key],
                |row| row.get(0),
            )
            .optional()
            .map_err(DownloadError::from)
    }

    pub fn set_setting(&self, key: &str, value: &str) -> Result<(), DownloadError> {
        self.connection()?.execute(
            "
            INSERT INTO download_settings (key, value) VALUES (?1, ?2)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
            ",
            params![key, value],
        )?;
        Ok(())
    }
}

fn task_from_row(row: &Row<'_>) -> rusqlite::Result<DownloadTask> {
    let status_value: String = row.get("status")?;
    let phase_value: String = row.get("phase")?;
    let status = DownloadStatus::from_str(&status_value).ok_or_else(|| {
        invalid_text(
            "status",
            12,
            format!("unknown download status {status_value}"),
        )
    })?;
    let phase = DownloadPhase::from_str(&phase_value).ok_or_else(|| {
        invalid_text("phase", 13, format!("unknown download phase {phase_value}"))
    })?;
    let warnings_json: String = row.get("warnings_json")?;
    let warnings = serde_json::from_str(&warnings_json).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(29, Type::Text, Box::new(error))
    })?;

    Ok(DownloadTask {
        id: row.get("id")?,
        bvid: row.get("bvid")?,
        cid: row_u64(row, "cid")?,
        aid: row_u64(row, "aid")?,
        title: row.get("title")?,
        part_title: row.get("part_title")?,
        cover_url: row.get("cover_url")?,
        duration_seconds: row.get("duration_seconds")?,
        quality_id: row.get("quality_id")?,
        quality_label: row.get("quality_label")?,
        width: row.get("width")?,
        height: row.get("height")?,
        status,
        phase,
        progress_percent: row.get("progress_percent")?,
        downloaded_bytes: row_u64(row, "downloaded_bytes")?,
        total_bytes: row_u64(row, "total_bytes")?,
        speed_bytes_per_second: row_u64(row, "speed_bytes_per_second")?,
        eta_seconds: row
            .get::<_, Option<i64>>("eta_seconds")?
            .map(|value| value.max(0) as u64),
        directory_path: row.get("directory_path")?,
        output_path: row.get("output_path")?,
        video_path: row.get("video_path")?,
        audio_path: row.get("audio_path")?,
        cover_path: row.get("cover_path")?,
        danmaku_path: row.get("danmaku_path")?,
        subtitle_path: row.get("subtitle_path")?,
        metadata_path: row.get("metadata_path")?,
        error_code: row.get("error_code")?,
        error_message: row.get("error_message")?,
        warnings,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
        completed_at: row.get("completed_at")?,
    })
}

fn invalid_text(column: &str, index: usize, message: String) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(
        index,
        Type::Text,
        Box::new(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!("{column}: {message}"),
        )),
    )
}

fn sql_u64(value: u64) -> i64 {
    value.min(i64::MAX as u64) as i64
}

fn row_u64(row: &Row<'_>, column: &str) -> rusqlite::Result<u64> {
    row.get::<_, i64>(column).map(|value| value.max(0) as u64)
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        path::PathBuf,
        sync::atomic::{AtomicU64, Ordering},
        time::{SystemTime, UNIX_EPOCH},
    };

    use super::DownloadRepository;
    use crate::downloads::model::{DownloadPhase, DownloadStatus, DownloadTask};

    fn temp_database() -> PathBuf {
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let token = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let sequence = COUNTER.fetch_add(1, Ordering::Relaxed);
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../.agent/test-tmp")
            .join(format!("downloads-{token}-{sequence}.sqlite3"))
    }

    fn task() -> DownloadTask {
        DownloadTask {
            id: "123e4567-e89b-12d3-a456-426614174000".to_owned(),
            bvid: "BV1xx411c7mD".to_owned(),
            cid: 42,
            aid: 7,
            title: "测试视频".to_owned(),
            part_title: "P1".to_owned(),
            cover_url: "https://i0.hdslb.com/cover.jpg".to_owned(),
            duration_seconds: 120,
            quality_id: 80,
            quality_label: "1080P".to_owned(),
            width: 1920,
            height: 1080,
            status: DownloadStatus::Queued,
            phase: DownloadPhase::Preparing,
            progress_percent: 0,
            downloaded_bytes: 0,
            total_bytes: 0,
            speed_bytes_per_second: 0,
            eta_seconds: None,
            directory_path: "C:\\Downloads\\task".to_owned(),
            output_path: None,
            video_path: None,
            audio_path: None,
            cover_path: None,
            danmaku_path: None,
            subtitle_path: None,
            metadata_path: None,
            error_code: None,
            error_message: None,
            warnings: vec![],
            created_at: 1,
            updated_at: 1,
            completed_at: None,
        }
    }

    #[test]
    fn persists_updates_and_reopens_tasks() {
        let path = temp_database();
        {
            let repository = DownloadRepository::open(&path).expect("repository");
            let mut value = task();
            repository.insert(&value).expect("insert");
            value.status = DownloadStatus::Downloading;
            value.phase = DownloadPhase::Video;
            value.downloaded_bytes = 512;
            value.progress_percent = 25;
            value.updated_at = 2;
            repository.update(&value).expect("update");
        }
        {
            let repository = DownloadRepository::open(&path).expect("reopen");
            let value = repository.get(&task().id).expect("get");
            assert_eq!(value.status, DownloadStatus::Downloading);
            assert_eq!(value.progress_percent, 25);
            assert_eq!(repository.list(10).expect("list").len(), 1);
        }

        let _ = fs::remove_file(&path);
        let _ = fs::remove_file(path.with_extension("sqlite3-wal"));
        let _ = fs::remove_file(path.with_extension("sqlite3-shm"));
    }

    #[test]
    fn marks_interrupted_active_tasks_paused() {
        let path = temp_database();
        let repository = DownloadRepository::open(&path).expect("repository");
        repository.insert(&task()).expect("insert");
        assert_eq!(repository.mark_interrupted_paused(3).expect("mark"), 1);
        let value = repository.get(&task().id).expect("get");
        assert_eq!(value.status, DownloadStatus::Paused);
        assert_eq!(value.error_code.as_deref(), Some("interrupted"));

        let _ = fs::remove_file(&path);
        let _ = fs::remove_file(path.with_extension("sqlite3-wal"));
        let _ = fs::remove_file(path.with_extension("sqlite3-shm"));
    }

    #[test]
    fn duplicate_detection_allows_retryable_terminal_states() {
        let path = temp_database();
        let repository = DownloadRepository::open(&path).expect("repository");
        let mut value = task();
        repository.insert(&value).expect("insert");
        assert!(repository
            .has_equivalent(&value.bvid, value.cid, value.quality_id)
            .expect("queued duplicate"));

        value.status = DownloadStatus::Failed;
        repository.update(&value).expect("failed update");
        assert!(!repository
            .has_equivalent(&value.bvid, value.cid, value.quality_id)
            .expect("failed duplicate"));

        value.status = DownloadStatus::Cancelled;
        repository.update(&value).expect("cancelled update");
        assert!(!repository
            .has_equivalent(&value.bvid, value.cid, value.quality_id)
            .expect("cancelled duplicate"));

        let _ = fs::remove_file(&path);
        let _ = fs::remove_file(path.with_extension("sqlite3-wal"));
        let _ = fs::remove_file(path.with_extension("sqlite3-shm"));
    }

    #[test]
    fn incomplete_check_covers_all_unfinished_states() {
        let path = temp_database();
        let repository = DownloadRepository::open(&path).expect("repository");
        let mut value = task();
        repository.insert(&value).expect("insert");
        assert!(repository.has_incomplete().expect("queued incomplete"));

        value.status = DownloadStatus::Failed;
        repository.update(&value).expect("failed update");
        assert!(repository.has_incomplete().expect("failed incomplete"));

        value.status = DownloadStatus::Completed;
        repository.update(&value).expect("completed update");
        assert!(!repository.has_incomplete().expect("completed"));

        let _ = fs::remove_file(&path);
        let _ = fs::remove_file(path.with_extension("sqlite3-wal"));
        let _ = fs::remove_file(path.with_extension("sqlite3-shm"));
    }

    #[test]
    fn lists_only_completed_tasks_in_completion_order() {
        let path = temp_database();
        let repository = DownloadRepository::open(&path).expect("repository");
        let mut first = task();
        first.id = "completed-first".to_owned();
        first.status = DownloadStatus::Completed;
        first.completed_at = Some(10);
        repository.insert(&first).expect("first insert");

        let mut second = task();
        second.id = "completed-second".to_owned();
        second.status = DownloadStatus::Completed;
        second.completed_at = Some(20);
        repository.insert(&second).expect("second insert");

        let mut active = task();
        active.id = "active".to_owned();
        active.status = DownloadStatus::Downloading;
        repository.insert(&active).expect("active insert");

        let completed = repository.list_completed(10).expect("completed list");
        assert_eq!(completed.len(), 2);
        assert_eq!(completed[0].id, "completed-second");
        assert_eq!(completed[1].id, "completed-first");

        let _ = fs::remove_file(&path);
        let _ = fs::remove_file(path.with_extension("sqlite3-wal"));
        let _ = fs::remove_file(path.with_extension("sqlite3-shm"));
    }
}
