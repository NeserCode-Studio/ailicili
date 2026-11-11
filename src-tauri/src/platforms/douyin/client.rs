use std::{
    collections::HashMap,
    future::Future,
    sync::Arc,
    time::{Duration, Instant},
};

use log::info;
use reqwest::{
    header::{HeaderMap, ACCEPT, COOKIE, REFERER},
    Response,
};
use serde_json::{json, Value};
use tokio::sync::Mutex;

use super::{
    mapper,
    media::{fetch_media_response, validate_media_url},
    DouyinError,
};
use crate::domain::{LiveDiscovery, LivePlaybackInfo, LiveRoomInfo};

const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const LIVE_HOME_URL: &str = "https://live.douyin.com/";
const LIVE_CATEGORY_URL: &str = "https://live.douyin.com/category/1";
const LIVE_ENTER_API: &str = "https://live.douyin.com/webcast/room/web/enter/";
const TTWID_REGISTER_URL: &str = "https://ttwid.bytedance.com/ttwid/union/register/";
const TTWID_CACHE_TTL: Duration = Duration::from_secs(2 * 60 * 60);
const ENTER_CACHE_TTL: Duration = Duration::from_secs(2);
const DISCOVERY_FALLBACK_TTL: Duration = Duration::from_secs(2 * 60);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);
const MEDIA_CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
const MAX_JSON_RESPONSE_BYTES: usize = 4 * 1024 * 1024;
const MAX_HTML_RESPONSE_BYTES: usize = 3 * 1024 * 1024;
const MAX_TTWID_LENGTH: usize = 4_096;
const MAX_WEB_RID_LENGTH: usize = 32;

pub(crate) struct DouyinClient {
    http: reqwest::Client,
    media_http: reqwest::Client,
    ttwid: TtwidCache,
    enter: Mutex<HashMap<String, CachedEnter>>,
    enter_locks: Mutex<HashMap<String, Arc<Mutex<()>>>>,
    discovery: Mutex<Option<CachedDiscovery>>,
}

impl DouyinClient {
    pub(crate) fn new() -> Result<Self, reqwest::Error> {
        let http = reqwest::Client::builder()
            .user_agent(USER_AGENT)
            .timeout(REQUEST_TIMEOUT)
            .redirect(reqwest::redirect::Policy::none())
            .build()?;
        let media_http = reqwest::Client::builder()
            .user_agent(USER_AGENT)
            .connect_timeout(MEDIA_CONNECT_TIMEOUT)
            .redirect(reqwest::redirect::Policy::none())
            .build()?;
        Ok(Self {
            http,
            media_http,
            ttwid: TtwidCache::default(),
            enter: Mutex::new(HashMap::new()),
            enter_locks: Mutex::new(HashMap::new()),
            discovery: Mutex::new(None),
        })
    }

    pub(crate) async fn discover(&self) -> Result<LiveDiscovery, DouyinError> {
        let category = self
            .get_ttwid_page(LIVE_CATEGORY_URL, "text/html,application/xhtml+xml")
            .await;
        if let Ok(html) = category {
            if let Ok(snapshot) = mapper::parse_discovery_snapshot(&html) {
                self.store_discovery(&snapshot).await;
                return Ok(snapshot.discovery);
            }
        }

        let homepage = self
            .get_ttwid_page(LIVE_HOME_URL, "text/html,application/xhtml+xml")
            .await?;
        let snapshot = mapper::parse_discovery_snapshot(&homepage)?;
        self.store_discovery(&snapshot).await;
        Ok(snapshot.discovery)
    }

    pub(crate) async fn room_info(&self, room_id: &str) -> Result<LiveRoomInfo, DouyinError> {
        let web_rid = normalize_web_rid(room_id)?;
        let root = match self.enter_room(&web_rid).await {
            Ok(root) => root,
            Err(error) if discovery_fallback_applies(&error) => {
                let Some(discovered) = self.discovered_room(&web_rid).await else {
                    return Err(error);
                };
                info!(
                    target: "Douyin/Live",
                    "using recent discovery room info fallback room={} enter_error={error}",
                    web_rid,
                );
                return Ok(mapper::parse_discovered_room_info(
                    &discovered.card,
                    &discovered.room,
                ));
            }
            Err(error) => return Err(error),
        };
        mapper::parse_room_info(&root, &web_rid)
    }

