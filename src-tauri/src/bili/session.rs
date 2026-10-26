use std::{
    collections::{BTreeMap, BTreeSet},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};

use keyring::{Entry, Error as KeyringError};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::sync::RwLock;

const KEYRING_SERVICE: &str = "com.nesercode.ailicili";
const KEYRING_USERNAME: &str = "bilibili-session";
const SESSION_VERSION: u8 = 1;
const REQUIRED_COOKIES: [&str; 4] = ["SESSDATA", "bili_jct", "DedeUserID", "DedeUserID__ckMd5"];

#[derive(Debug, Error)]
pub enum SessionStoreError {
    #[error("Windows Credential Manager is unavailable")]
    Unavailable,
    #[error("the stored Bilibili session is invalid")]
    InvalidData,
    #[error("Windows Credential Manager operation failed")]
    CredentialStore,
}

pub trait SessionStore: Send + Sync {
    fn load(&self) -> Result<Option<Session>, SessionStoreError>;
    fn save(&self, session: &Session) -> Result<(), SessionStoreError>;
    fn delete(&self) -> Result<(), SessionStoreError>;
}

#[derive(Clone, PartialEq, Eq, Serialize)]
pub struct Session {
    cookies: BTreeMap<String, String>,
}

#[derive(Deserialize)]
struct StoredSession {
    version: u8,
    cookies: BTreeMap<String, String>,
}

#[derive(Serialize)]
struct StoredSessionRef<'a> {
    version: u8,
    cookies: &'a BTreeMap<String, String>,
}

impl Session {
    pub fn from_cookie_pairs(
        pairs: impl IntoIterator<Item = (String, String)>,
    ) -> Result<Self, SessionStoreError> {
        let allowed = REQUIRED_COOKIES.into_iter().collect::<BTreeSet<_>>();
        let cookies = pairs
            .into_iter()
            .filter(|(name, value)| allowed.contains(name.as_str()) && !value.is_empty())
            .collect::<BTreeMap<_, _>>();
        let missing = REQUIRED_COOKIES
            .into_iter()
            .filter(|name| !cookies.contains_key(*name))
            .collect::<Vec<_>>();

        if missing.is_empty() {
            Ok(Self { cookies })
        } else {
            Err(SessionStoreError::InvalidData)
        }
    }

    fn from_stored(value: &str) -> Result<Self, SessionStoreError> {
        let stored: StoredSession =
            serde_json::from_str(value).map_err(|_| SessionStoreError::InvalidData)?;
        if stored.version != SESSION_VERSION {
            return Err(SessionStoreError::InvalidData);
        }
        Self::from_cookie_pairs(stored.cookies)
    }

    fn serialized(&self) -> Result<String, SessionStoreError> {
        serde_json::to_string(&StoredSessionRef {
            version: SESSION_VERSION,
            cookies: &self.cookies,
        })
        .map_err(|_| SessionStoreError::InvalidData)
    }

    pub fn cookie_pairs(&self) -> impl Iterator<Item = (&str, &str)> {
        self.cookies
            .iter()
            .map(|(name, value)| (name.as_str(), value.as_str()))
    }

    pub fn user_id(&self) -> Option<&str> {
        self.cookies.get("DedeUserID").map(String::as_str)
    }

    pub fn csrf_token(&self) -> Option<&str> {
        self.cookies.get("bili_jct").map(String::as_str)
    }
}

pub struct KeyringSessionStore;

impl KeyringSessionStore {
    fn entry() -> Result<Entry, SessionStoreError> {
        Entry::new(KEYRING_SERVICE, KEYRING_USERNAME).map_err(|_| SessionStoreError::Unavailable)
    }
}

impl SessionStore for KeyringSessionStore {
    fn load(&self) -> Result<Option<Session>, SessionStoreError> {
        match Self::entry()?.get_password() {
            Ok(value) => Session::from_stored(&value).map(Some),
            Err(KeyringError::NoEntry) => Ok(None),
            Err(_) => Err(SessionStoreError::CredentialStore),
        }
    }

    fn save(&self, session: &Session) -> Result<(), SessionStoreError> {
        let value = session.serialized()?;
        Self::entry()?
            .set_password(&value)
            .map_err(|_| SessionStoreError::CredentialStore)
    }

    fn delete(&self) -> Result<(), SessionStoreError> {
        match Self::entry()?.delete_credential() {
            Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
            Err(_) => Err(SessionStoreError::CredentialStore),
        }
    }
}

pub struct SessionManager {
    session: RwLock<Option<Session>>,
    store: Arc<dyn SessionStore>,
    storage_available: AtomicBool,
}

