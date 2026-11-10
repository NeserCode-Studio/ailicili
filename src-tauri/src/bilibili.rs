use crate::domain::{
    CommentAuthor, CommentEmote, CommentPage, CommentPicture, CommentReplyPage, CommentSort,
    PagedVideos, PlaybackInfo, QualityNotice, QualityNoticeKind, QualityOption, StreamProtocol,
    StreamSource, VideoCard, VideoComment, VideoDetail, VideoPage, VideoSourceKind, VideoStats,
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
const COMMENT_PAGE_SIZE: usize = 4;
const COMMENT_REPLY_PAGE_SIZE: u32 = 20;

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
    recommend_cursor: Arc<Mutex<RecommendationCursor>>,
}

#[derive(Debug, Clone)]
struct WbiCache {
    mixin_key: String,
    expires_at: Instant,
}

#[derive(Debug, Clone)]
struct RecommendationCursor {
    fresh_idx: u32,
    fresh_idx_1h: u32,
    brush: u32,
    fetch_row: u32,
    uniq_id: String,
    last_showlist: Vec<i64>,
}

impl RecommendationCursor {
    fn new() -> Self {
        Self {
            fresh_idx: 1,
            fresh_idx_1h: 1,
            brush: 1,
            fetch_row: 1,
            uniq_id: uuid::Uuid::new_v4().simple().to_string(),
            last_showlist: Vec::new(),
        }
    }

    fn reset(&mut self) {
        self.brush = self.brush.saturating_add(1);
        self.rewind();
    }

    fn rewind(&mut self) {
        self.fresh_idx = 1;
        self.fresh_idx_1h = 1;
        self.fetch_row = 1;
        self.last_showlist.clear();
    }

    fn query(&self) -> Vec<(String, String)> {
        let mut query = vec![
            ("fresh_type".to_string(), "4".to_string()),
            ("ps".to_string(), "30".to_string()),
            ("fresh_idx".to_string(), self.fresh_idx.to_string()),
            ("fresh_idx_1h".to_string(), self.fresh_idx_1h.to_string()),
            ("brush".to_string(), self.brush.to_string()),
            ("fetch_row".to_string(), self.fetch_row.to_string()),
            ("feed_version".to_string(), "V8".to_string()),
            ("homepage_ver".to_string(), "1".to_string()),
            ("y_num".to_string(), "4".to_string()),
            ("last_y_num".to_string(), "5".to_string()),
            ("uniq_id".to_string(), self.uniq_id.clone()),
            ("web_location".to_string(), "1430650".to_string()),
        ];
        if !self.last_showlist.is_empty() {
            query.push((
                "last_showlist".to_string(),
                self.last_showlist
                    .iter()
                    .map(|aid| format!("av_{aid}"))
                    .collect::<Vec<_>>()
                    .join(","),
            ));
        }
        query
    }

    fn advance(&mut self, aids: &[i64], server_fresh_idx: u32, server_fresh_idx_1h: u32) {
        let rows = ((aids.len() as u32) + 3) / 4;
        self.fetch_row = self.fetch_row.saturating_add(rows.max(1));
        self.fresh_idx = next_recommend_index(self.fresh_idx, server_fresh_idx);
        self.fresh_idx_1h = next_recommend_index(self.fresh_idx_1h, server_fresh_idx_1h);
        self.last_showlist = aids
            .iter()
            .copied()
            .filter(|aid| *aid > 0)
            .take(12)
            .collect();
    }
}

