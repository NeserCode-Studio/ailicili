use std::sync::Arc;

use reqwest::{header::HeaderMap, Response};

mod account;

pub(crate) use account::{SessionCookies, SharedSession};

use super::{
    LivePlatformAdapter, PlatformAccountAdapter, PlatformError, PlatformFuture,
    PlatformIntegration, RegisteredPlatform,
};
use crate::{
    bilibili::BilibiliClient,
    domain::{
        AccountCapability, AccountMode, ContentKind, LiveCapability, LiveDiscovery,
        LivePlaybackInfo, LiveRoomInfo, LoginMethod, PagedLiveRooms, PlatformAvailability,
        PlatformDescriptor, PlatformId,
    },
};

pub(super) fn register(client: BilibiliClient) -> Result<RegisteredPlatform, String> {
    let descriptor = PlatformDescriptor {
        id: PlatformId::bilibili(),
        display_name: "Bilibili".to_string(),
        content_kinds: vec![ContentKind::Video, ContentKind::Live],
        availability: PlatformAvailability::Available,
        account_capability: AccountCapability {
            mode: AccountMode::Optional,
            login_methods: vec![LoginMethod::Qr, LoginMethod::Sms],
            supports_refresh: true,
            supports_logout: true,
            supports_device_reset: true,
        },
        live_capability: Some(LiveCapability {
            supports_discovery: true,
            supports_search: true,
            supports_quality_selection: true,
        }),
    };
    let live = Arc::new(BilibiliLiveAdapter {
        client: client.clone(),
    });
    let account = Arc::new(account::BilibiliAccountAdapter::new(client));

    RegisteredPlatform::new(Arc::new(BilibiliIntegration {
        descriptor,
        live,
        account,
    }))
}

struct BilibiliIntegration {
    descriptor: PlatformDescriptor,
    live: Arc<dyn LivePlatformAdapter>,
    account: Arc<dyn PlatformAccountAdapter>,
}

impl PlatformIntegration for BilibiliIntegration {
    fn descriptor(&self) -> &PlatformDescriptor {
        &self.descriptor
    }

    fn live_adapter(&self) -> Option<Arc<dyn LivePlatformAdapter>> {
        Some(self.live.clone())
    }

    fn account_adapter(&self) -> Option<Arc<dyn PlatformAccountAdapter>> {
        Some(self.account.clone())
    }
}

struct BilibiliLiveAdapter {
    client: BilibiliClient,
}

impl LivePlatformAdapter for BilibiliLiveAdapter {
    fn discover<'a>(&'a self) -> PlatformFuture<'a, LiveDiscovery> {
        Box::pin(async move {
            self.client
                .live_discovery()
                .await
                .map_err(PlatformError::from)
        })
    }

    fn search<'a>(&'a self, keyword: &'a str, page: u32) -> PlatformFuture<'a, PagedLiveRooms> {
        Box::pin(async move {
            self.client
                .search_live_rooms(keyword, page)
                .await
                .map_err(PlatformError::from)
        })
    }

    fn room_info<'a>(&'a self, room_id: &'a str) -> PlatformFuture<'a, LiveRoomInfo> {
        Box::pin(async move {
            self.client
                .live_room_info(room_id)
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
                .live_room_playback(room_id, quality)
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
                .live_media_response(url, request_headers)
                .await
                .map_err(PlatformError::from)
        })
    }
}
