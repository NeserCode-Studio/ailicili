use crate::domain::{
    PagedVideos, PlaybackInfo, QualityNotice, QualityNoticeKind, QualityOption, StreamProtocol,
    StreamSource, VideoCard, VideoDetail, VideoPage, VideoStats,
};
use crate::{
    account::{SessionCookies, SharedSession},
    device::DeviceManager,
    wbi,
};
use log::{info, warn};
use reqwest::header::HeaderMap;
use serde_json::Value;
use std::{
    collections::BTreeSet,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const API_BASE: &str = "https://api.bilibili.com";
const PASSPORT_BASE: &str = "https://passport.bilibili.com";
const BILIBILI_WEB_URL: &str = "https://www.bilibili.com";
const WBI_CACHE_TTL: Duration = Duration::from_secs(12 * 60 * 60);

#[derive(Debug, thiserror::Error)]
pub enum BiliError {
    #[error("network: {0}")]
    Network(#[from] reqwest::Error),
    #[error("api code {code}: {message}")]
    Api { code: i64, message: String },
    #[error("invalid response: {0}")]
    Invalid(String),
    #[error("authentication required")]
    AuthRequired,
    #[error("login expired")]
    LoginExpired,
    #[error("rate limited")]
    RateLimited,
    #[error("no compatible stream")]
    NoCompatibleStream,
    #[error("credential store locked")]
    CredentialLocked,
    #[error("credential store: {0}")]
    CredentialStore(String),
    #[error("storage: {0}")]
    Storage(String),
}

#[derive(Clone)]
pub struct BilibiliClient {
    http: reqwest::Client,
    session: SharedSession,
    device: Arc<DeviceManager>,
    wbi_cache: Arc<Mutex<Option<WbiCache>>>,
}

#[derive(Debug, Clone)]
struct WbiCache {
    mixin_key: String,
    expires_at: Instant,
}

impl BilibiliClient {
    pub fn new(session: SharedSession) -> Result<Self, BiliError> {
        let http = reqwest::Client::builder()
            .user_agent(USER_AGENT)
            .timeout(Duration::from_secs(15))
            .redirect(reqwest::redirect::Policy::none())
            .build()?;
        let device = DeviceManager::new(http.clone())?;
        Ok(Self {
            http,
            session,
            device: Arc::new(device),
            wbi_cache: Arc::new(Mutex::new(None)),
        })
    }

    pub fn reset_device_identity(&self) -> Result<(), BiliError> {
        self.device.reset()?;
        info!(target: "Bilibili", "device identity reset");
        Ok(())
    }

    async fn get_json(&self, path: &str, query: &[(&str, String)]) -> Result<Value, BiliError> {
        let session = self.session_snapshot()?;
        let query = query
            .iter()
            .map(|(key, value)| ((*key).to_string(), value.clone()))
            .collect::<Vec<_>>();
        let root = self.api_root(path, &query, session.as_ref()).await?;
        ensure_api_success(&root)?;
        Ok(root)
    }

    async fn api_root(
        &self,
        path: &str,
        query: &[(String, String)],
        session: Option<&SessionCookies>,
    ) -> Result<Value, BiliError> {
        let cookie = self.cookie_header(session).await;
        let mut request = self
            .http
            .get(format!("{API_BASE}{path}"))
            .header("referer", "https://www.bilibili.com/")
            .header("origin", "https://www.bilibili.com")
            .query(query);
        if !cookie.is_empty() {
            request = request.header("cookie", cookie);
        }
        let response = request.send().await?;
        let status = response.status();
        if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
            return Err(BiliError::RateLimited);
        }
        let root: Value = response
            .json()
            .await
            .map_err(|_| BiliError::Invalid("invalid JSON response".to_string()))?;
        Ok(root)
    }

    async fn wbi_json(&self, path: &str, query: Vec<(String, String)>) -> Result<Value, BiliError> {
        let session = self.session_snapshot()?;
        let mut key = self.wbi_mixin_key(false, session.as_ref()).await?;
        let timestamp = chrono::Utc::now().timestamp().max(0) as u64;
        let signed = wbi::sign_params(query.clone(), &key, timestamp);
        let first = self
            .api_root(path, &signed, session.as_ref())
            .await
            .and_then(ensure_wbi_success);
        match first {
            Ok(root) => Ok(root),
            Err(BiliError::Api { code: -352, .. }) => {
                warn!(target: "Bilibili", "WBI rejected, refreshing key once");
                key = self.wbi_mixin_key(true, session.as_ref()).await?;
                let timestamp = chrono::Utc::now().timestamp().max(0) as u64;
                let signed = wbi::sign_params(query, &key, timestamp);
                self.api_root(path, &signed, session.as_ref())
                    .await
                    .and_then(ensure_wbi_success)
            }
            Err(err) => Err(err),
        }
    }

    async fn wbi_mixin_key(
        &self,
        force_refresh: bool,
        session: Option<&SessionCookies>,
    ) -> Result<String, BiliError> {
        if !force_refresh {
            if let Some(key) = self.cached_wbi_key()? {
                return Ok(key);
            }
        }

        let root = self.api_root("/x/web-interface/nav", &[], session).await?;
        match root.get("code").and_then(Value::as_i64) {
            Some(0) | Some(-101) => {}
            Some(-412) => return Err(BiliError::RateLimited),
            Some(-352) => {
                return Err(BiliError::Api {
                    code: -352,
                    message: "WBI verification failed".to_string(),
                })
            }
            Some(_) => return Err(api_error(&root)),
            None => return Err(BiliError::Invalid("missing nav code".to_string())),
        }
        let img_url = root
            .pointer("/data/wbi_img/img_url")
            .and_then(Value::as_str)
            .ok_or_else(|| BiliError::Invalid("missing WBI img URL".to_string()))?;
        let sub_url = root
            .pointer("/data/wbi_img/sub_url")
            .and_then(Value::as_str)
            .ok_or_else(|| BiliError::Invalid("missing WBI sub URL".to_string()))?;
        let img_key = wbi::extract_key_stem(img_url)
            .ok_or_else(|| BiliError::Invalid("invalid WBI img key".to_string()))?;
        let sub_key = wbi::extract_key_stem(sub_url)
            .ok_or_else(|| BiliError::Invalid("invalid WBI sub key".to_string()))?;
        let mixin_key = wbi::mixin_key(&img_key, &sub_key)
            .ok_or_else(|| BiliError::Invalid("invalid WBI mixin key".to_string()))?;
        *self
            .wbi_cache
            .lock()
            .map_err(|_| BiliError::Storage("WBI cache lock poisoned".to_string()))? =
            Some(WbiCache {
                mixin_key: mixin_key.clone(),
                expires_at: Instant::now() + WBI_CACHE_TTL,
            });
        info!(target: "Bilibili", "WBI key refreshed");
        Ok(mixin_key)
    }

    fn cached_wbi_key(&self) -> Result<Option<String>, BiliError> {
        let cache = self
            .wbi_cache
            .lock()
            .map_err(|_| BiliError::Storage("WBI cache lock poisoned".to_string()))?;
        Ok(cache
            .as_ref()
            .filter(|cache| cache.expires_at > Instant::now())
            .map(|cache| cache.mixin_key.clone()))
    }

    pub(crate) async fn qr_generate(&self) -> Result<Value, BiliError> {
        self.passport_get_json("/x/passport-login/web/qrcode/generate", &[])
            .await
    }

    pub(crate) async fn qr_poll(&self, qrcode_key: &str) -> Result<(HeaderMap, Value), BiliError> {
        let (headers, root) = self
            .passport_get(
                "/x/passport-login/web/qrcode/poll",
                &[("qrcode_key".to_string(), qrcode_key.to_string())],
            )
            .await?;
        ensure_api_success(&root)?;
        Ok((headers, root))
    }

    pub(crate) async fn sms_captcha(&self) -> Result<Value, BiliError> {
        self.passport_get_json(
            "/x/passport-login/captcha",
            &[("source".to_string(), "main_web".to_string())],
        )
        .await
    }

    pub(crate) async fn send_sms_code(
        &self,
        country_code: &str,
        phone: &str,
        token: &str,
        challenge: &str,
        validate: &str,
        seccode: &str,
    ) -> Result<Value, BiliError> {
        let form = sms_send_form(country_code, phone, token, challenge, validate, seccode);
        self.passport_post_json("/x/passport-login/web/sms/send", &form)
            .await
    }

    pub(crate) async fn login_with_sms(
        &self,
        country_code: &str,
        phone: &str,
        code: &str,
        captcha_key: &str,
    ) -> Result<(HeaderMap, Value), BiliError> {
        let form = sms_login_form(country_code, phone, code, captcha_key);
        self.passport_post("/x/passport-login/web/login/sms", &form)
            .await
    }

    pub(crate) async fn account_profile(
        &self,
        session: &SessionCookies,
    ) -> Result<crate::domain::AccountProfile, BiliError> {
        let root = self
            .api_root("/x/web-interface/nav", &[], Some(session))
            .await?;
        let code = root.get("code").and_then(Value::as_i64).unwrap_or(-1);
        let is_login = root
            .pointer("/data/isLogin")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        if code == -101 || !is_login {
            return Err(BiliError::LoginExpired);
        }
        if code != 0 {
            return Err(api_error(&root));
        }
        let data = root
            .get("data")
            .ok_or_else(|| BiliError::Invalid("missing nav data".to_string()))?;
        let mid = data
            .get("mid")
            .and_then(Value::as_i64)
            .ok_or_else(|| BiliError::Invalid("missing account mid".to_string()))?;
        let name = data
            .get("uname")
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| BiliError::Invalid("missing account name".to_string()))?;
        Ok(crate::domain::AccountProfile {
            mid,
            name: name.to_string(),
            avatar_url: data
                .get("face")
                .and_then(Value::as_str)
                .filter(|value| !value.is_empty())
                .map(normalize_url),
            level: data
                .pointer("/level_info/current_level")
                .and_then(Value::as_i64),
            vip: data
                .pointer("/vipStatus")
                .and_then(Value::as_i64)
                .is_some_and(|status| status > 0),
        })
    }

    async fn passport_get_json(
        &self,
        path: &str,
        query: &[(String, String)],
    ) -> Result<Value, BiliError> {
        let (_, root) = self.passport_get(path, query).await?;
        ensure_api_success(&root)?;
        Ok(root)
    }

    async fn passport_get(
        &self,
        path: &str,
        query: &[(String, String)],
    ) -> Result<(HeaderMap, Value), BiliError> {
        let request_shape = request_shape(
            query
                .iter()
                .map(|(key, value)| (key.as_str(), value.as_str())),
        );
        let cookie = self.cookie_header(None).await;
        info!(
            target: "Bilibili/AuthApi",
            "passport request method=GET path={path} fields=[{request_shape}] cookie_present={} user_agent=true referer=true origin=true",
            !cookie.is_empty(),
        );
        let mut request = self
            .http
            .get(format!("{PASSPORT_BASE}{path}"))
            .header("referer", "https://www.bilibili.com/")
            .header("origin", "https://www.bilibili.com")
            .query(query);
        if !cookie.is_empty() {
            request = request.header("cookie", cookie);
        }
        let response = request.send().await.map_err(|error| {
            log_passport_network_error("GET", path, &error);
            BiliError::Network(error)
        })?;
        let status = response.status();
        let headers = response.headers().clone();
        let content_type = header_value(&headers, "content-type");
        if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
            let response_cookie_names = cookie_names(&headers);
            info!(
                target: "Bilibili/AuthApi",
                "passport response method=GET path={path} http_status={} http_reason={:?} api_code=rate_limited fields=[{request_shape}] content_type={content_type:?} set_cookie_count={} cookie_names={response_cookie_names:?} body_read=false",
                status.as_u16(),
                status.canonical_reason().unwrap_or("unknown"),
                headers.get_all(reqwest::header::SET_COOKIE).iter().count(),
            );
            return Err(BiliError::RateLimited);
        }
        let body = response.text().await.map_err(|error| {
            log_passport_body_error("GET", path, status, &error);
            BiliError::Network(error)
        })?;
        let root: Value = serde_json::from_str(&body).map_err(|_| {
            log_passport_parse_error("GET", path, status, &content_type, body.len());
            BiliError::Invalid("invalid JSON response".to_string())
        })?;
        log_passport_response(
            "GET",
            path,
            status,
            &request_shape,
            &content_type,
            body.len(),
            &headers,
            &root,
        );
        Ok((headers, root))
    }

    async fn passport_post_json(
        &self,
        path: &str,
        form: &[(&str, &str)],
    ) -> Result<Value, BiliError> {
        let (_, root) = self.passport_post(path, form).await?;
        ensure_api_success(&root)?;
        Ok(root)
    }

    async fn passport_post(
        &self,
        path: &str,
        form: &[(&str, &str)],
    ) -> Result<(HeaderMap, Value), BiliError> {
        let request_shape = request_shape(form.iter().copied());
        let cookie = self.cookie_header(None).await;
        info!(
            target: "Bilibili/AuthApi",
            "passport request method=POST path={path} fields=[{request_shape}] cookie_present={} user_agent=true referer=true origin=true content_type=application/x-www-form-urlencoded",
            !cookie.is_empty(),
        );
        let mut request = self
            .http
            .post(format!("{PASSPORT_BASE}{path}"))
            .header("referer", "https://www.bilibili.com/")
            .header("origin", "https://www.bilibili.com")
            .form(form);
        if !cookie.is_empty() {
            request = request.header("cookie", cookie);
        }
        let response = request.send().await.map_err(|error| {
            log_passport_network_error("POST", path, &error);
            BiliError::Network(error)
        })?;
        let status = response.status();
        let headers = response.headers().clone();
        let content_type = header_value(&headers, "content-type");
        if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
            let response_cookie_names = cookie_names(&headers);
            info!(
                target: "Bilibili/AuthApi",
                "passport response method=POST path={path} http_status={} http_reason={:?} api_code=rate_limited fields=[{request_shape}] content_type={content_type:?} set_cookie_count={} cookie_names={response_cookie_names:?} body_read=false",
                status.as_u16(),
                status.canonical_reason().unwrap_or("unknown"),
                headers.get_all(reqwest::header::SET_COOKIE).iter().count(),
            );
            return Err(BiliError::RateLimited);
        }
        let body = response.text().await.map_err(|error| {
            log_passport_body_error("POST", path, status, &error);
            BiliError::Network(error)
        })?;
        let root: Value = serde_json::from_str(&body).map_err(|_| {
            log_passport_parse_error("POST", path, status, &content_type, body.len());
            BiliError::Invalid("invalid JSON response".to_string())
        })?;
        log_passport_response(
            "POST",
            path,
            status,
            &request_shape,
            &content_type,
            body.len(),
            &headers,
            &root,
        );
        if root.get("code").and_then(Value::as_i64).unwrap_or_default() != 0 {
            return Err(api_error(&root));
        }
        Ok((headers, root))
    }

    async fn cookie_header(&self, session: Option<&SessionCookies>) -> String {
        let mut parts = Vec::new();
        match self.device.ensure_identity().await {
            Ok(Some(identity)) => {
                parts.push(format!("buvid3={}", identity.buvid3));
                parts.push(format!("buvid4={}", identity.buvid4));
            }
            Ok(None) => {}
            Err(err) => {
                warn!(
                    target: "Bilibili",
                    "device identity unavailable code={}",
                    error_code(&err),
                );
            }
        }
        if let Some(session) = session {
            let session_cookie = session.cookie_header();
            if !session_cookie.is_empty() {
                parts.push(session_cookie);
            }
        }
        parts.join("; ")
    }

    fn session_snapshot(&self) -> Result<Option<SessionCookies>, BiliError> {
        self.session
            .read()
            .map(|session| session.clone())
            .map_err(|_| BiliError::Storage("session lock poisoned".to_string()))
    }

    pub async fn popular(&self, page: u32) -> Result<PagedVideos, BiliError> {
        let root = self
            .get_json(
                "/x/web-interface/popular",
                &[("ps", "20".to_string()), ("pn", page.to_string())],
            )
            .await?;
        let items = root
            .pointer("/data/list")
            .and_then(Value::as_array)
            .ok_or_else(|| BiliError::Invalid("missing popular list".to_string()))?
            .iter()
            .filter_map(parse_card)
            .collect::<Vec<_>>();
        let has_more = items.len() == 20;
        Ok(PagedVideos {
            page,
            items,
            has_more,
        })
    }

    pub async fn video_detail(&self, video_id: &str) -> Result<VideoDetail, BiliError> {
        let root = self
            .get_json("/x/web-interface/view", &[("bvid", video_id.to_string())])
            .await?;
        let data = root
            .get("data")
            .ok_or_else(|| BiliError::Invalid("missing detail data".to_string()))?;
        let mut card = parse_card(data)
            .ok_or_else(|| BiliError::Invalid("invalid detail card".to_string()))?;
        card.source_kind = "detail".to_string();
        let mut pages = data
            .get("pages")
            .and_then(Value::as_array)
            .map(|pages| {
                pages
                    .iter()
                    .filter_map(|page| {
                        let cid = page.get("cid")?.as_i64()?;
                        Some(VideoPage {
                            page_index: page.get("page").and_then(Value::as_u64).unwrap_or_default()
                                as u32,
                            cid,
                            title: page
                                .get("part")
                                .and_then(Value::as_str)
                                .or_else(|| page.get("title").and_then(Value::as_str))
                                .unwrap_or_default()
                                .to_string(),
                            duration: page.get("duration").and_then(Value::as_i64),
                        })
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();

        if pages.is_empty() {
            if let Some(cid) = card.cid {
                pages.push(VideoPage {
                    page_index: 1,
                    cid,
                    title: card.title.clone(),
                    duration: card.duration,
                });
            }
        }

        if pages.is_empty() {
            return Err(BiliError::Invalid(
                "detail has no playable page".to_string(),
            ));
        }

        Ok(VideoDetail {
            card,
            description: data
                .get("desc")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            pages,
        })
    }

    pub async fn search(&self, keyword: &str, page: u32) -> Result<PagedVideos, BiliError> {
        let root = self
            .get_json(
                "/x/web-interface/search/type",
                &[
                    ("search_type", "video".to_string()),
                    ("keyword", keyword.to_string()),
                    ("page", page.to_string()),
                    ("page_size", "20".to_string()),
                ],
            )
            .await?;
        let mut items = root
            .pointer("/data/result")
            .and_then(Value::as_array)
            .ok_or_else(|| BiliError::Invalid("missing search result".to_string()))?
            .iter()
            .filter_map(parse_search_card)
            .collect::<Vec<_>>();
        for item in &mut items {
            item.source_kind = "search".to_string();
        }
        let has_more = items.len() == 20;
        Ok(PagedVideos {
            page,
            items,
            has_more,
        })
    }

    pub async fn video_playback(
        &self,
        video_id: &str,
        cid: i64,
        quality: i64,
    ) -> Result<PlaybackInfo, BiliError> {
        let mut query = vec![
            ("cid".to_string(), cid.to_string()),
            ("qn".to_string(), quality.to_string()),
            ("fnval".to_string(), "1".to_string()),
            ("fnver".to_string(), "0".to_string()),
            ("fourk".to_string(), "1".to_string()),
            ("platform".to_string(), "html5".to_string()),
        ];
        if let Some(stripped) = video_id.strip_prefix("av") {
            query.push(("aid".to_string(), stripped.to_string()));
        } else {
            query.push(("bvid".to_string(), video_id.to_string()));
        }
        let root = self.wbi_json("/x/player/wbi/playurl", query).await?;
        let data = root
            .get("data")
            .ok_or_else(|| BiliError::Invalid("missing playback data".to_string()))?;
        let duration_ms = data
            .get("timelength")
            .and_then(Value::as_i64)
            .unwrap_or_default();
        let quality_id = data
            .get("quality")
            .and_then(Value::as_i64)
            .unwrap_or_default();
        let mut streams = Vec::new();
        let mut durl_count = 0;

        if let Some(durl) = data.get("durl").and_then(Value::as_array) {
            durl_count = durl.len();
            for (index, item) in durl.iter().enumerate() {
                let mut urls = Vec::new();
                if let Some(url) = item.get("url").and_then(Value::as_str) {
                    urls.push(url);
                }
                if let Some(backups) = item.get("backup_url").and_then(Value::as_array) {
                    urls.extend(backups.iter().filter_map(Value::as_str));
                }

                for (variant, url) in urls
                    .into_iter()
                    .map(normalize_url)
                    .filter(|url| !url.is_empty())
                    .enumerate()
                {
                    if streams
                        .iter()
                        .any(|stream: &StreamSource| stream.url == url)
                    {
                        continue;
                    }
                    streams.push(StreamSource {
                        id: if variant == 0 {
                            format!("mp4-{index}")
                        } else {
                            format!("mp4-{index}-fallback-{variant}")
                        },
                        protocol: StreamProtocol::Mp4,
                        url,
                        quality_id,
                        quality_label: quality_label(quality_id),
                        audio_url: None,
                        codec: Some("mp4".to_string()),
                    });
                }
            }
        }

        if streams.is_empty() {
            return Err(BiliError::NoCompatibleStream);
        }
        let advertised_qualities = parse_advertised_qualities(data);
        let logged_in = self
            .session_snapshot()?
            .as_ref()
            .is_some_and(SessionCookies::is_authenticated);
        let highest_advertised = advertised_qualities
            .iter()
            .map(|quality| quality.id)
            .max()
            .unwrap_or(quality_id);
        let quality_notice = if !logged_in {
            QualityNotice {
                kind: QualityNoticeKind::LoginRequired,
                message_code: "loginForHigherQuality".to_string(),
            }
        } else if quality_id < highest_advertised {
            QualityNotice {
                kind: QualityNoticeKind::QualityUnavailable,
                message_code: "dashRequiredForHigherQuality".to_string(),
            }
        } else {
            QualityNotice {
                kind: QualityNoticeKind::None,
                message_code: "none".to_string(),
            }
        };
        info!(
            target: "Bilibili",
            "playback loaded video={video_id} cid={cid} qn={quality} quality={quality_id} durl={durl_count} sources={} logged_in={logged_in}",
            streams.len(),
        );

        Ok(PlaybackInfo {
            video_id: video_id.to_string(),
            cid,
            duration_ms,
            streams,
            current_quality: QualityOption {
                id: quality_id,
                label: quality_label(quality_id),
            },
            advertised_qualities,
            quality_notice,
        })
    }
}

fn sms_send_form<'a>(
    country_code: &'a str,
    phone: &'a str,
    token: &'a str,
    challenge: &'a str,
    validate: &'a str,
    seccode: &'a str,
) -> [(&'static str, &'a str); 8] {
    [
        ("cid", country_code),
        ("tel", phone),
        ("source", "main_web"),
        ("token", token),
        ("challenge", challenge),
        ("validate", validate),
        ("seccode", seccode),
        ("go_url", BILIBILI_WEB_URL),
    ]
}

fn sms_login_form<'a>(
    country_code: &'a str,
    phone: &'a str,
    code: &'a str,
    captcha_key: &'a str,
) -> [(&'static str, &'a str); 6] {
    [
        ("cid", country_code),
        ("tel", phone),
        ("code", code),
        ("source", "main_web"),
        ("captcha_key", captcha_key),
        ("go_url", BILIBILI_WEB_URL),
    ]
}

fn request_shape<'a>(fields: impl IntoIterator<Item = (&'a str, &'a str)>) -> String {
    fields
        .into_iter()
        .map(|(key, value)| format!("{key}:len={}", value.len()))
        .collect::<Vec<_>>()
        .join(",")
}