    pub(crate) async fn room_playback(
        &self,
        room_id: &str,
        quality: i64,
    ) -> Result<LivePlaybackInfo, DouyinError> {
        let web_rid = normalize_web_rid(room_id)?;
        let root = match self.enter_room(&web_rid).await {
            Ok(root) => root,
            Err(error) if discovery_fallback_applies(&error) => {
                let Some(discovered) = self.discovered_room(&web_rid).await else {
                    return Err(error);
                };
                info!(
                    target: "Douyin/Live",
                    "using recent discovery playback fallback room={} enter_error={error}",
                    web_rid,
                );
                return mapper::parse_discovered_playback(&discovered.room, &web_rid, quality);
            }
            Err(error) => return Err(error),
        };
        mapper::parse_playback(&root, &web_rid, quality)
    }

    pub(crate) async fn media_response(
        &self,
        url: &str,
        request_headers: &HeaderMap,
    ) -> Result<Response, DouyinError> {
        let url = validate_media_url(url)?;
        fetch_media_response(&self.media_http, url, request_headers).await
    }

    async fn enter_room(&self, web_rid: &str) -> Result<Value, DouyinError> {
        if let Some(result) = self.cached_enter(web_rid).await {
            return result;
        }

        let room_lock = self.enter_room_lock(web_rid).await;
        let guard = room_lock.lock().await;
        if let Some(result) = self.cached_enter(web_rid).await {
            drop(guard);
            self.release_enter_room_lock(web_rid, &room_lock).await;
            return result;
        }

        let result = self.fetch_enter_room(web_rid).await;
        drop(guard);
        self.store_enter_result(web_rid, &result).await;
        self.release_enter_room_lock(web_rid, &room_lock).await;
        result
    }

    async fn fetch_enter_room(&self, web_rid: &str) -> Result<Value, DouyinError> {
        let ttwid = self.acquire_ttwid().await?;
        match self.enter_room_once(web_rid, &ttwid).await {
            Ok(root) => Ok(root),
            Err(DouyinError::EmptyResponse) => {
                self.ttwid.invalidate_if(&ttwid).await;
                let refreshed = self.acquire_ttwid().await?;
                self.enter_room_once(web_rid, &refreshed).await
            }
            Err(error) => Err(error),
        }
    }

    async fn cached_enter(&self, web_rid: &str) -> Option<Result<Value, DouyinError>> {
        let mut cached = self.enter.lock().await;
        let now = Instant::now();
        cached.retain(|_, entry| now < entry.expires_at);
        cached.get(web_rid).map(|entry| entry.outcome.to_result())
    }

    async fn store_enter_result(&self, web_rid: &str, result: &Result<Value, DouyinError>) {
        let outcome = match result {
            Ok(root) => CachedEnterOutcome::Success(root.clone()),
            Err(error) => {
                let Some(error) = CachedEnterFailure::from_error(error) else {
                    return;
                };
                CachedEnterOutcome::Failure(error)
            }
        };
        self.enter.lock().await.insert(
            web_rid.to_string(),
            CachedEnter {
                outcome,
                expires_at: Instant::now() + ENTER_CACHE_TTL,
            },
        );
    }

    async fn enter_room_lock(&self, web_rid: &str) -> Arc<Mutex<()>> {
        let mut locks = self.enter_locks.lock().await;
        locks
            .entry(web_rid.to_string())
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone()
    }

    async fn release_enter_room_lock(&self, web_rid: &str, room_lock: &Arc<Mutex<()>>) {
        let mut locks = self.enter_locks.lock().await;
        let can_remove = Arc::strong_count(room_lock) == 2
            && locks
                .get(web_rid)
                .is_some_and(|current| Arc::ptr_eq(current, room_lock));
        if can_remove {
            locks.remove(web_rid);
        }
    }

