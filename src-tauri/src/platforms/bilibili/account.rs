use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, RwLock,
    },
    time::{Duration, Instant},
};

use log::info;
use qrcode::{render::svg, QrCode};
use reqwest::header::HeaderMap;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

use super::super::{
    AccountLoginEvent, AccountLoginOutcome, AccountLoginStart, AccountRefresh,
    PlatformAccountAdapter, PlatformError, PlatformFuture,
};
use crate::{
    bilibili::{BiliError, BilibiliClient},
    domain::{CaptchaProvider, LoginMethod, PlatformLoginChallenge, PlatformLoginInput},
};

const QR_FLOW_TTL: Duration = Duration::from_secs(180);
const SMS_CHALLENGE_TTL: Duration = Duration::from_secs(300);
const SMS_FLOW_TTL: Duration = Duration::from_secs(300);
const SMS_RETRY_AFTER: Duration = Duration::from_secs(60);

pub(crate) type SharedSession = Arc<RwLock<Option<SessionCookies>>>;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub(crate) struct SessionCookies {
    pub sessdata: Option<String>,
    pub bili_jct: Option<String>,
    pub dede_user_id: Option<String>,
    pub dede_user_id_ck_md5: Option<String>,
    pub sid: Option<String>,
}

impl SessionCookies {
    pub(crate) fn from_response(headers: &HeaderMap, fallback_url: Option<&str>) -> Self {
        let mut cookies = Self::default();
        for header in headers.get_all("set-cookie") {
            let Ok(value) = header.to_str() else {
                continue;
            };
            let Some((name, value)) = value.split_once('=') else {
                continue;
            };
            cookies.set(
                name.trim(),
                value.split(';').next().unwrap_or_default().trim(),
            );
        }
        if let Some(url) = fallback_url {
            if let Ok(parsed) = reqwest::Url::parse(url) {
                for (name, value) in parsed.query_pairs() {
                    cookies.set(&name, &value);
                }
            }
        }
        cookies
    }

    fn set(&mut self, name: &str, value: &str) {
        if value.is_empty() {
            return;
        }
        match name {
            "SESSDATA" => self.sessdata = Some(value.to_string()),
            "bili_jct" => self.bili_jct = Some(value.to_string()),
            "DedeUserID" => self.dede_user_id = Some(value.to_string()),
            "DedeUserID__ckMd5" => self.dede_user_id_ck_md5 = Some(value.to_string()),
            "sid" => self.sid = Some(value.to_string()),
            _ => {}
        }
    }

    pub(crate) fn is_authenticated(&self) -> bool {
        self.sessdata
            .as_deref()
            .is_some_and(|value| !value.is_empty())
    }

    pub(crate) fn authenticated_uid(&self) -> Option<u64> {
        self.dede_user_id
            .as_deref()
            .and_then(|value| value.parse::<u64>().ok())
            .filter(|value| *value > 0)
    }

    pub(crate) fn cookie_header(&self) -> String {
        [
            ("SESSDATA", self.sessdata.as_deref()),
            ("bili_jct", self.bili_jct.as_deref()),
            ("DedeUserID", self.dede_user_id.as_deref()),
            ("DedeUserID__ckMd5", self.dede_user_id_ck_md5.as_deref()),
            ("sid", self.sid.as_deref()),
        ]
        .into_iter()
        .filter_map(|(name, value)| value.map(|value| format!("{name}={value}")))
        .collect::<Vec<_>>()
        .join("; ")
    }
}

#[derive(Debug, Clone)]
struct QrFlow {
    qrcode_key: String,
    expires_at: Instant,
    cancelled: Arc<AtomicBool>,
}

impl QrFlow {
    fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::Acquire)
    }
}

#[derive(Debug, Clone)]
struct SmsChallengeFlow {
    token: String,
    expires_at: Instant,
}

#[derive(Debug, Clone)]
struct SmsCodeFlow {
    country_code: String,
    phone: String,
    captcha_key: String,
    expires_at: Instant,
}

#[derive(Debug, Clone)]
enum LoginFlow {
    Qr(QrFlow),
    SmsChallenge(SmsChallengeFlow),
    SmsCode(SmsCodeFlow),
}

#[derive(Default)]
struct LoginRuntime {
    generation: u64,
    flows: HashMap<String, LoginFlow>,
    last_sms_sent: Option<Instant>,
}