fn log_passport_response(
    method: &str,
    path: &str,
    status: reqwest::StatusCode,
    request_shape: &str,
    content_type: &str,
    body_length: usize,
    headers: &HeaderMap,
    root: &Value,
) {
    let api_code = root
        .get("code")
        .and_then(Value::as_i64)
        .map(|code| code.to_string())
        .unwrap_or_else(|| "missing".to_string());
    let message = root.get("message").and_then(Value::as_str);
    let response_shape = json_shape(root);
    let response_header_names = header_names(headers);
    let response_cookie_names = cookie_names(headers);
    let set_cookie_count = headers.get_all(reqwest::header::SET_COOKIE).iter().count();
    info!(
        target: "Bilibili/AuthApi",
        "passport response method={method} path={path} http_status={} http_reason={:?} api_code={api_code} request_fields=[{request_shape}] content_type={content_type:?} body_length={body_length} message_present={} message_length={} set_cookie_count={set_cookie_count} cookie_names={response_cookie_names:?} header_names={response_header_names:?} response_shape={response_shape}",
        status.as_u16(),
        status.canonical_reason().unwrap_or("unknown"),
        message.is_some(),
        message.map(str::len).unwrap_or_default(),
    );
}

fn header_value(headers: &HeaderMap, name: &str) -> String {
    headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("<missing>")
        .to_string()
}

