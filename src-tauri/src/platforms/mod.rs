use std::{collections::HashMap, future::Future, pin::Pin, sync::Arc};

use reqwest::{header::HeaderMap, Response};

use crate::{
    bilibili::{BiliError, BilibiliClient},
    domain::{
        AccountMode, AccountProfile, CommandError, LiveDiscovery, LivePlaybackInfo, LiveRoomInfo,
        LoginMethod, PagedLiveRooms, PlatformAvailability, PlatformDescriptor, PlatformId,
        PlatformLoginChallenge, PlatformLoginInput,
    },
};

pub(crate) mod bilibili;
pub(crate) mod douyin;
pub(crate) mod huya;

pub(crate) type PlatformFuture<'a, T> =
    Pin<Box<dyn Future<Output = Result<T, PlatformError>> + Send + 'a>>;

#[derive(Debug, thiserror::Error)]
pub(crate) enum PlatformError {
    #[error("platform unavailable: {0}")]
    Unavailable(String),
    #[error("account capability unavailable: {0}")]
    AccountUnavailable(String),
    #[error("login expired")]
    LoginExpired,
    #[error("credential store locked")]
    CredentialLocked,
    #[error("credential store operation failed")]
    CredentialStore,
    #[error("storage: {0}")]
    Storage(String),
    #[error("invalid platform request: {0}")]
    Invalid(String),
    #[error("unsupported platform operation: {0}")]
    Unsupported(String),
    #[error("upstream platform request failed")]
    Upstream(CommandError),
}

impl From<BiliError> for PlatformError {
    fn from(error: BiliError) -> Self {
        match error {
            BiliError::LoginExpired => Self::LoginExpired,
            error => Self::Upstream(error.into()),
        }
    }
}

impl From<PlatformError> for CommandError {
    fn from(error: PlatformError) -> Self {
        match error {
            PlatformError::Unavailable(platform_id) => CommandError::with_action(
                "platformUnavailable",
                format!("平台 {platform_id} 当前不可用。"),
                "retryLater",
            ),
            PlatformError::AccountUnavailable(platform_id) => CommandError::new(
                "accountUnavailable",
                format!("平台 {platform_id} 不提供账号功能。"),
            ),
            PlatformError::LoginExpired => {
                CommandError::with_action("loginExpired", "登录状态已失效，请重新登录。", "login")
            }
            PlatformError::CredentialLocked | PlatformError::CredentialStore => {
                CommandError::with_action(
                    "credentialStoreError",
                    "无法安全读取或保存登录凭据。",
                    "retry",
                )
            }
            PlatformError::Storage(_) => {
                CommandError::new("storageError", "本地数据读写失败，请检查应用数据目录权限。")
            }
            PlatformError::Invalid(_) => {
                CommandError::new("invalidResponse", "平台响应格式异常，请稍后重试。")
            }
            PlatformError::Unsupported(_) => {
                CommandError::new("unsupportedOperation", "当前平台暂不支持此操作。")
            }
            PlatformError::Upstream(error) => error,
        }
    }
}

pub(crate) struct AccountLoginStart {
    pub flow_id: String,
    pub method: LoginMethod,
    pub challenge: PlatformLoginChallenge,
    pub expires_in_seconds: u64,
}

pub(crate) struct AccountLoginEvent {
    pub flow_id: String,
    pub outcome: AccountLoginOutcome,
    pub message_code: Option<String>,
}

pub(crate) enum AccountLoginOutcome {
    Pending,
    Scanned,
    SmsCodeSent {
        retry_after_seconds: u64,
        expires_in_seconds: u64,
    },
    Authenticated {
        credential: String,
    },
    Expired,
    Failed,
}

pub(crate) enum AccountRefresh {
    Authenticated(AccountProfile),
    Expired,
}

