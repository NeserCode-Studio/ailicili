use std::sync::Arc;

use reqwest::{header::HeaderMap, Response};

use super::{
    LivePlatformAdapter, PlatformError, PlatformFuture, PlatformIntegration, RegisteredPlatform,
};
use crate::domain::{
    AccountCapability, AccountMode, CommandError, ContentKind, LiveCapability, LiveDiscovery,
    LivePlaybackInfo, LiveRoomInfo, PagedLiveRooms, PlatformAvailability, PlatformDescriptor,
    PlatformId,
};

mod client;
mod mapper;
mod media;

pub(super) use client::HuyaClient;

#[derive(Debug, thiserror::Error)]
pub(crate) enum HuyaError {
    #[error("network request failed")]
    Network(#[from] reqwest::Error),
    #[error("HTTP status {0}")]
    Http(u16),
    #[error("empty response")]
    EmptyResponse,
    #[error("room not found")]
    RoomNotFound,
    #[error("media URL expired: HTTP {0}")]
    MediaExpired(u16),
    #[error("media URL rejected")]
    MediaUrlRejected,
    #[error("media redirect rejected")]
    RedirectRejected,
    #[error("invalid response: {0}")]
    Invalid(String),
}

impl From<HuyaError> for CommandError {
    fn from(error: HuyaError) -> Self {
        match error {
            HuyaError::Network(_) => CommandError::with_action(
                "networkError",
                "虎牙直播请求失败，请检查网络后重试。",
                "retry",
            ),
            HuyaError::Http(429) => CommandError::with_action(
                "rateLimited",
                "虎牙直播请求过于频繁，请稍后再试。",
                "retryLater",
            ),
            HuyaError::Http(status) => CommandError::new(
                format!("huyaHttpError:{status}"),
                "虎牙直播服务返回了异常状态。",
            ),
            HuyaError::EmptyResponse => CommandError::with_action(
                "emptyResponse",
                "虎牙直播返回了空响应，请重试。",
                "retry",
            ),
            HuyaError::RoomNotFound => {
                CommandError::new("roomNotFound", "没有找到该虎牙直播间，请检查房间地址。")
            }
            HuyaError::MediaExpired(status) => CommandError::with_action(
                format!("streamExpired:{status}"),
                "虎牙直播地址已过期，需要刷新。",
                "refresh",
            ),
            HuyaError::MediaUrlRejected => {
                CommandError::new("mediaUrlRejected", "虎牙直播媒体地址不受支持。")
            }
            HuyaError::RedirectRejected => CommandError::new(
                "mediaRedirectRejected",
                "虎牙直播媒体跳转到了不受支持的地址。",
            ),
            HuyaError::Invalid(_) => {
                CommandError::new("invalidResponse", "虎牙直播响应格式异常，请稍后重试。")
            }
        }
    }
}

impl From<HuyaError> for PlatformError {
    fn from(error: HuyaError) -> Self {
        Self::Upstream(error.into())
    }
}

pub(super) fn register() -> Result<RegisteredPlatform, String> {
    let descriptor = PlatformDescriptor {
        id: PlatformId::new("huya")?,
        display_name: "虎牙".to_string(),
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
            supports_discovery: true,
            supports_search: false,
            supports_quality_selection: false,
        }),
    };
    let client = Arc::new(
        HuyaClient::new().map_err(|_| "failed to initialize Huya HTTP client".to_string())?,
    );
    let live = Arc::new(HuyaLiveAdapter { client });

    RegisteredPlatform::new(Arc::new(HuyaIntegration { descriptor, live }))
}

struct HuyaIntegration {
    descriptor: PlatformDescriptor,
    live: Arc<dyn LivePlatformAdapter>,
}

impl PlatformIntegration for HuyaIntegration {
    fn descriptor(&self) -> &PlatformDescriptor {
        &self.descriptor
    }

    fn live_adapter(&self) -> Option<Arc<dyn LivePlatformAdapter>> {
        Some(self.live.clone())
    }

    fn account_adapter(&self) -> Option<Arc<dyn super::PlatformAccountAdapter>> {
        None
    }
}

struct HuyaLiveAdapter {
    client: Arc<HuyaClient>,
}

impl LivePlatformAdapter for HuyaLiveAdapter {
    fn discover<'a>(&'a self) -> PlatformFuture<'a, LiveDiscovery> {
        Box::pin(async move { self.client.discover().await.map_err(PlatformError::from) })
    }

    fn search<'a>(&'a self, _keyword: &'a str, _page: u32) -> PlatformFuture<'a, PagedLiveRooms> {
        Box::pin(async {
            Err(PlatformError::Unsupported(
                "Huya live search is not enabled".to_string(),
            ))
        })
    }

    fn room_info<'a>(&'a self, room_id: &'a str) -> PlatformFuture<'a, LiveRoomInfo> {
        Box::pin(async move {
            self.client
                .room_info(room_id)
                .await
                .map_err(PlatformError::from)
        })
    }

    fn room_playback<'a>(
        &'a self,
        room_id: &'a str,
        quality: i64,
    ) -> PlatformFuture<'a, LivePlaybackInfo> {
        Box::pin(async move {
            self.client
                .room_playback(room_id, quality)
                .await
                .map_err(PlatformError::from)
        })
    }

    fn media_response<'a>(
        &'a self,
        url: &'a str,
        request_headers: &'a HeaderMap,
    ) -> PlatformFuture<'a, Response> {
        Box::pin(async move {
            self.client
                .media_response(url, request_headers)
                .await
                .map_err(PlatformError::from)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn huya_registers_as_live_only_without_accounts_or_search() {
        let registered = register().expect("Huya registration should be valid");
        let descriptor = registered.descriptor();

        assert_eq!(descriptor.id.as_str(), "huya");
        assert_eq!(descriptor.content_kinds, vec![ContentKind::Live]);
        assert_eq!(descriptor.account_capability.mode, AccountMode::None);
        let capability = descriptor
            .live_capability
            .as_ref()
            .expect("live capability");
        assert!(capability.supports_discovery);
        assert!(!capability.supports_search);
        assert!(!capability.supports_quality_selection);
    }
}