fn header_names(headers: &HeaderMap) -> Vec<String> {
    headers
        .keys()
        .map(|name| name.as_str().to_string())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
}

fn cookie_names(headers: &HeaderMap) -> Vec<String> {
    headers
        .get_all(reqwest::header::SET_COOKIE)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .filter_map(|value| value.split(';').next())
        .filter_map(|cookie| cookie.split_once('=').map(|(name, _)| name.trim()))
        .filter(|name| !name.is_empty())
        .map(ToOwned::to_owned)
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
}

fn json_shape(value: &Value) -> String {
    let mut output = String::new();
    append_json_shape(value, "", 0, &mut output);
    output
}

fn append_json_shape(value: &Value, key: &str, depth: usize, output: &mut String) {
    if depth > 6 {
        output.push_str("<depth-limit>");
        return;
    }

    match value {
        Value::Null => output.push_str("null"),
        Value::Bool(value) if is_safe_diagnostic_key(key) => {
            output.push_str("bool(");
            output.push_str(if *value { "true" } else { "false" });
            output.push(')');
        }
        Value::Bool(_) => output.push_str("bool"),
        Value::Number(value) if is_safe_diagnostic_key(key) => {
            output.push_str("number(");
            output.push_str(&value.to_string());
            output.push(')');
        }
        Value::Number(_) => output.push_str("number"),
        Value::String(value) if is_safe_diagnostic_key(key) => {
            output.push_str("string(");
            output.push_str(&safe_enum_value(value));
            output.push(')');
        }
        Value::String(value) => {
            output.push_str("string(len=");
            output.push_str(&value.len().to_string());
            output.push(')');
        }
        Value::Array(values) => {
            output.push_str("array(len=");
            output.push_str(&values.len().to_string());
            output.push_str(")[");
            for (index, item) in values.iter().take(3).enumerate() {
                if index > 0 {
                    output.push(',');
                }
                append_json_shape(item, "", depth + 1, output);
            }
            if values.len() > 3 {
                output.push_str(", ...");
            }
            output.push(']');
        }
        Value::Object(object) => {
            output.push('{');
            let mut entries = object.iter().collect::<Vec<_>>();
            entries.sort_by(|left, right| left.0.cmp(right.0));
            for (index, (key, value)) in entries.iter().take(64).enumerate() {
                if index > 0 {
                    output.push(',');
                }
                output.push_str(key);
                output.push(':');
                append_json_shape(value, key, depth + 1, output);
            }
            if entries.len() > 64 {
                output.push_str(", ...");
            }
            output.push('}');
        }
    }
}