    async fn store_discovery(&self, snapshot: &mapper::DiscoverySnapshot) {
        *self.discovery.lock().await = Some(CachedDiscovery {
            rooms: snapshot.rooms.clone(),
            expires_at: Instant::now() + DISCOVERY_FALLBACK_TTL,
        });
    }

    async fn discovered_room(&self, web_rid: &str) -> Option<mapper::DiscoveredRoom> {
        let mut cached = self.discovery.lock().await;
        let now = Instant::now();
        if cached.as_ref().is_some_and(|cache| now >= cache.expires_at) {
            *cached = None;
            return None;
        }
        cached
            .as_ref()
            .and_then(|cache| cache.rooms.get(web_rid).cloned())
    }

    async fn enter_room_once(&self, web_rid: &str, ttwid: &str) -> Result<Value, DouyinError> {
        let response = self
            .http
            .get(LIVE_ENTER_API)
            .query(&public_query(web_rid))
            .header(ACCEPT, "application/json, text/plain, */*")
            .header(REFERER, LIVE_HOME_URL)
            .header("origin", "https://live.douyin.com")
            .header("accept-language", "zh-CN,zh;q=0.9,en;q=0.8")
            .header(COOKIE, format!("ttwid={ttwid}"))
            .send()
            .await?;
        let status = response.status();
        if !status.is_success() {
            return Err(DouyinError::Http(status.as_u16()));
        }
        let root = read_json(response, MAX_JSON_RESPONSE_BYTES).await?;
        validate_enter_response(&root)?;
        Ok(root)
    }

    async fn get_ttwid_page(&self, url: &str, accept: &str) -> Result<String, DouyinError> {
        let ttwid = self.acquire_ttwid().await?;
        let response = self
            .http
            .get(url)
            .header(ACCEPT, accept)
            .header(REFERER, LIVE_HOME_URL)
            .header("accept-language", "zh-CN,zh;q=0.9,en;q=0.8")
            .header(COOKIE, format!("ttwid={ttwid}"))
            .send()
            .await?;
        let status = response.status();
        if !status.is_success() {
            return Err(DouyinError::Http(status.as_u16()));
        }
        read_text(response, MAX_HTML_RESPONSE_BYTES).await
    }

    async fn acquire_ttwid(&self) -> Result<String, DouyinError> {
        self.ttwid
            .get_or_fetch(Instant::now(), || self.fetch_ttwid())
            .await
    }

    async fn fetch_ttwid(&self) -> Result<String, DouyinError> {
        if let Ok(response) = self
            .http
            .get(LIVE_HOME_URL)
            .header(ACCEPT, "text/html,application/xhtml+xml")
            .header("accept-language", "zh-CN,zh;q=0.9,en;q=0.8")
            .send()
            .await
        {
            if response.status().is_success() {
                if let Some(ttwid) = parse_ttwid(response.headers()) {
                    return Ok(ttwid);
                }
            }
        }

        let response = self
            .http
            .post(TTWID_REGISTER_URL)
            .header(ACCEPT, "application/json, text/plain, */*")
            .header("origin", "https://www.douyin.com")
            .header(REFERER, "https://www.douyin.com/")
            .json(&json!({
                "region": "cn",
                "aid": 6383,
                "needFid": false,
                "service": "https://www.douyin.com",
                "union": true,
                "fid": ""
            }))
            .send()
            .await
            .map_err(|_| DouyinError::TtwidUnavailable)?;
        if !response.status().is_success() {
            return Err(DouyinError::TtwidUnavailable);
        }
        parse_ttwid(response.headers()).ok_or(DouyinError::TtwidUnavailable)
    }
}

#[derive(Default)]
struct TtwidCache {
    value: Mutex<Option<CachedTtwid>>,
}

struct CachedTtwid {
    value: String,
    expires_at: Instant,
}

struct CachedEnter {
    outcome: CachedEnterOutcome,
    expires_at: Instant,
}

