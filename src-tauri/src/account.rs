use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

use log::{info, warn};

use crate::{
    domain::{
        AccountCenterSnapshot, AccountMode, AccountProfile, AccountStatus, BilibiliAccount,
        LoginCapabilities, LoginMethod, PlatformAccountEntry, PlatformAvailability,
        PlatformDescriptor, PlatformId, PlatformLoginEvent, PlatformLoginInput, PlatformLoginStart,
        PlatformLoginState,
    },
    platforms::{
        AccountLoginEvent, AccountLoginOutcome, AccountRefresh, PlatformAccountAdapter,
        PlatformError,
    },
};

const CREDENTIAL_SERVICE: &str = "ailicili";

#[derive(Debug, thiserror::Error)]
pub enum CredentialStoreError {
    #[error("credential store is unavailable on this platform")]
    #[allow(dead_code)]
    Unavailable,
    #[error("credential store operation failed")]
    Backend,
}

pub trait CredentialStore: Send + Sync {
    fn load_platform(
        &self,
        platform_id: &PlatformId,
    ) -> Result<Option<String>, CredentialStoreError>;
    fn save_platform(
        &self,
        platform_id: &PlatformId,
        payload: &str,
    ) -> Result<(), CredentialStoreError>;
    fn clear_platform(&self, platform_id: &PlatformId) -> Result<(), CredentialStoreError>;
    fn is_available(&self) -> bool;
}

fn credential_slot(platform_id: &PlatformId) -> String {
    format!("{platform_id}-session")
}

fn map_credential_error(error: CredentialStoreError) -> PlatformError {
    match error {
        CredentialStoreError::Unavailable => PlatformError::CredentialLocked,
        CredentialStoreError::Backend => PlatformError::CredentialStore,
    }
}

#[cfg(windows)]
struct NativeCredentialStore;

#[cfg(windows)]
impl NativeCredentialStore {
    fn entry(platform_id: &PlatformId) -> Result<keyring::Entry, CredentialStoreError> {
        keyring::Entry::new(CREDENTIAL_SERVICE, &credential_slot(platform_id))
            .map_err(|_| CredentialStoreError::Backend)
    }
}