fn is_safe_diagnostic_key(key: &str) -> bool {
    matches!(
        key,
        "code" | "type" | "status" | "status_code" | "ttl" | "isLogin" | "is_new"
    )
}

fn safe_enum_value(value: &str) -> String {
    let mut output = value
        .chars()
        .take(32)
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.') {
                character
            } else {
                '?'
            }
        })
        .collect::<String>();
    if value.chars().count() > 32 {
        output.push_str("...");
    }
    output
}

fn log_passport_network_error(method: &str, path: &str, error: &reqwest::Error) {
    warn!(
        target: "Bilibili/AuthApi",
        "passport network error method={method} path={path} timeout={} connect={} request={} body={} decode={} http_status={:?}",
        error.is_timeout(),
        error.is_connect(),
        error.is_request(),
        error.is_body(),
        error.is_decode(),
        error.status().map(|status| status.as_u16()),
    );
}

fn log_passport_body_error(
    method: &str,
    path: &str,
    status: reqwest::StatusCode,
    error: &reqwest::Error,
) {
    warn!(
        target: "Bilibili/AuthApi",
        "passport body read error method={method} path={path} http_status={} timeout={} connect={} body={} decode={}",
        status.as_u16(),
        error.is_timeout(),
        error.is_connect(),
        error.is_body(),
        error.is_decode(),
    );
}

