use std::{
    future::Future,
    time::{Duration, Instant},
};

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
        })
    }

    pub(crate) async fn discover(&self) -> Result<LiveDiscovery, DouyinError> {
        let category = self
            .get_ttwid_page(LIVE_CATEGORY_URL, "text/html,application/xhtml+xml")
            .await;
        if let Ok(html) = category {
            if let Ok(discovery) = mapper::parse_discovery(&html) {
                return Ok(discovery);
            }
        }

        let homepage = self
            .get_ttwid_page(LIVE_HOME_URL, "text/html,application/xhtml+xml")
            .await?;
        mapper::parse_discovery(&homepage)
    }

    pub(crate) async fn room_info(&self, room_id: &str) -> Result<LiveRoomInfo, DouyinError> {
        let web_rid = normalize_web_rid(room_id)?;
        let root = self.enter_room(&web_rid).await?;
        mapper::parse_room_info(&root, &web_rid)
    }

    pub(crate) async fn room_playback(
        &self,
        room_id: &str,
        quality: i64,
    ) -> Result<LivePlaybackInfo, DouyinError> {
        let web_rid = normalize_web_rid(room_id)?;
        let root = self.enter_room(&web_rid).await?;
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
    #[ignore = "requires live Douyin network access and a currently live public room"]
    async fn live_discovery_and_room_smoke() {
        let client = DouyinClient::new().expect("HTTP client");
        let discovery = client.discover().await.expect("live discovery");
        let rooms = discovery
            .sections
            .iter()
            .flat_map(|section| section.rooms.iter())
            .take(5)
            .collect::<Vec<_>>();
        assert!(!rooms.is_empty());
        assert!(
            rooms.iter().any(|room| room.cover_url.is_some()),
            "live discovery did not expose any cover URLs"
        );

        let mut checked = 0;
        for room in rooms {
            let info = match client.room_info(&room.room_id).await {
                Ok(info) => info,
                Err(error) => {
                    eprintln!("room {} info failed: {error}", room.room_id);
                    continue;
                }
            };
            let playback = match client.room_playback(&room.room_id, 10_000).await {
                Ok(playback) => playback,
                Err(error) => {
                    eprintln!("room {} playback failed: {error}", room.room_id);
                    continue;
                }
            };
            if info.live_status != crate::domain::LiveStatus::Live {
                eprintln!("room {} is not live: {:?}", room.room_id, info.live_status);
                continue;
            }
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
                    "room {} is missing HLS or FLV; protocols={:?}",
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
                        "room {} HLS returned HTTP {}",
                        room.room_id,
                        response.status()
                    );
                    continue;
                }
                Err(error) => {
                    eprintln!("room {} HLS request failed: {error}", room.room_id);
                    continue;
                }
            };
            let hls_body = hls_response.bytes().await.expect("HLS manifest body");
            if !hls_body.starts_with(b"#EXTM3U") {
                eprintln!(
                    "room {} HLS body was not a manifest ({} bytes)",
                    room.room_id,
                    hls_body.len()
                );
                continue;
            }
            let (media_content_type, media_length) =
                match fetch_hls_media_segment(&client, &hls.url, hls_body.to_vec(), &empty_headers)
                    .await
                {
                    Ok(media) => media,
                    Err(error) => {
                        eprintln!("room {} HLS media validation failed: {error}", room.room_id);
                        continue;
                    }
                };
            let flv_response = match client.media_response(&flv.url, &empty_headers).await {
                Ok(response) if response.status().is_success() => response,
                Ok(response) => {
                    eprintln!(
                        "room {} FLV returned HTTP {}",
                        room.room_id,
                        response.status()
                    );
                    continue;
                }
                Err(error) => {
                    eprintln!("room {} FLV request failed: {error}", room.room_id);
                    continue;
                }
            };
            let flv_content_type = flv_response
                .headers()
                .get(reqwest::header::CONTENT_TYPE)
                .and_then(|value| value.to_str().ok());
            if flv_content_type.is_some_and(|value| value.contains("video/x-flv")) {
                eprintln!(
                    "room {} HLS media passed content_type={media_content_type:?} bytes={media_length}",
                    room.room_id
                );
                checked += 1;
                break;
            }
            eprintln!(
                "room {} FLV content type was {:?}",
                room.room_id, flv_content_type
            );
        }
        assert!(checked > 0, "no live room yielded HLS and FLV sources");
    }
}