pub(super) struct BilibiliAccountAdapter {
    client: BilibiliClient,
    runtime: Mutex<LoginRuntime>,
}

impl BilibiliAccountAdapter {
    pub(super) fn new(client: BilibiliClient) -> Self {
        Self {
            client,
            runtime: Mutex::new(LoginRuntime::default()),
        }
    }

    fn runtime_lock(&self) -> Result<std::sync::MutexGuard<'_, LoginRuntime>, PlatformError> {
        self.runtime
            .lock()
            .map_err(|_| PlatformError::Storage("login state lock poisoned".to_string()))
    }

    fn begin_generation(&self) -> Result<u64, PlatformError> {
        let mut runtime = self.runtime_lock()?;
        runtime.generation = runtime.generation.wrapping_add(1);
        cancel_flows(&mut runtime.flows);
        runtime.flows.clear();
        Ok(runtime.generation)
    }

    fn flow(&self, flow_id: &str) -> Result<LoginFlow, PlatformError> {
        self.runtime_lock()?
            .flows
            .get(flow_id)
            .cloned()
            .ok_or_else(|| PlatformError::Invalid("login flow not found".to_string()))
    }

    fn remove_flow(&self, flow_id: &str) -> Result<(), PlatformError> {
        if let Some(flow) = self.runtime_lock()?.flows.remove(flow_id) {
            if let LoginFlow::Qr(flow) = flow {
                flow.cancelled.store(true, Ordering::Release);
            }
        }
        Ok(())
    }

    async fn start_qr_login(&self) -> Result<AccountLoginStart, PlatformError> {
        let generation = self.begin_generation()?;
        let root = self.client.qr_generate().await?;
        let data = root
            .get("data")
            .ok_or_else(|| BiliError::Invalid("missing QR data".to_string()))?;
        let url = data
            .get("url")
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| BiliError::Invalid("missing QR URL".to_string()))?;
        let qrcode_key = data
            .get("qrcode_key")
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| BiliError::Invalid("missing QR key".to_string()))?;
        let qr = QrCode::new(url.as_bytes())
            .map_err(|err| BiliError::Invalid(format!("cannot render QR: {err}")))?;
        let svg = qr
            .render::<svg::Color>()
            .min_dimensions(220, 220)
            .quiet_zone(true)
            .build();
        let image_data_url = format!("[image omitted]{}", urlencoding::encode(&svg));
        let flow_id = Uuid::new_v4().simple().to_string();

        let mut runtime = self.runtime_lock()?;
        if runtime.generation != generation {
            return Err(PlatformError::Invalid(
                "login start was superseded".to_string(),
            ));
        }
        runtime.flows.insert(
            flow_id.clone(),
            LoginFlow::Qr(QrFlow {
                qrcode_key: qrcode_key.to_string(),
                expires_at: Instant::now() + QR_FLOW_TTL,
                cancelled: Arc::new(AtomicBool::new(false)),
            }),
        );
        drop(runtime);
        info!(target: "Bilibili/Auth", "qr login started");

        Ok(AccountLoginStart {
            flow_id,
            method: LoginMethod::Qr,
            challenge: PlatformLoginChallenge::Qr { image_data_url },
            expires_in_seconds: QR_FLOW_TTL.as_secs(),
        })
    }

    async fn start_sms_login(&self) -> Result<AccountLoginStart, PlatformError> {
        let generation = self.begin_generation()?;
        let root = self.client.sms_captcha().await?;
        let data = root
            .get("data")
            .ok_or_else(|| BiliError::Invalid("missing captcha data".to_string()))?;
        let challenge_type = data.get("type").and_then(Value::as_str).unwrap_or_default();
        let token = data
            .get("token")
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| BiliError::Invalid("missing captcha token".to_string()))?;
        let (provider, gt, challenge, tencent_app_id) = match challenge_type {
            "geetest" => (
                CaptchaProvider::Geetest,
                data.pointer("/geetest/gt")
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned),
                data.pointer("/geetest/challenge")
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned),
                None,
            ),
            "tencent" => (
                CaptchaProvider::Tencent,
                None,
                None,
                data.pointer("/tencent/appid")
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned),
            ),
            _ => {
                return Err(PlatformError::from(BiliError::Invalid(
                    "unsupported captcha provider".to_string(),
                )))
            }
        };
        if provider == CaptchaProvider::Geetest && (gt.is_none() || challenge.is_none()) {
            return Err(PlatformError::from(BiliError::Invalid(
                "incomplete Geetest challenge".to_string(),
            )));
        }

        let flow_id = Uuid::new_v4().simple().to_string();
        let mut runtime = self.runtime_lock()?;
        if runtime.generation != generation {
            return Err(PlatformError::Invalid(
                "login start was superseded".to_string(),
            ));
        }
        runtime.flows.insert(
            flow_id.clone(),
            LoginFlow::SmsChallenge(SmsChallengeFlow {
                token: token.to_string(),
                expires_at: Instant::now() + SMS_CHALLENGE_TTL,
            }),
        );
        drop(runtime);
        info!(
            target: "Bilibili/Auth",
            "sms challenge created provider={provider:?} gt_present={} challenge_present={} tencent_app_id_present={} ttl_seconds={}",
            gt.is_some(),
            challenge.is_some(),
            tencent_app_id.is_some(),
            SMS_CHALLENGE_TTL.as_secs(),
        );

        Ok(AccountLoginStart {
            flow_id,
            method: LoginMethod::Sms,
            challenge: PlatformLoginChallenge::SmsCaptcha {
                provider,
                gt,
                challenge,
                tencent_app_id,
            },
            expires_in_seconds: SMS_CHALLENGE_TTL.as_secs(),
        })
    }

    async fn submit_sms_captcha(
        &self,
        flow_id: &str,
        country_code: String,
        phone: String,
        captcha_challenge: String,
        validate: String,
        seccode: String,
    ) -> Result<AccountLoginEvent, PlatformError> {
        let country_code = normalize_country_code(&country_code)?;
        let phone = normalize_phone(&phone)?;
        if captcha_challenge.is_empty() || validate.is_empty() || seccode.is_empty() {
            return Err(PlatformError::from(BiliError::AuthRequired));
        }

        let flow = self.flow(flow_id)?;
        let LoginFlow::SmsChallenge(flow) = flow else {
            return Err(PlatformError::Invalid(
                "sms login flow is not awaiting captcha".to_string(),
            ));
        };
        if flow.expires_at <= Instant::now() {
            self.remove_flow(flow_id)?;
            return Err(PlatformError::from(BiliError::Api {
                code: 1007,
                message: "sms challenge expired".to_string(),
            }));
        }
        {
            let runtime = self.runtime_lock()?;
            if runtime
                .last_sms_sent
                .is_some_and(|sent_at| sent_at + SMS_RETRY_AFTER > Instant::now())
            {
                return Err(PlatformError::from(BiliError::RateLimited));
            }
        }

        self.remove_flow(flow_id)?;
        info!(
            target: "Bilibili/Auth",
            "sms send request country_code_len={} phone_len={} token_len={} challenge_len={} validate_len={} seccode_len={}",
            country_code.len(),
            phone.len(),
            flow.token.len(),
            captcha_challenge.len(),
            validate.len(),
            seccode.len(),
        );
        let root = self
            .client
            .send_sms_code(
                &country_code,
                &phone,
                &flow.token,
                &captcha_challenge,
                &validate,
                &seccode,
            )
            .await?;
        let captcha_key = root
            .pointer("/data/captcha_key")
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| BiliError::Invalid("missing captcha key".to_string()))?
            .to_string();

        let mut runtime = self.runtime_lock()?;
        runtime.last_sms_sent = Some(Instant::now());
        runtime.flows.insert(
            flow_id.to_string(),
            LoginFlow::SmsCode(SmsCodeFlow {
                country_code,
                phone,
                captcha_key,
                expires_at: Instant::now() + SMS_FLOW_TTL,
            }),
        );
        drop(runtime);
        info!(
            target: "Bilibili/Auth",
            "sms code sent retry_after_seconds={} expires_in_seconds={}",
            SMS_RETRY_AFTER.as_secs(),
            SMS_FLOW_TTL.as_secs(),
        );
        Ok(AccountLoginEvent {
            flow_id: flow_id.to_string(),
            outcome: AccountLoginOutcome::SmsCodeSent {
                retry_after_seconds: SMS_RETRY_AFTER.as_secs(),
                expires_in_seconds: SMS_FLOW_TTL.as_secs(),
            },
            message_code: None,
        })
    }

    async fn submit_sms_code(
        &self,
        flow_id: &str,
        code: String,
    ) -> Result<AccountLoginEvent, PlatformError> {
        let code = normalize_sms_code(&code)?;
        let flow = self.flow(flow_id)?;
        let LoginFlow::SmsCode(flow) = flow else {
            return Err(PlatformError::Invalid(
                "sms login flow is not awaiting a code".to_string(),
            ));
        };
        if flow.expires_at <= Instant::now() {
            self.remove_flow(flow_id)?;
            return Err(PlatformError::from(BiliError::Api {
                code: 1007,
                message: "sms flow expired".to_string(),
            }));
        }

        let (headers, root) = self
            .client
            .login_with_sms(&flow.country_code, &flow.phone, &code, &flow.captcha_key)
            .await?;
        self.remove_flow(flow_id)?;
        let fallback_url = root.pointer("/data/url").and_then(Value::as_str);
        let session = SessionCookies::from_response(&headers, fallback_url);
        info!(
            target: "Bilibili/Auth",
            "sms login response country_code_len={} phone_len={} code_len={} captcha_key_len={} sessdata_present={} bili_jct_present={} dede_user_id_present={}",
            flow.country_code.len(),
            flow.phone.len(),
            code.len(),
            flow.captcha_key.len(),
            session.sessdata.is_some(),
            session.bili_jct.is_some(),
            session.dede_user_id.is_some(),
        );
        if !session.is_authenticated() {
            return Err(PlatformError::from(BiliError::AuthRequired));
        }
        let credential = serialize_session(&session)?;
        info!(target: "Bilibili/Auth", "sms login credential accepted");
        Ok(AccountLoginEvent {
            flow_id: flow_id.to_string(),
            outcome: AccountLoginOutcome::Authenticated { credential },
            message_code: None,
        })
    }
}