fn log_passport_parse_error(
    method: &str,
    path: &str,
    status: reqwest::StatusCode,
    content_type: &str,
    body_length: usize,
) {
    warn!(
        target: "Bilibili/AuthApi",
        "passport JSON parse error method={method} path={path} http_status={} content_type={content_type:?} body_length={body_length}",
        status.as_u16(),
    );
}

fn ensure_api_success(root: &Value) -> Result<(), BiliError> {
    let code = root
        .get("code")
        .and_then(Value::as_i64)
        .ok_or_else(|| BiliError::Invalid("missing code".to_string()))?;
    match code {
        0 => Ok(()),
        -101 => Err(BiliError::LoginExpired),
        -412 => Err(BiliError::RateLimited),
        -352 => Err(BiliError::Api {
            code,
            message: "WBI verification failed".to_string(),
        }),
        _ => Err(api_error(root)),
    }
}

fn ensure_wbi_success(root: Value) -> Result<Value, BiliError> {
    ensure_api_success(&root)?;
    Ok(root)
}

fn api_error(root: &Value) -> BiliError {
    BiliError::Api {
        code: root.get("code").and_then(Value::as_i64).unwrap_or(-1),
        message: root
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
    }
}

fn error_code(error: &BiliError) -> String {
    match error {
        BiliError::Api { code, .. } => format!("api:{code}"),
        BiliError::Invalid(_) => "invalidResponse".to_string(),
        _ => "unavailable".to_string(),
    }
}

