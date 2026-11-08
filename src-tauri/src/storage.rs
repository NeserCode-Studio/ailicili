use std::{fs, path::PathBuf};

use crate::domain::HistoryEntry;

const HISTORY_FILE: &str = "history.json";

fn data_dir() -> Result<PathBuf, String> {
    let dir = dirs::data_local_dir()
        .map(|path| path.join("ailicili"))
        .ok_or_else(|| "Cannot resolve local data directory".to_string())?;
    fs::create_dir_all(&dir).map_err(|err| err.to_string())?;
    Ok(dir)
}

pub fn list_history() -> Result<Vec<HistoryEntry>, String> {
    let path = data_dir()?.join(HISTORY_FILE);
    if !path.exists() {
        return Ok(Vec::new());
    }
    let content = fs::read_to_string(path).map_err(|err| err.to_string())?;
    serde_json::from_str(&content).map_err(|err| err.to_string())
}

pub fn save_history_entry(entry: HistoryEntry) -> Result<Vec<HistoryEntry>, String> {
    let mut entries = list_history()?;
    entries.retain(|item| item.card.video_id != entry.card.video_id);
    entries.insert(0, entry);
    entries.truncate(200);

    let path = data_dir()?.join(HISTORY_FILE);
    let content = serde_json::to_string_pretty(&entries).map_err(|err| err.to_string())?;
    fs::write(path, content).map_err(|err| err.to_string())?;
    Ok(entries)
}
