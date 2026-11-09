use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{Duration, Instant},
};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{bilibili::BiliError, storage};

const DEVICE_FILE: &str = "bilibili-device.json";
const FINGERPRINT_PATH: &str = "/x/frontend/finger/spi";
const FAILURE_COOLDOWN: Duration = Duration::from_secs(60);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceIdentity {
    pub buvid3: String,
    pub buvid4: String,
    pub created_at: i64,
}

pub struct DeviceManager {
    http: reqwest::Client,
    path: PathBuf,
    cached: Mutex<Option<DeviceIdentity>>,
    retry_after: Mutex<Option<Instant>>,
}

impl DeviceManager {
    pub fn new(http: reqwest::Client) -> Result<Self, BiliError> {
        let path = storage::data_dir()
            .map_err(BiliError::Storage)?
            .join(DEVICE_FILE);
        Ok(Self {
            http,
            path,
            cached: Mutex::new(None),
            retry_after: Mutex::new(None),
        })
    }

    pub async fn ensure_identity(&self) -> Result<Option<DeviceIdentity>, BiliError> {
        if let Some(identity) = self.cached()? {
            return Ok(Some(identity));
        }

        if let Some(identity) = read_identity(&self.path)? {
            self.set_cached(identity.clone())?;
            return Ok(Some(identity));
        }

        if self
            .retry_after
            .lock()
            .map_err(|_| BiliError::Storage("device cooldown lock poisoned".to_string()))?
            .is_some_and(|deadline| deadline > Instant::now())
        {
            return Ok(None);
        }

        let root = match self.fetch_identity().await {
            Ok(root) => root,
            Err(err) => {
                self.defer_retry()?;
                return Err(err);
            }
        };
        let data = root
            .get("data")
            .ok_or_else(|| BiliError::Invalid("missing device fingerprint data".to_string()))?;
        let buvid3 = non_empty_string(data.get("b_3"))
            .ok_or_else(|| BiliError::Invalid("missing buvid3".to_string()))?;
        let buvid4 = non_empty_string(data.get("b_4"))
            .ok_or_else(|| BiliError::Invalid("missing buvid4".to_string()))?;
        let identity = DeviceIdentity {
            buvid3,
            buvid4,
            created_at: chrono::Utc::now().timestamp(),
        };

        save_identity(&self.path, &identity)?;
        self.set_cached(identity.clone())?;
        Ok(Some(identity))
    }

    pub fn reset(&self) -> Result<(), BiliError> {
        if self.path.exists() {
            fs::remove_file(&self.path).map_err(|err| {
                BiliError::Storage(format!("cannot remove device identity: {err}"))
            })?;
        }
        *self
            .cached
            .lock()
            .map_err(|_| BiliError::Storage("device cache lock poisoned".to_string()))? = None;
        Ok(())
    }

    async fn fetch_identity(&self) -> Result<Value, BiliError> {
        let response = self
            .http
            .get(format!("https://api.bilibili.com{FINGERPRINT_PATH}"))
            .header("referer", "https://www.bilibili.com/")
            .header("origin", "https://www.bilibili.com")
            .send()
            .await?
            .error_for_status()?;
        let root: Value = response.json().await?;
        let code = root.get("code").and_then(Value::as_i64).unwrap_or_default();
        if code != 0 {
            return Err(BiliError::Api {
                code,
                message: "device fingerprint rejected".to_string(),
            });
        }
        Ok(root)
    }

    fn cached(&self) -> Result<Option<DeviceIdentity>, BiliError> {
        self.cached
            .lock()
            .map(|cache| cache.clone())
            .map_err(|_| BiliError::Storage("device cache lock poisoned".to_string()))
    }

    fn set_cached(&self, identity: DeviceIdentity) -> Result<(), BiliError> {
        *self
            .cached
            .lock()
            .map_err(|_| BiliError::Storage("device cache lock poisoned".to_string()))? =
            Some(identity);
        Ok(())
    }

    fn defer_retry(&self) -> Result<(), BiliError> {
        *self
            .retry_after
            .lock()
            .map_err(|_| BiliError::Storage("device cooldown lock poisoned".to_string()))? =
            Some(Instant::now() + FAILURE_COOLDOWN);
        Ok(())
    }
}

fn read_identity(path: &Path) -> Result<Option<DeviceIdentity>, BiliError> {
    if !path.exists() {
        return Ok(None);
    }
    let content = fs::read_to_string(path)
        .map_err(|err| BiliError::Storage(format!("cannot read device identity: {err}")))?;
    let identity: DeviceIdentity = serde_json::from_str(&content)
        .map_err(|err| BiliError::Storage(format!("invalid device identity: {err}")))?;
    if identity.buvid3.is_empty() || identity.buvid4.is_empty() {
        return Err(BiliError::Storage(
            "device identity is missing required values".to_string(),
        ));
    }
    Ok(Some(identity))
}

fn save_identity(path: &Path, identity: &DeviceIdentity) -> Result<(), BiliError> {
    let content = serde_json::to_vec_pretty(identity)
        .map_err(|err| BiliError::Storage(format!("cannot encode device identity: {err}")))?;
    let temp_path = path.with_extension(format!("json.{}.tmp", std::process::id()));
    fs::write(&temp_path, content)
        .map_err(|err| BiliError::Storage(format!("cannot write device identity: {err}")))?;
    if path.exists() {
        fs::remove_file(path)
            .map_err(|err| BiliError::Storage(format!("cannot replace device identity: {err}")))?;
    }
    fs::rename(&temp_path, path)
        .map_err(|err| BiliError::Storage(format!("cannot finalize device identity: {err}")))
}

fn non_empty_string(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}