fn parse_advertised_qualities(data: &Value) -> Vec<QualityOption> {
    if let Some(formats) = data.get("support_formats").and_then(Value::as_array) {
        let parsed = formats
            .iter()
            .filter_map(|format| {
                let id = format.get("quality").and_then(Value::as_i64)?;
                let label = format
                    .get("new_description")
                    .or_else(|| format.get("display_desc"))
                    .or_else(|| format.get("description"))
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned)
                    .unwrap_or_else(|| quality_label(id));
                Some(QualityOption { id, label })
            })
            .collect::<Vec<_>>();
        if !parsed.is_empty() {
            return parsed;
        }
    }

    let descriptions = data.get("accept_description").and_then(Value::as_array);
    data.get("accept_quality")
        .and_then(Value::as_array)
        .map(|qualities| {
            qualities
                .iter()
                .enumerate()
                .filter_map(|(index, quality)| {
                    let id = quality.as_i64()?;
                    let label = descriptions
                        .and_then(|items| items.get(index))
                        .and_then(Value::as_str)
                        .map(ToOwned::to_owned)
                        .unwrap_or_else(|| quality_label(id));
                    Some(QualityOption { id, label })
                })
                .collect()
        })
        .unwrap_or_default()
}

fn quality_label(id: i64) -> String {
    match id {
        16 => "360P",
        32 => "480P",
        64 => "720P",
        74 => "720P60",
        80 => "1080P",
        112 => "1080P+",
        116 => "1080P60",
        120 => "4K",
        125 => "HDR",
        126 => "Dolby Vision",
        127 => "8K",
        _ => return format!("{id}P"),
    }
    .to_string()
}