fn next_recommend_index(current: u32, server: u32) -> u32 {
    let next = if server > 0 { server + 1 } else { current + 1 };
    next.max(current + 1)
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
            recommend_cursor: Arc::new(Mutex::new(RecommendationCursor::new())),
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

    async fn comment_api_root(
        &self,
        path: &str,
        query: &[(String, String)],
    ) -> Result<Value, BiliError> {
        let session = self.session_snapshot()?;
        let cookie = if session
            .as_ref()
            .is_some_and(SessionCookies::is_authenticated)
        {
            self.cookie_header(session.as_ref()).await
        } else {
            String::new()
        };
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
        if response.status() == reqwest::StatusCode::TOO_MANY_REQUESTS {
            return Err(BiliError::RateLimited);
        }
        response
            .json()
            .await
            .map_err(|_| BiliError::Invalid("invalid JSON response".to_string()))
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
            next_cursor: None,
            fallback: false,
        })
    }

    pub async fn recommend(&self, page: u32) -> Result<PagedVideos, BiliError> {
        let query = {
            let mut cursor = self
                .recommend_cursor
                .lock()
                .map_err(|_| BiliError::Storage("recommend cursor lock poisoned".to_string()))?;
            if page <= 1 {
                cursor.reset();
            }
            cursor.query()
        };

        let root = match self
            .wbi_json("/x/web-interface/wbi/index/top/feed/rcmd", query)
            .await
        {
            Ok(root) => root,
            Err(recommend_error) => {
                return self.recommend_fallback(page, recommend_error).await;
            }
        };
        let Some(data) = root.get("data") else {
            return self
                .recommend_fallback(
                    page,
                    BiliError::Invalid("missing recommendation data".to_string()),
                )
                .await;
        };
        let (items, aids, server_fresh_idx, server_fresh_idx_1h) = parse_recommendation(data);
        if items.is_empty() {
            return self
                .recommend_fallback(
                    page,
                    BiliError::Invalid("recommendation returned no video items".to_string()),
                )
                .await;
        }

        {
            let mut cursor = self
                .recommend_cursor
                .lock()
                .map_err(|_| BiliError::Storage("recommend cursor lock poisoned".to_string()))?;
            cursor.advance(&aids, server_fresh_idx, server_fresh_idx_1h);
        }
        let has_more = items.len() >= 30;
        Ok(PagedVideos {
            page,
            items,
            has_more,
            next_cursor: has_more.then(|| (page + 1).to_string()),
            fallback: false,
        })
    }

    async fn recommend_fallback(
        &self,
        page: u32,
        recommend_error: BiliError,
    ) -> Result<PagedVideos, BiliError> {
        match self.popular(page.max(1)).await {
            Ok(mut fallback) => {
                fallback.fallback = true;
                Ok(fallback)
            }
            Err(_) => Err(recommend_error),
        }
    }

    pub async fn region_feed(&self, region_id: i64, page: u32) -> Result<PagedVideos, BiliError> {
        let region_id = normalize_region_id(region_id)
            .ok_or_else(|| BiliError::Invalid(format!("unsupported region id {region_id}")))?;
        let display_id = page.max(1);
        let query = vec![
            ("display_id".to_string(), display_id.to_string()),
            ("request_cnt".to_string(), "20".to_string()),
            ("from_region".to_string(), region_id.to_string()),
            ("device".to_string(), "web".to_string()),
            ("plat".to_string(), "30".to_string()),
        ];
        let session = self.session_snapshot()?;
        let root = self
            .api_root(
                "/x/web-interface/region/feed/rcmd",
                &query,
                session.as_ref(),
            )
            .await?;
        parse_region_feed_page(&root, display_id)
    }

    pub async fn video_detail(&self, video_id: &str) -> Result<VideoDetail, BiliError> {
        let root = self
            .get_json("/x/web-interface/view", &[("bvid", video_id.to_string())])
            .await?;
        let data = root
            .get("data")
            .ok_or_else(|| BiliError::Invalid("missing detail data".to_string()))?;
        let aid = data
            .get("aid")
            .and_then(Value::as_i64)
            .filter(|value| *value > 0)
            .ok_or_else(|| BiliError::Invalid("missing detail aid".to_string()))?;
        let mut card = parse_card(data)
            .ok_or_else(|| BiliError::Invalid("invalid detail card".to_string()))?;
        card.source_kind = VideoSourceKind::Detail;
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
            aid,
            description: data
                .get("desc")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            pages,
        })
    }

    pub async fn video_comments(
        &self,
        aid: i64,
        sort: CommentSort,
        next: Option<&str>,
    ) -> Result<CommentPage, BiliError> {
        if aid <= 0 {
            return Err(BiliError::Invalid("invalid comment aid".to_string()));
        }
        let mut query = vec![
            ("oid".to_string(), aid.to_string()),
            ("type".to_string(), "1".to_string()),
            ("mode".to_string(), comment_sort_mode(sort).to_string()),
            ("ps".to_string(), COMMENT_PAGE_SIZE.to_string()),
        ];
        if let Some(next) = next.map(str::trim).filter(|value| !value.is_empty()) {
            query.push(("next".to_string(), next.to_string()));
        }
        let root = self.comment_api_root("/x/v2/reply/main", &query).await?;
        ensure_api_success(&root)?;
        parse_comment_page(&root)
    }

    pub async fn comment_replies(
        &self,
        aid: i64,
        root_rpid: i64,
        page: u32,
    ) -> Result<CommentReplyPage, BiliError> {
        if aid <= 0 || root_rpid <= 0 {
            return Err(BiliError::Invalid(
                "invalid comment reply target".to_string(),
            ));
        }
        let page = page.max(1);
        let root = self
            .comment_api_root(
                "/x/v2/reply/reply",
                &[
                    ("oid".to_string(), aid.to_string()),
                    ("type".to_string(), "1".to_string()),
                    ("root".to_string(), root_rpid.to_string()),
                    ("ps".to_string(), COMMENT_REPLY_PAGE_SIZE.to_string()),
                    ("pn".to_string(), page.to_string()),
                ],
            )
            .await?;
        ensure_api_success(&root)?;
        parse_comment_reply_page(&root, page)
    }

    pub async fn search(&self, keyword: &str, page: u32) -> Result<PagedVideos, BiliError> {
        let root = match self
            .get_json(
                "/x/web-interface/search/type",
                &[
                    ("search_type", "video".to_string()),
                    ("keyword", keyword.to_string()),
                    ("page", page.to_string()),
                    ("page_size", "20".to_string()),
                ],
            )
            .await
        {
            Ok(root) => root,
            Err(BiliError::Api { code: -352, .. }) => {
                self.wbi_json(
                    "/x/web-interface/wbi/search/type",
                    vec![
                        ("search_type".to_string(), "video".to_string()),
                        ("keyword".to_string(), keyword.to_string()),
                        ("page".to_string(), page.to_string()),
                        ("page_size".to_string(), "20".to_string()),
                    ],
                )
                .await?
            }
            Err(error) => return Err(error),
        };
        let mut items = root
            .pointer("/data/result")
            .and_then(Value::as_array)
            .ok_or_else(|| BiliError::Invalid("missing search result".to_string()))?
            .iter()
            .filter_map(parse_search_card)
            .collect::<Vec<_>>();
        for item in &mut items {
            item.source_kind = VideoSourceKind::Search;
        }
        let has_more = search_has_more(&root, page, items.len());
        Ok(PagedVideos {
            page,
            items,
            has_more,
            next_cursor: has_more.then(|| (page + 1).to_string()),
            fallback: false,
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
            ("fnval".to_string(), "4048".to_string()),
            ("fnver".to_string(), "0".to_string()),
            ("fourk".to_string(), "1".to_string()),
            ("platform".to_string(), "pc".to_string()),
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
        let mut dash_video_count = 0;
        let mut dash_audio_count = 0;

        if let Some(dash) = data.get("dash") {
            dash_video_count = dash
                .get("video")
                .and_then(Value::as_array)
                .map(Vec::len)
                .unwrap_or_default();
            dash_audio_count = dash_audio_items(dash).len();
            streams = parse_dash_streams(dash);
        }

        if streams.is_empty() {
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
                            backup_urls: Vec::new(),
                            quality_id,
                            quality_label: quality_label(quality_id),
                            audio_url: None,
                            audio_backup_urls: Vec::new(),
                            codec: Some("mp4".to_string()),
                            audio_codec: None,
                        });
                    }
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
        let highest_available = streams
            .iter()
            .map(|stream| stream.quality_id)
            .max()
            .unwrap_or(quality_id);
        let quality_notice = if !logged_in {
            QualityNotice {
                kind: QualityNoticeKind::LoginRequired,
                message_code: "loginForHigherQuality".to_string(),
            }
        } else if highest_available < highest_advertised {
            QualityNotice {
                kind: QualityNoticeKind::QualityUnavailable,
                message_code: "higherQualityUnavailable".to_string(),
            }
        } else {
            QualityNotice {
                kind: QualityNoticeKind::None,
                message_code: "none".to_string(),
            }
        };
        info!(
            target: "Bilibili",
            "playback loaded video={video_id} cid={cid} qn={quality} quality={quality_id} dash_video={dash_video_count} dash_audio={dash_audio_count} durl={durl_count} sources={} logged_in={logged_in}",
            streams.len(),
        );

        Ok(PlaybackInfo {
            video_id: video_id.to_string(),
            cid,
            duration_ms,
            streams,
            current_quality: QualityOption {
                id: highest_available,
                label: quality_label(highest_available),
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

fn dash_audio_items(dash: &Value) -> Vec<&Value> {
    let mut items = Vec::new();
    if let Some(audio) = dash.get("audio").and_then(Value::as_array) {
        items.extend(audio.iter());
    }
    if let Some(dolby) = dash.get("dolby").and_then(|value| value.get("audio")) {
        if let Some(audio) = dolby.as_array() {
            items.extend(audio.iter());
        }
    }
    if let Some(flac) = dash.get("flac").and_then(|value| value.get("audio")) {
        if let Some(audio) = flac.as_array() {
            items.extend(audio.iter());
        }
    }
    items
}

fn parse_dash_streams(dash: &Value) -> Vec<StreamSource> {
    let audio = select_dash_audio(dash);
    let mut videos: Vec<(&Value, i32, i64)> = Vec::new();

    if let Some(items) = dash.get("video").and_then(Value::as_array) {
        for item in items {
            let Some(quality_id) = item.get("id").and_then(Value::as_i64) else {
                continue;
            };
            if dash_media_urls(item).is_none() {
                continue;
            }
            let codec = item
                .get("codecs")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            let bandwidth = item
                .get("bandwidth")
                .and_then(Value::as_i64)
                .unwrap_or_default();
            let score = codec_score(&codec);
            match videos.iter_mut().find(|(candidate, _, _)| {
                candidate.get("id").and_then(Value::as_i64) == Some(quality_id)
            }) {
                Some(entry) => {
                    if score > entry.1 || (score == entry.1 && bandwidth > entry.2) {
                        *entry = (item, score, bandwidth);
                    }
                }
                None => videos.push((item, score, bandwidth)),
            }
        }
    }

    let mut streams = videos
        .into_iter()
        .map(|(item, _, _)| {
            let quality_id = item.get("id").and_then(Value::as_i64).unwrap_or_default();
            let (url, backup_urls) = dash_media_urls(item).unwrap_or_default();
            StreamSource {
                id: format!("dash-{quality_id}"),
                protocol: StreamProtocol::Dash,
                url,
                backup_urls,
                quality_id,
                quality_label: quality_label(quality_id),
                audio_url: audio.as_ref().map(|audio| audio.url.clone()),
                audio_backup_urls: audio
                    .as_ref()
                    .map(|audio| audio.backup_urls.clone())
                    .unwrap_or_default(),
                codec: item
                    .get("codecs")
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned),
                audio_codec: audio.as_ref().and_then(|audio| audio.codec.clone()),
            }
        })
        .collect::<Vec<_>>();
    streams.sort_by(|left, right| right.quality_id.cmp(&left.quality_id));
    streams
}

#[derive(Debug, Clone)]
struct DashAudioSource {
    url: String,
    backup_urls: Vec<String>,
    codec: Option<String>,
}

fn dash_media_urls(item: &Value) -> Option<(String, Vec<String>)> {
    let url = item
        .get("baseUrl")
        .or_else(|| item.get("base_url"))
        .and_then(Value::as_str)
        .map(normalize_url)
        .filter(|url| !url.is_empty())?;
    let mut backup_urls = Vec::new();

    for key in ["backupUrl", "backup_url"] {
        match item.get(key) {
            Some(Value::Array(values)) => {
                for value in values.iter().filter_map(Value::as_str) {
                    push_unique_media_url(&mut backup_urls, value, &url);
                }
            }
            Some(Value::String(value)) => {
                push_unique_media_url(&mut backup_urls, value, &url);
            }
            _ => {}
        }
    }

    Some((url, backup_urls))
}

fn push_unique_media_url(urls: &mut Vec<String>, candidate: &str, primary_url: &str) {
    let candidate = normalize_url(candidate);
    if !candidate.is_empty()
        && candidate != primary_url
        && !urls.iter().any(|url| url == &candidate)
    {
        urls.push(candidate);
    }
}

fn select_dash_audio(dash: &Value) -> Option<DashAudioSource> {
    let audio_arrays = [
        dash.get("audio").and_then(Value::as_array),
        dash.get("dolby")
            .and_then(|value| value.get("audio"))
            .and_then(Value::as_array),
        dash.get("flac")
            .and_then(|value| value.get("audio"))
            .and_then(Value::as_array),
    ];
    for audio in audio_arrays.into_iter().flatten() {
        let selected = audio
            .iter()
            .filter_map(|item| {
                let (url, backup_urls) = dash_media_urls(item)?;
                let codec = item
                    .get("codecs")
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned);
                let bandwidth = item
                    .get("bandwidth")
                    .and_then(Value::as_i64)
                    .unwrap_or_default();
                Some(DashAudioSource {
                    url,
                    backup_urls,
                    codec,
                })
                .map(|audio| (audio, bandwidth))
            })
            .max_by_key(|(_, bandwidth)| *bandwidth)?
            .0;
        return Some(selected);
    }
    None
}

fn codec_score(codec: &str) -> i32 {
    if codec.contains("avc1") {
        4
    } else if codec.contains("hvc1") || codec.contains("hev1") {
        3
    } else if codec.contains("av01") {
        2
    } else {
        1
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

fn normalize_region_id(region_id: i64) -> Option<i64> {
    if matches!(
        region_id,
        1001 | 1002
            | 1003
            | 1004
            | 1005
            | 1006
            | 1007
            | 1008
            | 1009
            | 1010
            | 1011
            | 1012
            | 1013
            | 1014
            | 1015
            | 1016
            | 1017
            | 1018
            | 1019
            | 1020
            | 1021
            | 1022
            | 1023
            | 1024
            | 1025
            | 1026
            | 1027
            | 1029
            | 1030
            | 1031
    ) {
        return Some(region_id);
    }
    None
}

fn parse_region_feed_page(root: &Value, page: u32) -> Result<PagedVideos, BiliError> {
    if root.get("code").and_then(Value::as_i64) == Some(62013) {
        return Ok(PagedVideos {
            page,
            items: Vec::new(),
            has_more: false,
            next_cursor: None,
            fallback: false,
        });
    }
    ensure_api_success(root)?;

    let data = root
        .get("data")
        .ok_or_else(|| BiliError::Invalid("missing region feed data".to_string()))?;
    let items = data
        .get("archives")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| parse_card_with_source(item, VideoSourceKind::Region))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let declared_has_more = data
        .get("has_more")
        .and_then(Value::as_i64)
        .is_some_and(|value| value > 0);
    let has_more = declared_has_more || items.len() >= 20;
    Ok(PagedVideos {
        page,
        items,
        has_more,
        next_cursor: has_more.then(|| (page + 1).to_string()),
        fallback: false,
    })
}

fn search_has_more(root: &Value, page: u32, item_count: usize) -> bool {
    root.pointer("/data/numPages")
        .and_then(Value::as_u64)
        .map(|total_pages| u64::from(page) < total_pages)
        .unwrap_or(item_count >= 20)
}

fn parse_recommendation(data: &Value) -> (Vec<VideoCard>, Vec<i64>, u32, u32) {
    let entries = data
        .get("item")
        .or_else(|| data.get("items"))
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or_default();
    let mut items = Vec::new();
    let mut aids = Vec::new();

    for entry in entries {
        if entry
            .get("goto")
            .and_then(Value::as_str)
            .is_some_and(|goto| goto != "av")
        {
            continue;
        }
        let video = entry.get("bilibili").unwrap_or(entry);
        let Some(card) = parse_card_with_source(video, VideoSourceKind::Recommend) else {
            continue;
        };
        if let Some(aid) = video
            .get("aid")
            .or_else(|| video.get("id"))
            .and_then(Value::as_i64)
        {
            if aid > 0 {
                aids.push(aid);
            }
        }
        items.push(card);
    }

    let fresh_idx = recommendation_counter(data, "fresh_idx");
    let fresh_idx_1h = recommendation_counter(data, "fresh_idx_1h");
    (items, aids, fresh_idx, fresh_idx_1h)
}

fn recommendation_counter(data: &Value, key: &str) -> u32 {
    let Some(userfeature) = data.get("userfeature") else {
        return 0;
    };
    let parsed;
    let object = if let Some(raw) = userfeature.as_str() {
        parsed = serde_json::from_str::<Value>(raw).ok();
        parsed.as_ref()
    } else {
        Some(userfeature)
    };
    object
        .and_then(|value| value.get(key))
        .and_then(Value::as_u64)
        .and_then(|value| u32::try_from(value).ok())
        .unwrap_or_default()
}

fn comment_sort_mode(sort: CommentSort) -> &'static str {
    match sort {
        CommentSort::Hot => "3",
        CommentSort::Time => "2",
    }
}

fn parse_comment_page(root: &Value) -> Result<CommentPage, BiliError> {
    let data = root
        .get("data")
        .ok_or_else(|| BiliError::Invalid("missing comment data".to_string()))?;
    let upper_mid = data
        .pointer("/upper/mid")
        .and_then(|value| parse_json_integer(Some(value)))
        .unwrap_or_default();
    let cursor = data.get("cursor");
    let total = cursor
        .and_then(|value| value.get("all_count"))
        .and_then(|value| parse_json_integer(Some(value)))
        .unwrap_or_default()
        .max(0);
    let next_cursor = cursor
        .and_then(|value| value.get("next"))
        .and_then(|value| parse_json_integer(Some(value)))
        .filter(|value| *value > 0)
        .map(|value| value.to_string());
    let is_end = cursor
        .and_then(|value| value.get("is_end"))
        .and_then(Value::as_bool)
        .unwrap_or(false);

    let mut items = Vec::new();
    for key in ["upper", "admin"] {
        let Some(comment) = data
            .get("top")
            .and_then(|top| top.get(key))
            .and_then(|value| parse_comment(value, upper_mid, true))
        else {
            continue;
        };
        items.push(comment);
    }
    if let Some(replies) = data.get("replies").and_then(Value::as_array) {
        items.extend(
            replies
                .iter()
                .filter_map(|value| parse_comment(value, upper_mid, false)),
        );
    }

    let mut seen = BTreeSet::new();
    items.retain(|comment| seen.insert(comment.id));
    items.truncate(COMMENT_PAGE_SIZE);
    Ok(CommentPage {
        total,
        items,
        has_more: !is_end && next_cursor.is_some(),
        next_cursor,
    })
}

fn parse_comment_reply_page(
    root: &Value,
    requested_page: u32,
) -> Result<CommentReplyPage, BiliError> {
    let data = root
        .get("data")
        .ok_or_else(|| BiliError::Invalid("missing comment reply data".to_string()))?;
    let upper_mid = data
        .pointer("/upper/mid")
        .and_then(|value| parse_json_integer(Some(value)))
        .unwrap_or_default();
    let mut items = data
        .get("replies")
        .and_then(Value::as_array)
        .map(|replies| {
            replies
                .iter()
                .filter_map(|value| parse_comment(value, upper_mid, false))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let mut seen = BTreeSet::new();
    items.retain(|comment| seen.insert(comment.id));

    let page_number = data
        .pointer("/page/num")
        .and_then(|value| parse_json_integer(Some(value)))
        .filter(|value| *value > 0)
        .and_then(|value| u32::try_from(value).ok())
        .unwrap_or(requested_page.max(1));
    let page_size = data
        .pointer("/page/size")
        .and_then(|value| parse_json_integer(Some(value)))
        .filter(|value| *value > 0)
        .and_then(|value| u32::try_from(value).ok())
        .unwrap_or(COMMENT_REPLY_PAGE_SIZE);
    let total = data
        .pointer("/page/count")
        .and_then(|value| parse_json_integer(Some(value)))
        .filter(|value| *value > 0);
    let has_more = total.map_or(items.len() >= page_size as usize, |total| {
        i64::from(page_number) * i64::from(page_size) < total
    });

    Ok(CommentReplyPage {
        items,
        has_more,
        next_page: has_more.then(|| page_number.saturating_add(1)),
    })
}

fn parse_comment(value: &Value, upper_mid: i64, is_pinned: bool) -> Option<VideoComment> {
    parse_comment_at_depth(value, upper_mid, is_pinned, 0)
}

fn parse_comment_at_depth(
    value: &Value,
    upper_mid: i64,
    is_pinned: bool,
    depth: u8,
) -> Option<VideoComment> {
    let id = parse_json_integer(value.get("rpid")).filter(|value| *value > 0)?;
    let member = value.get("member")?;
    let author_id = parse_json_integer(member.get("mid")).unwrap_or_default();
    let name = member
        .get("uname")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let replies = if depth < 1 {
        value
            .get("replies")
            .and_then(Value::as_array)
            .map(|replies| {
                replies
                    .iter()
                    .filter_map(|reply| {
                        parse_comment_at_depth(reply, upper_mid, false, depth.saturating_add(1))
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default()
    } else {
        Vec::new()
    };

    Some(VideoComment {
        id,
        author: CommentAuthor {
            id: author_id,
            name,
            avatar_url: member
                .get("avatar")
                .and_then(Value::as_str)
                .filter(|value| !value.is_empty())
                .map(normalize_url),
            level: member
                .pointer("/level_info/current_level")
                .and_then(|value| parse_json_integer(Some(value))),
            is_up: upper_mid > 0 && author_id == upper_mid,
        },
        message: value
            .pointer("/content/message")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        pictures: parse_comment_pictures(value),
        emotes: parse_comment_emotes(value),
        created_at: parse_json_integer(value.get("ctime"))
            .unwrap_or_default()
            .max(0),
        like_count: parse_json_integer(value.get("like"))
            .unwrap_or_default()
            .max(0),
        reply_count: parse_json_integer(value.get("rcount"))
            .unwrap_or_default()
            .max(0),
        location: value
            .pointer("/reply_control/location")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string),
        replies,
        is_pinned,
    })
}

fn parse_comment_pictures(comment: &Value) -> Vec<CommentPicture> {
    let Some(pictures) = comment
        .pointer("/content/pictures")
        .and_then(Value::as_array)
    else {
        return Vec::new();
    };
    let mut seen = BTreeSet::new();
    pictures
        .iter()
        .filter_map(parse_comment_picture)
        .filter(|picture| seen.insert(picture.url.clone()))
        .collect()
}

fn parse_comment_picture(value: &Value) -> Option<CommentPicture> {
    let source = value
        .get("img_src")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())?;
    let url = normalize_url(source);
    if !url.starts_with("https://") {
        return None;
    }

    Some(CommentPicture {
        url,
        width: parse_json_integer(value.get("img_width")).filter(|value| *value > 0),
        height: parse_json_integer(value.get("img_height")).filter(|value| *value > 0),
    })
}

fn parse_comment_emotes(comment: &Value) -> Vec<CommentEmote> {
    let Some(emotes) = comment.pointer("/content/emote").and_then(Value::as_object) else {
        return Vec::new();
    };
    let mut seen = BTreeSet::new();
    emotes
        .iter()
        .filter_map(|(key, value)| {
            let text = key.trim();
            if text.is_empty() {
                return None;
            }
            let url = value
                .get("url")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(normalize_url)?;
            if !url.starts_with("https://") {
                return None;
            }
            if !seen.insert(text.to_string()) {
                return None;
            }
            Some(CommentEmote {
                text: text.to_string(),
                url,
            })
        })
        .collect()
}

fn parse_json_integer(value: Option<&Value>) -> Option<i64> {
    let value = value?;
    if let Some(number) = value.as_i64() {
        return Some(number);
    }
    if let Some(number) = value.as_u64() {
        return i64::try_from(number).ok();
    }
    if let Some(number) = value.as_f64() {
        return float_to_i64(number);
    }
    let text = value.as_str()?.trim();
    text.parse::<i64>()
        .ok()
        .or_else(|| text.parse::<f64>().ok().and_then(float_to_i64))
}

fn float_to_i64(value: f64) -> Option<i64> {
    if value.is_finite() && value >= i64::MIN as f64 && value <= i64::MAX as f64 {
        Some(value.trunc() as i64)
    } else {
        None
    }
}

fn parse_card(value: &Value) -> Option<VideoCard> {
    parse_card_with_source(value, VideoSourceKind::Popular)
}

fn parse_card_with_source(value: &Value, source_kind: VideoSourceKind) -> Option<VideoCard> {
    let bvid = value
        .get("bvid")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let aid = value
        .get("aid")
        .or_else(|| value.get("id"))
        .and_then(Value::as_i64)
        .unwrap_or_default();
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
        platform: crate::domain::Platform::Bilibili,
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
        source_kind,
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
        platform: crate::domain::Platform::Bilibili,
        video_id,
        title,
        cover_url: value.get("pic").and_then(Value::as_str).map(normalize_url),
        duration,
        published_at: value.get("pubdate").and_then(Value::as_i64),
        owner: Some(crate::domain::OwnerInfo {
            id: mid,
            name: author.to_string(),
            avatar_url: None,
        }),
        stats: stat,
        cid: None,
        source_kind: VideoSourceKind::Search,
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
    use crate::domain::{CommandError, Platform};
    use serde_json::json;

    #[test]
    fn feed_fixtures_map_to_the_unified_video_card() {
        let popular: Value =
            serde_json::from_str(include_str!("../tests/fixtures/bilibili/feed/popular.json"))
                .unwrap();
        let popular_card = parse_card(&popular["data"]["list"][0]).unwrap();
        assert_eq!(popular_card.platform, Platform::Bilibili);
        assert_eq!(popular_card.source_kind, VideoSourceKind::Popular);
        assert_eq!(popular_card.owner.unwrap().name, "Popular owner");

        let region: Value =
            serde_json::from_str(include_str!("../tests/fixtures/bilibili/feed/region.json"))
                .unwrap();
        let region_card =
            parse_card_with_source(&region["data"]["archives"][0], VideoSourceKind::Region)
                .unwrap();
        assert_eq!(region_card.video_id, "BV1REGION0001");
        assert_eq!(
            region_card.cover_url.as_deref(),
            Some("https://example.invalid/region-cover.jpg")
        );
        assert_eq!(region_card.source_kind, VideoSourceKind::Region);

        let recommend: Value = serde_json::from_str(include_str!(
            "../tests/fixtures/bilibili/feed/recommend.json"
        ))
        .unwrap();
        let recommend_card = parse_card_with_source(
            &recommend["data"]["items"][0]["bilibili"],
            VideoSourceKind::Recommend,
        )
        .unwrap();
        assert_eq!(recommend_card.video_id, "BV1RECOMMEND");
        assert_eq!(recommend_card.stats.view, 3200);
        assert_eq!(recommend_card.source_kind, VideoSourceKind::Recommend);

        let search: Value =
            serde_json::from_str(include_str!("../tests/fixtures/bilibili/feed/search.json"))
                .unwrap();
        let search_card = parse_search_card(&search["data"]["result"][0]).unwrap();
        assert_eq!(search_card.title, "Search fixture");
        assert_eq!(search_card.duration, Some(365));
        assert_eq!(search_card.source_kind, VideoSourceKind::Search);
    }

    #[test]
    fn comment_fixture_maps_pinned_replies_and_numeric_variants() {
        let main: Value = serde_json::from_str(include_str!(
            "../tests/fixtures/bilibili/comments/main.json"
        ))
        .unwrap();
        let page = parse_comment_page(&main).unwrap();

        assert_eq!(page.total, 7);
        assert_eq!(page.items.len(), 3);
        assert_eq!(page.next_cursor.as_deref(), Some("20"));
        assert!(page.has_more);

        let pinned = &page.items[0];
        assert_eq!(pinned.id, 100);
        assert!(pinned.is_pinned);
        assert!(pinned.author.is_up);
        assert_eq!(pinned.like_count, 12);
        assert_eq!(pinned.replies.len(), 1);
        assert_eq!(
            pinned.author.avatar_url.as_deref(),
            Some("https://example.invalid/avatar-up.jpg")
        );
        assert_eq!(pinned.location.as_deref(), Some("IP属地：上海"));

        let ordinary = &page.items[1];
        assert_eq!(ordinary.like_count, 34);
        assert_eq!(ordinary.reply_count, 2);
        assert_eq!(ordinary.author.level, Some(3));
        assert_eq!(ordinary.pictures.len(), 2);
        assert_eq!(
            ordinary.pictures[0].url,
            "https://example.invalid/comment-vertical.png"
        );
        assert_eq!(ordinary.pictures[0].width, Some(1024));
        assert_eq!(ordinary.pictures[0].height, Some(1956));
        assert_eq!(
            ordinary.pictures[1].url,
            "https://example.invalid/comment-wide.png"
        );
        assert_eq!(ordinary.pictures[1].width, Some(1920));
        assert_eq!(ordinary.emotes.len(), 1);
        assert_eq!(ordinary.emotes[0].text, "[fixture_emote]");
        assert_eq!(
            ordinary.emotes[0].url,
            "https://example.invalid/fixture-emote.png"
        );
        assert_eq!(ordinary.replies.len(), 1);
        assert_eq!(ordinary.replies[0].pictures.len(), 1);
        assert_eq!(
            ordinary.replies[0].pictures[0].url,
            "https://example.invalid/reply-image.png"
        );
        assert_eq!(
            ordinary.replies[0].author.avatar_url.as_deref(),
            Some("https://example.invalid/avatar-inline.jpg")
        );
        assert!(!ordinary.author.is_up);
        assert!(page.items[2].author.is_up);
    }

    #[test]
    fn comment_fixtures_preserve_reply_pagination() {
        let replies: Value = serde_json::from_str(include_str!(
            "../tests/fixtures/bilibili/comments/replies.json"
        ))
        .unwrap();
        let page = parse_comment_reply_page(&replies, 1).unwrap();

        assert_eq!(page.items.len(), 2);
        assert!(!page.has_more);
        assert!(page.next_page.is_none());
        assert_eq!(page.items[0].like_count, 40);
        assert_eq!(
            page.items[0].author.avatar_url.as_deref(),
            Some("https://example.invalid/avatar-reply.jpg")
        );
        assert!(page.items[1].author.is_up);
    }

    #[test]
    fn comment_reply_pages_advance_until_the_reported_total() {
        let first_page = json!({
            "data": {
                "page": {
                    "count": 25,
                    "num": 1,
                    "size": 10
                },
                "replies": []
            }
        });
        let page = parse_comment_reply_page(&first_page, 1).unwrap();

        assert!(page.has_more);
        assert_eq!(page.next_page, Some(2));

        let last_page = json!({
            "data": {
                "page": {
                    "count": 25,
                    "num": 3,
                    "size": 10
                },
                "replies": []
            }
        });
        let page = parse_comment_reply_page(&last_page, 3).unwrap();

        assert!(!page.has_more);
        assert!(page.next_page.is_none());
    }

    #[test]
    fn comment_reply_pages_continue_when_page_metadata_is_missing() {
        let replies = (1..=20)
            .map(|id| {
                json!({
                    "rpid": id,
                    "member": {
                        "mid": 1000 + id,
                        "uname": format!("Reply {id}")
                    },
                    "content": {
                        "message": format!("Reply body {id}")
                    }
                })
            })
            .collect::<Vec<_>>();
        let root = json!({
            "data": {
                "replies": replies
            }
        });
        let page = parse_comment_reply_page(&root, 1).unwrap();

        assert_eq!(page.items.len(), COMMENT_REPLY_PAGE_SIZE as usize);
        assert!(page.has_more);
        assert_eq!(page.next_page, Some(2));
    }

    #[test]
    fn comment_reply_first_page_includes_more_than_ten_items() {
        let replies = (1..=12)
            .map(|id| {
                json!({
                    "rpid": id,
                    "member": {
                        "mid": 1000 + id,
                        "uname": format!("Reply {id}")
                    },
                    "content": {
                        "message": format!("Reply body {id}")
                    }
                })
            })
            .collect::<Vec<_>>();
        let root = json!({
            "data": {
                "page": {
                    "count": 12,
                    "num": 1,
                    "size": 20
                },
                "replies": replies
            }
        });
        let page = parse_comment_reply_page(&root, 1).unwrap();

        assert_eq!(page.items.len(), 12);
        assert!(!page.has_more);
        assert!(page.next_page.is_none());
    }

    #[test]
    fn comments_always_serialize_an_empty_replies_array() {
        let comment = parse_comment(
            &json!({
                "rpid": 99,
                "member": {
                    "mid": 1000,
                    "uname": "No replies"
                },
                "content": {
                    "message": "Nothing below this comment"
                },
                "rcount": 0
            }),
            0,
            false,
        )
        .unwrap();
        let value = serde_json::to_value(comment).unwrap();

        assert_eq!(value.get("replies"), Some(&json!([])));
        assert_eq!(value.get("pictures"), Some(&json!([])));
        assert_eq!(value.get("emotes"), Some(&json!([])));
    }

    #[test]
    fn comment_cursor_end_and_sort_contract_are_stable() {
        let root = json!({
            "data": {
                "cursor": {
                    "all_count": 0,
                    "next": 0,
                    "is_end": true
                },
                "replies": []
            }
        });
        let page = parse_comment_page(&root).unwrap();

        assert!(page.items.is_empty());
        assert!(!page.has_more);
        assert!(page.next_cursor.is_none());
        assert_eq!(comment_sort_mode(CommentSort::Hot), "3");
        assert_eq!(comment_sort_mode(CommentSort::Time), "2");
    }

    #[test]
    fn comment_pages_render_at_most_four_top_level_items() {
        let replies = (1..=6)
            .map(|id| {
                json!({
                    "rpid": id,
                    "mid": 1000 + id,
                    "like": 0,
                    "ctime": 1762142400,
                    "rcount": 0,
                    "member": {
                        "mid": 1000 + id,
                        "uname": format!("User {id}")
                    },
                    "content": {
                        "message": format!("Comment {id}")
                    }
                })
            })
            .collect::<Vec<_>>();
        let root = json!({
            "data": {
                "cursor": {
                    "all_count": 6,
                    "next": 4,
                    "is_end": false
                },
                "replies": replies
            }
        });
        let page = parse_comment_page(&root).unwrap();

        assert_eq!(COMMENT_PAGE_SIZE, 4);
        assert_eq!(COMMENT_REPLY_PAGE_SIZE, 20);
        assert_eq!(page.items.len(), 4);
        assert!(page.has_more);
    }

    #[test]
    fn unified_cards_always_serialize_required_stats() {
        let card = parse_card(&json!({
            "aid": 1005,
            "title": "Zero stats fixture"
        }))
        .unwrap();

        let serialized = serde_json::to_value(card).unwrap();
        assert_eq!(serialized["stats"]["view"], 0);
        assert_eq!(serialized["stats"]["like"], 0);
        assert_eq!(serialized["stats"]["danmaku"], 0);
    }

    #[test]
    fn feed_fixtures_preserve_pagination_and_error_boundaries() {
        let region_end: Value = serde_json::from_str(include_str!(
            "../tests/fixtures/bilibili/feed/region-end.json"
        ))
        .unwrap();
        let end_page = parse_region_feed_page(&region_end, 7).unwrap();
        assert_eq!(end_page.page, 7);
        assert!(end_page.items.is_empty());
        assert!(!end_page.has_more);
        assert!(end_page.next_cursor.is_none());

        let region: Value =
            serde_json::from_str(include_str!("../tests/fixtures/bilibili/feed/region.json"))
                .unwrap();
        let region_page = parse_region_feed_page(&region, 1).unwrap();
        assert_eq!(region_page.items.len(), 1);
        assert!(region_page.has_more);
        assert_eq!(region_page.next_cursor.as_deref(), Some("2"));

        let search: Value =
            serde_json::from_str(include_str!("../tests/fixtures/bilibili/feed/search.json"))
                .unwrap();
        assert!(search_has_more(&search, 1, 1));
        assert!(!search_has_more(&search, 2, 1));

        let risk_control: Value = serde_json::from_str(include_str!(
            "../tests/fixtures/bilibili/feed/risk-control.json"
        ))
        .unwrap();
        let command_error: CommandError = api_error(&risk_control).into();
        assert_eq!(command_error.code, "riskControl");
    }

    #[test]
    fn region_ids_require_confirmed_v2_values() {
        for region_id in [
            1001, 1002, 1003, 1004, 1005, 1006, 1007, 1008, 1009, 1010, 1011, 1012, 1013, 1014,
            1015, 1016, 1017, 1018, 1019, 1020, 1021, 1022, 1023, 1024, 1025, 1026, 1027, 1029,
            1030, 1031,
        ] {
            assert_eq!(normalize_region_id(region_id), Some(region_id));
        }

        assert_eq!(normalize_region_id(0), None);
        assert_eq!(normalize_region_id(1), None);
        assert_eq!(normalize_region_id(160), None);
    }

    #[test]
    fn recommendation_cursor_advances_and_resets_for_a_new_feed() {
        let mut cursor = RecommendationCursor {
            fresh_idx: 1,
            fresh_idx_1h: 1,
            brush: 1,
            fetch_row: 1,
            uniq_id: "fixture".to_string(),
            last_showlist: Vec::new(),
        };

        cursor.advance(&[101, 102, 103, 104, 105], 2, 3);
        let query = cursor.query();
        let value = |key: &str| {
            query
                .iter()
                .find(|(candidate, _)| candidate == key)
                .map(|(_, value)| value.as_str())
        };

        assert_eq!(value("fresh_idx"), Some("3"));
        assert_eq!(value("fresh_idx_1h"), Some("4"));
        assert_eq!(value("fetch_row"), Some("3"));
        assert_eq!(
            value("last_showlist"),
            Some("av_101,av_102,av_103,av_104,av_105")
        );

        cursor.reset();
        let reset_query = cursor.query();
        assert!(reset_query
            .iter()
            .any(|(key, value)| { key == "fresh_idx" && value == "1" }));
        assert!(reset_query
            .iter()
            .any(|(key, value)| { key == "brush" && value == "2" }));
        assert!(!reset_query.iter().any(|(key, _)| key == "last_showlist"));
    }

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

    #[test]
    fn dash_streams_use_actual_video_ids_and_best_standard_audio() {
        let dash = json!({
            "video": [
                {
                    "id": 64,
                    "baseUrl": "https://example.com/video-64-hevc.m4s",
                    "codecs": "hev1.1.6.L120.90",
                    "bandwidth": 2000000
                },
                {
                    "id": 64,
                    "baseUrl": "https://example.com/video-64-avc.m4s",
                    "codecs": "avc1.640028",
                    "bandwidth": 1800000
                },
                {
                    "id": 80,
                    "baseUrl": "https://example.com/video-80.m4s",
                    "backupUrl": [
                        "https://cdn.example.com/video-80.m4s",
                        "https://cdn.example.com/video-80.m4s"
                    ],
                    "codecs": "avc1.640032",
                    "bandwidth": 3000000
                }
            ],
            "audio": [
                {
                    "baseUrl": "https://example.com/audio-low.m4s",
                    "codecs": "mp4a.40.2",
                    "bandwidth": 64000
                },
                {
                    "baseUrl": "https://example.com/audio-high.m4s",
                    "backup_url": [
                        "https://cdn.example.com/audio-high.m4s",
                        "https://example.com/audio-high.m4s"
                    ],
                    "codecs": "mp4a.40.2",
                    "bandwidth": 192000
                }
            ],
            "dolby": {
                "audio": [
                    {
                        "baseUrl": "https://example.com/audio-dolby.m4s",
                        "codecs": "ec-3",
                        "bandwidth": 384000
                    }
                ]
            },
            "flac": {
                "audio": [
                    {
                        "baseUrl": "https://example.com/audio-flac.m4s",
                        "codecs": "flac",
                        "bandwidth": 900000
                    }
                ]
            }
        });

        let streams = parse_dash_streams(&dash);
        assert_eq!(streams.len(), 2);
        assert_eq!(streams[0].quality_id, 80);
        assert_eq!(
            streams[0].backup_urls,
            vec!["https://cdn.example.com/video-80.m4s"]
        );
        assert_eq!(streams[1].quality_id, 64);
        assert_eq!(streams[1].protocol, StreamProtocol::Dash);
        assert_eq!(streams[1].url, "https://example.com/video-64-avc.m4s");
        assert_eq!(
            streams[1].audio_url.as_deref(),
            Some("https://example.com/audio-high.m4s")
        );
        assert_eq!(
            streams[1].audio_backup_urls,
            vec!["https://cdn.example.com/audio-high.m4s"]
        );
        assert_eq!(streams[1].audio_codec.as_deref(), Some("mp4a.40.2"));
        assert_eq!(dash_audio_items(&dash).len(), 4);
    }
}