pub(crate) trait PlatformAccountAdapter: Send + Sync {
    fn start_login<'a>(&'a self, method: LoginMethod) -> PlatformFuture<'a, AccountLoginStart>;

    fn poll_login<'a>(&'a self, flow_id: &'a str) -> PlatformFuture<'a, AccountLoginEvent>;

    fn submit_login_input<'a>(
        &'a self,
        flow_id: &'a str,
        input: PlatformLoginInput,
    ) -> PlatformFuture<'a, AccountLoginEvent>;

    fn cancel_login(&self, flow_id: &str) -> Result<(), PlatformError>;

    fn restore_session(&self, credential: &str) -> Result<(), PlatformError>;

    fn refresh<'a>(&'a self, credential: &'a str) -> PlatformFuture<'a, AccountRefresh>;

    fn logout(&self, credential: &str) -> Result<(), PlatformError>;

    fn reset_identity(&self) -> Result<(), PlatformError>;
}

pub(crate) trait LivePlatformAdapter: Send + Sync {
    fn discover<'a>(&'a self) -> PlatformFuture<'a, LiveDiscovery>;

    fn search<'a>(&'a self, keyword: &'a str, page: u32) -> PlatformFuture<'a, PagedLiveRooms>;

    fn room_info<'a>(&'a self, room_id: &'a str) -> PlatformFuture<'a, LiveRoomInfo>;

    fn room_playback<'a>(
        &'a self,
        room_id: &'a str,
        quality: i64,
    ) -> PlatformFuture<'a, LivePlaybackInfo>;

    fn media_response<'a>(
        &'a self,
        url: &'a str,
        request_headers: &'a HeaderMap,
    ) -> PlatformFuture<'a, Response>;
}

pub(crate) trait PlatformIntegration: Send + Sync {
    fn descriptor(&self) -> &PlatformDescriptor;
    fn live_adapter(&self) -> Option<Arc<dyn LivePlatformAdapter>>;
    fn account_adapter(&self) -> Option<Arc<dyn PlatformAccountAdapter>>;
}

struct RegisteredPlatform {
    integration: Arc<dyn PlatformIntegration>,
}

impl RegisteredPlatform {
    fn new(integration: Arc<dyn PlatformIntegration>) -> Result<Self, String> {
        let descriptor = integration.descriptor();
        PlatformId::new(descriptor.id.as_str())?;
        if descriptor.display_name.trim().is_empty() {
            return Err("platform display name is empty".to_string());
        }

        let live = integration.live_adapter();
        if live.is_some() && descriptor.live_capability.is_none() {
            return Err("platform has a live adapter without live capability".to_string());
        }
        if descriptor.availability == PlatformAvailability::Available
            && descriptor.live_capability.is_some()
            && live.is_none()
        {
            return Err("available live platform is missing a live adapter".to_string());
        }

        let account = integration.account_adapter();
        match descriptor.account_capability.mode {
            AccountMode::None => {
                if account.is_some() {
                    return Err("account adapter registered without account capability".to_string());
                }
                if !descriptor.account_capability.login_methods.is_empty()
                    || descriptor.account_capability.supports_refresh
                    || descriptor.account_capability.supports_logout
                    || descriptor.account_capability.supports_device_reset
                {
                    return Err(
                        "platform without account capability exposes account actions".to_string(),
                    );
                }
            }
            AccountMode::Optional => {
                if account.is_none() {
                    return Err(
                        "account-capable platform is missing an account adapter".to_string()
                    );
                }
                if descriptor.account_capability.login_methods.is_empty() {
                    return Err("account-capable platform exposes no login method".to_string());
                }
            }
        }

        Ok(Self { integration })
    }

    fn descriptor(&self) -> &PlatformDescriptor {
        self.integration.descriptor()
    }
}

#[derive(Clone)]
pub(crate) struct PlatformRegistry {
    inner: Arc<PlatformRegistryInner>,
}

struct PlatformRegistryInner {
    ordered: Vec<RegisteredPlatform>,
    by_id: HashMap<PlatformId, usize>,
}