enum CachedEnterOutcome {
    Success(Value),
    Failure(CachedEnterFailure),
}

impl CachedEnterOutcome {
    fn to_result(&self) -> Result<Value, DouyinError> {
        match self {
            Self::Success(root) => Ok(root.clone()),
            Self::Failure(error) => Err(error.to_error()),
        }
    }
}

#[derive(Clone, Copy)]
enum CachedEnterFailure {
    EmptyResponse,
    RoomNotFound,
    Api(i64),
}

impl CachedEnterFailure {
    fn from_error(error: &DouyinError) -> Option<Self> {
        match error {
            DouyinError::EmptyResponse => Some(Self::EmptyResponse),
            DouyinError::RoomNotFound => Some(Self::RoomNotFound),
            DouyinError::Api(30003) => Some(Self::Api(30003)),
            _ => None,
        }
    }

    fn to_error(self) -> DouyinError {
        match self {
            Self::EmptyResponse => DouyinError::EmptyResponse,
            Self::RoomNotFound => DouyinError::RoomNotFound,
            Self::Api(code) => DouyinError::Api(code),
        }
    }
}

struct CachedDiscovery {
    rooms: HashMap<String, mapper::DiscoveredRoom>,
    expires_at: Instant,
}

impl TtwidCache {
    async fn get_or_fetch<F, Fut>(&self, now: Instant, fetch: F) -> Result<String, DouyinError>
    where
        F: FnOnce() -> Fut + Send,
        Fut: Future<Output = Result<String, DouyinError>> + Send,
    {
        let mut cached = self.value.lock().await;
        if let Some(value) = cached.as_ref().filter(|value| now < value.expires_at) {
            return Ok(value.value.clone());
        }

        let value = fetch().await?;
        *cached = Some(CachedTtwid {
            value: value.clone(),
            expires_at: now + TTWID_CACHE_TTL,
        });
        Ok(value)
    }

    async fn invalidate_if(&self, expected: &str) {
        let mut cached = self.value.lock().await;
        if cached.as_ref().is_some_and(|value| value.value == expected) {
            *cached = None;
        }
    }
}

fn public_query(web_rid: &str) -> Vec<(&'static str, String)> {
    vec![
        ("aid", "6383".to_string()),
        ("app_name", "douyin_web".to_string()),
        ("live_id", "1".to_string()),
        ("device_platform", "web".to_string()),
        ("language", "zh-CN".to_string()),
        ("enter_from", "web_live".to_string()),
        ("cookie_enabled", "true".to_string()),
        ("screen_width", "1920".to_string()),
        ("screen_height", "1080".to_string()),
        ("browser_language", "zh-CN".to_string()),
        ("browser_platform", "Win32".to_string()),
        ("browser_name", "Chrome".to_string()),
        ("browser_version", "124.0.0.0".to_string()),
        ("web_rid", web_rid.to_string()),
    ]
}

fn validate_enter_response(root: &Value) -> Result<(), DouyinError> {
    let code = root
        .get("status_code")
        .and_then(value_i64)
        .ok_or_else(|| DouyinError::Invalid("missing enter status code".to_string()))?;
    match code {
        0 => {}
        4001038 => return Err(DouyinError::ContentUnavailable),
        10011 => return Err(DouyinError::RiskControl),
        code => return Err(DouyinError::Api(code)),
    }
    let rooms = root
        .pointer("/data/data")
        .and_then(Value::as_array)
        .ok_or_else(|| DouyinError::Invalid("missing enter room list".to_string()))?;
    if rooms.is_empty() {
        return Err(DouyinError::RoomNotFound);
    }
    Ok(())
}

fn discovery_fallback_applies(error: &DouyinError) -> bool {
    matches!(
        error,
        DouyinError::EmptyResponse | DouyinError::RoomNotFound | DouyinError::Api(30003)
    )
}

fn normalize_web_rid(value: &str) -> Result<String, DouyinError> {
    let value = value.trim();
    if value.is_empty()
        || value.len() > MAX_WEB_RID_LENGTH
        || !value.bytes().all(|byte| byte.is_ascii_digit())
        || value.bytes().all(|byte| byte == b'0')
    {
        return Err(DouyinError::RoomNotFound);
    }
    Ok(value.to_string())
}