impl PlatformAccountAdapter for BilibiliAccountAdapter {
    fn start_login<'a>(&'a self, method: LoginMethod) -> PlatformFuture<'a, AccountLoginStart> {
        Box::pin(async move {
            match method {
                LoginMethod::Qr => self.start_qr_login().await,
                LoginMethod::Sms => self.start_sms_login().await,
            }
        })
    }

    fn poll_login<'a>(&'a self, flow_id: &'a str) -> PlatformFuture<'a, AccountLoginEvent> {
        Box::pin(async move {
            let flow = self.flow(flow_id)?;
            let LoginFlow::Qr(flow) = flow else {
                return Err(PlatformError::Invalid(
                    "polling is only available for QR login".to_string(),
                ));
            };
            if flow.is_cancelled() {
                return Ok(login_event(
                    flow_id,
                    AccountLoginOutcome::Failed,
                    Some("qr_login_cancelled"),
                ));
            }
            if flow.expires_at <= Instant::now() {
                self.remove_flow(flow_id)?;
                return Ok(login_event(
                    flow_id,
                    AccountLoginOutcome::Expired,
                    Some("qr_expired"),
                ));
            }

            let (headers, root) = self.client.qr_poll(&flow.qrcode_key).await?;
            if flow.is_cancelled() {
                return Ok(login_event(
                    flow_id,
                    AccountLoginOutcome::Failed,
                    Some("qr_login_cancelled"),
                ));
            }
            let data = root
                .get("data")
                .ok_or_else(|| BiliError::Invalid("missing QR poll data".to_string()))?;
            let code = data.get("code").and_then(Value::as_i64).unwrap_or(-1);
            match code {
                86101 => Ok(login_event(flow_id, AccountLoginOutcome::Pending, None)),
                86090 => Ok(login_event(flow_id, AccountLoginOutcome::Scanned, None)),
                86038 => {
                    self.remove_flow(flow_id)?;
                    Ok(login_event(
                        flow_id,
                        AccountLoginOutcome::Expired,
                        Some("qr_expired"),
                    ))
                }
                0 => {
                    let fallback_url = data.get("url").and_then(Value::as_str);
                    let session = SessionCookies::from_response(&headers, fallback_url);
                    if !session.is_authenticated() {
                        self.remove_flow(flow_id)?;
                        return Ok(login_event(
                            flow_id,
                            AccountLoginOutcome::Failed,
                            Some("login_cookie_missing"),
                        ));
                    }
                    let credential = serialize_session(&session)?;
                    self.remove_flow(flow_id)?;
                    info!(target: "Bilibili/Auth", "qr login credential accepted");
                    Ok(login_event(
                        flow_id,
                        AccountLoginOutcome::Authenticated { credential },
                        None,
                    ))
                }
                _ => {
                    self.remove_flow(flow_id)?;
                    Ok(login_event(
                        flow_id,
                        AccountLoginOutcome::Failed,
                        Some("qr_login_failed"),
                    ))
                }
            }
        })
    }

    fn submit_login_input<'a>(
        &'a self,
        flow_id: &'a str,
        input: PlatformLoginInput,
    ) -> PlatformFuture<'a, AccountLoginEvent> {
        Box::pin(async move {
            match input {
                PlatformLoginInput::SmsCaptcha {
                    country_code,
                    phone,
                    challenge,
                    validate,
                    seccode,
                } => {
                    self.submit_sms_captcha(
                        flow_id,
                        country_code,
                        phone,
                        challenge,
                        validate,
                        seccode,
                    )
                    .await
                }
                PlatformLoginInput::SmsCode { code } => self.submit_sms_code(flow_id, code).await,
            }
        })
    }

    fn cancel_login(&self, flow_id: &str) -> Result<(), PlatformError> {
        self.remove_flow(flow_id)
    }

    fn restore_session(&self, credential: &str) -> Result<(), PlatformError> {
        let session = parse_session(credential)?;
        if !session.is_authenticated() {
            return Err(PlatformError::Invalid(
                "stored credential is not authenticated".to_string(),
            ));
        }
        self.client.replace_session(Some(session))?;
        self.client.invalidate_wbi_cache()?;
        Ok(())
    }

    fn refresh<'a>(&'a self, credential: &'a str) -> PlatformFuture<'a, AccountRefresh> {
        Box::pin(async move {
            let session = parse_session(credential)?;
            if !session.is_authenticated() {
                return Ok(AccountRefresh::Expired);
            }
            match self.client.account_profile(&session).await {
                Ok(profile) => Ok(AccountRefresh::Authenticated(profile)),
                Err(BiliError::LoginExpired) => Ok(AccountRefresh::Expired),
                Err(error) => Err(PlatformError::from(error)),
            }
        })
    }

    fn logout(&self, _credential: &str) -> Result<(), PlatformError> {
        self.client.replace_session(None)?;
        self.client.invalidate_wbi_cache()?;
        self.cancel_all_logins()?;
        info!(target: "Bilibili/Auth", "platform session cleared");
        Ok(())
    }

    fn reset_identity(&self) -> Result<(), PlatformError> {
        self.client
            .reset_device_identity()
            .map_err(PlatformError::from)
    }
}

