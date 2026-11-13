use std::fmt;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandError {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub action: Option<String>,
}

impl CommandError {
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            action: None,
        }
    }

    pub fn with_action(
        code: impl Into<String>,
        message: impl Into<String>,
        action: impl Into<String>,
    ) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            action: Some(action.into()),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AccountStatus {
    Anonymous,
    Authenticated,
    Expired,
    Locked,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountProfile {
    pub mid: i64,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub avatar_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub level: Option<i64>,
    #[serde(default)]
    pub vip: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BilibiliAccount {
    pub status: AccountStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub profile: Option<AccountProfile>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message_code: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformAccountEntry {
    pub platform: PlatformDescriptor,
    pub status: AccountStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub profile: Option<AccountProfile>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message_code: Option<String>,
    pub revision: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountCenterSnapshot {
    pub platforms: Vec<PlatformAccountEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginCapabilities {
    pub credential_storage_available: bool,
    pub qr_available: bool,
    pub sms_available: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformLoginStart {
    pub platform_id: PlatformId,
    pub flow_id: String,
    pub method: LoginMethod,
    pub challenge: PlatformLoginChallenge,
    pub expires_in_seconds: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum PlatformLoginChallenge {
    Qr {
        image_data_url: String,
    },
    SmsCaptcha {
        provider: CaptchaProvider,
        #[serde(skip_serializing_if = "Option::is_none")]
        gt: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        challenge: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        tencent_app_id: Option<String>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum PlatformLoginInput {
    SmsCaptcha {
        country_code: String,
        phone: String,
        challenge: String,
        validate: String,
        seccode: String,
    },
    SmsCode {
        code: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformLoginEvent {
    pub platform_id: PlatformId,
    pub flow_id: String,
    pub state: PlatformLoginState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message_code: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum PlatformLoginState {
    Pending,
    Scanned,
    SmsCodeSent {
        retry_after_seconds: u64,
        expires_in_seconds: u64,
    },
    Succeeded {
        account: PlatformAccountEntry,
    },
    Expired,
    Failed,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum QrLoginStatus {
    Pending,
    Scanned,
    Expired,
    Succeeded,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QrLoginStart {
    pub login_id: String,
    pub image_data_url: String,
    pub expires_in_seconds: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QrLoginPoll {
    pub login_id: String,
    pub status: QrLoginStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub account: Option<BilibiliAccount>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message_code: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum CaptchaProvider {
    Geetest,
    Tencent,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SmsChallenge {
    pub challenge_id: String,
    pub provider: CaptchaProvider,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gt: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub challenge: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tencent_app_id: Option<String>,
    pub expires_in_seconds: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SmsCodeSent {
    pub sms_flow_id: String,
    pub retry_after_seconds: u64,
    pub expires_in_seconds: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct QualityOption {
    pub id: i64,
    pub label: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum QualityNoticeKind {
    None,
    LoginRequired,
    AccountExpired,
    QualityUnavailable,
    RiskControl,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QualityNotice {
    pub kind: QualityNoticeKind,
    pub message_code: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum StreamProtocol {
    Hls,
    Flv,
    Dash,
    Mp4,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OwnerInfo {
    pub id: i64,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub avatar_url: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoStats {
    pub view: i64,
    pub like: i64,
    pub danmaku: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(transparent)]
pub struct PlatformId(String);

impl PlatformId {
    pub const BILIBILI: &'static str = "bilibili";

    pub fn new(value: impl Into<String>) -> Result<Self, String> {
        let value = value.into();
        if value.is_empty()
            || value.len() > 64
            || !value.chars().all(|character| {
                character.is_ascii_lowercase() || character.is_ascii_digit() || character == '-'
            })
            || !value
                .chars()
                .next()
                .is_some_and(|character| character.is_ascii_lowercase())
        {
            return Err(
                "platform id must contain lowercase letters, digits and hyphens".to_string(),
            );
        }
        Ok(Self(value))
    }

    pub fn bilibili() -> Self {
        Self(Self::BILIBILI.to_string())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl Default for PlatformId {
    fn default() -> Self {
        Self::bilibili()
    }
}

impl fmt::Display for PlatformId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ContentKind {
    Video,
    Live,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PlatformAvailability {
    Available,
    Unavailable,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AccountMode {
    None,
    Optional,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum LoginMethod {
    Qr,
    Sms,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AccountCapability {
    pub mode: AccountMode,
    pub login_methods: Vec<LoginMethod>,
    pub supports_refresh: bool,
    pub supports_logout: bool,
    pub supports_device_reset: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LiveCapability {
    pub supports_discovery: bool,
    pub supports_search: bool,
    pub supports_quality_selection: bool,
    pub supports_danmaku: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PlatformDescriptor {
    pub id: PlatformId,
    pub display_name: String,
    pub content_kinds: Vec<ContentKind>,
    pub availability: PlatformAvailability,
    pub account_capability: AccountCapability,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub live_capability: Option<LiveCapability>,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum VideoSourceKind {
    #[default]
    Popular,
    Recommend,
    Region,
    Search,
    Related,
    Detail,
    History,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoCard {
    #[serde(default)]
    pub platform: PlatformId,
    pub video_id: String,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cover_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub published_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub owner: Option<OwnerInfo>,
    #[serde(default)]
    pub stats: VideoStats,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cid: Option<i64>,
    #[serde(default)]
    pub source_kind: VideoSourceKind,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoPage {
    pub page_index: u32,
    pub cid: i64,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoDetail {
    pub card: VideoCard,
    #[serde(default)]
    pub aid: i64,
    pub description: String,
    pub pages: Vec<VideoPage>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum DanmakuMode {
    Scroll,
    Bottom,
    Top,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DanmakuItem {
    pub id: String,
    pub text: String,
    pub time_ms: i64,
    pub mode: DanmakuMode,
    pub font_size: u16,
    pub color: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DanmakuSegment {
    pub cid: i64,
    pub segment_index: u32,
    pub items: Vec<DanmakuItem>,
    pub ended: bool,
    pub skipped_count: u32,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveDanmakuConnection {
    pub room_id: String,
    pub token: String,
    pub uid: u64,
    pub buvid: String,
    pub websocket_url: String,
    pub protocol_version: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LiveEmoticon {
    pub token: String,
    pub id: String,
    pub url: String,
    pub width: u32,
    pub height: u32,
    pub animated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveEmoticonCatalog {
    pub room_id: String,
    pub emoticons: Vec<LiveEmoticon>,
    pub skipped_count: u32,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum CommentSort {
    Hot,
    Time,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommentAuthor {
    pub id: i64,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub avatar_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub level: Option<i64>,
    #[serde(default)]
    pub is_up: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommentPicture {
    pub url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub height: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommentEmote {
    pub text: String,
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoComment {
    pub id: i64,
    pub author: CommentAuthor,
    pub message: String,
    #[serde(default)]
    pub pictures: Vec<CommentPicture>,
    #[serde(default)]
    pub emotes: Vec<CommentEmote>,
    pub created_at: i64,
    pub like_count: i64,
    pub reply_count: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub location: Option<String>,
    #[serde(default)]
    pub replies: Vec<VideoComment>,
    #[serde(default)]
    pub is_pinned: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommentPage {
    pub total: i64,
    pub items: Vec<VideoComment>,
    pub has_more: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommentReplyPage {
    pub items: Vec<VideoComment>,
    pub has_more: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_page: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub card: VideoCard,
    pub page_cid: i64,
    pub page_title: String,
    pub progress_seconds: i64,
    pub duration_seconds: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum FavoriteKind {
    Video,
    LiveRoom,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FavoriteTarget {
    pub platform: PlatformId,
    pub kind: FavoriteKind,
    pub target_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FavoriteDraft {
    pub target: FavoriteTarget,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cover_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub owner_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub owner_avatar_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FavoriteEntry {
    pub target: FavoriteTarget,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cover_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub owner_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub owner_avatar_url: Option<String>,
    pub saved_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PagedVideos {
    pub page: u32,
    pub items: Vec<VideoCard>,
    pub has_more: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<String>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub fallback: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamSource {
    pub id: String,
    pub protocol: StreamProtocol,
    pub url: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub backup_urls: Vec<String>,
    pub quality_id: i64,
    pub quality_label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub audio_url: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub audio_backup_urls: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub codec: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub audio_codec: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackInfo {
    pub video_id: String,
    pub cid: i64,
    pub duration_ms: i64,
    pub streams: Vec<StreamSource>,
    pub current_quality: QualityOption,
    pub advertised_qualities: Vec<QualityOption>,
    pub quality_notice: QualityNotice,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum LiveStatus {
    Live,
    Offline,
    Round,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LiveRoomCard {
    pub platform: PlatformId,
    pub room_id: String,
    pub title: String,
    pub anchor_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cover_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub avatar_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub area_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_area_name: Option<String>,
    pub online: i64,
    pub live_status: LiveStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveSection {
    pub id: String,
    pub title: String,
    pub rooms: Vec<LiveRoomCard>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveDiscovery {
    pub sections: Vec<LiveSection>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PagedLiveRooms {
    pub page: u32,
    pub items: Vec<LiveRoomCard>,
    pub has_more: bool,
    pub total: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveRoomInfo {
    pub platform: PlatformId,
    pub room_id: String,
    pub title: String,
    pub anchor_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub anchor_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cover_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub avatar_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub area_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_area_name: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    pub live_status: LiveStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub started_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LivePlaybackInfo {
    pub platform: PlatformId,
    pub room_id: String,
    pub live_status: LiveStatus,
    #[serde(default)]
    pub streams: Vec<StreamSource>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_quality: Option<QualityOption>,
    #[serde(default)]
    pub advertised_qualities: Vec<QualityOption>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn platform_id_preserves_legacy_and_future_string_values() {
        let legacy: PlatformId = serde_json::from_str("\"bilibili\"").unwrap();
        assert_eq!(legacy, PlatformId::bilibili());

        let future: PlatformId = serde_json::from_str("\"future-live\"").unwrap();
        assert_eq!(future.as_str(), "future-live");
        assert_eq!(PlatformId::default(), PlatformId::bilibili());
    }

    #[test]
    fn platform_id_registration_rejects_unsafe_values() {
        for value in ["", "Bilibili", "-bilibili", "bili_live", "bilibili.test"] {
            assert!(PlatformId::new(value).is_err(), "{value}");
        }
        assert_eq!(
            PlatformId::new("future-live-2").unwrap().as_str(),
            "future-live-2"
        );
    }

    #[test]
    fn live_wire_models_always_serialize_required_arrays() {
        let room = LiveRoomInfo {
            platform: PlatformId::bilibili(),
            room_id: "1001".to_string(),
            title: "fixture".to_string(),
            anchor_name: "anchor".to_string(),
            anchor_id: None,
            cover_url: None,
            avatar_url: None,
            area_name: None,
            parent_area_name: None,
            tags: Vec::new(),
            live_status: LiveStatus::Offline,
            started_at: None,
        };
        let serialized = serde_json::to_value(&room).unwrap();
        assert_eq!(serialized.get("tags"), Some(&serde_json::json!([])));

        let playback = LivePlaybackInfo {
            platform: PlatformId::bilibili(),
            room_id: "1001".to_string(),
            live_status: LiveStatus::Offline,
            streams: Vec::new(),
            current_quality: None,
            advertised_qualities: Vec::new(),
        };
        let serialized = serde_json::to_value(&playback).unwrap();
        assert_eq!(serialized.get("streams"), Some(&serde_json::json!([])));
        assert_eq!(
            serialized.get("advertisedQualities"),
            Some(&serde_json::json!([]))
        );
    }
}