impl PlatformRegistry {
    pub(crate) fn register_builtins(client: BilibiliClient) -> Result<Self, String> {
        Self::new(vec![
            bilibili::register(client)?,
            douyin::register()?,
            huya::register()?,
        ])
    }

    fn new(platforms: Vec<RegisteredPlatform>) -> Result<Self, String> {
        let mut by_id = HashMap::with_capacity(platforms.len());
        for (index, platform) in platforms.iter().enumerate() {
            if by_id
                .insert(platform.descriptor().id.clone(), index)
                .is_some()
            {
                return Err(format!(
                    "duplicate platform registration: {}",
                    platform.descriptor().id
                ));
            }
        }
        Ok(Self {
            inner: Arc::new(PlatformRegistryInner {
                ordered: platforms,
                by_id,
            }),
        })
    }

    pub(crate) fn catalog(&self) -> Vec<PlatformDescriptor> {
        self.inner
            .ordered
            .iter()
            .map(|platform| platform.descriptor().clone())
            .collect()
    }

    fn available_platform(
        &self,
        platform_id: &PlatformId,
    ) -> Result<&RegisteredPlatform, PlatformError> {
        let platform = self
            .inner
            .by_id
            .get(platform_id)
            .and_then(|index| self.inner.ordered.get(*index))
            .ok_or_else(|| PlatformError::Unavailable(platform_id.to_string()))?;
        if platform.descriptor().availability != PlatformAvailability::Available {
            return Err(PlatformError::Unavailable(platform_id.to_string()));
        }
        Ok(platform)
    }

    pub(crate) fn live_adapter(
        &self,
        platform_id: &PlatformId,
    ) -> Result<Arc<dyn LivePlatformAdapter>, PlatformError> {
        self.available_platform(platform_id)?
            .integration
            .live_adapter()
            .ok_or_else(|| PlatformError::Unavailable(platform_id.to_string()))
    }

    pub(crate) fn account_adapter(
        &self,
        platform_id: &PlatformId,
    ) -> Result<Arc<dyn PlatformAccountAdapter>, PlatformError> {
        let platform = self.available_platform(platform_id)?;
        if platform.descriptor().account_capability.mode == AccountMode::None {
            return Err(PlatformError::AccountUnavailable(platform_id.to_string()));
        }
        platform
            .integration
            .account_adapter()
            .ok_or_else(|| PlatformError::AccountUnavailable(platform_id.to_string()))
    }

