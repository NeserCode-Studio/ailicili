use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, RwLock,
    },
    time::{Duration, Instant},
};

use log::{info, warn};
use qrcode::{render::svg, QrCode};
use reqwest::header::HeaderMap;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

use crate::{
    bilibili::{BiliError, BilibiliClient},
    domain::{
        AccountProfile, AccountStatus, BilibiliAccount, CaptchaProvider, CommandError,
        LoginCapabilities, QrLoginPoll, QrLoginStart, QrLoginStatus, SmsChallenge, SmsCodeSent,
    },
};

const CREDENTIAL_SERVICE: &str = "ailicili";
const CREDENTIAL_ACCOUNT: &str = "bilibili-session";
const QR_FLOW_TTL: Duration = Duration::from_secs(180);
const SMS_CHALLENGE_TTL: Duration = Duration::from_secs(300);
const SMS_FLOW_TTL: Duration = Duration::from_secs(300);
const SMS_RETRY_AFTER: Duration = Duration::from_secs(60);

pub type SharedSession = Arc<RwLock<Option<SessionCookies>>>;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub(crate) struct SessionCookies {
    pub sessdata: Option<String>,
    pub bili_jct: Option<String>,
    pub dede_user_id: Option<String>,
    pub dede_user_id_ck_md5: Option<String>,
    pub sid: Option<String>,
}

