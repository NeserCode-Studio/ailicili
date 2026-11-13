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

pub(super) use client::DouyinClient;

#[derive(Debug, thiserror::Error)]
pub(crate) enum DouyinError {
    #[error("network request failed")]
    Network(#[from] reqwest::Error),
    #[error("HTTP status {0}")]
    Http(u16),
    #[error("empty response")]
    EmptyResponse,
    #[error("API status {0}")]
    Api(i64),
    #[error("ttwid unavailable")]
    TtwidUnavailable,
    #[error("room not found")]
    RoomNotFound,
    #[error("content unavailable")]
    ContentUnavailable,
    #[error("risk control")]
    RiskControl,
    #[error("media URL expired")]
    MediaExpired,
    #[error("media URL rejected")]
    MediaUrlRejected,
    #[error("media redirect rejected")]
    RedirectRejected,
    #[error("invalid response: {0}")]
    Invalid(String),
}

impl From<DouyinError> for CommandError {
    fn from(error: DouyinError) -> Self {
        match error {
            DouyinError::Network(_) => CommandError::with_action(
                "networkError",
                "抖音直播请求失败，请检查网络后重试。",
                "retry",
            ),
            DouyinError::Http(429) => CommandError::with_action(
                "rateLimited",
                "抖音直播请求过于频繁，请稍后再试。",
                "retryLater",
            ),
            DouyinError::Http(status) => CommandError::new(
                format!("douyinHttpError:{status}"),
                "抖音直播服务返回了异常状态。",
            ),
            DouyinError::EmptyResponse => CommandError::with_action(
                "emptyResponse",
                "抖音直播返回了空响应，请重试。",
                "retry",
            ),
            DouyinError::Api(code) => CommandError::new(
                format!("douyinApiError:{code}"),
                "抖音直播服务返回了未处理的错误。",
            ),
            DouyinError::TtwidUnavailable => CommandError::with_action(
                "ttwidUnavailable",
                "无法建立抖音匿名访问会话，请稍后重试。",
                "retry",
            ),
            DouyinError::RoomNotFound => {
                CommandError::new("roomNotFound", "没有找到该抖音直播间，请检查房间地址。")
            }
            DouyinError::ContentUnavailable => CommandError::with_action(
                "liveContentUnavailable",
                "该直播暂时无法查看，可能已结束或受平台限制。",
                "retryLater",
            ),
            DouyinError::RiskControl => CommandError::with_action(
                "riskControl",
                "抖音直播触发了风控校验，请稍后重试。",
                "retryLater",
            ),
            DouyinError::MediaExpired => CommandError::with_action(
                "streamExpired",
                "抖音直播地址已过期，需要刷新。",
                "refresh",
            ),
            DouyinError::MediaUrlRejected => {
                CommandError::new("mediaUrlRejected", "抖音直播媒体地址不受支持。")
            }
            DouyinError::RedirectRejected => CommandError::new(
                "mediaRedirectRejected",
                "抖音直播媒体跳转到了不受支持的地址。",
            ),
            DouyinError::Invalid(_) => {
                CommandError::new("invalidResponse", "抖音直播响应格式异常，请稍后重试。")
            }
        }
    }
}

impl From<DouyinError> for PlatformError {
    fn from(error: DouyinError) -> Self {
        Self::Upstream(error.into())
    }
}

pub(super) fn register() -> Result<RegisteredPlatform, String> {
    let descriptor = PlatformDescriptor {
        id: PlatformId::new("douyin")?,
        display_name: "抖音".to_string(),
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
            supports_quality_selection: true,
            supports_danmaku: false,
        }),
    };
    let client = Arc::new(
        DouyinClient::new().map_err(|_| "failed to initialize Douyin HTTP client".to_string())?,
    );
    let live = Arc::new(DouyinLiveAdapter { client });

    RegisteredPlatform::new(Arc::new(DouyinIntegration { descriptor, live }))
}

struct DouyinIntegration {
    descriptor: PlatformDescriptor,
    live: Arc<dyn LivePlatformAdapter>,
}

impl PlatformIntegration for DouyinIntegration {
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

struct DouyinLiveAdapter {
    client: Arc<DouyinClient>,
}

impl LivePlatformAdapter for DouyinLiveAdapter {
    fn discover<'a>(&'a self) -> PlatformFuture<'a, LiveDiscovery> {
        Box::pin(async move { self.client.discover().await.map_err(PlatformError::from) })
    }

    fn search<'a>(&'a self, _keyword: &'a str, _page: u32) -> PlatformFuture<'a, PagedLiveRooms> {
        Box::pin(async {
            Err(PlatformError::Unsupported(
                "Douyin live search is not enabled".to_string(),
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
    fn douyin_registers_as_live_only_without_accounts() {
        let registered = register().expect("Douyin registration should be valid");
        let descriptor = registered.descriptor();

        assert_eq!(descriptor.id.as_str(), "douyin");
        assert_eq!(descriptor.content_kinds, vec![ContentKind::Live]);
        assert_eq!(descriptor.account_capability.mode, AccountMode::None);
        assert!(descriptor.live_capability.is_some());
    }
}
