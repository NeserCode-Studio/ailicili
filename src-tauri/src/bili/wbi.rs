use std::{
    collections::BTreeMap,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use percent_encoding::{utf8_percent_encode, AsciiSet, NON_ALPHANUMERIC};
use reqwest::{
    header::{COOKIE, REFERER},
    Client,
};
use serde::Deserialize;
use tokio::sync::RwLock;

use super::error::BiliError;

const NAV_URL: &str = "https://api.bilibili.com/x/web-interface/nav";
pub const WBI_CACHE_TTL: Duration = Duration::from_secs(60 * 60);

const WBI_ENCODE_SET: &AsciiSet = &NON_ALPHANUMERIC
    .remove(b'-')
    .remove(b'_')
    .remove(b'.')
    .remove(b'~');

const MIXIN_KEY_ENC_TAB: [usize; 64] = [
    46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29,
    28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25,
    54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
];

#[derive(Clone)]
pub struct WbiKeys {
    img_key: String,
    sub_key: String,
}

impl WbiKeys {
    fn from_urls(img_url: &str, sub_url: &str) -> Result<Self, BiliError> {
        Ok(Self {
            img_key: key_from_url(img_url)?,
            sub_key: key_from_url(sub_url)?,
        })
    }

    fn mixin_key(&self) -> String {
        let raw = format!("{}{}", self.img_key, self.sub_key);
        let bytes = raw.as_bytes();
        MIXIN_KEY_ENC_TAB
            .iter()
            .take(32)
            .map(|index| bytes.get(*index).copied().unwrap_or(b'0') as char)
            .collect()
    }
}

struct CachedWbiKeys {
    keys: WbiKeys,
    fetched_at: Instant,
}

pub struct WbiCache {
    cached: RwLock<Option<CachedWbiKeys>>,
}

impl WbiCache {
    pub fn new() -> Self {
        Self {
            cached: RwLock::new(None),
        }
    }

    pub async fn keys(
        &self,
        http: &Client,
        cookie_header: Option<&str>,
        force_refresh: bool,
    ) -> Result<WbiKeys, BiliError> {
        if !force_refresh {
            let cached = self.cached.read().await;
            if let Some(cached) = cached.as_ref() {
                if cached.fetched_at.elapsed() < WBI_CACHE_TTL {
                    return Ok(cached.keys.clone());
                }
            }
        }

        let keys = fetch_keys(http, cookie_header).await?;
        *self.cached.write().await = Some(CachedWbiKeys {
            keys: keys.clone(),
            fetched_at: Instant::now(),
        });
        Ok(keys)
    }

    pub async fn invalidate(&self) {
        *self.cached.write().await = None;
    }
}

impl Default for WbiCache {
    fn default() -> Self {
        Self::new()
    }
}

pub fn sign_query(params: BTreeMap<String, String>, keys: &WbiKeys, wts: u64) -> String {
    let mut params = params;
    params.insert("wts".to_owned(), wts.to_string());
    let query = params
        .into_iter()
        .map(|(key, value)| {
            let filtered = value
                .chars()
                .filter(|character| !"!'()*".contains(*character))
                .collect::<String>();
            format!(
                "{}={}",
                utf8_percent_encode(&key, WBI_ENCODE_SET),
                utf8_percent_encode(&filtered, WBI_ENCODE_SET)
            )
        })
        .collect::<Vec<_>>()
        .join("&");
    let digest = format!("{:x}", md5::compute(format!("{query}{}", keys.mixin_key())));
    format!("{query}&w_rid={digest}")
}

pub fn unix_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

pub fn should_refresh_wbi(code: i64, message: &str) -> bool {
    code != 0 && (message.to_ascii_lowercase().contains("wbi") || message.contains("签名"))
}

async fn fetch_keys(http: &Client, cookie_header: Option<&str>) -> Result<WbiKeys, BiliError> {
    let mut request = http
        .get(NAV_URL)
        .header(REFERER, "https://www.bilibili.com/");
    if let Some(cookie_header) = cookie_header.filter(|value| !value.is_empty()) {
        request = request.header(COOKIE, cookie_header);
    }

    let response = request.send().await?;
    let status = response.status();
    if !status.is_success() {
        return Err(BiliError::HttpStatus(status.as_u16()));
    }
    let envelope: NavEnvelope = response.json().await?;
    if envelope.code != 0 && envelope.code != -101 {
        return Err(BiliError::Upstream {
            code: envelope.code,
            message: envelope.message.chars().take(160).collect(),
        });
    }
    let wbi = envelope.data.ok_or(BiliError::MissingData)?.wbi_img;
    WbiKeys::from_urls(&wbi.img_url, &wbi.sub_url)
}

fn key_from_url(url: &str) -> Result<String, BiliError> {
    let filename = url.rsplit('/').next().unwrap_or(url);
    let key = filename.split('.').next().unwrap_or_default();
    if key.is_empty() {
        Err(BiliError::InvalidResponse("invalid WBI key URL"))
    } else {
        Ok(key.to_owned())
    }
}

#[derive(Deserialize)]
struct NavEnvelope {
    code: i64,
    #[serde(default)]
    message: String,
    data: Option<NavData>,
}

#[derive(Deserialize)]
struct NavData {
    wbi_img: NavWbiImage,
}

#[derive(Deserialize)]
struct NavWbiImage {
    img_url: String,
    sub_url: String,
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use super::{key_from_url, should_refresh_wbi, sign_query, WbiKeys};

    fn documented_keys() -> WbiKeys {
        WbiKeys::from_urls(
            "https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png",
            "https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png",
        )
        .expect("documented WBI keys")
    }

    #[test]
    fn generates_documented_mixin_key_and_signature() {
        let keys = documented_keys();
        assert_eq!(keys.mixin_key(), "ea1db124af3c7062474693fa704f4ff8");

        let params = BTreeMap::from([
            ("foo".to_owned(), "114".to_owned()),
            ("bar".to_owned(), "514".to_owned()),
            ("zab".to_owned(), "1919810".to_owned()),
        ]);
        assert_eq!(
            sign_query(params, &keys, 1_702_204_169),
            "bar=514&foo=114&wts=1702204169&zab=1919810&w_rid=8f6f2b5b3d485fe1886cec6a0be8c5d4"
        );
    }

    #[test]
    fn filters_reserved_characters_and_encodes_like_uri_component() {
        let params = BTreeMap::from([("keyword".to_owned(), "one two!('中文')*".to_owned())]);
        let signed = sign_query(params, &documented_keys(), 1);
        assert!(signed.starts_with("keyword=one%20two%E4%B8%AD%E6%96%87&wts=1&w_rid="));
    }

    #[test]
    fn extracts_keys_and_detects_wbi_failures() {
        assert_eq!(
            key_from_url("https://i0.hdslb.com/bfs/wbi/key.png").expect("key"),
            "key"
        );
        assert!(key_from_url("https://i0.hdslb.com/bfs/wbi/").is_err());
        assert!(should_refresh_wbi(-403, "WBI signature expired"));
        assert!(should_refresh_wbi(-403, "请求签名错误"));
        assert!(!should_refresh_wbi(-403, "permission denied"));
        assert!(!should_refresh_wbi(0, "wbi"));
    }
}