impl BilibiliAccountAdapter {
    fn cancel_all_logins(&self) -> Result<(), PlatformError> {
        let mut runtime = self.runtime_lock()?;
        cancel_flows(&mut runtime.flows);
        runtime.flows.clear();
        runtime.generation = runtime.generation.wrapping_add(1);
        Ok(())
    }
}

fn cancel_flows(flows: &mut HashMap<String, LoginFlow>) {
    for flow in flows.values() {
        if let LoginFlow::Qr(flow) = flow {
            flow.cancelled.store(true, Ordering::Release);
        }
    }
}

fn serialize_session(session: &SessionCookies) -> Result<String, PlatformError> {
    serde_json::to_string(session)
        .map_err(|_| PlatformError::Storage("cannot serialize platform credential".to_string()))
}

fn parse_session(credential: &str) -> Result<SessionCookies, PlatformError> {
    serde_json::from_str(credential)
        .map_err(|_| PlatformError::Invalid("stored credential is invalid".to_string()))
}

fn login_event(
    flow_id: &str,
    outcome: AccountLoginOutcome,
    message_code: Option<&str>,
) -> AccountLoginEvent {
    AccountLoginEvent {
        flow_id: flow_id.to_string(),
        outcome,
        message_code: message_code.map(ToOwned::to_owned),
    }
}

