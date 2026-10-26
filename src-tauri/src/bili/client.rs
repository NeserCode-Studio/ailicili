use std::{collections::BTreeMap, sync::Arc, time::Duration};

use reqwest::{
    header::{HeaderMap, HeaderValue, ACCEPT, ACCEPT_LANGUAGE, ORIGIN, REFERER},
    Client,
};
use serde::{de::DeserializeOwned, Deserialize};
use tokio::sync::RwLock;

use super::{
    auth::PendingLogins,
    error::BiliError,
    live::LiveMediaSessions,
    live_chat::LiveChatSessions,
    playurl::MediaSessions,
    session::{KeyringSessionStore, SessionManager},
    types::{PopularPage, RawPopularData, RawVideoDetailData, VideoDetail},
    wbi::WbiCache,
};

const API_BASE: &str = "https://api.bilibili.com";
const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) \
AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

#[derive(Debug, Deserialize)]
pub(crate) struct ApiEnvelope<T> {
    pub code: i64,
    #[serde(default)]
    pub message: String,
    pub data: Option<T>,
}

pub struct BiliClient {
    pub(crate) http: Client,
    pub(crate) session: SessionManager,
    pub(crate) wbi: WbiCache,
    pub(crate) pending_logins: PendingLogins,
    pub(crate) guest_cookies: RwLock<Option<BTreeMap<String, String>>>,
    pub(crate) media: Arc<MediaSessions>,
    pub(crate) live_media: Arc<LiveMediaSessions>,
    pub(crate) live_chat: Arc<LiveChatSessions>,
}

impl BiliClient {
    pub fn new() -> Result<Self, reqwest::Error> {
        let mut headers = HeaderMap::new();
        headers.insert(
            REFERER,
            HeaderValue::from_static("https://www.bilibili.com/"),
        );
        headers.insert(ORIGIN, HeaderValue::from_static("https://www.bilibili.com"));
        headers.insert(ACCEPT, HeaderValue::from_static("application/json"));
        headers.insert(
            ACCEPT_LANGUAGE,
            HeaderValue::from_static("zh-CN,zh;q=0.9,en;q=0.7"),
        );

        let http = Client::builder()
            .default_headers(headers)
            .user_agent(USER_AGENT)
            .connect_timeout(Duration::from_secs(8))
            .timeout(Duration::from_secs(15))
            .build()?;

        Ok(Self {
            http,
            session: SessionManager::new(Arc::new(KeyringSessionStore)),
            wbi: WbiCache::new(),
            pending_logins: PendingLogins::new(),
            guest_cookies: RwLock::new(None),
            media: Arc::new(MediaSessions::new()),
            live_media: Arc::new(LiveMediaSessions::new()),
            live_chat: Arc::new(LiveChatSessions::new()),
        })
    }

    pub(crate) async fn get<T>(&self, path: &str, query: &[(&str, String)]) -> Result<T, BiliError>
    where
        T: for<'de> Deserialize<'de>,
    {
        let response = self
            .http
            .get(format!("{API_BASE}{path}"))
            .query(query)
            .send()
            .await?;
        let status = response.status();
        if !status.is_success() {
            return Err(BiliError::HttpStatus(status.as_u16()));
        }

        let envelope: ApiEnvelope<T> = response.json().await?;
        if envelope.code != 0 {
            return Err(BiliError::Upstream {
                code: envelope.code,
                message: envelope.message.chars().take(160).collect::<String>(),
            });
        }

        envelope.data.ok_or(BiliError::MissingData)
    }

    pub(crate) async fn get_authenticated<T>(
        &self,
        path: &str,
        query: &[(&str, String)],
    ) -> Result<T, BiliError>
    where
        T: DeserializeOwned,
    {
        let cookie_header = self
            .session
            .cookie_header()
            .await
            .ok_or(BiliError::AuthenticationRequired)?;
        let response = self
            .http
            .get(format!("{API_BASE}{path}"))
            .header(reqwest::header::COOKIE, cookie_header)
            .query(query)
            .send()
            .await?;
        let status = response.status();
        if !status.is_success() {
            return Err(BiliError::HttpStatus(status.as_u16()));
        }

        let envelope: ApiEnvelope<T> = response.json().await?;
        if envelope.code != 0 {
            return Err(BiliError::Upstream {
                code: envelope.code,
                message: envelope.message.chars().take(160).collect::<String>(),
            });
        }

        envelope.data.ok_or(BiliError::MissingData)
    }

    pub(crate) async fn post_authenticated_form(
        &self,
        path: &str,
        mut form: BTreeMap<String, String>,
    ) -> Result<serde_json::Value, BiliError> {
        let csrf = self
            .session
            .csrf_token()
            .await
            .ok_or(BiliError::AuthenticationRequired)?;
        let cookie_header = self
            .session
            .cookie_header()
            .await
            .ok_or(BiliError::AuthenticationRequired)?;
        form.insert("csrf".to_owned(), csrf);

        let response = self
            .http
            .post(format!("{API_BASE}{path}"))
            .header(reqwest::header::COOKIE, cookie_header)
            .form(&form)
            .send()
            .await?;
        let status = response.status();
        if !status.is_success() {
            return Err(BiliError::HttpStatus(status.as_u16()));
        }

        let envelope: ApiEnvelope<serde_json::Value> = response.json().await?;
        if envelope.code != 0 {
            return Err(BiliError::Upstream {
                code: envelope.code,
                message: envelope.message.chars().take(160).collect::<String>(),
            });
        }
        Ok(envelope.data.unwrap_or(serde_json::Value::Null))
    }

    pub(crate) async fn session_user_id(&self) -> Result<String, BiliError> {
        self.session
            .user_id()
            .await
            .ok_or(BiliError::AuthenticationRequired)
    }

    pub async fn popular_videos(
        &self,
        page: u32,
        page_size: u32,
    ) -> Result<PopularPage, BiliError> {
        let page = page.clamp(1, 100);
        let page_size = page_size.clamp(1, 50);
        let data: RawPopularData = self
            .get(
                "/x/web-interface/popular",
                &[("pn", page.to_string()), ("ps", page_size.to_string())],
            )
            .await?;
        let has_more = !data.no_more && data.list.len() >= page_size as usize;

        Ok(PopularPage {
            videos: data
                .list
                .into_iter()
                .map(|video| video.into_summary())
                .collect(),
            page,
            page_size,
            has_more,
        })
    }

    pub async fn video_detail(&self, bvid: &str) -> Result<VideoDetail, BiliError> {
        validate_bvid(bvid)?;
        let data: RawVideoDetailData = self
            .get("/x/web-interface/view", &[("bvid", bvid.to_owned())])
            .await?;

        Ok(data.into_detail())
    }
}

pub(crate) fn validate_bvid(bvid: &str) -> Result<(), BiliError> {
    let valid = bvid.starts_with("BV")
        && (10..=24).contains(&bvid.len())
        && bvid
            .chars()
            .all(|character| character.is_ascii_alphanumeric());

    if valid {
        Ok(())
    } else {
        Err(BiliError::InvalidInput("expected a BV identifier"))
    }
}

#[cfg(test)]
mod tests {
    use super::validate_bvid;

    #[test]
    fn accepts_expected_bvid_shape() {
        assert!(validate_bvid("BV19wnQ6sExk").is_ok());
    }

    #[test]
    fn rejects_path_injection_and_invalid_identifiers() {
        assert!(validate_bvid("../another-path").is_err());
        assert!(validate_bvid("av123").is_err());
        assert!(validate_bvid("BV/123").is_err());
    }
}