impl SessionManager {
    pub fn new(store: Arc<dyn SessionStore>) -> Self {
        let (session, storage_available) = match store.load() {
            Ok(session) => (session, true),
            Err(_) => (None, false),
        };

        Self {
            session: RwLock::new(session),
            store,
            storage_available: AtomicBool::new(storage_available),
        }
    }

    pub fn storage_available(&self) -> bool {
        self.storage_available.load(Ordering::Relaxed)
    }

    pub async fn has_session(&self) -> bool {
        self.session.read().await.is_some()
    }

    pub async fn cookie_header(&self) -> Option<String> {
        self.session.read().await.as_ref().map(|session| {
            session
                .cookie_pairs()
                .map(|(name, value)| format!("{name}={value}"))
                .collect::<Vec<_>>()
                .join("; ")
        })
    }

    pub async fn user_id(&self) -> Option<String> {
        self.session
            .read()
            .await
            .as_ref()
            .and_then(Session::user_id)
            .map(str::to_owned)
    }

    pub(crate) async fn csrf_token(&self) -> Option<String> {
        self.session
            .read()
            .await
            .as_ref()
            .and_then(Session::csrf_token)
            .map(str::to_owned)
    }

    pub async fn replace(&self, session: Session) -> Result<(), SessionStoreError> {
        let stored = self.store.save(&session);
        self.storage_available
            .store(stored.is_ok(), Ordering::Relaxed);
        stored?;
        *self.session.write().await = Some(session);
        Ok(())
    }

    pub async fn logout(&self) -> Result<(), SessionStoreError> {
        *self.session.write().await = None;
        let deleted = self.store.delete();
        self.storage_available
            .store(deleted.is_ok(), Ordering::Relaxed);
        deleted
    }

    pub async fn clear_invalid(&self) {
        *self.session.write().await = None;
        let deleted = self.store.delete();
        self.storage_available
            .store(deleted.is_ok(), Ordering::Relaxed);
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use super::{Session, SessionManager, SessionStore, SessionStoreError, REQUIRED_COOKIES};

    #[derive(Default)]
    struct MemoryStore {
        value: Mutex<Option<String>>,
    }

    impl SessionStore for MemoryStore {
        fn load(&self) -> Result<Option<Session>, SessionStoreError> {
            self.value
                .lock()
                .expect("session store lock")
                .as_deref()
                .map(Session::from_stored)
                .transpose()
        }

        fn save(&self, session: &Session) -> Result<(), SessionStoreError> {
            *self.value.lock().expect("session store lock") = Some(session.serialized()?);
            Ok(())
        }

        fn delete(&self) -> Result<(), SessionStoreError> {
            *self.value.lock().expect("session store lock") = None;
            Ok(())
        }
    }

    fn fixture_session() -> Session {
        Session::from_cookie_pairs(
            REQUIRED_COOKIES
                .into_iter()
                .map(|name| (name.to_owned(), format!("{name}-value"))),
        )
        .expect("fixture session")
    }

    #[test]
    fn rejects_incomplete_sessions_and_drops_unneeded_cookies() {
        assert!(Session::from_cookie_pairs([
            ("SESSDATA".to_owned(), "secret".to_owned()),
            ("bili_jct".to_owned(), "csrf".to_owned()),
        ])
        .is_err());

        let mut pairs = REQUIRED_COOKIES
            .into_iter()
            .map(|name| (name.to_owned(), format!("{name}-value")))
            .collect::<Vec<_>>();
        pairs.push(("buvid3".to_owned(), "guest".to_owned()));
        let session = Session::from_cookie_pairs(pairs).expect("valid session");
        assert_eq!(session.cookie_pairs().count(), REQUIRED_COOKIES.len());
    }

    #[tokio::test]
    async fn saves_restores_and_clears_a_session() {
        let store = Arc::new(MemoryStore::default());
        let manager = SessionManager::new(store.clone());
        manager
            .replace(fixture_session())
            .await
            .expect("session saves");

        assert!(manager.has_session().await);
        assert!(manager
            .cookie_header()
            .await
            .expect("cookie header")
            .contains("SESSDATA="));
        assert_eq!(manager.user_id().await.as_deref(), Some("DedeUserID-value"));
        assert_eq!(
            manager.csrf_token().await.as_deref(),
            Some("bili_jct-value")
        );

        let restored = SessionManager::new(store);
        assert!(restored.has_session().await);

        restored.logout().await.expect("session clears");
        assert!(!restored.has_session().await);
        assert!(manager.has_session().await);
    }
}