    pub(crate) fn account_adapters(&self) -> HashMap<PlatformId, Arc<dyn PlatformAccountAdapter>> {
        self.inner
            .ordered
            .iter()
            .filter_map(|platform| {
                let descriptor = platform.descriptor();
                if descriptor.availability != PlatformAvailability::Available
                    || descriptor.account_capability.mode == AccountMode::None
                {
                    return None;
                }
                let platform_id = descriptor.id.clone();
                self.account_adapter(&platform_id)
                    .ok()
                    .map(|adapter| (platform_id, adapter))
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::{AccountCapability, ContentKind, LiveCapability};

    fn descriptor(id: &str) -> PlatformDescriptor {
        PlatformDescriptor {
            id: PlatformId::new(id).unwrap(),
            display_name: id.to_string(),
            content_kinds: vec![ContentKind::Live],
            availability: PlatformAvailability::Available,
            account_capability: AccountCapability {
                mode: AccountMode::None,
                login_methods: Vec::new(),
                supports_refresh: false,
                supports_logout: false,
                supports_device_reset: false,
            },
            live_capability: Some(LiveCapability {
                supports_discovery: false,
                supports_search: false,
                supports_quality_selection: false,
                supports_danmaku: false,
            }),
        }
    }

    fn account_descriptor(id: &str) -> PlatformDescriptor {
        let mut descriptor = descriptor(id);
        descriptor.account_capability = AccountCapability {
            mode: AccountMode::Optional,
            login_methods: vec![LoginMethod::Qr],
            supports_refresh: true,
            supports_logout: true,
            supports_device_reset: false,
        };
        descriptor
    }

    struct FakeIntegration {
        descriptor: PlatformDescriptor,
        live: Option<Arc<dyn LivePlatformAdapter>>,
        account: Option<Arc<dyn PlatformAccountAdapter>>,
    }

    impl PlatformIntegration for FakeIntegration {
        fn descriptor(&self) -> &PlatformDescriptor {
            &self.descriptor
        }

        fn live_adapter(&self) -> Option<Arc<dyn LivePlatformAdapter>> {
            self.live.clone()
        }

        fn account_adapter(&self) -> Option<Arc<dyn PlatformAccountAdapter>> {
            self.account.clone()
        }
    }

    fn integration(
        descriptor: PlatformDescriptor,
        live: Option<Arc<dyn LivePlatformAdapter>>,
        account: Option<Arc<dyn PlatformAccountAdapter>>,
    ) -> Arc<dyn PlatformIntegration> {
        Arc::new(FakeIntegration {
            descriptor,
            live,
            account,
        })
    }

    struct FakeLiveAdapter;

    impl LivePlatformAdapter for FakeLiveAdapter {
        fn discover<'a>(&'a self) -> PlatformFuture<'a, LiveDiscovery> {
            Box::pin(async {
                Ok(LiveDiscovery {
                    sections: Vec::new(),
                })
            })
        }

        fn search<'a>(
            &'a self,
            _keyword: &'a str,
            _page: u32,
        ) -> PlatformFuture<'a, PagedLiveRooms> {
            Box::pin(async { Err(PlatformError::Unavailable("fake".to_string())) })
        }

        fn room_info<'a>(&'a self, _room_id: &'a str) -> PlatformFuture<'a, LiveRoomInfo> {
            Box::pin(async { Err(PlatformError::Unavailable("fake".to_string())) })
        }