#[cfg(windows)]
impl CredentialStore for NativeCredentialStore {
    fn load_platform(
        &self,
        platform_id: &PlatformId,
    ) -> Result<Option<String>, CredentialStoreError> {
        match Self::entry(platform_id)?.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err(CredentialStoreError::Backend),
        }
    }

    fn save_platform(
        &self,
        platform_id: &PlatformId,
        payload: &str,
    ) -> Result<(), CredentialStoreError> {
        Self::entry(platform_id)?
            .set_password(payload)
            .map_err(|_| CredentialStoreError::Backend)
    }

    fn clear_platform(&self, platform_id: &PlatformId) -> Result<(), CredentialStoreError> {
        match Self::entry(platform_id)?.delete_credential() {
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
    fn load_platform(
        &self,
        _platform_id: &PlatformId,
    ) -> Result<Option<String>, CredentialStoreError> {
        Err(CredentialStoreError::Unavailable)
    }

    fn save_platform(
        &self,
        _platform_id: &PlatformId,
        _payload: &str,
    ) -> Result<(), CredentialStoreError> {
        Err(CredentialStoreError::Unavailable)
    }

    fn clear_platform(&self, _platform_id: &PlatformId) -> Result<(), CredentialStoreError> {
        Err(CredentialStoreError::Unavailable)
    }

    fn is_available(&self) -> bool {
        false
    }
}

#[derive(Debug, Clone)]
struct PlatformAccountRuntime {
    status: AccountStatus,
    profile: Option<AccountProfile>,
    message_code: Option<String>,
    revision: u64,
}

impl Default for PlatformAccountRuntime {
    fn default() -> Self {
        Self {
            status: AccountStatus::Anonymous,
            profile: None,
            message_code: None,
            revision: 0,
        }
    }
}

#[derive(Default)]
struct RuntimeState {
    initialized: bool,
    accounts: HashMap<PlatformId, PlatformAccountRuntime>,
}

pub struct AccountManager {
    runtime: Mutex<RuntimeState>,
    credentials: Box<dyn CredentialStore>,
    platforms: Vec<PlatformDescriptor>,
    adapters: HashMap<PlatformId, Arc<dyn PlatformAccountAdapter>>,
}

impl AccountManager {
    pub fn new(
        platforms: Vec<PlatformDescriptor>,
        adapters: HashMap<PlatformId, Arc<dyn PlatformAccountAdapter>>,
    ) -> Self {
        Self {
            runtime: Mutex::new(RuntimeState::default()),
            credentials: Box::new(NativeCredentialStore),
            platforms,
            adapters,
        }
    }

    #[cfg(test)]
    fn with_store(
        credentials: Box<dyn CredentialStore>,
        platforms: Vec<PlatformDescriptor>,
        adapters: HashMap<PlatformId, Arc<dyn PlatformAccountAdapter>>,
    ) -> Self {
        Self {
            runtime: Mutex::new(RuntimeState::default()),
            credentials,
            platforms,
            adapters,
        }
    }

    pub fn login_capabilities(
        &self,
        platform_id: &PlatformId,
    ) -> Result<LoginCapabilities, PlatformError> {
        let descriptor = self.ensure_account_platform(platform_id)?;
        let credential_storage_available = self.credentials.is_available();
        let supports = |method| {
            descriptor
                .account_capability
                .login_methods
                .contains(&method)
        };
        Ok(LoginCapabilities {
            credential_storage_available,
            qr_available: !cfg!(target_os = "android")
                && credential_storage_available
                && supports(LoginMethod::Qr),
            sms_available: credential_storage_available && supports(LoginMethod::Sms),
        })
    }

    pub fn account_center_snapshot(&self) -> Result<AccountCenterSnapshot, PlatformError> {
        self.initialize()?;
        let runtime = self.runtime_lock()?;
        let platforms = self
            .platforms
            .iter()
            .cloned()
            .map(|platform| {
                let account = runtime
                    .accounts
                    .get(&platform.id)
                    .cloned()
                    .unwrap_or_default();
                PlatformAccountEntry {
                    platform,
                    status: account.status,
                    profile: account.profile,
                    message_code: account.message_code,
                    revision: account.revision,
                }
            })
            .collect();
        Ok(AccountCenterSnapshot { platforms })
    }

    pub fn platform_account_entry(
        &self,
        platform_id: &PlatformId,
    ) -> Result<PlatformAccountEntry, PlatformError> {
        self.initialize()?;
        let descriptor = self
            .platforms
            .iter()
            .find(|platform| &platform.id == platform_id)
            .cloned()
            .ok_or_else(|| PlatformError::Unavailable(platform_id.to_string()))?;
        let account = self
            .runtime_lock()?
            .accounts
            .get(platform_id)
            .cloned()
            .unwrap_or_default();
        Ok(PlatformAccountEntry {
            platform: descriptor,
            status: account.status,
            profile: account.profile,
            message_code: account.message_code,
            revision: account.revision,
        })
    }

    pub async fn refresh_platform_account(
        &self,
        platform_id: &PlatformId,
    ) -> Result<AccountCenterSnapshot, PlatformError> {
        let descriptor = self.ensure_account_platform(platform_id)?;
        if !descriptor.account_capability.supports_refresh {
            return Err(PlatformError::AccountUnavailable(platform_id.to_string()));
        }
        let adapter = self.account_adapter(platform_id)?;
        self.initialize()?;
        let Some(credential) = self.load_credential(platform_id)? else {
            return self.account_center_snapshot();
        };

        match adapter.refresh(&credential).await {
            Ok(AccountRefresh::Authenticated(profile)) => {
                self.set_authenticated(platform_id, Some(profile), None, false)?;
            }
            Ok(AccountRefresh::Expired) | Err(PlatformError::LoginExpired) => {
                self.expire_account(platform_id, &adapter, &credential)?;
            }
            Err(error) => {
                self.set_message_code(platform_id, Some("profile_unavailable".to_string()))?;
                warn!(
                    target: "Account",
                    "account profile refresh failed platform={platform_id} code={}",
                    platform_error_code(&error),
                );
            }
        }
        self.account_center_snapshot()
    }

    pub fn logout_platform_account(
        &self,
        platform_id: &PlatformId,
    ) -> Result<AccountCenterSnapshot, PlatformError> {
        let descriptor = self.ensure_account_platform(platform_id)?;
        if !descriptor.account_capability.supports_logout {
            return Err(PlatformError::AccountUnavailable(platform_id.to_string()));
        }
        let adapter = self.account_adapter(platform_id)?;
        self.initialize()?;
        let credential = self.load_credential(platform_id)?.unwrap_or_default();
        adapter.logout(&credential)?;
        self.credentials
            .clear_platform(platform_id)
            .map_err(map_credential_error)?;

        let mut runtime = self.runtime_lock()?;
        let account = runtime.accounts.entry(platform_id.clone()).or_default();
        account.status = AccountStatus::Anonymous;
        account.profile = None;
        account.message_code = None;
        account.revision = account.revision.saturating_add(1);
        drop(runtime);
        info!(target: "Account", "platform logout completed platform={platform_id}");
        self.account_center_snapshot()
    }

    pub fn reset_platform_device_identity(
        &self,
        platform_id: &PlatformId,
    ) -> Result<(), PlatformError> {
        let descriptor = self.ensure_account_platform(platform_id)?;
        if !descriptor.account_capability.supports_device_reset {
            return Err(PlatformError::AccountUnavailable(platform_id.to_string()));
        }
        self.account_adapter(platform_id)?.reset_identity()
    }

    pub async fn start_platform_login(
        &self,
        platform_id: &PlatformId,
        method: LoginMethod,
    ) -> Result<PlatformLoginStart, PlatformError> {
        let descriptor = self.ensure_account_platform(platform_id)?;
        if !descriptor
            .account_capability
            .login_methods
            .contains(&method)
        {
            return Err(PlatformError::AccountUnavailable(platform_id.to_string()));
        }
        if !self.credentials.is_available() {
            return Err(PlatformError::CredentialLocked);
        }
        let adapter = self.account_adapter(platform_id)?;
        let start = adapter.start_login(method).await?;
        Ok(PlatformLoginStart {
            platform_id: platform_id.clone(),
            flow_id: start.flow_id,
            method: start.method,
            challenge: start.challenge,
            expires_in_seconds: start.expires_in_seconds,
        })
    }

    pub async fn poll_platform_login(
        &self,
        platform_id: &PlatformId,
        flow_id: &str,
    ) -> Result<PlatformLoginEvent, PlatformError> {
        self.ensure_account_platform(platform_id)?;
        let adapter = self.account_adapter(platform_id)?;
        let event = adapter.poll_login(flow_id).await?;
        self.finish_login_event(platform_id, &adapter, event).await
    }

    pub async fn submit_platform_login_input(
        &self,
        platform_id: &PlatformId,
        flow_id: &str,
        input: PlatformLoginInput,
    ) -> Result<PlatformLoginEvent, PlatformError> {
        self.ensure_account_platform(platform_id)?;
        let adapter = self.account_adapter(platform_id)?;
        let event = adapter.submit_login_input(flow_id, input).await?;
        self.finish_login_event(platform_id, &adapter, event).await
    }

    pub fn cancel_platform_login(
        &self,
        platform_id: &PlatformId,
        flow_id: &str,
    ) -> Result<(), PlatformError> {
        self.ensure_account_platform(platform_id)?;
        self.account_adapter(platform_id)?.cancel_login(flow_id)
    }

    async fn finish_login_event(
        &self,
        platform_id: &PlatformId,
        adapter: &Arc<dyn PlatformAccountAdapter>,
        event: AccountLoginEvent,
    ) -> Result<PlatformLoginEvent, PlatformError> {
        let flow_id = event.flow_id.clone();
        let state = match event.outcome {
            AccountLoginOutcome::Pending => PlatformLoginState::Pending,
            AccountLoginOutcome::Scanned => PlatformLoginState::Scanned,
            AccountLoginOutcome::SmsCodeSent {
                retry_after_seconds,
                expires_in_seconds,
            } => PlatformLoginState::SmsCodeSent {
                retry_after_seconds,
                expires_in_seconds,
            },
            AccountLoginOutcome::Authenticated { credential } => {
                self.complete_platform_login(platform_id, adapter, credential)
                    .await?
            }
            AccountLoginOutcome::Expired => PlatformLoginState::Expired,
            AccountLoginOutcome::Failed => PlatformLoginState::Failed,
        };
        Ok(PlatformLoginEvent {
            platform_id: platform_id.clone(),
            flow_id,
            state,
            message_code: event.message_code,
        })
    }

    async fn complete_platform_login(
        &self,
        platform_id: &PlatformId,
        adapter: &Arc<dyn PlatformAccountAdapter>,
        credential: String,
    ) -> Result<PlatformLoginState, PlatformError> {
        if credential.is_empty() {
            return Err(PlatformError::Invalid(
                "platform returned an empty credential".to_string(),
            ));
        }
        let previous_credential = self.load_credential(platform_id)?;
        self.credentials
            .save_platform(platform_id, &credential)
            .map_err(map_credential_error)?;
        if let Err(error) = adapter.restore_session(&credential) {
            self.rollback_login(
                platform_id,
                adapter,
                previous_credential.as_deref(),
                &credential,
            )?;
            return Err(error);
        }

        match adapter.refresh(&credential).await {
            Ok(AccountRefresh::Authenticated(profile)) => {
                self.set_authenticated(platform_id, Some(profile), None, true)?;
            }
            Ok(AccountRefresh::Expired) | Err(PlatformError::LoginExpired) => {
                if previous_credential.is_some() {
                    self.rollback_login(
                        platform_id,
                        adapter,
                        previous_credential.as_deref(),
                        &credential,
                    )?;
                    self.set_message_code(platform_id, Some("relogin_failed".to_string()))?;
                    return Ok(PlatformLoginState::Failed);
                }
                self.expire_account(platform_id, adapter, &credential)?;
                return Ok(PlatformLoginState::Expired);
            }
            Err(error) => {
                self.set_authenticated(
                    platform_id,
                    None,
                    Some("profile_unavailable".to_string()),
                    true,
                )?;
                warn!(
                    target: "Account",
                    "account profile unavailable after login platform={platform_id} code={}",
                    platform_error_code(&error),
                );
            }
        }

        let account = self.platform_account_entry(platform_id)?;
        info!(
            target: "Account",
            "platform login completed platform={platform_id} revision={}",
            account.revision,
        );
        Ok(PlatformLoginState::Succeeded { account })
    }

    fn rollback_login(
        &self,
        platform_id: &PlatformId,
        adapter: &Arc<dyn PlatformAccountAdapter>,
        previous_credential: Option<&str>,
        rejected_credential: &str,
    ) -> Result<(), PlatformError> {
        adapter.logout(rejected_credential)?;
        if let Some(previous_credential) = previous_credential {
            self.credentials
                .save_platform(platform_id, previous_credential)
                .map_err(map_credential_error)?;
            adapter.restore_session(previous_credential)?;
        } else {
            self.credentials
                .clear_platform(platform_id)
                .map_err(map_credential_error)?;
        }
        Ok(())
    }

    fn expire_account(
        &self,
        platform_id: &PlatformId,
        adapter: &Arc<dyn PlatformAccountAdapter>,
        credential: &str,
    ) -> Result<(), PlatformError> {
        adapter.logout(credential)?;
        self.credentials
            .clear_platform(platform_id)
            .map_err(map_credential_error)?;
        let mut runtime = self.runtime_lock()?;
        let account = runtime.accounts.entry(platform_id.clone()).or_default();
        account.status = AccountStatus::Expired;
        account.profile = None;
        account.message_code = Some("login_expired".to_string());
        account.revision = account.revision.saturating_add(1);
        Ok(())
    }

    fn initialize(&self) -> Result<(), PlatformError> {
        let mut runtime = self.runtime_lock()?;
        if runtime.initialized {
            return Ok(());
        }

        for platform in &self.platforms {
            let mut account = PlatformAccountRuntime::default();
            if platform.availability == PlatformAvailability::Available
                && platform.account_capability.mode != AccountMode::None
            {
                account = self.initialize_platform_account(platform)?;
            }
            runtime.accounts.insert(platform.id.clone(), account);
        }
        runtime.initialized = true;
        Ok(())
    }

    fn initialize_platform_account(
        &self,
        platform: &PlatformDescriptor,
    ) -> Result<PlatformAccountRuntime, PlatformError> {
        if !self.credentials.is_available() {
            return Ok(locked_account("credential_store_unavailable"));
        }
        if !self.adapters.contains_key(&platform.id) {
            return Ok(locked_account("account_adapter_unavailable"));
        }
        let credential = match self.credentials.load_platform(&platform.id) {
            Ok(credential) => credential,
            Err(CredentialStoreError::Unavailable) => {
                return Ok(locked_account("credential_store_unavailable"))
            }
            Err(CredentialStoreError::Backend) => {
                return Ok(locked_account("credential_store_error"))
            }
        };
        let Some(credential) = credential else {
            return Ok(PlatformAccountRuntime::default());
        };

        let adapter = self
            .adapters
            .get(&platform.id)
            .cloned()
            .ok_or_else(|| PlatformError::AccountUnavailable(platform.id.to_string()))?;
        if adapter.restore_session(&credential).is_err() {
            let _ = self.credentials.clear_platform(&platform.id);
            let _ = adapter.logout(&credential);
            return Ok(PlatformAccountRuntime {
                message_code: Some("credential_invalid".to_string()),
                ..PlatformAccountRuntime::default()
            });
        }
        Ok(PlatformAccountRuntime {
            status: AccountStatus::Authenticated,
            ..PlatformAccountRuntime::default()
        })
    }

    fn load_credential(&self, platform_id: &PlatformId) -> Result<Option<String>, PlatformError> {
        self.credentials
            .load_platform(platform_id)
            .map_err(map_credential_error)
    }

    fn set_authenticated(
        &self,
        platform_id: &PlatformId,
        profile: Option<AccountProfile>,
        message_code: Option<String>,
        bump_revision: bool,
    ) -> Result<(), PlatformError> {
        let mut runtime = self.runtime_lock()?;
        let account = runtime.accounts.entry(platform_id.clone()).or_default();
        account.status = AccountStatus::Authenticated;
        account.profile = profile;
        account.message_code = message_code;
        if bump_revision {
            account.revision = account.revision.saturating_add(1);
        }
        Ok(())
    }

    fn set_message_code(
        &self,
        platform_id: &PlatformId,
        message_code: Option<String>,
    ) -> Result<(), PlatformError> {
        self.runtime_lock()?
            .accounts
            .entry(platform_id.clone())
            .or_default()
            .message_code = message_code;
        Ok(())
    }

    fn ensure_account_platform(
        &self,
        platform_id: &PlatformId,
    ) -> Result<PlatformDescriptor, PlatformError> {
        let descriptor = self
            .platforms
            .iter()
            .find(|platform| &platform.id == platform_id)
            .cloned()
            .ok_or_else(|| PlatformError::Unavailable(platform_id.to_string()))?;
        if descriptor.availability != PlatformAvailability::Available
            || descriptor.account_capability.mode == AccountMode::None
        {
            return Err(PlatformError::AccountUnavailable(platform_id.to_string()));
        }
        Ok(descriptor)
    }

    fn account_adapter(
        &self,
        platform_id: &PlatformId,
    ) -> Result<Arc<dyn PlatformAccountAdapter>, PlatformError> {
        self.adapters
            .get(platform_id)
            .cloned()
            .ok_or_else(|| PlatformError::AccountUnavailable(platform_id.to_string()))
    }

    fn runtime_lock(&self) -> Result<std::sync::MutexGuard<'_, RuntimeState>, PlatformError> {
        self.runtime
            .lock()
            .map_err(|_| PlatformError::Storage("account state lock poisoned".to_string()))
    }
}

