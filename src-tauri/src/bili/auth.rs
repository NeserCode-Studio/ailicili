use std::{
    collections::HashMap,
    sync::Mutex,
    time::{Duration, Instant},
};

use qrcode::{render::svg, QrCode};
use reqwest::header::{COOKIE, SET_COOKIE};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::{client::BiliClient, error::BiliError, session::Session, types::image_url};

const NAV_URL: &str = "https://api.bilibili.com/x/web-interface/nav";
const QR_GENERATE_URL: &str = "https://passport.bilibili.com/x/passport-login/web/qrcode/generate";
const QR_POLL_URL: &str = "https://passport.bilibili.com/x/passport-login/web/qrcode/poll";
const LOGIN_ATTEMPT_TTL: Duration = Duration::from_secs(180);
const LOGIN_ATTEMPT_TTL_SECONDS: u64 = 180;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthStatus {
    pub authenticated: bool,
    pub storage_available: bool,
    pub profile: Option<AccountProfile>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountProfile {
    pub mid: String,
    pub name: String,
    pub avatar_url: String,
    pub level: u32,
    pub vip_status: bool,
    pub vip_label: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QrLoginStart {
    pub attempt_id: String,
    pub qr_svg: String,
    pub expires_in_seconds: u64,
}

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum QrLoginState {
    Waiting,
    Scanned,
    Confirmed,
    Expired,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QrLoginPoll {
    pub state: QrLoginState,
    pub profile: Option<AccountProfile>,
}

struct PendingLogin {
    qrcode_key: String,
    created_at: Instant,
}

pub struct PendingLogins {
    values: Mutex<HashMap<String, PendingLogin>>,
}

impl PendingLogins {
    pub fn new() -> Self {
        Self {
            values: Mutex::new(HashMap::new()),
        }
    }

    fn insert(&self, qrcode_key: String) -> String {
        let attempt_id = Uuid::new_v4().to_string();
        let mut values = self.values.lock().expect("pending login lock");
        values.retain(|_, pending| pending.created_at.elapsed() < LOGIN_ATTEMPT_TTL);
        values.insert(
            attempt_id.clone(),
            PendingLogin {
                qrcode_key,
                created_at: Instant::now(),
            },
        );
        attempt_id
    }

    fn get(&self, attempt_id: &str) -> Option<(String, Duration)> {
        self.values
            .lock()
            .expect("pending login lock")
            .get(attempt_id)
            .map(|pending| {
                (
                    pending.qrcode_key.clone(),
                    LOGIN_ATTEMPT_TTL.saturating_sub(pending.created_at.elapsed()),
                )
            })
    }

    fn remove(&self, attempt_id: &str) {
        self.values
            .lock()
            .expect("pending login lock")
            .remove(attempt_id);
    }
}

impl Default for PendingLogins {
    fn default() -> Self {
        Self::new()
    }
}

impl BiliClient {
    pub async fn auth_status(&self) -> Result<AuthStatus, BiliError> {
        let had_session = self.session.has_session().await;
        let authenticated = self.fetch_nav_profile().await?;

        if authenticated.is_none() && had_session {
            self.session.clear_invalid().await;
            self.wbi.invalidate().await;
        }

        Ok(AuthStatus {
            authenticated: authenticated.is_some(),
            storage_available: self.session.storage_available(),
            profile: authenticated,
        })
    }

    pub async fn login_start(&self) -> Result<QrLoginStart, BiliError> {
        let response = self.http.get(QR_GENERATE_URL).send().await?;
        let status = response.status();
        if !status.is_success() {
            return Err(BiliError::HttpStatus(status.as_u16()));
        }
        let envelope: Envelope<QrGenerateData> = response.json().await?;
        if envelope.code != 0 {
            return Err(BiliError::Upstream {
                code: envelope.code,
                message: truncate_message(&envelope.message),
            });
        }
        let data = envelope.data.ok_or(BiliError::MissingData)?;
        if !data.url.starts_with("https://") || data.qrcode_key.is_empty() {
            return Err(BiliError::InvalidResponse("invalid QR login payload"));
        }

        let code = QrCode::new(data.url.as_bytes())
            .map_err(|_| BiliError::InvalidResponse("QR encode"))?;
        let qr_svg = code
            .render::<svg::Color>()
            .min_dimensions(256, 256)
            .quiet_zone(true)
            .dark_color(svg::Color("#161616"))
            .light_color(svg::Color("#ffffff"))
            .build();
        let attempt_id = self.pending_logins.insert(data.qrcode_key);

        Ok(QrLoginStart {
            attempt_id,
            qr_svg,
            expires_in_seconds: LOGIN_ATTEMPT_TTL_SECONDS,
        })
    }

    pub async fn login_poll(&self, attempt_id: &str) -> Result<QrLoginPoll, BiliError> {
        let (qrcode_key, remaining) = self
            .pending_logins
            .get(attempt_id)
            .ok_or(BiliError::LoginAttemptExpired)?;
        if remaining.is_zero() {
            self.pending_logins.remove(attempt_id);
            return Ok(QrLoginPoll {
                state: QrLoginState::Expired,
                profile: None,
            });
        }

        let response = self
            .http
            .get(QR_POLL_URL)
            .query(&[("qrcode_key", qrcode_key)])
            .send()
            .await?;
        let status = response.status();
        if !status.is_success() {
            return Err(BiliError::HttpStatus(status.as_u16()));
        }
        let cookies = collect_session_cookies(response.headers());
        let envelope: Envelope<QrPollData> = response.json().await?;
        if envelope.code != 0 {
            return Err(BiliError::Upstream {
                code: envelope.code,
                message: truncate_message(&envelope.message),
            });
        }
        let data = envelope.data.ok_or(BiliError::MissingData)?;

        match data.code {
            86_101 => Ok(QrLoginPoll {
                state: QrLoginState::Waiting,
                profile: None,
            }),
            86_090 => Ok(QrLoginPoll {
                state: QrLoginState::Scanned,
                profile: None,
            }),
            86_038 => {
                self.pending_logins.remove(attempt_id);
                Ok(QrLoginPoll {
                    state: QrLoginState::Expired,
                    profile: None,
                })
            }
            0 => {
                self.pending_logins.remove(attempt_id);
                let session = Session::from_cookie_pairs(cookies)?;
                self.session.replace(session).await?;
                self.wbi.invalidate().await;
                let profile = self.fetch_nav_profile().await.ok().flatten();
                Ok(QrLoginPoll {
                    state: QrLoginState::Confirmed,
                    profile,
                })
            }
            _ => Err(BiliError::InvalidResponse("unknown QR login state")),
        }
    }

    pub async fn logout(&self) -> Result<(), BiliError> {
        self.session.logout().await?;
        self.wbi.invalidate().await;
        Ok(())
    }

    async fn fetch_nav_profile(&self) -> Result<Option<AccountProfile>, BiliError> {
        let mut request = self.http.get(NAV_URL);
        if let Some(cookie_header) = self.session.cookie_header().await {
            request = request.header(COOKIE, cookie_header);
        }
        let response = request.send().await?;
        let status = response.status();
        if !status.is_success() {
            return Err(BiliError::HttpStatus(status.as_u16()));
        }
        let envelope: Envelope<NavData> = response.json().await?;
        if envelope.code == -101 {
            return Ok(None);
        }
        if envelope.code != 0 {
            return Err(BiliError::Upstream {
                code: envelope.code,
                message: truncate_message(&envelope.message),
            });
        }
        let data = envelope.data.ok_or(BiliError::MissingData)?;
        if !data.is_login {
            return Ok(None);
        }

        Ok(Some(AccountProfile {
            mid: data.mid.to_string(),
            name: data.uname,
            avatar_url: image_url(&data.face, "@128w_128h_1c.webp"),
            level: data.level_info.current_level,
            vip_status: data.vip_status == 1,
            vip_label: data.vip_label.text.filter(|label| !label.is_empty()),
        }))
    }
}

fn collect_session_cookies(headers: &reqwest::header::HeaderMap) -> Vec<(String, String)> {
    headers
        .get_all(SET_COOKIE)
        .iter()
        .filter_map(|header| header.to_str().ok())
        .filter_map(|header| header.split(';').next())
        .filter_map(|pair| pair.split_once('='))
        .map(|(name, value)| (name.trim().to_owned(), value.trim().to_owned()))
        .collect()
}

fn truncate_message(message: &str) -> String {
    message.chars().take(160).collect()
}

#[derive(Deserialize)]
struct Envelope<T> {
    code: i64,
    #[serde(default)]
    message: String,
    data: Option<T>,
}

#[derive(Deserialize)]
struct QrGenerateData {
    url: String,
    qrcode_key: String,
}

#[derive(Deserialize)]
struct QrPollData {
    code: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NavData {
    is_login: bool,
    #[serde(default)]
    mid: u64,
    #[serde(default)]
    uname: String,
    #[serde(default)]
    face: String,
    #[serde(default)]
    level_info: LevelInfo,
    #[serde(default)]
    vip_status: i32,
    #[serde(default)]
    vip_label: VipLabel,
}

#[derive(Default, Deserialize)]
struct LevelInfo {
    #[serde(default)]
    current_level: u32,
}

#[derive(Default, Deserialize)]
struct VipLabel {
    #[serde(default)]
    text: Option<String>,
}

#[cfg(test)]
mod tests {
    use reqwest::header::{HeaderMap, HeaderValue, SET_COOKIE};

    use super::{collect_session_cookies, truncate_message};
    use crate::bili::{client::BiliClient, session::Session};

    #[test]
    fn extracts_only_the_required_cookie_pairs_from_set_cookie_headers() {
        let mut headers = HeaderMap::new();
        for value in [
            "SESSDATA=session-value; Path=/; HttpOnly; Secure",
            "bili_jct=csrf-value; Path=/",
            "DedeUserID=42; Path=/",
            "DedeUserID__ckMd5=check-value; Path=/",
            "buvid3=guest-value; Path=/",
        ] {
            headers.append(SET_COOKIE, HeaderValue::from_static(value));
        }

        let cookies = collect_session_cookies(&headers);
        let session = Session::from_cookie_pairs(cookies).expect("complete session");
        assert_eq!(session.cookie_pairs().count(), 4);
        assert!(!session.cookie_pairs().any(|(name, _)| name.eq("buvid3")));
    }

    #[test]
    fn cookie_parser_never_returns_header_attributes() {
        let mut headers = HeaderMap::new();
        headers.append(
            SET_COOKIE,
            HeaderValue::from_static("SESSDATA=abc; Path=/; HttpOnly"),
        );
        assert_eq!(
            collect_session_cookies(&headers),
            vec![("SESSDATA".to_owned(), "abc".to_owned())]
        );
    }

    #[test]
    fn upstream_messages_are_bounded() {
        assert_eq!(truncate_message(&"a".repeat(200)).len(), 160);
    }

    #[ignore = "requires network access to Bilibili"]
    #[tokio::test]
    async fn live_qr_generation_smoke() {
        let client = BiliClient::new().expect("client");
        let status = client.auth_status().await.expect("account status");
        assert!(status.storage_available);
        let start = client.login_start().await.expect("QR login start");
        assert!(!start.attempt_id.is_empty());
        assert!(start.qr_svg.contains("<svg"));
        assert_eq!(start.expires_in_seconds, 180);
    }
}