impl SessionCookies {
    pub fn from_response(headers: &HeaderMap, fallback_url: Option<&str>) -> Self {
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

    pub fn is_authenticated(&self) -> bool {
        self.sessdata
            .as_deref()
            .is_some_and(|value| !value.is_empty())
    }

    pub fn cookie_header(&self) -> String {
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

#[derive(Debug, thiserror::Error)]
pub enum CredentialStoreError {
    #[error("credential store is unavailable on this platform")]
    #[allow(dead_code)]
    Unavailable,
    #[error("credential store operation failed")]
    Backend,
}

pub trait CredentialStore: Send + Sync {
    fn load_session(&self) -> Result<Option<SessionCookies>, CredentialStoreError>;
    fn save_session(&self, session: &SessionCookies) -> Result<(), CredentialStoreError>;
    fn clear_session(&self) -> Result<(), CredentialStoreError>;
    fn is_available(&self) -> bool;
}

#[cfg(windows)]
struct NativeCredentialStore;

#[cfg(windows)]
impl NativeCredentialStore {
    fn entry() -> Result<keyring::Entry, CredentialStoreError> {
        keyring::Entry::new(CREDENTIAL_SERVICE, CREDENTIAL_ACCOUNT)
            .map_err(|_| CredentialStoreError::Backend)
    }
}

#[cfg(windows)]
impl CredentialStore for NativeCredentialStore {
    fn load_session(&self) -> Result<Option<SessionCookies>, CredentialStoreError> {
        match Self::entry()?.get_password() {
            Ok(value) => serde_json::from_str(&value)
                .map(Some)
                .map_err(|_| CredentialStoreError::Backend),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err(CredentialStoreError::Backend),
        }
    }

    fn save_session(&self, session: &SessionCookies) -> Result<(), CredentialStoreError> {
        let value = serde_json::to_string(session).map_err(|_| CredentialStoreError::Backend)?;
        Self::entry()?
            .set_password(&value)
            .map_err(|_| CredentialStoreError::Backend)
    }

    fn clear_session(&self) -> Result<(), CredentialStoreError> {
        match Self::entry()?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => Err(CredentialStoreError::Backend),
        }
    }

    fn is_available(&self) -> bool {
        true
    }
}

#[cfg(not(windows))]
struct NativeCredentialStore;

#[cfg(not(windows))]
impl CredentialStore for NativeCredentialStore {
    fn load_session(&self) -> Result<Option<SessionCookies>, CredentialStoreError> {
        Err(CredentialStoreError::Unavailable)
    }

    fn save_session(&self, _session: &SessionCookies) -> Result<(), CredentialStoreError> {
        Err(CredentialStoreError::Unavailable)
    }

    fn clear_session(&self) -> Result<(), CredentialStoreError> {
        Err(CredentialStoreError::Unavailable)
    }

    fn is_available(&self) -> bool {
        false
    }
}

#[cfg(test)]
#[derive(Default)]
struct MemoryCredentialStore {
    value: std::sync::Mutex<Option<String>>,
}

#[cfg(test)]
struct UnavailableCredentialStore;

#[cfg(test)]
impl CredentialStore for UnavailableCredentialStore {
    fn load_session(&self) -> Result<Option<SessionCookies>, CredentialStoreError> {
        Err(CredentialStoreError::Unavailable)
    }

    fn save_session(&self, _session: &SessionCookies) -> Result<(), CredentialStoreError> {
        Err(CredentialStoreError::Unavailable)
    }

    fn clear_session(&self) -> Result<(), CredentialStoreError> {
        Err(CredentialStoreError::Unavailable)
    }

    fn is_available(&self) -> bool {
        false
    }
}

#[cfg(test)]
impl CredentialStore for MemoryCredentialStore {
    fn load_session(&self) -> Result<Option<SessionCookies>, CredentialStoreError> {
        let guard = self
            .value
            .lock()
            .map_err(|_| CredentialStoreError::Backend)?;
        guard
            .as_deref()
            .map(serde_json::from_str)
            .transpose()
            .map_err(|_| CredentialStoreError::Backend)
    }

    fn save_session(&self, session: &SessionCookies) -> Result<(), CredentialStoreError> {
        let value = serde_json::to_string(session).map_err(|_| CredentialStoreError::Backend)?;
        *self
            .value
            .lock()
            .map_err(|_| CredentialStoreError::Backend)? = Some(value);
        Ok(())
    }

    fn clear_session(&self) -> Result<(), CredentialStoreError> {
        *self
            .value
            .lock()
            .map_err(|_| CredentialStoreError::Backend)? = None;
        Ok(())
    }

    fn is_available(&self) -> bool {
        true
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
struct SmsFlow {
    country_code: String,
    phone: String,
    captcha_key: String,
    expires_at: Instant,
}

#[derive(Default)]
struct RuntimeState {
    initialized: bool,
    status: Option<AccountStatus>,
    profile: Option<AccountProfile>,
    message_code: Option<String>,
    qr_flows: HashMap<String, QrFlow>,
    sms_challenges: HashMap<String, SmsChallengeFlow>,
    sms_challenge_generation: u64,
    sms_flows: HashMap<String, SmsFlow>,
    sms_last_sent: Option<Instant>,
}

pub struct AccountManager {
    runtime: std::sync::Mutex<RuntimeState>,
    credentials: Box<dyn CredentialStore>,
    session: SharedSession,
}

impl AccountManager {
    pub fn new(session: SharedSession) -> Self {
        Self {
            runtime: std::sync::Mutex::new(RuntimeState::default()),
            credentials: Box::new(NativeCredentialStore),
            session,
        }
    }

    #[cfg(test)]
    fn with_store(session: SharedSession, credentials: Box<dyn CredentialStore>) -> Self {
        Self {
            runtime: std::sync::Mutex::new(RuntimeState::default()),
            credentials,
            session,
        }
    }

    pub fn login_capabilities(&self) -> LoginCapabilities {
        let credential_storage_available = self.credentials.is_available();
        LoginCapabilities {
            credential_storage_available,
            qr_available: !cfg!(target_os = "android") && credential_storage_available,
            sms_available: credential_storage_available,
        }
    }

    pub async fn get_account(&self, client: &BilibiliClient) -> Result<BilibiliAccount, BiliError> {
        self.initialize()?;
        let session = self.session_snapshot()?;
        let Some(session) = session else {
            return self.account_snapshot();
        };

        match client.account_profile(&session).await {
            Ok(profile) => {
                self.set_authenticated(profile)?;
                Ok(self.account_snapshot()?)
            }
            Err(BiliError::LoginExpired) => {
                self.set_status(AccountStatus::Expired, Some("login_expired".to_string()))?;
                Ok(self.account_snapshot()?)
            }
            Err(err) => {
                self.set_message_code(Some("profile_unavailable".to_string()))?;
                warn!(
                    target: "Account",
                    "account profile refresh failed code={}",
                    command_code(&err),
                );
                Ok(self.account_snapshot()?)
            }
        }
    }

    pub async fn refresh_account(
        &self,
        client: &BilibiliClient,
    ) -> Result<BilibiliAccount, BiliError> {
        self.get_account(client).await
    }

    pub async fn start_qr_login(&self, client: &BilibiliClient) -> Result<QrLoginStart, BiliError> {
        self.initialize()?;
        let root = client.qr_generate().await?;
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
        let image_data_url = format!("data:image/svg+xml,{}", urlencoding::encode(&svg));
        let login_id = Uuid::new_v4().simple().to_string();

        let mut runtime = self.runtime_lock()?;
        for flow in runtime.qr_flows.values() {
            flow.cancelled.store(true, Ordering::Release);
        }
        runtime.qr_flows.clear();
        runtime.qr_flows.insert(
            login_id.clone(),
            QrFlow {
                qrcode_key: qrcode_key.to_string(),
                expires_at: Instant::now() + QR_FLOW_TTL,
                cancelled: Arc::new(AtomicBool::new(false)),
            },
        );
        drop(runtime);
        info!(target: "Account", "qr login started");

        Ok(QrLoginStart {
            login_id,
            image_data_url,
            expires_in_seconds: QR_FLOW_TTL.as_secs(),
        })
    }

    pub async fn poll_qr_login(
        &self,
        client: &BilibiliClient,
        login_id: &str,
    ) -> Result<QrLoginPoll, BiliError> {
        let flow = self.qr_flow(login_id)?;
        if flow.is_cancelled() {
            return Ok(self.cancelled_qr_poll(login_id));
        }
        if flow.expires_at <= Instant::now() {
            self.remove_qr_flow(login_id)?;
            return Ok(QrLoginPoll {
                login_id: login_id.to_string(),
                status: QrLoginStatus::Expired,
                account: None,
                message_code: Some("qr_expired".to_string()),
            });
        }

        let (headers, root) = client.qr_poll(&flow.qrcode_key).await?;
        if flow.is_cancelled() {
            return Ok(self.cancelled_qr_poll(login_id));
        }
        let data = root
            .get("data")
            .ok_or_else(|| BiliError::Invalid("missing QR poll data".to_string()))?;
        let code = data.get("code").and_then(Value::as_i64).unwrap_or(-1);
        let status = match code {
            86101 => QrLoginStatus::Pending,
            86090 => QrLoginStatus::Scanned,
            86038 => {
                self.remove_qr_flow(login_id)?;
                QrLoginStatus::Expired
            }
            0 => {
                if flow.is_cancelled() {
                    return Ok(self.cancelled_qr_poll(login_id));
                }
                let fallback_url = data.get("url").and_then(Value::as_str);
                let session = SessionCookies::from_response(&headers, fallback_url);
                if !session.is_authenticated() {
                    self.remove_qr_flow(login_id)?;
                    return Ok(QrLoginPoll {
                        login_id: login_id.to_string(),
                        status: QrLoginStatus::Failed,
                        account: None,
                        message_code: Some("login_cookie_missing".to_string()),
                    });
                }
                let account = self.complete_login(client, session).await?;
                self.remove_qr_flow(login_id)?;
                info!(target: "Account", "qr login succeeded");
                return Ok(QrLoginPoll {
                    login_id: login_id.to_string(),
                    status: QrLoginStatus::Succeeded,
                    account: Some(account),
                    message_code: None,
                });
            }
            _ => QrLoginStatus::Failed,
        };

        Ok(QrLoginPoll {
            login_id: login_id.to_string(),
            status,
            account: None,
            message_code: (status == QrLoginStatus::Expired)
                .then(|| "qr_expired".to_string())
                .or_else(|| {
                    (status == QrLoginStatus::Failed).then(|| "qr_login_failed".to_string())
                }),
        })
    }

    pub fn cancel_qr_login(&self, login_id: &str) -> Result<(), BiliError> {
        self.remove_qr_flow(login_id)
    }

    pub async fn create_sms_challenge(
        &self,
        client: &BilibiliClient,
    ) -> Result<SmsChallenge, BiliError> {
        self.initialize()?;
        let generation = {
            let mut runtime = self.runtime_lock()?;
            runtime.sms_challenge_generation = runtime.sms_challenge_generation.wrapping_add(1);
            runtime.sms_challenges.clear();
            runtime.sms_challenge_generation
        };
        info!(
            target: "Account",
            "sms captcha request started generation={generation}"
        );
        let root = client.sms_captcha().await?;
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
                return Err(BiliError::Invalid(
                    "unsupported captcha provider".to_string(),
                ))
            }
        };
        if provider == CaptchaProvider::Geetest && (gt.is_none() || challenge.is_none()) {
            return Err(BiliError::Invalid(
                "incomplete Geetest challenge".to_string(),
            ));
        }
        let gt_present = gt.is_some();
        let challenge_present = challenge.is_some();
        let tencent_app_id_present = tencent_app_id.is_some();
        let challenge_id = Uuid::new_v4().simple().to_string();
        let mut runtime = self.runtime_lock()?;
        if runtime.sms_challenge_generation != generation {
            info!(
                target: "Account",
                "sms captcha response discarded generation={generation} current_generation={}",
                runtime.sms_challenge_generation,
            );
            return Err(BiliError::Invalid(
                "sms challenge request was superseded".to_string(),
            ));
        }
        runtime.sms_challenges.clear();
        runtime.sms_challenges.insert(
            challenge_id.clone(),
            SmsChallengeFlow {
                token: token.to_string(),
                expires_at: Instant::now() + SMS_CHALLENGE_TTL,
            },
        );
        drop(runtime);
        info!(
            target: "Account",
            "sms challenge created generation={generation} provider={provider:?} token_present=true gt_present={gt_present} challenge_present={challenge_present} tencent_app_id_present={tencent_app_id_present} ttl_seconds={} challenge_id_len={} gt_len={} challenge_len={}",
            SMS_CHALLENGE_TTL.as_secs(),
            challenge_id.len(),
            gt.as_deref().map(str::len).unwrap_or_default(),
            challenge.as_deref().map(str::len).unwrap_or_default(),
        );

        Ok(SmsChallenge {
            challenge_id,
            provider,
            gt,
            challenge,
            tencent_app_id,
            expires_in_seconds: SMS_CHALLENGE_TTL.as_secs(),
        })
    }

    pub async fn send_sms_code(
        &self,
        client: &BilibiliClient,
        challenge_id: &str,
        country_code: String,
        phone: String,
        captcha_challenge: String,
        validate: String,
        seccode: String,
    ) -> Result<SmsCodeSent, BiliError> {
        let country_code = normalize_country_code(&country_code)?;
        let phone = normalize_phone(&phone)?;
        let country_code_len = country_code.len();
        let phone_len = phone.len();
        {
            let runtime = self.runtime_lock()?;
            if runtime
                .sms_last_sent
                .is_some_and(|sent_at| sent_at + SMS_RETRY_AFTER > Instant::now())
            {
                return Err(BiliError::RateLimited);
            }
        }
        let challenge = {
            let mut runtime = self.runtime_lock()?;
            runtime
                .sms_challenges
                .remove(challenge_id)
                .ok_or_else(|| BiliError::Invalid("sms challenge not found".to_string()))?
        };
        if challenge.expires_at <= Instant::now() {
            return Err(BiliError::Api {
                code: 1007,
                message: "sms challenge expired".to_string(),
            });
        }
        if captcha_challenge.is_empty() || validate.is_empty() || seccode.is_empty() {
            return Err(BiliError::AuthRequired);
        }
        info!(
            target: "Account",
            "sms send request country_code_len={country_code_len} phone_len={phone_len} token_len={} challenge_len={} validate_len={} seccode_len={}",
            challenge.token.len(),
            captcha_challenge.len(),
            validate.len(),
            seccode.len(),
        );

        let root = client
            .send_sms_code(
                &country_code,
                &phone,
                &challenge.token,
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
        let captcha_key_len = captcha_key.len();
        info!(
            target: "Account",
            "sms send response captcha_key_present=true captcha_key_len={captcha_key_len} response_keys={:?} data_keys={:?}",
            root.as_object()
                .map(|object| object.keys().cloned().collect::<Vec<_>>())
                .unwrap_or_default(),
            root.get("data")
                .and_then(Value::as_object)
                .map(|object| object.keys().cloned().collect::<Vec<_>>())
                .unwrap_or_default(),
        );
        let sms_flow_id = Uuid::new_v4().simple().to_string();
        let mut runtime = self.runtime_lock()?;
        runtime.sms_last_sent = Some(Instant::now());
        runtime.sms_flows.clear();
        runtime.sms_flows.insert(
            sms_flow_id.clone(),
            SmsFlow {
                country_code,
                phone,
                captcha_key,
                expires_at: Instant::now() + SMS_FLOW_TTL,
            },
        );
        drop(runtime);
        info!(
            target: "Account",
            "sms code sent retry_after_seconds={} expires_in_seconds={}",
            SMS_RETRY_AFTER.as_secs(),
            SMS_FLOW_TTL.as_secs(),
        );

        Ok(SmsCodeSent {
            sms_flow_id,
            retry_after_seconds: SMS_RETRY_AFTER.as_secs(),
            expires_in_seconds: SMS_FLOW_TTL.as_secs(),
        })
    }

    pub async fn login_with_sms(
        &self,
        client: &BilibiliClient,
        sms_flow_id: &str,
        code: String,
    ) -> Result<BilibiliAccount, BiliError> {
        let code = normalize_sms_code(&code)?;
        let flow = {
            let runtime = self.runtime_lock()?;
            runtime
                .sms_flows
                .get(sms_flow_id)
                .cloned()
                .ok_or_else(|| BiliError::Invalid("sms flow not found".to_string()))?
        };
        if flow.expires_at <= Instant::now() {
            self.runtime_lock()?.sms_flows.remove(sms_flow_id);
            return Err(BiliError::Api {
                code: 1007,
                message: "sms flow expired".to_string(),
            });
        }

        let (headers, root) = client
            .login_with_sms(&flow.country_code, &flow.phone, &code, &flow.captcha_key)
            .await?;
        self.runtime_lock()?.sms_flows.remove(sms_flow_id);
        let fallback_url = root.pointer("/data/url").and_then(Value::as_str);
        let session = SessionCookies::from_response(&headers, fallback_url);
        info!(
            target: "Account",
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
            return Err(BiliError::AuthRequired);
        }
        let account = self.complete_login(client, session).await?;
        info!(
            target: "Account",
            "sms login succeeded profile_present={}",
            account.profile.is_some(),
        );
        Ok(account)
    }

    pub fn cancel_sms_login(
        &self,
        challenge_id: Option<&str>,
        sms_flow_id: Option<&str>,
    ) -> Result<(), BiliError> {
        let mut runtime = self.runtime_lock()?;
        if challenge_id.is_some() || (challenge_id.is_none() && sms_flow_id.is_none()) {
            runtime.sms_challenge_generation = runtime.sms_challenge_generation.wrapping_add(1);
            runtime.sms_challenges.clear();
        }
        if let Some(id) = challenge_id {
            runtime.sms_challenges.remove(id);
        }
        if let Some(id) = sms_flow_id {
            runtime.sms_flows.remove(id);
        }
        if challenge_id.is_none() && sms_flow_id.is_none() {
            runtime.sms_flows.clear();
        }
        Ok(())
    }

    pub fn logout(&self) -> Result<BilibiliAccount, BiliError> {
        self.credentials
            .clear_session()
            .map_err(map_credential_error)?;
        self.replace_session(None)?;
        let mut runtime = self.runtime_lock()?;
        runtime.status = Some(AccountStatus::Anonymous);
        runtime.profile = None;
        runtime.message_code = None;
        runtime.qr_flows.clear();
        runtime.sms_challenge_generation = runtime.sms_challenge_generation.wrapping_add(1);
        runtime.sms_challenges.clear();
        runtime.sms_flows.clear();
        drop(runtime);
        info!(target: "Account", "logout completed");
        Ok(BilibiliAccount::anonymous())
    }

    fn initialize(&self) -> Result<(), BiliError> {
        {
            let runtime = self.runtime_lock()?;
            if runtime.initialized {
                return Ok(());
            }
        }

        let loaded = self.credentials.load_session();
        let mut runtime = self.runtime_lock()?;
        if runtime.initialized {
            return Ok(());
        }
        runtime.initialized = true;
        match loaded {
            Ok(Some(session)) if session.is_authenticated() => {
                self.replace_session(Some(session))?;
                runtime.status = Some(AccountStatus::Authenticated);
            }
            Ok(_) => {
                self.replace_session(None)?;
                runtime.status = Some(AccountStatus::Anonymous);
            }
            Err(CredentialStoreError::Unavailable) => {
                runtime.status = Some(AccountStatus::Locked);
                runtime.message_code = Some("credential_store_unavailable".to_string());
            }
            Err(CredentialStoreError::Backend) => {
                runtime.status = Some(AccountStatus::Locked);
                runtime.message_code = Some("credential_store_error".to_string());
            }
        }
        Ok(())
    }

    async fn complete_login(
        &self,
        client: &BilibiliClient,
        session: SessionCookies,
    ) -> Result<BilibiliAccount, BiliError> {
        self.credentials
            .save_session(&session)
            .map_err(map_credential_error)?;
        self.replace_session(Some(session.clone()))?;

        let (profile, message_code) = match client.account_profile(&session).await {
            Ok(profile) => (Some(profile), None),
            Err(BiliError::LoginExpired) => {
                self.set_status(AccountStatus::Expired, Some("login_expired".to_string()))?;
                return self.account_snapshot();
            }
            Err(_) => (None, Some("profile_unavailable".to_string())),
        };
        let mut runtime = self.runtime_lock()?;
        runtime.initialized = true;
        runtime.status = Some(AccountStatus::Authenticated);
        runtime.profile = profile;
        runtime.message_code = message_code;
        drop(runtime);
        self.account_snapshot()
    }

    fn account_snapshot(&self) -> Result<BilibiliAccount, BiliError> {
        let runtime = self.runtime_lock()?;
        Ok(BilibiliAccount {
            status: runtime.status.unwrap_or(AccountStatus::Anonymous),
            profile: runtime.profile.clone(),
            message_code: runtime.message_code.clone(),
        })
    }

    fn set_authenticated(&self, profile: AccountProfile) -> Result<(), BiliError> {
        let mut runtime = self.runtime_lock()?;
        runtime.status = Some(AccountStatus::Authenticated);
        runtime.profile = Some(profile);
        runtime.message_code = None;
        Ok(())
    }

    fn set_status(
        &self,
        status: AccountStatus,
        message_code: Option<String>,
    ) -> Result<(), BiliError> {
        let mut runtime = self.runtime_lock()?;
        runtime.status = Some(status);
        runtime.message_code = message_code;
        Ok(())
    }

    fn set_message_code(&self, message_code: Option<String>) -> Result<(), BiliError> {
        self.runtime_lock()?.message_code = message_code;
        Ok(())
    }

    fn qr_flow(&self, login_id: &str) -> Result<QrFlow, BiliError> {
        self.runtime_lock()?
            .qr_flows
            .get(login_id)
            .cloned()
            .ok_or_else(|| BiliError::Invalid("QR login flow not found".to_string()))
    }

    fn remove_qr_flow(&self, login_id: &str) -> Result<(), BiliError> {
        if let Some(flow) = self.runtime_lock()?.qr_flows.remove(login_id) {
            flow.cancelled.store(true, Ordering::Release);
        }
        Ok(())
    }

    fn cancelled_qr_poll(&self, login_id: &str) -> QrLoginPoll {
        QrLoginPoll {
            login_id: login_id.to_string(),
            status: QrLoginStatus::Failed,
            account: None,
            message_code: Some("qr_login_cancelled".to_string()),
        }
    }

    fn session_snapshot(&self) -> Result<Option<SessionCookies>, BiliError> {
        self.session
            .read()
            .map(|session| session.clone())
            .map_err(|_| BiliError::Storage("session lock poisoned".to_string()))
    }

    fn replace_session(&self, session: Option<SessionCookies>) -> Result<(), BiliError> {
        *self
            .session
            .write()
            .map_err(|_| BiliError::Storage("session lock poisoned".to_string()))? = session;
        Ok(())
    }

    fn runtime_lock(&self) -> Result<std::sync::MutexGuard<'_, RuntimeState>, BiliError> {
        self.runtime
            .lock()
            .map_err(|_| BiliError::Storage("account state lock poisoned".to_string()))
    }
}

impl From<BiliError> for CommandError {
    fn from(error: BiliError) -> Self {
        match &error {
            BiliError::Network(_) => CommandError::with_action(
                "networkError",
                "网络请求失败，请检查网络后重试。",
                "retry",
            ),
            BiliError::Api { code: -101, .. } | BiliError::LoginExpired => {
                CommandError::with_action("loginExpired", "登录状态已失效，请重新登录。", "login")
            }
            BiliError::Api { code: 1006, .. } => {
                CommandError::with_action("smsCodeInvalid", "短信验证码不正确。", "editCode")
            }
            BiliError::Api { code: 1007, .. } => CommandError::with_action(
                "smsCodeExpired",
                "短信验证码已过期，请重新获取。",
                "refresh",
            ),
            BiliError::Api { code: -400, .. } => CommandError::with_action(
                "smsRequestInvalid",
                "短信请求参数无效，请检查区号和手机号。",
                "editPhone",
            ),
            BiliError::Api { code: -352, .. } => CommandError::with_action(
                "riskControl",
                "平台风控校验未通过，请稍后重试或重新登录。",
                "retryLater",
            ),
            BiliError::Api { code: -412, .. } | BiliError::RateLimited => {
                CommandError::with_action("rateLimited", "请求过于频繁，请稍后再试。", "retryLater")
            }
            BiliError::Api { code, .. } => CommandError::new(
                format!("bilibiliApiError:{code}"),
                "平台返回了未处理的错误。",
            ),
            BiliError::AuthRequired => {
                CommandError::with_action("authRequired", "此操作需要登录。", "login")
            }
            BiliError::NoCompatibleStream => CommandError::new(
                "noCompatibleStream",
                "当前账号或视频没有可播放的兼容 MP4 流。",
            ),
            BiliError::CredentialLocked | BiliError::CredentialStore(_) => {
                CommandError::with_action(
                    "credentialStoreError",
                    "无法安全读取或保存登录凭据。",
                    "retry",
                )
            }
            BiliError::Storage(_) => {
                CommandError::new("storageError", "本地数据读写失败，请检查应用数据目录权限。")
            }
            BiliError::Invalid(_) => {
                CommandError::new("invalidResponse", "平台响应格式异常，请稍后重试。")
            }
        }
    }
}

fn map_credential_error(error: CredentialStoreError) -> BiliError {
    match error {
        CredentialStoreError::Unavailable => BiliError::CredentialLocked,
        CredentialStoreError::Backend => BiliError::CredentialStore(error.to_string()),
    }
}

fn command_code(error: &BiliError) -> String {
    match error {
        BiliError::Network(_) => "networkError".to_string(),
        BiliError::Api { code, .. } => format!("api:{code}"),
        BiliError::AuthRequired => "authRequired".to_string(),
        BiliError::LoginExpired => "loginExpired".to_string(),
        BiliError::RateLimited => "rateLimited".to_string(),
        BiliError::NoCompatibleStream => "noCompatibleStream".to_string(),
        BiliError::CredentialLocked => "credentialLocked".to_string(),
        BiliError::CredentialStore(_) => "credentialStoreError".to_string(),
        BiliError::Storage(_) => "storageError".to_string(),
        BiliError::Invalid(_) => "invalidResponse".to_string(),
    }
}

fn normalize_country_code(value: &str) -> Result<String, BiliError> {
    let normalized = value.trim().trim_start_matches('+');
    if normalized.is_empty()
        || normalized.len() > 4
        || !normalized
            .chars()
            .all(|character| character.is_ascii_digit())
    {
        return Err(BiliError::Invalid("invalid country code".to_string()));
    }
    Ok(normalized.to_string())
}

fn normalize_phone(value: &str) -> Result<String, BiliError> {
    let normalized = value.trim().replace([' ', '-'], "");
    if normalized.len() < 6
        || normalized.len() > 15
        || !normalized
            .chars()
            .all(|character| character.is_ascii_digit())
    {
        return Err(BiliError::Invalid("invalid phone number".to_string()));
    }
    Ok(normalized)
}

fn normalize_sms_code(value: &str) -> Result<String, BiliError> {
    let normalized = value.trim();
    if normalized.len() != 6
        || !normalized
            .chars()
            .all(|character| character.is_ascii_digit())
    {
        return Err(BiliError::Invalid("invalid sms code".to_string()));
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
        assert!(!session.cookie_header().contains("unknown_cookie"));
    }

    #[test]
    fn credential_round_trip_uses_store_boundary() {
        let store = MemoryCredentialStore::default();
        let session = SessionCookies {
            sessdata: Some("secret".to_string()),
            dede_user_id: Some("42".to_string()),
            ..Default::default()
        };
        store.save_session(&session).unwrap();
        assert_eq!(
            store.load_session().unwrap().unwrap().sessdata.as_deref(),
            Some("secret")
        );
        store.clear_session().unwrap();
        assert!(store.load_session().unwrap().is_none());
    }

    #[test]
    fn manager_restores_session_without_plaintext_file() {
        let shared = Arc::new(RwLock::new(None));
        let store = Box::new(MemoryCredentialStore::default());
        let session = SessionCookies {
            sessdata: Some("secret".to_string()),
            dede_user_id: Some("42".to_string()),
            ..Default::default()
        };
        store.save_session(&session).unwrap();
        let manager = AccountManager::with_store(shared.clone(), store);
        manager.initialize().unwrap();
        assert_eq!(
            shared
                .read()
                .unwrap()
                .as_ref()
                .unwrap()
                .dede_user_id
                .as_deref(),
            Some("42")
        );
    }

    #[test]
    fn capabilities_do_not_advertise_login_without_credential_storage() {
        let manager = AccountManager::with_store(
            Arc::new(RwLock::new(None)),
            Box::new(UnavailableCredentialStore),
        );
        let capabilities = manager.login_capabilities();
        assert!(!capabilities.credential_storage_available);
        assert!(!capabilities.qr_available);
        assert!(!capabilities.sms_available);
    }

    #[test]
    fn sms_code_contract_requires_six_digits() {
        assert_eq!(normalize_sms_code("123456").unwrap(), "123456");
        assert!(normalize_sms_code("12345").is_err());
        assert!(normalize_sms_code("1234567").is_err());
        assert!(normalize_sms_code("12345a").is_err());
    }
}