fn locked_account(message_code: &str) -> PlatformAccountRuntime {
    PlatformAccountRuntime {
        status: AccountStatus::Locked,
        message_code: Some(message_code.to_string()),
        ..PlatformAccountRuntime::default()
    }
}

fn platform_error_code(error: &PlatformError) -> &'static str {
    match error {
        PlatformError::Unavailable(_) => "platformUnavailable",
        PlatformError::AccountUnavailable(_) => "accountUnavailable",
        PlatformError::LoginExpired => "loginExpired",
        PlatformError::CredentialLocked => "credentialLocked",
        PlatformError::CredentialStore => "credentialStoreError",
        PlatformError::Storage(_) => "storageError",
        PlatformError::Invalid(_) => "invalidResponse",
        PlatformError::Unsupported(_) => "unsupportedOperation",
        PlatformError::Upstream(_) => "platformRequestFailed",
    }
}

pub fn legacy_account(entry: &PlatformAccountEntry) -> BilibiliAccount {
    BilibiliAccount {
        status: entry.status,
        profile: entry.profile.clone(),
        message_code: entry.message_code.clone(),
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};

    use super::*;
    use crate::{
        domain::{AccountCapability, ContentKind, LiveCapability, PlatformLoginChallenge},
        platforms::{AccountLoginStart, PlatformFuture},
    };

    #[derive(Default)]
    struct MemoryCredentialStore {
        values: Mutex<HashMap<String, String>>,
    }

    impl CredentialStore for Arc<MemoryCredentialStore> {
        fn load_platform(
            &self,
            platform_id: &PlatformId,
        ) -> Result<Option<String>, CredentialStoreError> {
            Ok(self
                .values
                .lock()
                .map_err(|_| CredentialStoreError::Backend)?
                .get(&credential_slot(platform_id))
                .cloned())
        }

        fn save_platform(
            &self,
            platform_id: &PlatformId,
            payload: &str,
        ) -> Result<(), CredentialStoreError> {
            *self
                .values
                .lock()
                .map_err(|_| CredentialStoreError::Backend)?
                .entry(credential_slot(platform_id))
                .or_default() = payload.to_string();
            Ok(())
        }

        fn clear_platform(&self, platform_id: &PlatformId) -> Result<(), CredentialStoreError> {
            self.values
                .lock()
                .map_err(|_| CredentialStoreError::Backend)?
                .remove(&credential_slot(platform_id));
            Ok(())
        }

        fn is_available(&self) -> bool {
            true
        }
    }

    impl CredentialStore for MemoryCredentialStore {
        fn load_platform(
            &self,
            platform_id: &PlatformId,
        ) -> Result<Option<String>, CredentialStoreError> {
            Ok(self
                .values
                .lock()
                .map_err(|_| CredentialStoreError::Backend)?
                .get(&credential_slot(platform_id))
                .cloned())
        }

        fn save_platform(
            &self,
            platform_id: &PlatformId,
            payload: &str,
        ) -> Result<(), CredentialStoreError> {
            *self
                .values
                .lock()
                .map_err(|_| CredentialStoreError::Backend)?
                .entry(credential_slot(platform_id))
                .or_default() = payload.to_string();
            Ok(())
        }

        fn clear_platform(&self, platform_id: &PlatformId) -> Result<(), CredentialStoreError> {
            self.values
                .lock()
                .map_err(|_| CredentialStoreError::Backend)?
                .remove(&credential_slot(platform_id));
            Ok(())
        }

        fn is_available(&self) -> bool {
            true
        }
    }

    struct UnavailableCredentialStore;

    impl CredentialStore for UnavailableCredentialStore {
        fn load_platform(
            &self,
            _platform_id: &PlatformId,
        ) -> Result<Option<String>, CredentialStoreError> {
            Err(CredentialStoreError::Unavailable)
        }

        fn save_platform(
            &self,
            _platform_id: &PlatformId,
            _payload: &str,
        ) -> Result<(), CredentialStoreError> {
            Err(CredentialStoreError::Unavailable)
        }

        fn clear_platform(&self, _platform_id: &PlatformId) -> Result<(), CredentialStoreError> {
            Err(CredentialStoreError::Unavailable)
        }

        fn is_available(&self) -> bool {
            false
        }
    }

    fn platform_descriptor(id: &str, account_mode: AccountMode) -> PlatformDescriptor {
        PlatformDescriptor {
            id: PlatformId::new(id).unwrap(),
            display_name: id.to_string(),
            content_kinds: vec![ContentKind::Live],
            availability: PlatformAvailability::Available,
            account_capability: AccountCapability {
                mode: account_mode,
                login_methods: if account_mode == AccountMode::Optional {
                    vec![LoginMethod::Qr, LoginMethod::Sms]
                } else {
                    Vec::new()
                },
                supports_refresh: account_mode == AccountMode::Optional,
                supports_logout: account_mode == AccountMode::Optional,
                supports_device_reset: false,
            },
            live_capability: Some(LiveCapability {
                supports_discovery: true,
                supports_search: false,
                supports_quality_selection: false,
            }),
        }
    }

    fn bilibili_platform() -> PlatformDescriptor {
        platform_descriptor(PlatformId::BILIBILI, AccountMode::Optional)
    }

    struct FakeAccountState {
        restore_count: AtomicUsize,
        logout_count: AtomicUsize,
        refresh_expired: Mutex<bool>,
        restored_credentials: Mutex<Vec<String>>,
    }

    impl Default for FakeAccountState {
        fn default() -> Self {
            Self {
                restore_count: AtomicUsize::new(0),
                logout_count: AtomicUsize::new(0),
                refresh_expired: Mutex::new(false),
                restored_credentials: Mutex::new(Vec::new()),
            }
        }
    }

    struct FakeAccountAdapter {
        name: &'static str,
        state: Arc<FakeAccountState>,
    }

    impl PlatformAccountAdapter for FakeAccountAdapter {
        fn start_login<'a>(&'a self, method: LoginMethod) -> PlatformFuture<'a, AccountLoginStart> {
            Box::pin(async move {
                Ok(AccountLoginStart {
                    flow_id: "flow".to_string(),
                    method,
                    challenge: PlatformLoginChallenge::Qr {
                        image_data_url: "[image omitted]".to_string(),
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
                    outcome: AccountLoginOutcome::Authenticated {
                        credential: format!("{}-credential", self.name),
                    },
                    message_code: None,
                })
            })
        }

        fn cancel_login(&self, _flow_id: &str) -> Result<(), PlatformError> {
            Ok(())
        }

        fn restore_session(&self, credential: &str) -> Result<(), PlatformError> {
            self.state.restore_count.fetch_add(1, Ordering::AcqRel);
            self.state
                .restored_credentials
                .lock()
                .map_err(|_| PlatformError::Storage("fake lock poisoned".to_string()))?
                .push(credential.to_string());
            Ok(())
        }

        fn refresh<'a>(&'a self, _credential: &'a str) -> PlatformFuture<'a, AccountRefresh> {
            Box::pin(async move {
                if *self
                    .state
                    .refresh_expired
                    .lock()
                    .map_err(|_| PlatformError::Storage("fake lock poisoned".to_string()))?
                {
                    return Ok(AccountRefresh::Expired);
                }
                Ok(AccountRefresh::Authenticated(AccountProfile {
                    mid: 1,
                    name: self.name.to_string(),
                    avatar_url: None,
                    level: None,
                    vip: false,
                }))
            })
        }

        fn logout(&self, _credential: &str) -> Result<(), PlatformError> {
            self.state.logout_count.fetch_add(1, Ordering::AcqRel);
            Ok(())
        }

        fn reset_identity(&self) -> Result<(), PlatformError> {
            Ok(())
        }
    }

    fn fake_adapter(
        name: &'static str,
        state: Arc<FakeAccountState>,
    ) -> Arc<dyn PlatformAccountAdapter> {
        Arc::new(FakeAccountAdapter { name, state })
    }

    fn adapter_map(
        entries: Vec<(PlatformId, Arc<dyn PlatformAccountAdapter>)>,
    ) -> HashMap<PlatformId, Arc<dyn PlatformAccountAdapter>> {
        entries.into_iter().collect()
    }

    #[test]
    fn credential_slots_are_isolated_by_platform() {
        let store = MemoryCredentialStore::default();
        let bilibili = PlatformId::bilibili();
        let future = PlatformId::new("future-live").unwrap();
        store.save_platform(&bilibili, "bilibili-secret").unwrap();
        store.save_platform(&future, "future-secret").unwrap();

        store.clear_platform(&bilibili).unwrap();
        assert!(store.load_platform(&bilibili).unwrap().is_none());
        assert_eq!(
            store.load_platform(&future).unwrap().as_deref(),
            Some("future-secret")
        );
        assert_eq!(credential_slot(&bilibili), "bilibili-session");
        assert_eq!(credential_slot(&future), "future-live-session");
    }

    #[test]
    fn manager_restores_credentials_through_the_account_adapter() {
        let store = Arc::new(MemoryCredentialStore::default());
        store
            .save_platform(&PlatformId::bilibili(), "credential")
            .unwrap();
        let state = Arc::new(FakeAccountState::default());
        let manager = AccountManager::with_store(
            Box::new(store),
            vec![bilibili_platform()],
            adapter_map(vec![(
                PlatformId::bilibili(),
                fake_adapter("bilibili", state.clone()),
            )]),
        );

        let snapshot = manager.account_center_snapshot().unwrap();
        assert_eq!(snapshot.platforms[0].status, AccountStatus::Authenticated);
        assert_eq!(state.restore_count.load(Ordering::Acquire), 1);
    }

    #[test]
    fn capabilities_do_not_advertise_login_without_credential_storage() {
        let manager = AccountManager::with_store(
            Box::new(UnavailableCredentialStore),
            vec![bilibili_platform()],
            adapter_map(vec![(
                PlatformId::bilibili(),
                fake_adapter("bilibili", Arc::new(FakeAccountState::default())),
            )]),
        );
        let capabilities = manager.login_capabilities(&PlatformId::bilibili()).unwrap();
        assert!(!capabilities.credential_storage_available);
        assert!(!capabilities.qr_available);
        assert!(!capabilities.sms_available);
    }

    #[test]
    fn snapshot_contains_every_registered_platform_and_zero_accounts() {
        let manager = AccountManager::with_store(
            Box::new(MemoryCredentialStore::default()),
            vec![
                bilibili_platform(),
                platform_descriptor("future-live", AccountMode::None),
            ],
            adapter_map(vec![(
                PlatformId::bilibili(),
                fake_adapter("bilibili", Arc::new(FakeAccountState::default())),
            )]),
        );

        let snapshot = manager.account_center_snapshot().unwrap();
        assert_eq!(snapshot.platforms.len(), 2);
        assert_eq!(
            snapshot
                .platforms
                .iter()
                .map(|account| account.platform.id.to_string())
                .collect::<Vec<_>>(),
            vec!["bilibili", "future-live"]
        );
        assert!(snapshot
            .platforms
            .iter()
            .all(|account| account.status == AccountStatus::Anonymous));
        assert!(snapshot
            .platforms
            .iter()
            .all(|account| account.revision == 0));
    }

    #[test]
    fn logout_updates_only_the_target_platform() {
        let store = Arc::new(MemoryCredentialStore::default());
        let bilibili = PlatformId::bilibili();
        let future = PlatformId::new("future-live").unwrap();
        store.save_platform(&bilibili, "bili").unwrap();
        store.save_platform(&future, "future").unwrap();
        let bilibili_state = Arc::new(FakeAccountState::default());
        let future_state = Arc::new(FakeAccountState::default());
        let manager = AccountManager::with_store(
            Box::new(store.clone()),
            vec![
                bilibili_platform(),
                platform_descriptor("future-live", AccountMode::Optional),
            ],
            adapter_map(vec![
                (
                    bilibili.clone(),
                    fake_adapter("bilibili", bilibili_state.clone()),
                ),
                (future.clone(), fake_adapter("future", future_state.clone())),
            ]),
        );
        manager.initialize().unwrap();

        let snapshot = manager.logout_platform_account(&bilibili).unwrap();
        assert_eq!(snapshot.platforms[0].status, AccountStatus::Anonymous);
        assert_eq!(snapshot.platforms[0].revision, 1);
        assert_eq!(snapshot.platforms[1].status, AccountStatus::Authenticated);
        assert_eq!(snapshot.platforms[1].revision, 0);
        assert_eq!(bilibili_state.logout_count.load(Ordering::Acquire), 1);
        assert_eq!(future_state.logout_count.load(Ordering::Acquire), 0);
        assert!(store.load_platform(&bilibili).unwrap().is_none());
        assert_eq!(
            store.load_platform(&future).unwrap().as_deref(),
            Some("future")
        );
    }

    #[test]
    fn signing_in_again_replaces_only_the_target_platform_account() {
        let bilibili = PlatformId::bilibili();
        let future = PlatformId::new("future-live").unwrap();
        let bilibili_state = Arc::new(FakeAccountState::default());
        let future_state = Arc::new(FakeAccountState::default());
        let manager = AccountManager::with_store(
            Box::new(MemoryCredentialStore::default()),
            vec![
                bilibili_platform(),
                platform_descriptor("future-live", AccountMode::Optional),
            ],
            adapter_map(vec![
                (bilibili.clone(), fake_adapter("bilibili", bilibili_state)),
                (future.clone(), fake_adapter("future", future_state)),
            ]),
        );
        manager.initialize().unwrap();

        let first = tauri::async_runtime::block_on(manager.submit_platform_login_input(
            &bilibili,
            "flow",
            PlatformLoginInput::SmsCode {
                code: "123456".to_string(),
            },
        ))
        .unwrap();
        assert!(matches!(first.state, PlatformLoginState::Succeeded { .. }));
        let second = tauri::async_runtime::block_on(manager.submit_platform_login_input(
            &bilibili,
            "flow",
            PlatformLoginInput::SmsCode {
                code: "123456".to_string(),
            },
        ))
        .unwrap();
        assert!(matches!(second.state, PlatformLoginState::Succeeded { .. }));

        let snapshot = manager.account_center_snapshot().unwrap();
        assert_eq!(snapshot.platforms[0].status, AccountStatus::Authenticated);
        assert_eq!(snapshot.platforms[0].revision, 2);
        assert_eq!(snapshot.platforms[1].status, AccountStatus::Anonymous);
        assert_eq!(snapshot.platforms[1].revision, 0);
    }

    #[test]
    fn expiration_invalidates_only_the_target_platform() {
        let store = Arc::new(MemoryCredentialStore::default());
        let bilibili = PlatformId::bilibili();
        let future = PlatformId::new("future-live").unwrap();
        store.save_platform(&bilibili, "bili").unwrap();
        store.save_platform(&future, "future").unwrap();
        let future_state = Arc::new(FakeAccountState::default());
        *future_state.refresh_expired.lock().unwrap() = true;
        let manager = AccountManager::with_store(
            Box::new(store.clone()),
            vec![
                bilibili_platform(),
                platform_descriptor("future-live", AccountMode::Optional),
            ],
            adapter_map(vec![
                (
                    bilibili.clone(),
                    fake_adapter("bilibili", Arc::new(FakeAccountState::default())),
                ),
                (future.clone(), fake_adapter("future", future_state)),
            ]),
        );
        manager.initialize().unwrap();

        let snapshot =
            tauri::async_runtime::block_on(manager.refresh_platform_account(&future)).unwrap();
        assert_eq!(snapshot.platforms[0].status, AccountStatus::Authenticated);
        assert_eq!(snapshot.platforms[0].revision, 0);
        assert_eq!(snapshot.platforms[1].status, AccountStatus::Expired);
        assert_eq!(snapshot.platforms[1].revision, 1);
        assert!(store.load_platform(&future).unwrap().is_none());
        assert_eq!(
            store.load_platform(&bilibili).unwrap().as_deref(),
            Some("bili")
        );
    }

    #[test]
    fn failed_relogin_rolls_back_to_the_previous_account() {
        let store = Arc::new(MemoryCredentialStore::default());
        let bilibili = PlatformId::bilibili();
        store.save_platform(&bilibili, "old-credential").unwrap();
        let state = Arc::new(FakeAccountState::default());
        let manager = AccountManager::with_store(
            Box::new(store.clone()),
            vec![bilibili_platform()],
            adapter_map(vec![(
                bilibili.clone(),
                fake_adapter("bilibili", state.clone()),
            )]),
        );
        manager.initialize().unwrap();
        *state.refresh_expired.lock().unwrap() = true;

        let event = tauri::async_runtime::block_on(manager.submit_platform_login_input(
            &bilibili,
            "flow",
            PlatformLoginInput::SmsCode {
                code: "123456".to_string(),
            },
        ))
        .unwrap();
        assert!(matches!(event.state, PlatformLoginState::Failed));
        let snapshot = manager.account_center_snapshot().unwrap();
        assert_eq!(snapshot.platforms[0].status, AccountStatus::Authenticated);
        assert_eq!(
            snapshot.platforms[0].message_code.as_deref(),
            Some("relogin_failed")
        );
        assert_eq!(snapshot.platforms[0].revision, 0);
        assert_eq!(
            store.load_platform(&bilibili).unwrap().as_deref(),
            Some("old-credential")
        );
        let restored = state.restored_credentials.lock().unwrap();
        assert_eq!(restored.last().map(String::as_str), Some("old-credential"));
    }
}