fn parse_ttwid(headers: &HeaderMap) -> Option<String> {
    headers
        .get_all(reqwest::header::SET_COOKIE)
        .iter()
        .find_map(|value| {
            let value = value.to_str().ok()?;
            let (name, remainder) = value.split_once('=')?;
            if !name.trim().eq_ignore_ascii_case("ttwid") {
                return None;
            }
            let value = remainder.split(';').next()?.trim();
            (!value.is_empty()
                && value.len() <= MAX_TTWID_LENGTH
                && !value.chars().any(char::is_whitespace))
            .then(|| value.to_string())
        })
}

async fn read_json(response: Response, max_bytes: usize) -> Result<Value, DouyinError> {
    let bytes = read_limited_bytes(response, max_bytes).await?;
    if bytes.is_empty() {
        return Err(DouyinError::EmptyResponse);
    }
    serde_json::from_slice(&bytes)
        .map_err(|_| DouyinError::Invalid("invalid JSON response".to_string()))
}

async fn read_text(response: Response, max_bytes: usize) -> Result<String, DouyinError> {
    let bytes = read_limited_bytes(response, max_bytes).await?;
    if bytes.is_empty() {
        return Err(DouyinError::EmptyResponse);
    }
    String::from_utf8(bytes).map_err(|_| DouyinError::Invalid("invalid UTF-8 response".to_string()))
}

async fn read_limited_bytes(response: Response, max_bytes: usize) -> Result<Vec<u8>, DouyinError> {
    if response
        .content_length()
        .is_some_and(|length| length > max_bytes as u64)
    {
        return Err(DouyinError::Invalid(
            "response body is too large".to_string(),
        ));
    }
    let bytes = response.bytes().await?;
    if bytes.len() > max_bytes {
        return Err(DouyinError::Invalid(
            "response body is too large".to_string(),
        ));
    }
    Ok(bytes.to_vec())
}

fn value_i64(value: &Value) -> Option<i64> {
    value
        .as_i64()
        .or_else(|| value.as_str().and_then(|value| value.parse().ok()))
}

#[cfg(test)]
mod tests {
    use std::{
        collections::HashSet,
        sync::atomic::{AtomicUsize, Ordering},
    };

    use reqwest::header::{HeaderValue, SET_COOKIE};

    use super::*;

    async fn fetch_hls_media_segment(
        client: &DouyinClient,
        manifest_url: &str,
        manifest: Vec<u8>,
        request_headers: &HeaderMap,
    ) -> Result<(String, u64), String> {
        let mut current_url =
            reqwest::Url::parse(manifest_url).map_err(|_| "invalid HLS URL".to_string())?;
        let mut body = manifest;

        for _ in 0..3 {
            let text = String::from_utf8_lossy(&body);
            let uri = text
                .lines()
                .map(str::trim)
                .find(|line| !line.is_empty() && !line.starts_with('#'))
                .ok_or_else(|| "HLS playlist contained no media URI".to_string())?;
            current_url = current_url
                .join(uri)
                .map_err(|_| "invalid HLS media URL".to_string())?;
            let media_host = current_url.host_str().unwrap_or("<missing>").to_string();

            let response = client
                .media_response(current_url.as_str(), request_headers)
                .await
                .map_err(|error| {
                    format!("HLS media request failed at host={media_host}: {error}")
                })?;
            let status = response.status();
            if !status.is_success() {
                return Err(format!("HLS media returned HTTP {status}"));
            }
            let response_url = response.url().clone();
            let content_type = response
                .headers()
                .get(reqwest::header::CONTENT_TYPE)
                .and_then(|value| value.to_str().ok())
                .unwrap_or("<missing>")
                .to_string();
            body = response
                .bytes()
                .await
                .map_err(|error| format!("HLS media body failed: {error}"))?
                .to_vec();
            if body.starts_with(b"#EXTM3U") {
                current_url = response_url;
                continue;
            }
            if body.is_empty() {
                return Err("HLS media segment was empty".to_string());
            }
            if content_type.starts_with("text/html") {
                return Err("HLS media segment returned HTML".to_string());
            }
            return Ok((content_type, body.len() as u64));
        }

        Err("HLS playlist nesting exceeded the smoke-test limit".to_string())
    }