        fn room_playback<'a>(
            &'a self,
            _room_id: &'a str,
            _quality: i64,
        ) -> PlatformFuture<'a, LivePlaybackInfo> {
            Box::pin(async { Err(PlatformError::Unavailable("fake".to_string())) })
        }

        fn media_response<'a>(
            &'a self,
            _url: &'a str,
            _request_headers: &'a HeaderMap,
        ) -> PlatformFuture<'a, Response> {
            Box::pin(async { Err(PlatformError::Unavailable("fake".to_string())) })
        }
    }

    struct FakeAccountAdapter;

    impl PlatformAccountAdapter for FakeAccountAdapter {
        fn start_login<'a>(&'a self, method: LoginMethod) -> PlatformFuture<'a, AccountLoginStart> {
            Box::pin(async move {
                Ok(AccountLoginStart {
                    flow_id: "flow".to_string(),
                    method,
                    challenge: PlatformLoginChallenge::Qr {
                        image_data_url: "data:image/svg+xml,test".to_string(),
                    },
                    expires_in_seconds: 60,
                })
            })
        }

        fn poll_login<'a>(&'a self, flow_id: &'a str) -> PlatformFuture<'a, AccountLoginEvent> {
            Box::pin(async move {
                Ok(AccountLoginEvent {
                    flow_id: flow_id.to_string(),
                    outcome: AccountLoginOutcome::Pending,
                    message_code: None,
                })
            })
        }

        fn submit_login_input<'a>(
            &'a self,
            flow_id: &'a str,
            _input: PlatformLoginInput,
        ) -> PlatformFuture<'a, AccountLoginEvent> {
            Box::pin(async move {
                Ok(AccountLoginEvent {
                    flow_id: flow_id.to_string(),
                    outcome: AccountLoginOutcome::Failed,
                    message_code: None,
                })
            })
        }

        fn cancel_login(&self, _flow_id: &str) -> Result<(), PlatformError> {
            Ok(())
        }

        fn restore_session(&self, _credential: &str) -> Result<(), PlatformError> {
            Ok(())
        }

        fn refresh<'a>(&'a self, _credential: &'a str) -> PlatformFuture<'a, AccountRefresh> {
            Box::pin(async {
                Ok(AccountRefresh::Authenticated(AccountProfile {
                    mid: 1,
                    name: "fake".to_string(),
                    avatar_url: None,
                    level: None,
                    vip: false,
                }))
            })
        }

        fn logout(&self, _credential: &str) -> Result<(), PlatformError> {
            Ok(())
        }

        fn reset_identity(&self) -> Result<(), PlatformError> {
            Ok(())
        }
    }

    #[test]
    fn catalog_preserves_registration_order() {
        let registry = PlatformRegistry::new(vec![
            RegisteredPlatform::new(integration(
                descriptor("alpha"),
                Some(Arc::new(FakeLiveAdapter)),
                None,
            ))
            .unwrap(),
            RegisteredPlatform::new(integration(
                descriptor("beta"),
                Some(Arc::new(FakeLiveAdapter)),
                None,
            ))
            .unwrap(),
        ])
        .unwrap();

        let ids = registry
            .catalog()
            .into_iter()
            .map(|platform| platform.id.to_string())
            .collect::<Vec<_>>();
        assert_eq!(ids, vec!["alpha", "beta"]);
    }

    #[test]
    fn duplicate_or_unknown_platforms_are_rejected() {
        let duplicate = PlatformRegistry::new(vec![
            RegisteredPlatform::new(integration(
                descriptor("alpha"),
                Some(Arc::new(FakeLiveAdapter)),
                None,
            ))
            .unwrap(),
            RegisteredPlatform::new(integration(
                descriptor("alpha"),
                Some(Arc::new(FakeLiveAdapter)),
                None,
            ))
            .unwrap(),
        ]);
        assert!(duplicate.is_err());

        let registry = PlatformRegistry::new(vec![RegisteredPlatform::new(integration(
            descriptor("alpha"),
            Some(Arc::new(FakeLiveAdapter)),
            None,
        ))
        .unwrap()])
        .unwrap();
        let error = registry
            .live_adapter(&PlatformId::new("missing").unwrap())
            .err()
            .unwrap();
        assert!(matches!(error, PlatformError::Unavailable(id) if id == "missing"));
    }

    #[test]
    fn public_descriptor_does_not_expose_credential_slots() {
        let serialized = serde_json::to_string(&descriptor("alpha")).unwrap();
        assert!(!serialized.contains("session"));
        assert!(!serialized.contains("credential"));
    }

    #[test]
    fn hypothetical_live_platform_registers_once_and_resolves() {
        let platform_id = PlatformId::new("future-live").unwrap();
        let registry = PlatformRegistry::new(vec![RegisteredPlatform::new(integration(
            descriptor("future-live"),
            Some(Arc::new(FakeLiveAdapter)),
            None,
        ))
        .unwrap()])
        .unwrap();

        assert_eq!(registry.catalog()[0].id, platform_id);
        assert!(registry.live_adapter(&platform_id).is_ok());
    }

    #[test]
    fn account_capability_and_adapter_must_be_registered_together() {
        let missing_adapter = RegisteredPlatform::new(integration(
            account_descriptor("future-account"),
            Some(Arc::new(FakeLiveAdapter)),
            None,
        ));
        assert!(missing_adapter.is_err());

        let registry = PlatformRegistry::new(vec![RegisteredPlatform::new(integration(
            account_descriptor("future-account"),
            Some(Arc::new(FakeLiveAdapter)),
            Some(Arc::new(FakeAccountAdapter)),
        ))
        .unwrap()])
        .unwrap();
        assert!(registry
            .account_adapter(&PlatformId::new("future-account").unwrap())
            .is_ok());
        assert_eq!(registry.account_adapters().len(), 1);
    }
}