fn parse_card(value: &Value) -> Option<VideoCard> {
    let bvid = value
        .get("bvid")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let aid = value.get("aid").and_then(Value::as_i64).unwrap_or_default();
    let video_id = if !bvid.is_empty() {
        bvid.to_string()
    } else if aid > 0 {
        format!("av{aid}")
    } else {
        return None;
    };
    let title = value
        .get("title")
        .and_then(Value::as_str)
        .map(strip_html_tags)
        .unwrap_or_default();
    let owner_value = value.get("owner").or_else(|| value.get("author"));
    let owner = owner_value.map(|owner| crate::domain::OwnerInfo {
        id: owner.get("mid").and_then(Value::as_i64).unwrap_or_default(),
        name: owner
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        avatar_url: owner.get("face").and_then(Value::as_str).map(normalize_url),
    });
    let stat = value.get("stat").map(|stat| VideoStats {
        view: stat
            .get("view")
            .and_then(Value::as_i64)
            .or_else(|| stat.get("video").and_then(Value::as_i64))
            .unwrap_or_default(),
        like: stat.get("like").and_then(Value::as_i64).unwrap_or_default(),
        danmaku: stat
            .get("danmaku")
            .and_then(Value::as_i64)
            .unwrap_or_default(),
    });

    Some(VideoCard {
        video_id,
        title,
        cover_url: value
            .get("pic")
            .or_else(|| value.get("cover"))
            .and_then(Value::as_str)
            .map(normalize_url),
        duration: value.get("duration").and_then(Value::as_i64),
        published_at: value.get("pubdate").and_then(Value::as_i64),
        owner,
        stats: stat.unwrap_or_default(),
        cid: value.get("cid").and_then(Value::as_i64),
        source_kind: "popular".to_string(),
    })
}