    #[test]
    fn public_query_contains_only_expected_enter_fields() {
        let query = public_query("123456");
        let keys = query.iter().map(|(key, _)| *key).collect::<HashSet<_>>();

        assert!(keys.contains("web_rid"));
        assert!(keys.contains("device_platform"));
        assert!(!keys.contains("a_bogus"));
        assert!(!keys.contains("msToken"));
        assert_eq!(
            query
                .iter()
                .find(|(key, _)| *key == "web_rid")
                .map(|(_, value)| value.as_str()),
            Some("123456")
        );
    }

    #[test]
    fn ttwid_cookie_is_extracted_without_other_cookies() {
        let mut headers = HeaderMap::new();
        headers.append(
            SET_COOKIE,
            HeaderValue::from_static("UIFID_TEMP=private; Path=/; Secure"),
        );
        headers.append(
            SET_COOKIE,
            HeaderValue::from_static("ttwid=fixture%7Cvalue; Domain=.douyin.com; Path=/"),
        );

        assert_eq!(parse_ttwid(&headers).as_deref(), Some("fixture%7Cvalue"));
    }

    #[test]
    fn web_rid_rejects_non_public_values() {
        assert_eq!(normalize_web_rid(" 123456 ").unwrap(), "123456");
        for value in ["", "0", "000", "12a34", "-1", "123/456"] {
            assert!(matches!(
                normalize_web_rid(value),
                Err(DouyinError::RoomNotFound)
            ));
        }
    }

    #[test]
    fn enter_response_distinguishes_unavailable_content_from_risk_control() {
        assert!(matches!(
            validate_enter_response(&json!({ "status_code": 4001038 })),
            Err(DouyinError::ContentUnavailable)
        ));
        assert!(matches!(
            validate_enter_response(&json!({ "status_code": 10011 })),
            Err(DouyinError::RiskControl)
        ));
    }

    #[test]
    fn discovery_fallback_only_covers_transient_enter_failures() {
        for error in [
            DouyinError::EmptyResponse,
            DouyinError::RoomNotFound,
            DouyinError::Api(30003),
        ] {
            assert!(discovery_fallback_applies(&error), "{error}");
        }
        for error in [
            DouyinError::ContentUnavailable,
            DouyinError::RiskControl,
            DouyinError::Http(503),
        ] {
            assert!(!discovery_fallback_applies(&error), "{error}");
        }
    }