fn normalize_country_code(value: &str) -> Result<String, PlatformError> {
    let normalized = value.trim().trim_start_matches('+');
    if normalized.is_empty()
        || normalized.len() > 4
        || !normalized
            .chars()
            .all(|character| character.is_ascii_digit())
    {
        return Err(PlatformError::Invalid("invalid country code".to_string()));
    }
    Ok(normalized.to_string())
}

fn normalize_phone(value: &str) -> Result<String, PlatformError> {
    let normalized = value.trim().replace([' ', '-'], "");
    if normalized.len() < 6
        || normalized.len() > 15
        || !normalized
            .chars()
            .all(|character| character.is_ascii_digit())
    {
        return Err(PlatformError::Invalid("invalid phone number".to_string()));
    }
    Ok(normalized)
}

fn normalize_sms_code(value: &str) -> Result<String, PlatformError> {
    let normalized = value.trim();
    if normalized.len() != 6
        || !normalized
            .chars()
            .all(|character| character.is_ascii_digit())
    {
        return Err(PlatformError::Invalid("invalid sms code".to_string()));
    }
    Ok(normalized.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_only_whitelisted_cookies() {
        let mut headers = HeaderMap::new();
        headers.append(
            "set-cookie",
            "SESSDATA=secret%2Cvalue; Path=/; HttpOnly".parse().unwrap(),
        );
        headers.append(
            "set-cookie",
            "DedeUserID=42; Path=/; HttpOnly".parse().unwrap(),
        );
        headers.append(
            "set-cookie",
            "unknown_cookie=drop-me; Path=/".parse().unwrap(),
        );

        let session = SessionCookies::from_response(&headers, None);
        assert_eq!(session.sessdata.as_deref(), Some("secret%2Cvalue"));
        assert_eq!(session.dede_user_id.as_deref(), Some("42"));
        assert!(session.is_authenticated());
        assert_eq!(session.authenticated_uid(), Some(42));
        assert!(!session.cookie_header().contains("unknown_cookie"));
    }

    #[test]
    fn credential_round_trip_remains_compatible() {
        let session = SessionCookies {
            sessdata: Some("secret".to_string()),
            bili_jct: Some("csrf".to_string()),
            dede_user_id: Some("42".to_string()),
            ..Default::default()
        };
        let payload = serialize_session(&session).unwrap();
        let parsed = parse_session(&payload).unwrap();
        assert_eq!(parsed.sessdata.as_deref(), Some("secret"));
        assert_eq!(parsed.dede_user_id.as_deref(), Some("42"));
    }

    #[test]
    fn login_and_relogin_restore_invalidate_wbi_cache() {
        let client = BilibiliClient::new(Arc::new(RwLock::new(None))).expect("client");
        let adapter = BilibiliAccountAdapter::new(client.clone());
        let credential = serialize_session(&SessionCookies {
            sessdata: Some("secret".to_string()),
            ..Default::default()
        })
        .unwrap();

        client.seed_wbi_cache_for_test();
        adapter.restore_session(&credential).unwrap();
        assert!(!client.has_wbi_cache_for_test());

        client.seed_wbi_cache_for_test();
        adapter.restore_session(&credential).unwrap();
        assert!(!client.has_wbi_cache_for_test());
    }

    #[test]
    fn logout_invalidates_wbi_cache() {
        let client = BilibiliClient::new(Arc::new(RwLock::new(None))).expect("client");
        let adapter = BilibiliAccountAdapter::new(client.clone());

        client.seed_wbi_cache_for_test();
        adapter.logout("credential").unwrap();

        assert!(!client.has_wbi_cache_for_test());
    }

    #[test]
    fn sms_code_contract_requires_six_digits() {
        assert_eq!(normalize_sms_code("123456").unwrap(), "123456");
        assert!(normalize_sms_code("12345").is_err());
        assert!(normalize_sms_code("1234567").is_err());
        assert!(normalize_sms_code("12345a").is_err());
    }

    #[test]
    fn phone_and_country_code_are_normalized_before_network_use() {
        assert_eq!(normalize_country_code("+86").unwrap(), "86");
        assert_eq!(normalize_phone(" 138-0013 8000 ").unwrap(), "13800138000");
        assert!(normalize_country_code("86x").is_err());
        assert!(normalize_phone("123").is_err());
    }
}