fn parse_search_card(value: &Value) -> Option<VideoCard> {
    let video_id = value.get("bvid")?.as_str()?.to_string();
    let title = value
        .get("title")
        .and_then(Value::as_str)
        .map(strip_html_tags)
        .unwrap_or_default();
    let duration_text = value
        .get("duration")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let duration = parse_duration_text(duration_text);
    let author = value
        .get("author")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let mid = value.get("mid").and_then(Value::as_i64).unwrap_or_default();
    let stat = VideoStats {
        view: value
            .get("play")
            .and_then(Value::as_i64)
            .unwrap_or_default(),
        danmaku: value
            .get("video_review")
            .and_then(Value::as_i64)
            .unwrap_or_default(),
        like: 0,
    };

    Some(VideoCard {
        video_id,
        title,
        cover_url: value.get("pic").and_then(Value::as_str).map(normalize_url),
        duration,
        published_at: None,
        owner: Some(crate::domain::OwnerInfo {
            id: mid,
            name: author.to_string(),
            avatar_url: None,
        }),
        stats: stat,
        cid: None,
        source_kind: "search".to_string(),
    })
}

fn strip_html_tags(value: &str) -> String {
    value
        .chars()
        .fold(
            (String::new(), false),
            |(mut output, in_tag), ch| match ch {
                '<' => (output, true),
                '>' => (output, false),
                _ if !in_tag => {
                    output.push(ch);
                    (output, false)
                }
                _ => (output, true),
            },
        )
        .0
}

fn normalize_url(value: &str) -> String {
    if value.starts_with("//") {
        format!("https:{value}")
    } else if value.starts_with("http://") {
        value.replacen("http://", "https://", 1)
    } else if value.starts_with('/') && !value.starts_with("//") {
        format!("https:{value}")
    } else {
        value.to_string()
    }
}

fn parse_duration_text(value: &str) -> Option<i64> {
    let parts: Vec<i64> = value
        .split(':')
        .filter_map(|part| part.parse::<i64>().ok())
        .collect();
    match parts.as_slice() {
        [seconds] => Some(*seconds),
        [minutes, seconds] => Some(minutes * 60 + seconds),
        [hours, minutes, seconds] => Some(hours * 3600 + minutes * 60 + seconds),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn passport_shape_keeps_structure_without_sensitive_values() {
        let shape = json_shape(&json!({
            "code": 0,
            "message": "private error detail",
            "data": {
                "type": "geetest",
                "token": "secret-token-value",
                "geetest": {
                    "gt": "secret-gt",
                    "challenge": "secret-challenge"
                }
            }
        }));

        assert!(shape.contains("code:number(0)"));
        assert!(shape.contains("type:string(geetest)"));
        assert!(shape.contains("token:string(len=18)"));
        assert!(!shape.contains("secret-token-value"));
        assert!(!shape.contains("private error detail"));
    }

    #[test]
    fn passport_cookie_diagnostics_include_names_only() {
        let mut headers = HeaderMap::new();
        headers.append(
            "set-cookie",
            "SESSDATA=secret%2Cvalue; Path=/; HttpOnly".parse().unwrap(),
        );
        headers.append("set-cookie", "buvid3=device-value; Path=/".parse().unwrap());

        assert_eq!(cookie_names(&headers), vec!["SESSDATA", "buvid3"]);
        assert_eq!(header_value(&headers, "content-type"), "<missing>");
    }

    #[test]
    fn passport_request_shape_excludes_field_values() {
        let shape = request_shape([
            ("tel", "13800138000"),
            ("code", "123456"),
            ("token", "secret-token"),
        ]);

        assert_eq!(shape, "tel:len=11,code:len=6,token:len=12");
        assert!(!shape.contains("13800138000"));
        assert!(!shape.contains("123456"));
        assert!(!shape.contains("secret-token"));
    }

    #[test]
    fn wbi_rejection_reaches_the_refresh_branch() {
        let result = ensure_wbi_success(json!({
            "code": -352,
            "message": "WBI verification failed"
        }));

        assert!(matches!(result, Err(BiliError::Api { code: -352, .. })));
    }

    #[test]
    fn sms_send_form_matches_current_passport_contract() {
        let form = sms_send_form(
            "86",
            "13800138000",
            "token",
            "challenge",
            "validate",
            "seccode",
        );
        let fields = form.iter().map(|(field, _)| *field).collect::<Vec<_>>();

        assert_eq!(
            fields,
            vec![
                "cid",
                "tel",
                "source",
                "token",
                "challenge",
                "validate",
                "seccode",
                "go_url",
            ]
        );
        assert_eq!(form[2].1, "main_web");
        assert_eq!(form[7].1, BILIBILI_WEB_URL);
    }

    #[test]
    fn sms_login_form_matches_current_passport_contract() {
        let form = sms_login_form("86", "13800138000", "123456", "captcha-key");
        let fields = form.iter().map(|(field, _)| *field).collect::<Vec<_>>();

        assert_eq!(
            fields,
            vec!["cid", "tel", "code", "source", "captcha_key", "go_url"]
        );
        assert!(!fields.contains(&"keep"));
    }
}