    #[tokio::test]
    async fn ttwid_cache_coalesces_concurrent_fetches() {
        let cache = TtwidCache::default();
        let now = Instant::now();
        let calls = AtomicUsize::new(0);

        let (first, second) = tokio::join!(
            cache.get_or_fetch(now, || async {
                calls.fetch_add(1, Ordering::SeqCst);
                tokio::task::yield_now().await;
                Ok("fixture".to_string())
            }),
            cache.get_or_fetch(now, || async {
                calls.fetch_add(1, Ordering::SeqCst);
                tokio::task::yield_now().await;
                Ok("fixture".to_string())
            })
        );

        assert_eq!(first.unwrap(), "fixture");
        assert_eq!(second.unwrap(), "fixture");
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn ttwid_cache_hits_and_refreshes_after_expiry() {
        let cache = TtwidCache::default();
        let now = Instant::now();
        let calls = AtomicUsize::new(0);

        for at in [now, now + TTWID_CACHE_TTL / 2] {
            let value = cache
                .get_or_fetch(at, || async {
                    calls.fetch_add(1, Ordering::SeqCst);
                    Ok("first".to_string())
                })
                .await
                .unwrap();
            assert_eq!(value, "first");
        }
        assert_eq!(calls.load(Ordering::SeqCst), 1);

        let value = cache
            .get_or_fetch(now + TTWID_CACHE_TTL + Duration::from_secs(1), || async {
                calls.fetch_add(1, Ordering::SeqCst);
                Ok("second".to_string())
            })
            .await
            .unwrap();
        assert_eq!(value, "second");
        assert_eq!(calls.load(Ordering::SeqCst), 2);
    }

    #[tokio::test]
    async fn ttwid_failure_is_not_cached() {
        let cache = TtwidCache::default();
        let now = Instant::now();

        let error = cache
            .get_or_fetch(now, || async { Err(DouyinError::TtwidUnavailable) })
            .await;
        assert!(error.is_err());

        let value = cache
            .get_or_fetch(now, || async { Ok("recovered".to_string()) })
            .await
            .unwrap();
        assert_eq!(value, "recovered");
    }

    #[tokio::test]
    async fn enter_cache_keeps_rooms_independent() {
        let client = DouyinClient::new().unwrap();
        let first = json!({ "data": { "data": [{ "id_str": "first" }] } });
        let second = json!({ "data": { "data": [{ "id_str": "second" }] } });

        client
            .store_enter_result("100001", &Ok(first.clone()))
            .await;
        client
            .store_enter_result("100002", &Ok(second.clone()))
            .await;

        assert_eq!(client.cached_enter("100001").await.unwrap().unwrap(), first);
        assert_eq!(
            client.cached_enter("100002").await.unwrap().unwrap(),
            second
        );
        assert!(client.cached_enter("100003").await.is_none());
    }

    #[tokio::test]
    async fn enter_cache_shares_discovery_fallback_failures() {
        let client = DouyinClient::new().unwrap();
        client
            .store_enter_result("100001", &Err(DouyinError::Api(30003)))
            .await;
        client
            .store_enter_result("100002", &Err(DouyinError::Api(500)))
            .await;

        assert!(matches!(
            client.cached_enter("100001").await.unwrap(),
            Err(DouyinError::Api(30003))
        ));
        assert!(client.cached_enter("100002").await.is_none());
    }

    #[tokio::test]
    async fn enter_room_locks_are_shared_per_room_and_released() {
        let client = DouyinClient::new().unwrap();
        let first = client.enter_room_lock("100001").await;
        let same = client.enter_room_lock("100001").await;
        let other = client.enter_room_lock("100002").await;

        assert!(Arc::ptr_eq(&first, &same));
        assert!(!Arc::ptr_eq(&first, &other));

        drop(same);
        client.release_enter_room_lock("100001", &first).await;
        assert!(!client.enter_locks.lock().await.contains_key("100001"));

        client.release_enter_room_lock("100002", &other).await;
        assert!(client.enter_locks.lock().await.is_empty());
    }

    #[tokio::test]
    #[ignore = "requires live Douyin network access and a currently live public room"]
    async fn live_discovery_and_room_smoke() {
        let client = DouyinClient::new().expect("HTTP client");
        let discovery = client.discover().await.expect("live discovery");
        let rooms = discovery
            .sections
            .iter()
            .flat_map(|section| section.rooms.iter())
            .take(20)
            .collect::<Vec<_>>();
        let sample_count = rooms.len();
        assert!(
            rooms.len() >= 10,
            "Douyin discovery should provide a representative live sample"
        );
        assert!(
            rooms.iter().any(|room| room.cover_url.is_some()),
            "live discovery did not expose any cover URLs"
        );

        let mut info_ok = 0;
        let mut playback_ok = 0;
        let mut live_rooms = 0;
        let mut hls_manifest_ok = 0;
        let mut hls_media_ok = 0;
        let mut flv_ok = 0;
        let mut end_to_end = 0;
        for room in &rooms {
            let (info, playback) = tokio::join!(
                client.room_info(&room.room_id),
                client.room_playback(&room.room_id, 10_000)
            );
            let info = match info {
                Ok(info) => {
                    info_ok += 1;
                    info
                }
                Err(error) => {
                    eprintln!(
                        "sample room={} stage=info result=fail error={error}",
                        room.room_id
                    );
                    continue;
                }
            };
            let playback = match playback {
                Ok(playback) => {
                    playback_ok += 1;
                    playback
                }
                Err(error) => {
                    eprintln!(
                        "sample room={} stage=playback result=fail error={error}",
                        room.room_id
                    );
                    continue;
                }
            };
            if info.live_status != crate::domain::LiveStatus::Live {
                eprintln!(
                    "sample room={} stage=status result=skip status={:?}",
                    room.room_id, info.live_status
                );
                continue;
            }
            live_rooms += 1;
            let hls = playback
                .streams
                .iter()
                .find(|stream| stream.protocol == crate::domain::StreamProtocol::Hls);
            let flv = playback
                .streams
                .iter()
                .find(|stream| stream.protocol == crate::domain::StreamProtocol::Flv);
            let (Some(hls), Some(flv)) = (hls, flv) else {
                eprintln!(
                    "sample room={} stage=sources result=fail protocols={:?}",
                    room.room_id,
                    playback
                        .streams
                        .iter()
                        .map(|stream| stream.protocol)
                        .collect::<Vec<_>>()
                );
                continue;
            };

            let empty_headers = HeaderMap::new();
            let hls_response = match client.media_response(&hls.url, &empty_headers).await {
                Ok(response) if response.status().is_success() => response,
                Ok(response) => {
                    eprintln!(
                        "sample room={} stage=hls-manifest result=fail http={}",
                        room.room_id,
                        response.status()
                    );
                    continue;
                }
                Err(error) => {
                    eprintln!(
                        "sample room={} stage=hls-manifest result=fail error={error}",
                        room.room_id
                    );
                    continue;
                }
            };
            let hls_body = hls_response.bytes().await.expect("HLS manifest body");
            if !hls_body.starts_with(b"#EXTM3U") {
                eprintln!(
                    "sample room={} stage=hls-manifest result=fail bytes={}",
                    room.room_id,
                    hls_body.len()
                );
                continue;
            }
            hls_manifest_ok += 1;
            let (media_content_type, media_length) =
                match fetch_hls_media_segment(&client, &hls.url, hls_body.to_vec(), &empty_headers)
                    .await
                {
                    Ok(media) => media,
                    Err(error) => {
                        eprintln!(
                            "sample room={} stage=hls-media result=fail error={error}",
                            room.room_id
                        );
                        continue;
                    }
                };
            hls_media_ok += 1;
            let flv_response = match client.media_response(&flv.url, &empty_headers).await {
                Ok(response) if response.status().is_success() => response,
                Ok(response) => {
                    eprintln!(
                        "sample room={} stage=flv result=fail http={}",
                        room.room_id,
                        response.status()
                    );
                    continue;
                }
                Err(error) => {
                    eprintln!(
                        "sample room={} stage=flv result=fail error={error}",
                        room.room_id
                    );
                    continue;
                }
            };
            let flv_content_type = flv_response
                .headers()
                .get(reqwest::header::CONTENT_TYPE)
                .and_then(|value| value.to_str().ok());
            if flv_content_type.is_some_and(|value| value.contains("video/x-flv")) {
                flv_ok += 1;
                end_to_end += 1;
                eprintln!(
                    "sample room={} stage=end-to-end result=pass hls_type={media_content_type:?} hls_bytes={media_length}",
                    room.room_id
                );
            } else {
                eprintln!(
                    "sample room={} stage=flv result=fail content_type={flv_content_type:?}",
                    room.room_id
                );
            }
        }
        eprintln!(
            "sample summary rooms={} info_ok={info_ok} playback_ok={playback_ok} live={live_rooms} hls_manifest_ok={hls_manifest_ok} hls_media_ok={hls_media_ok} flv_ok={flv_ok} end_to_end={end_to_end}",
            sample_count
        );
        assert!(
            end_to_end > 0,
            "no live room yielded a complete HLS and FLV media chain"
        );
    }
}
