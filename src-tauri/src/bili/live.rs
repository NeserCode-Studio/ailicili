use std::{
    collections::{BTreeMap, HashMap, HashSet},
    sync::{Arc, RwLock},
    time::{Duration, Instant},
};

use reqwest::{
    header::{COOKIE, ORIGIN, REFERER},
    Client, Url,
};
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;
use uuid::Uuid;

use super::{
    client::{ApiEnvelope, BiliClient},
    error::BiliError,
    types::image_url,
    wbi::{should_refresh_wbi, sign_query, unix_timestamp, WbiKeys},
};

const LIVE_REFERER: &str = "https://live.bilibili.com/";
const LIVE_MEDIA_ORIGIN: &str = "http://bilistream.localhost";
const AREA_LIST_URL: &str =
    "https://api.live.bilibili.com/xlive/web-interface/v1/index/getWebAreaList";
const HOME_FEED_URL: &str = "https://api.live.bilibili.com/xlive/web-interface/v1/index/getList";
const FILTERED_ROOMS_URL: &str =
    "https://api.live.bilibili.com/xlive/web-interface/v1/second/getListByArea";
const ROOM_INFO_URL: &str = "https://api.live.bilibili.com/room/v1/Room/get_info";
const MASTER_INFO_URL: &str = "https://api.live.bilibili.com/live_user/v1/Master/info";
const PLAY_INFO_URL: &str = "https://api.live.bilibili.com/xlive/web-room/v2/index/getRoomPlayInfo";
const DANMAKU_INFO_URL: &str = "https://api.live.bilibili.com/xlive/web-room/v1/index/getDanmuInfo";
const LIVE_SESSION_TTL: Duration = Duration::from_secs(20 * 60);
const LIVE_ASSET_TTL: Duration = Duration::from_secs(10 * 60);
const MAX_LIVE_SESSIONS: usize = 16;
const MAX_LIVE_ASSETS: usize = 2048;
const MAX_PLAYLIST_BYTES: usize = 2 * 1024 * 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveArea {
    pub id: String,
    pub name: String,
    pub children: Vec<LiveSubArea>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveSubArea {
    pub id: String,
    pub parent_id: String,
    pub name: String,
    pub icon_url: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveRoomSummary {
    pub room_id: u64,
    pub short_id: u64,
    pub uid: u64,
    pub title: String,
    pub cover_url: String,
    pub keyframe_url: String,
    pub anchor_name: String,
    pub anchor_avatar_url: String,
    pub area_id: String,
    pub parent_area_id: String,
    pub area_name: String,
    pub parent_area_name: String,
    pub online: u64,
    pub live_status: u8,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LiveFeedMode {
    Area,
    Recommended,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveRoomPage {
    pub rooms: Vec<LiveRoomSummary>,
    pub page: u32,
    pub page_size: u32,
    pub has_more: bool,
    pub mode: LiveFeedMode,
    pub fallback_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveRoomDetail {
    pub room: LiveRoomSummary,
    pub description: String,
    pub tags: Vec<String>,
    pub follower_count: u64,
    pub anchor_level: u32,
    pub live_time: String,
    pub web_url: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LivePlaybackQuality {
    pub id: u32,
    pub label: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LivePlaybackSession {
    pub session_id: String,
    pub room_id: u64,
    pub live_status: u8,
    pub playback_url: Option<String>,
    pub expires_in_seconds: u64,
    pub selected_quality: u32,
    pub qualities: Vec<LivePlaybackQuality>,
    pub stream_format: Option<String>,
}

#[derive(Debug, Clone)]
pub(crate) struct LiveDanmakuConfig {
    pub token: String,
    pub hosts: Vec<LiveDanmakuHost>,
}

#[derive(Debug, Clone)]
pub(crate) struct LiveDanmakuHost {
    pub host: String,
    pub wss_port: u16,
}

#[derive(Debug)]
struct LiveMediaAsset {
    remote_url: String,
    is_playlist: bool,
    created_at: Instant,
    last_access: RwLock<Instant>,
}

struct LiveMediaSession {
    token: String,
    room_id: u64,
    created_at: Instant,
    playlist_url: String,
    cookie_header: String,
    assets: RwLock<HashMap<String, LiveMediaAsset>>,
    asset_tokens: RwLock<HashMap<String, String>>,
    last_access: RwLock<Instant>,
}

pub(crate) struct LiveAssetRequest {
    pub remote_url: String,
    pub cookie_header: String,
    pub referer: String,
    is_playlist: bool,
}

impl LiveAssetRequest {
    pub(crate) fn is_playlist(&self) -> bool {
        self.is_playlist
    }
}

#[derive(Default)]
pub struct LiveMediaSessions {
    values: RwLock<HashMap<String, Arc<LiveMediaSession>>>,
}

impl LiveMediaSessions {
    pub fn new() -> Self {
        Self::default()
    }

    fn insert(&self, session: LiveMediaSession) -> Result<(), BiliError> {
        let token = session.token.clone();
        let now = Instant::now();
        let mut values = self.values.write().map_err(|_| BiliError::Internal)?;
        values.retain(|_, value| value.is_active_at(now));
        if values.len() >= MAX_LIVE_SESSIONS {
            if let Some(oldest) = values
                .iter()
                .min_by_key(|(_, value)| value.last_access_at())
                .map(|(token, _)| token.clone())
            {
                values.remove(&oldest);
            }
        }
        values.insert(token, Arc::new(session));
        Ok(())
    }

    fn get(&self, token: &str) -> Option<Arc<LiveMediaSession>> {
        if !valid_opaque_token(token) {
            return None;
        }
        let session = self
            .values
            .read()
            .ok()?
            .get(token)
            .filter(|session| session.is_active())
            .cloned()?;
        session.touch();
        Some(session)
    }

    pub(crate) async fn playlist(&self, http: &Client, token: &str) -> Result<String, BiliError> {
        let session = self.get(token).ok_or_else(|| {
            BiliError::InvalidInput("live playback session is missing or expired")
        })?;
        let source = fetch_playlist(
            http,
            &session.playlist_url,
            &session.cookie_header,
            &live_referer(session.room_id),
        )
        .await?;
        session.rewrite_playlist(&source, &session.playlist_url)
    }

    pub(crate) async fn asset_playlist(
        &self,
        http: &Client,
        token: &str,
        asset_token: &str,
    ) -> Result<Option<String>, BiliError> {
        let asset = self
            .asset(token, asset_token)
            .ok_or_else(|| BiliError::InvalidInput("live playback asset is missing or expired"))?;
        if !asset.is_playlist {
            return Ok(None);
        }
        let session = self.get(token).ok_or_else(|| {
            BiliError::InvalidInput("live playback session is missing or expired")
        })?;
        let source = fetch_playlist(
            http,
            &asset.remote_url,
            &asset.cookie_header,
            &asset.referer,
        )
        .await?;
        session
            .rewrite_playlist(&source, &asset.remote_url)
            .map(Some)
    }

    pub(crate) fn asset(&self, token: &str, asset_token: &str) -> Option<LiveAssetRequest> {
        if !valid_opaque_token(asset_token) {
            return None;
        }
        let session = self.get(token)?;
        let assets = session.assets.read().ok()?;
        let asset = assets.get(asset_token).filter(|asset| asset.is_active())?;
        asset.touch();
        Some(LiveAssetRequest {
            remote_url: asset.remote_url.clone(),
            cookie_header: session.cookie_header.clone(),
            referer: live_referer(session.room_id),
            is_playlist: asset.is_playlist,
        })
    }
}

impl LiveMediaSession {
    fn is_active(&self) -> bool {
        self.is_active_at(Instant::now())
    }

    fn is_active_at(&self, now: Instant) -> bool {
        self.last_access_at()
            .checked_add(LIVE_SESSION_TTL)
            .is_some_and(|expires_at| now < expires_at)
    }

    fn last_access_at(&self) -> Instant {
        self.last_access
            .read()
            .map(|value| *value)
            .unwrap_or(self.created_at)
    }

    fn touch(&self) {
        if let Ok(mut last_access) = self.last_access.write() {
            *last_access = Instant::now();
        }
    }

    fn rewrite_playlist(&self, source: &str, playlist_url: &str) -> Result<String, BiliError> {
        let base = Url::parse(playlist_url)
            .map_err(|_| BiliError::InvalidResponse("invalid live playlist URL"))?;
        let mut output = String::with_capacity(source.len() + 1024);

        for line in source.lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                output.push('\n');
                continue;
            }

            if trimmed.starts_with('#') {
                output.push_str(&self.rewrite_tag_uris(line, &base)?);
            } else {
                output.push_str(&self.proxy_url(&base, trimmed)?);
            }
            output.push('\n');
        }

        if !output.starts_with("#EXTM3U") {
            return Err(BiliError::InvalidResponse(
                "upstream response is not an HLS playlist",
            ));
        }
        Ok(output)
    }

    fn rewrite_tag_uris(&self, line: &str, base: &Url) -> Result<String, BiliError> {
        let mut output = String::with_capacity(line.len());
        let mut remaining = line;

        while let Some(start) = remaining.find("URI=\"") {
            let value_start = start + 5;
            output.push_str(&remaining[..value_start]);
            let after_value = &remaining[value_start..];
            let Some(end) = after_value.find('"') else {
                output.push_str(after_value);
                return Ok(output);
            };
            output.push_str(&self.proxy_url(base, &after_value[..end])?);
            output.push('"');
            remaining = &after_value[end + 1..];
        }
        output.push_str(remaining);
        Ok(output)
    }

    fn proxy_url(&self, base: &Url, value: &str) -> Result<String, BiliError> {
        let remote = base
            .join(value)
            .map_err(|_| BiliError::InvalidResponse("invalid live playlist asset URL"))?;
        if !matches!(remote.scheme(), "https" | "http") {
            return Err(BiliError::InvalidResponse(
                "unsupported live playlist asset scheme",
            ));
        }
        let asset_token = Uuid::new_v4().to_string();
        let now = Instant::now();
        let mut assets = self.assets.write().map_err(|_| BiliError::Internal)?;
        let mut asset_tokens = self
            .asset_tokens
            .write()
            .map_err(|_| BiliError::Internal)?;
        assets.retain(|_, asset| asset.is_active_at(now));
        asset_tokens.retain(|_, token| assets.contains_key(token));
        let remote_url = remote.to_string();
        if let Some(asset_token) = asset_tokens.get(&remote_url) {
            if let Some(asset) = assets.get(asset_token) {
                asset.touch();
                return Ok(format!(
                    "{LIVE_MEDIA_ORIGIN}/live/{}/asset/{asset_token}",
                    self.token
                ));
            }
        }
        if assets.len() >= MAX_LIVE_ASSETS {
            if let Some(oldest) = assets
                .iter()
                .min_by_key(|(_, asset)| asset.last_access_at())
                .map(|(token, _)| token.clone())
            {
                assets.remove(&oldest);
                asset_tokens.remove(&oldest);
            }
        }
        assets.insert(
            asset_token.clone(),
            LiveMediaAsset {
                remote_url: remote_url.clone(),
                is_playlist: remote.path().to_ascii_lowercase().ends_with(".m3u8"),
                created_at: now,
                last_access: RwLock::new(now),
            },
        );
        asset_tokens.insert(remote_url, asset_token.clone());
        Ok(format!(
            "{LIVE_MEDIA_ORIGIN}/live/{}/asset/{asset_token}",
            self.token
        ))
    }
}

impl LiveMediaAsset {
    fn is_active(&self) -> bool {
        self.is_active_at(Instant::now())
    }

    fn is_active_at(&self, now: Instant) -> bool {
        self.last_access_at()
            .checked_add(LIVE_ASSET_TTL)
            .is_some_and(|expires_at| now < expires_at)
    }

    fn last_access_at(&self) -> Instant {
        self.last_access
            .read()
            .map(|value| *value)
            .unwrap_or(self.created_at)
    }

    fn touch(&self) {
        if let Ok(mut last_access) = self.last_access.write() {
            *last_access = Instant::now();
        }
    }
}

impl BiliClient {
    pub async fn live_areas(&self) -> Result<Vec<LiveArea>, BiliError> {
        let data: RawAreaListData = self
            .live_get(
                AREA_LIST_URL,
                &[("source_id", "2".to_owned())],
                LIVE_REFERER,
            )
            .await?;
        Ok(data
            .data
            .into_iter()
            .filter_map(|area| {
                let name = clean_text(&area.name);
                if area.id.0.is_empty() || name.is_empty() {
                    return None;
                }
                Some(LiveArea {
                    id: area.id.0.clone(),
                    name,
                    children: area
                        .list
                        .into_iter()
                        .filter_map(|child| {
                            let name = clean_text(&child.name);
                            let id = child.id.0;
                            if id.is_empty() || name.is_empty() {
                                return None;
                            }
                            Some(LiveSubArea {
                                id,
                                parent_id: if child.parent_id.0.is_empty() {
                                    area.id.0.clone()
                                } else {
                                    child.parent_id.0
                                },
                                name,
                                icon_url: image_url(&child.pic, "@96w_96h_1c.webp"),
                            })
                        })
                        .collect(),
                })
            })
            .collect())
    }

    pub async fn live_rooms(
        &self,
        parent_area_id: Option<String>,
        area_id: Option<String>,
        page: u32,
        page_size: u32,
    ) -> Result<LiveRoomPage, BiliError> {
        let page = page.clamp(1, 50);
        let page_size = page_size.clamp(1, 30);
        let parent_area_id = normalize_area_id(parent_area_id);
        let area_id = normalize_area_id(area_id);
        let filtered = parent_area_id != "0" || area_id != "0";

        if filtered {
            let result = self
                .live_get::<RawLiveFeedPage>(
                    FILTERED_ROOMS_URL,
                    &[
                        ("platform", "web".to_owned()),
                        ("parent_area_id", parent_area_id.clone()),
                        ("area_id", area_id.clone()),
                        ("sort_type", "online".to_owned()),
                        ("page", page.to_string()),
                        ("page_size", page_size.to_string()),
                    ],
                    LIVE_REFERER,
                )
                .await;
            match result {
                Ok(data) if !data.list.is_empty() => {
                    let rooms = deduplicate_rooms(data.list.into_iter().filter_map(map_feed_room));
                    return Ok(LiveRoomPage {
                        has_more: rooms.len() >= page_size as usize,
                        rooms,
                        page,
                        page_size,
                        mode: LiveFeedMode::Area,
                        fallback_reason: None,
                    });
                }
                Ok(_) => {}
                Err(error) if live_feed_fallback_reason(&error).is_some() => {}
                Err(error) => return Err(error),
            }
        }

        let data: RawLiveHomePage = self
            .live_get(
                HOME_FEED_URL,
                &[("platform", "web".to_owned())],
                LIVE_REFERER,
            )
            .await?;
        let rooms = deduplicate_rooms(
            data.room_list
                .into_iter()
                .flat_map(|module| module.list)
                .filter_map(map_home_room),
        );
        let start = ((page - 1) * page_size) as usize;
        let end = start.saturating_add(page_size as usize);
        let has_more = end < rooms.len();
        let rooms = rooms
            .into_iter()
            .skip(start)
            .take(page_size as usize)
            .collect::<Vec<_>>();

        Ok(LiveRoomPage {
            has_more,
            rooms,
            page,
            page_size,
            mode: LiveFeedMode::Recommended,
            fallback_reason: filtered.then(|| "area_feed_unavailable".to_owned()),
        })
    }

    pub async fn live_room_detail(&self, room_id: u64) -> Result<LiveRoomDetail, BiliError> {
        if room_id == 0 {
            return Err(BiliError::InvalidInput("room id must be positive"));
        }
        let raw: RawRoomInfo = self
            .live_get(
                ROOM_INFO_URL,
                &[("room_id", room_id.to_string())],
                format!("https://live.bilibili.com/{room_id}").as_str(),
            )
            .await?;
        let master = self
            .live_get::<RawMasterInfo>(
                MASTER_INFO_URL,
                &[("uid", raw.uid.to_string())],
                LIVE_REFERER,
            )
            .await
            .ok();
        Ok(raw.into_detail(master))
    }

    pub async fn create_live_playback_session(
        &self,
        room_id: u64,
        qn: u32,
    ) -> Result<LivePlaybackSession, BiliError> {
        if room_id == 0 {
            return Err(BiliError::InvalidInput("room id must be positive"));
        }
        let qn = qn.clamp(80, 30_000);
        let data: RawLivePlayInfo = self
            .live_get(
                PLAY_INFO_URL,
                &[
                    ("room_id", room_id.to_string()),
                    ("protocol", "1".to_owned()),
                    ("format", "2,1".to_owned()),
                    ("codec", "0".to_owned()),
                    ("qn", qn.to_string()),
                    ("platform", "web".to_owned()),
                    ("ptype", "8".to_owned()),
                ],
                format!("https://live.bilibili.com/{room_id}").as_str(),
            )
            .await?;

        if data.live_status != 1 {
            return Ok(LivePlaybackSession {
                session_id: String::new(),
                room_id,
                live_status: data.live_status,
                playback_url: None,
                expires_in_seconds: 0,
                selected_quality: 0,
                qualities: Vec::new(),
                stream_format: None,
            });
        }
        if data.encrypted && !data.pwd_verified {
            return Err(BiliError::PlaybackUnavailable(
                "password-protected live room",
            ));
        }

        let playurl = data.playurl_info.and_then(|info| info.playurl).ok_or(
            BiliError::PlaybackUnavailable("live playback streams are missing"),
        )?;
        let selected = select_live_codec(&playurl.stream).ok_or(BiliError::PlaybackUnavailable(
            "no browser-playable HLS representation",
        ))?;
        let url_info = selected
            .codec
            .url_info
            .first()
            .ok_or(BiliError::PlaybackUnavailable(
                "live playback hosts are missing",
            ))?;
        let playlist_url = format!(
            "{}{}{}",
            url_info.host.trim_end_matches('/'),
            selected.codec.base_url,
            url_info.extra
        );
        let parsed_url = Url::parse(&playlist_url)
            .map_err(|_| BiliError::InvalidResponse("invalid live playback URL"))?;
        if parsed_url.scheme() != "https" {
            return Err(BiliError::InvalidResponse(
                "live playback URL must use HTTPS",
            ));
        }

        let mut quality_labels = playurl
            .g_qn_desc
            .into_iter()
            .map(|quality| (quality.qn, clean_text(&quality.desc)))
            .collect::<HashMap<_, _>>();
        let mut qualities = selected
            .codec
            .accept_qn
            .iter()
            .copied()
            .map(|id| LivePlaybackQuality {
                id,
                label: quality_labels
                    .remove(&id)
                    .filter(|label| !label.is_empty())
                    .unwrap_or_else(|| format!("{id}")),
            })
            .collect::<Vec<_>>();
        qualities.sort_by(|left, right| right.id.cmp(&left.id));
        if qualities.is_empty() {
            qualities.push(LivePlaybackQuality {
                id: selected.codec.current_qn,
                label: quality_labels
                    .remove(&selected.codec.current_qn)
                    .filter(|label| !label.is_empty())
                    .unwrap_or_else(|| format!("{}", selected.codec.current_qn)),
            });
        }

        let cookie_header = self.search_cookie_header().await?;
        let token = Uuid::new_v4().to_string();
        let session = LiveMediaSession {
            token: token.clone(),
            room_id,
            created_at: Instant::now(),
            playlist_url,
            cookie_header,
            assets: RwLock::new(HashMap::new()),
            asset_tokens: RwLock::new(HashMap::new()),
            last_access: RwLock::new(Instant::now()),
        };
        let stream_format = selected.format_name.to_owned();
        self.live_media.insert(session)?;

        Ok(LivePlaybackSession {
            session_id: token.clone(),
            room_id,
            live_status: data.live_status,
            playback_url: Some(format!("{LIVE_MEDIA_ORIGIN}/live/{token}/index.m3u8")),
            expires_in_seconds: LIVE_SESSION_TTL.as_secs(),
            selected_quality: selected.codec.current_qn,
            qualities,
            stream_format: Some(stream_format),
        })
    }

    pub(crate) async fn live_danmaku_config(
        &self,
        room_id: u64,
    ) -> Result<LiveDanmakuConfig, BiliError> {
        if room_id == 0 {
            return Err(BiliError::InvalidInput("room id must be positive"));
        }
        let cookie_header = self.search_cookie_header().await?;
        let keys = self
            .wbi
            .keys(&self.http, Some(&cookie_header), false)
            .await?;
        let first = self
            .danmaku_config_once(room_id, &cookie_header, &keys)
            .await;
        let data = match first {
            Ok(data) => data,
            Err(error) if retryable_wbi(&error) => {
                let keys = self
                    .wbi
                    .keys(&self.http, Some(&cookie_header), true)
                    .await?;
                self.danmaku_config_once(room_id, &cookie_header, &keys)
                    .await?
            }
            Err(error) => return Err(error),
        };
        let token = data.token.trim().to_owned();
        let hosts = data
            .host_list
            .into_iter()
            .filter(|host| !host.host.trim().is_empty() && host.wss_port > 0)
            .map(|host| LiveDanmakuHost {
                host: host.host.trim().to_owned(),
                wss_port: host.wss_port,
            })
            .collect::<Vec<_>>();
        if token.is_empty() || hosts.is_empty() {
            return Err(BiliError::InvalidResponse(
                "live danmaku configuration is incomplete",
            ));
        }
        Ok(LiveDanmakuConfig { token, hosts })
    }

    async fn danmaku_config_once(
        &self,
        room_id: u64,
        cookie_header: &str,
        keys: &WbiKeys,
    ) -> Result<RawDanmakuInfo, BiliError> {
        let params = BTreeMap::from([
            ("id".to_owned(), room_id.to_string()),
            ("type".to_owned(), "0".to_owned()),
            ("web_location".to_owned(), "444.8".to_owned()),
        ]);
        let signed_query = sign_query(params, keys, unix_timestamp());
        let response = self
            .http
            .get(format!("{DANMAKU_INFO_URL}?{signed_query}"))
            .header(COOKIE, cookie_header)
            .header(REFERER, format!("https://live.bilibili.com/{room_id}"))
            .header(ORIGIN, LIVE_REFERER)
            .send()
            .await?;
        let status = response.status();
        if !status.is_success() {
            return Err(BiliError::HttpStatus(status.as_u16()));
        }
        let envelope: ApiEnvelope<RawDanmakuInfo> = response.json().await?;
        if envelope.code != 0 {
            return Err(BiliError::Upstream {
                code: envelope.code,
                message: envelope.message.chars().take(160).collect(),
            });
        }
        envelope.data.ok_or(BiliError::MissingData)
    }

    async fn live_get<T>(
        &self,
        url: &str,
        query: &[(&str, String)],
        referer: &str,
    ) -> Result<T, BiliError>
    where
        T: for<'de> Deserialize<'de>,
    {
        let cookie_header = self.search_cookie_header().await?;
        let response = self
            .http
            .get(url)
            .header(COOKIE, cookie_header)
            .header(REFERER, referer)
            .header(ORIGIN, LIVE_REFERER)
            .query(query)
            .send()
            .await?;
        let status = response.status();
        if !status.is_success() {
            return Err(BiliError::HttpStatus(status.as_u16()));
        }
        let envelope: ApiEnvelope<T> = response.json().await?;
        if envelope.code != 0 {
            return Err(BiliError::Upstream {
                code: envelope.code,
                message: envelope.message.chars().take(160).collect(),
            });
        }
        envelope.data.ok_or(BiliError::MissingData)
    }
}

struct SelectedLiveCodec<'a> {
    format_name: &'a str,
    codec: &'a RawLiveCodec,
}

fn select_live_codec(streams: &[RawLiveStream]) -> Option<SelectedLiveCodec<'_>> {
    let mut candidates = Vec::new();
    for stream in streams
        .iter()
        .filter(|stream| stream.protocol_name == "http_hls")
    {
        for format in &stream.format {
            let format_rank = match format.format_name.as_str() {
                "fmp4" => 0,
                "ts" => 1,
                _ => continue,
            };
            for codec in format
                .codec
                .iter()
                .filter(|codec| codec.codec_name == "avc")
            {
                candidates.push((
                    format_rank,
                    codec.current_qn,
                    SelectedLiveCodec {
                        format_name: &format.format_name,
                        codec,
                    },
                ));
            }
        }
    }
    candidates
        .into_iter()
        .min_by_key(|(format_rank, quality, _)| (*format_rank, u32::MAX - *quality))
        .map(|(_, _, selected)| selected)
}

fn map_feed_room(raw: RawFeedRoom) -> Option<LiveRoomSummary> {
    if raw.room_id == 0 {
        return None;
    }
    Some(LiveRoomSummary {
        room_id: raw.room_id,
        short_id: raw.short_id,
        uid: raw.uid,
        title: clean_text(&raw.title),
        cover_url: image_url(
            raw.cover
                .as_deref()
                .filter(|value| !value.trim().is_empty())
                .unwrap_or(&raw.keyframe),
            "@672w_378h_1c.webp",
        ),
        keyframe_url: image_url(&raw.keyframe, "@1280w_720h_1c.webp"),
        anchor_name: clean_text(&raw.uname),
        anchor_avatar_url: image_url(&raw.face, "@96w_96h_1c.webp"),
        area_id: first_non_empty([&raw.area_id.0, &raw.area_v2_id.0]),
        parent_area_id: first_non_empty([&raw.parent_area_id.0, &raw.area_v2_parent_id.0]),
        area_name: first_non_empty([&raw.area_name, &raw.area_v2_name]),
        parent_area_name: first_non_empty([&raw.parent_area_name, &raw.area_v2_parent_name]),
        online: raw.online,
        live_status: raw.live_status,
    })
}

fn map_home_room(raw: RawHomeRoom) -> Option<LiveRoomSummary> {
    if raw.room_id == 0 {
        return None;
    }
    Some(LiveRoomSummary {
        room_id: raw.room_id,
        short_id: raw.short_id,
        uid: raw.uid,
        title: clean_text(&raw.title),
        cover_url: image_url(
            raw.cover
                .as_deref()
                .filter(|value| !value.trim().is_empty())
                .unwrap_or(&raw.keyframe),
            "@672w_378h_1c.webp",
        ),
        keyframe_url: image_url(&raw.keyframe, "@1280w_720h_1c.webp"),
        anchor_name: clean_text(&raw.uname),
        anchor_avatar_url: image_url(&raw.face, "@96w_96h_1c.webp"),
        area_id: raw.area_v2_id.0,
        parent_area_id: raw.area_v2_parent_id.0,
        area_name: clean_text(&raw.area_v2_name),
        parent_area_name: clean_text(&raw.area_v2_parent_name),
        online: raw.online,
        live_status: u8::from(raw.status),
    })
}

fn deduplicate_rooms(rooms: impl IntoIterator<Item = LiveRoomSummary>) -> Vec<LiveRoomSummary> {
    let mut seen = HashSet::new();
    rooms
        .into_iter()
        .filter(|room| seen.insert(room.room_id))
        .collect()
}

fn live_feed_fallback_reason(error: &BiliError) -> Option<&'static str> {
    match error {
        BiliError::HttpStatus(412) => Some("risk_control"),
        BiliError::Upstream {
            code: -352 | -412, ..
        } => Some("risk_control"),
        BiliError::MissingData | BiliError::InvalidResponse(_) => Some("upstream_changed"),
        _ => None,
    }
}

fn retryable_wbi(error: &BiliError) -> bool {
    matches!(error, BiliError::Upstream { code, message } if should_refresh_wbi(*code, message))
}

fn normalize_area_id(value: Option<String>) -> String {
    value
        .map(|value| value.trim().to_owned())
        .filter(|value| {
            !value.is_empty() && value.chars().all(|character| character.is_ascii_digit())
        })
        .unwrap_or_else(|| "0".to_owned())
}

fn valid_opaque_token(value: &str) -> bool {
    value.len() == 36
        && value
            .chars()
            .all(|character| character.is_ascii_hexdigit() || character == '-')
}

fn clean_text(value: &str) -> String {
    html_escape::decode_html_entities(value)
        .chars()
        .filter(|character| !character.is_control())
        .take(400)
        .collect::<String>()
        .trim()
        .to_owned()
}

fn first_non_empty<const N: usize>(values: [&String; N]) -> String {
    values
        .into_iter()
        .map(|value| value.trim())
        .find(|value| !value.is_empty())
        .unwrap_or_default()
        .to_owned()
}

async fn fetch_playlist(
    http: &Client,
    url: &str,
    cookie_header: &str,
    referer: &str,
) -> Result<String, BiliError> {
    let response = http
        .get(url)
        .header(COOKIE, cookie_header)
        .header(REFERER, referer)
        .send()
        .await?;
    let status = response.status();
    if !status.is_success() {
        return Err(BiliError::HttpStatus(status.as_u16()));
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_PLAYLIST_BYTES as u64)
    {
        return Err(BiliError::InvalidResponse("live playlist is too large"));
    }
    let bytes = response.bytes().await?;
    if bytes.len() > MAX_PLAYLIST_BYTES {
        return Err(BiliError::InvalidResponse("live playlist is too large"));
    }
    std::str::from_utf8(&bytes)
        .map(str::to_owned)
        .map_err(|_| BiliError::InvalidResponse("live playlist is not UTF-8"))
}

fn live_referer(room_id: u64) -> String {
    format!("https://live.bilibili.com/{room_id}")
}

#[derive(Debug, Clone, Default, Deserialize)]
struct FlexibleId(#[serde(default, deserialize_with = "deserialize_flexible_id")] String);

fn deserialize_flexible_id<'de, D>(deserializer: D) -> Result<String, D::Error>
where
    D: Deserializer<'de>,
{
    let value = Value::deserialize(deserializer)?;
    match value {
        Value::String(value) => Ok(value),
        Value::Number(value) => Ok(value.to_string()),
        _ => Ok(String::new()),
    }
}

#[derive(Debug, Deserialize)]
struct RawAreaListData {
    #[serde(default)]
    data: Vec<RawLiveArea>,
}

#[derive(Debug, Deserialize)]
struct RawLiveArea {
    #[serde(default)]
    id: FlexibleId,
    #[serde(default)]
    name: String,
    #[serde(default)]
    list: Vec<RawLiveSubArea>,
}

#[derive(Debug, Deserialize)]
struct RawLiveSubArea {
    #[serde(default)]
    id: FlexibleId,
    #[serde(default)]
    parent_id: FlexibleId,
    #[serde(default)]
    name: String,
    #[serde(default)]
    pic: String,
}

#[derive(Debug, Deserialize)]
struct RawLiveFeedPage {
    #[serde(default)]
    list: Vec<RawFeedRoom>,
}

#[derive(Debug, Deserialize)]
struct RawLiveHomePage {
    #[serde(default)]
    room_list: Vec<RawLiveHomeModule>,
}

#[derive(Debug, Deserialize)]
struct RawLiveHomeModule {
    #[serde(default)]
    list: Vec<RawHomeRoom>,
}

#[derive(Debug, Deserialize)]
struct RawFeedRoom {
    #[serde(default, rename = "roomid", alias = "room_id")]
    room_id: u64,
    #[serde(default)]
    short_id: u64,
    #[serde(default)]
    uid: u64,
    #[serde(default)]
    title: String,
    #[serde(default)]
    uname: String,
    #[serde(default)]
    face: String,
    #[serde(default, alias = "user_cover", alias = "system_cover")]
    cover: Option<String>,
    #[serde(default)]
    keyframe: String,
    #[serde(default)]
    online: u64,
    #[serde(default)]
    live_status: u8,
    #[serde(default)]
    area_id: FlexibleId,
    #[serde(default)]
    parent_area_id: FlexibleId,
    #[serde(default)]
    area_v2_id: FlexibleId,
    #[serde(default)]
    area_v2_parent_id: FlexibleId,
    #[serde(default)]
    area_name: String,
    #[serde(default)]
    parent_area_name: String,
    #[serde(default)]
    area_v2_name: String,
    #[serde(default)]
    area_v2_parent_name: String,
}

#[derive(Debug, Deserialize)]
struct RawHomeRoom {
    #[serde(default, rename = "roomid", alias = "room_id")]
    room_id: u64,
    #[serde(default)]
    short_id: u64,
    #[serde(default)]
    uid: u64,
    #[serde(default)]
    title: String,
    #[serde(default)]
    uname: String,
    #[serde(default)]
    face: String,
    #[serde(default)]
    cover: Option<String>,
    #[serde(default)]
    keyframe: String,
    #[serde(default)]
    online: u64,
    #[serde(default)]
    status: bool,
    #[serde(default)]
    area_v2_id: FlexibleId,
    #[serde(default)]
    area_v2_parent_id: FlexibleId,
    #[serde(default)]
    area_v2_name: String,
    #[serde(default)]
    area_v2_parent_name: String,
}

#[derive(Debug, Deserialize)]
struct RawRoomInfo {
    #[serde(default)]
    uid: u64,
    #[serde(default)]
    room_id: u64,
    #[serde(default)]
    short_id: u64,
    #[serde(default)]
    attention: u64,
    #[serde(default)]
    online: u64,
    #[serde(default)]
    title: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    tags: String,
    #[serde(default)]
    live_time: String,
    #[serde(default)]
    live_status: u8,
    #[serde(default, rename = "area_id")]
    area_id: FlexibleId,
    #[serde(default, rename = "parent_area_id")]
    parent_area_id: FlexibleId,
    #[serde(default, rename = "area_name")]
    area_name: String,
    #[serde(default, rename = "parent_area_name")]
    parent_area_name: String,
    #[serde(default)]
    user_cover: String,
    #[serde(default)]
    keyframe: String,
}

impl RawRoomInfo {
    fn into_detail(self, master: Option<RawMasterInfo>) -> LiveRoomDetail {
        let master_info = master.as_ref().map(|master| &master.info);
        LiveRoomDetail {
            room: LiveRoomSummary {
                room_id: self.room_id,
                short_id: self.short_id,
                uid: self.uid,
                title: clean_text(&self.title),
                cover_url: image_url(&self.user_cover, "@672w_378h_1c.webp"),
                keyframe_url: image_url(&self.keyframe, "@1280w_720h_1c.webp"),
                anchor_name: clean_text(master_info.map(|info| info.uname.as_str()).unwrap_or("")),
                anchor_avatar_url: image_url(
                    master_info.map(|info| info.face.as_str()).unwrap_or(""),
                    "@96w_96h_1c.webp",
                ),
                area_id: self.area_id.0,
                parent_area_id: self.parent_area_id.0,
                area_name: clean_text(&self.area_name),
                parent_area_name: clean_text(&self.parent_area_name),
                online: self.online,
                live_status: self.live_status,
            },
            description: clean_text(&self.description),
            tags: self
                .tags
                .split(',')
                .map(clean_text)
                .filter(|tag| !tag.is_empty())
                .take(16)
                .collect(),
            follower_count: master
                .as_ref()
                .map(|info| info.follower_num)
                .unwrap_or(self.attention),
            anchor_level: master
                .and_then(|info| info.exp.and_then(|exp| exp.master_level))
                .map(|level| level.level)
                .unwrap_or_default(),
            live_time: clean_text(&self.live_time),
            web_url: format!("https://live.bilibili.com/{}", self.room_id),
        }
    }
}

#[derive(Debug, Deserialize)]
struct RawMasterInfo {
    #[serde(default)]
    info: RawMasterProfile,
    #[serde(default)]
    exp: Option<RawMasterExp>,
    #[serde(default)]
    follower_num: u64,
}

#[derive(Debug, Default, Deserialize)]
struct RawMasterProfile {
    #[serde(default)]
    uname: String,
    #[serde(default)]
    face: String,
}

#[derive(Debug, Deserialize)]
struct RawMasterExp {
    #[serde(default)]
    master_level: Option<RawMasterLevel>,
}

#[derive(Debug, Deserialize)]
struct RawMasterLevel {
    #[serde(default)]
    level: u32,
}

#[derive(Debug, Deserialize)]
struct RawLivePlayInfo {
    #[serde(default)]
    live_status: u8,
    #[serde(default)]
    encrypted: bool,
    #[serde(default)]
    pwd_verified: bool,
    #[serde(default)]
    playurl_info: Option<RawPlayurlInfo>,
}

#[derive(Debug, Deserialize)]
struct RawPlayurlInfo {
    #[serde(default)]
    playurl: Option<RawLivePlayurl>,
}

#[derive(Debug, Deserialize)]
struct RawLivePlayurl {
    #[serde(default)]
    g_qn_desc: Vec<RawQualityDescription>,
    #[serde(default)]
    stream: Vec<RawLiveStream>,
}

#[derive(Debug, Deserialize)]
struct RawQualityDescription {
    #[serde(default)]
    qn: u32,
    #[serde(default)]
    desc: String,
}

#[derive(Debug, Deserialize)]
struct RawLiveStream {
    #[serde(default)]
    protocol_name: String,
    #[serde(default)]
    format: Vec<RawLiveFormat>,
}

#[derive(Debug, Deserialize)]
struct RawLiveFormat {
    #[serde(default)]
    format_name: String,
    #[serde(default)]
    codec: Vec<RawLiveCodec>,
}

#[derive(Debug, Deserialize)]
struct RawLiveCodec {
    #[serde(default)]
    codec_name: String,
    #[serde(default)]
    current_qn: u32,
    #[serde(default)]
    accept_qn: Vec<u32>,
    #[serde(default)]
    base_url: String,
    #[serde(default)]
    url_info: Vec<RawLiveUrlInfo>,
}

#[derive(Debug, Deserialize)]
struct RawLiveUrlInfo {
    #[serde(default)]
    host: String,
    #[serde(default)]
    extra: String,
}

#[derive(Debug, Deserialize)]
struct RawDanmakuInfo {
    #[serde(default)]
    token: String,
    #[serde(default)]
    host_list: Vec<RawDanmakuHost>,
}

#[derive(Debug, Deserialize)]
struct RawDanmakuHost {
    #[serde(default)]
    host: String,
    #[serde(default)]
    wss_port: u16,
}

#[cfg(test)]
mod tests {
    use std::{sync::RwLock, time::Instant};

    use crate::bili::client::BiliClient;

    use super::{
        map_feed_room, map_home_room, select_live_codec, LiveMediaSession, RawFeedRoom,
        RawHomeRoom, RawLiveCodec, RawLiveFormat, RawLivePlayurl, RawLiveUrlInfo,
    };

    #[test]
    fn maps_string_and_numeric_area_ids() {
        let fixture = r#"{
            "roomid": 123,
            "short_id": 0,
            "uid": 42,
            "title": "测试直播",
            "uname": "主播",
            "face": "//i0.hdslb.com/face.jpg",
            "user_cover": "https://i0.hdslb.com/live.jpg",
            "keyframe": "https://i0.hdslb.com/key.jpg",
            "online": 999,
            "area_id": 86,
            "parent_area_id": "2",
            "area_name": "英雄联盟"
        }"#;
        let raw: RawFeedRoom = serde_json::from_str(fixture).expect("feed room");
        let room = map_feed_room(raw).expect("mapped room");

        assert_eq!(room.area_id, "86");
        assert_eq!(room.parent_area_id, "2");
        assert_eq!(room.area_name, "英雄联盟");
        assert_eq!(
            room.anchor_avatar_url,
            "https://i0.hdslb.com/face.jpg@96w_96h_1c.webp"
        );
    }

    #[test]
    fn maps_home_rooms_with_the_real_live_status() {
        let raw: RawHomeRoom = serde_json::from_str(
            r#"{
                "roomid": 456,
                "short_id": 7,
                "uid": 9,
                "title": "推荐直播",
                "uname": "推荐主播",
                "face": "",
                "cover": "",
                "keyframe": "https://i0.hdslb.com/key.jpg",
                "online": 12,
                "status": false,
                "area_v2_id": 86,
                "area_v2_parent_id": 2,
                "area_v2_name": "英雄联盟",
                "area_v2_parent_name": "网游"
            }"#,
        )
        .expect("home room");
        let room = map_home_room(raw).expect("mapped room");
        assert_eq!(room.room_id, 456);
        assert_eq!(room.area_name, "英雄联盟");
        assert_eq!(room.live_status, 0);
        assert!(room.cover_url.starts_with("https://"));
    }

    #[test]
    fn selects_hls_fmp4_avc_before_ts() {
        let playurl: RawLivePlayurl = serde_json::from_str(
            r#"{
                "stream": [{
                    "protocol_name": "http_hls",
                    "format": [{
                        "format_name": "ts",
                        "codec": [{
                            "codec_name": "avc",
                            "current_qn": 150,
                            "accept_qn": [150, 250],
                            "base_url": "/ts.m3u8",
                            "url_info": [{ "host": "https://example.com", "extra": "?token=secret" }]
                        }]
                    }, {
                        "format_name": "fmp4",
                        "codec": [{
                            "codec_name": "avc",
                            "current_qn": 250,
                            "accept_qn": [250],
                            "base_url": "/fmp4.m3u8",
                            "url_info": [{ "host": "https://example.com", "extra": "?token=secret" }]
                        }]
                    }]
                }]
            }"#,
        )
        .expect("playurl");
        let selected = select_live_codec(&playurl.stream).expect("selected codec");

        assert_eq!(selected.format_name, "fmp4");
        assert_eq!(selected.codec.current_qn, 250);
    }

    #[test]
    fn rewrites_playlist_assets_to_opaque_local_urls() {
        let session = LiveMediaSession {
            token: "00000000-0000-4000-8000-000000000001".to_owned(),
            room_id: 1,
            created_at: Instant::now(),
            playlist_url: "https://media.example/live/index.m3u8?sign=secret".to_owned(),
            cookie_header: "buvid3=secret".to_owned(),
            assets: RwLock::new(Default::default()),
            asset_tokens: RwLock::new(Default::default()),
            last_access: RwLock::new(Instant::now()),
        };
        let playlist = session
            .rewrite_playlist(
                "#EXTM3U\n#EXT-X-MAP:URI=\"init.m4s\"\n#EXTINF:1,\nsegment.m4s\n",
                "https://media.example/live/index.m3u8?sign=secret",
            )
            .expect("rewritten playlist");

        assert!(playlist.contains("http://bilistream.localhost/live/"));
        assert!(!playlist.contains("media.example"));
        assert!(!playlist.contains("secret"));
        assert_eq!(session.assets.read().expect("assets").len(), 2);

        let refreshed = session
            .rewrite_playlist(
                "#EXTM3U\n#EXT-X-MAP:URI=\"init.m4s\"\n#EXTINF:1,\nsegment.m4s\n",
                "https://media.example/live/index.m3u8?sign=secret",
            )
            .expect("refreshed playlist");

        assert_eq!(playlist, refreshed);
        assert_eq!(session.assets.read().expect("assets").len(), 2);
    }

    #[test]
    fn rewrites_a_nested_media_playlist_against_its_remote_url() {
        let session = LiveMediaSession {
            token: "00000000-0000-4000-8000-000000000001".to_owned(),
            room_id: 1,
            created_at: Instant::now(),
            playlist_url: "https://media.example/live/index.m3u8?sign=main".to_owned(),
            cookie_header: "buvid3=secret".to_owned(),
            assets: RwLock::new(Default::default()),
            asset_tokens: RwLock::new(Default::default()),
            last_access: RwLock::new(Instant::now()),
        };
        let main = session
            .rewrite_playlist(
                "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=10240000\nchild/index.m3u8?sign=child\n",
                "https://media.example/live/index.m3u8?sign=main",
            )
            .expect("main playlist");
        let assets = session.assets.read().expect("assets");
        let child = assets.values().next().expect("child playlist asset");
        assert!(child.is_playlist);
        assert_eq!(
            child.remote_url,
            "https://media.example/live/child/index.m3u8?sign=child"
        );
        drop(assets);

        let child = session
            .rewrite_playlist(
                "#EXTM3U\n#EXT-X-MAP:URI=\"init.m4s\"\n#EXTINF:1,\nsegment.m4s\n",
                "https://media.example/live/child/index.m3u8?sign=child",
            )
            .expect("child rewritten");

        assert_eq!(session.assets.read().expect("assets").len(), 3);
        assert!(!main.contains("media.example"));
        assert!(!child.contains("media.example"));
        assert!(!child.contains("sign="));
    }

    #[test]
    fn keeps_only_browser_playable_avc_hls_streams() {
        let codec = RawLiveCodec {
            codec_name: "hevc".to_owned(),
            current_qn: 250,
            accept_qn: vec![250],
            base_url: String::new(),
            url_info: vec![RawLiveUrlInfo {
                host: String::new(),
                extra: String::new(),
            }],
        };
        let playurl = RawLivePlayurl {
            g_qn_desc: Vec::new(),
            stream: vec![super::RawLiveStream {
                protocol_name: "http_hls".to_owned(),
                format: vec![RawLiveFormat {
                    format_name: "fmp4".to_owned(),
                    codec: vec![codec],
                }],
            }],
        };

        assert!(select_live_codec(&playurl.stream).is_none());
    }

    #[ignore = "requires network access to Bilibili"]
    #[tokio::test]
    async fn live_catalog_and_stream_smoke() {
        let client = BiliClient::new().expect("client");
        let areas = client.live_areas().await.expect("live areas");
        let page = client
            .live_rooms(None, None, 1, 12)
            .await
            .expect("live rooms");
        let room = page
            .rooms
            .iter()
            .find(|room| room.live_status == 1)
            .expect("live recommendation");
        let detail = client
            .live_room_detail(room.room_id)
            .await
            .expect("live room detail");
        let playback = client
            .create_live_playback_session(room.room_id, 10_000)
            .await
            .expect("live playback session");

        assert!(!areas.is_empty());
        assert!(!page.rooms.is_empty());
        assert_eq!(detail.room.room_id, room.room_id);
        assert_eq!(playback.live_status, 1);
        assert!(playback
            .playback_url
            .as_deref()
            .is_some_and(|url| url.starts_with("http://bilistream.localhost/live/")));

        let master = client
            .live_media
            .playlist(&client.http, &playback.session_id)
            .await
            .expect("proxied master playlist");
        if master.contains("#EXT-X-STREAM-INF") {
            let child_url = master
                .lines()
                .map(str::trim)
                .find(|line| !line.is_empty() && !line.starts_with('#'))
                .expect("child playlist URL");
            let child_token = child_url.rsplit('/').next().expect("child playlist token");
            let child_asset = client
                .live_media
                .asset(&playback.session_id, child_token)
                .expect("child playlist asset");
            assert!(child_asset.is_playlist());

            let child = client
                .live_media
                .asset_playlist(&client.http, &playback.session_id, child_token)
                .await
                .expect("child playlist request")
                .expect("nested HLS playlist");
            assert!(child.starts_with("#EXTM3U"));
            assert!(child.contains("/asset/"));
            assert!(!child.contains(".m3u8?"));
        } else {
            let segment_url = master
                .lines()
                .map(str::trim)
                .find(|line| !line.is_empty() && !line.starts_with('#'))
                .expect("media segment URL");
            let segment_token = segment_url.rsplit('/').next().expect("media segment token");
            let segment = client
                .live_media
                .asset(&playback.session_id, segment_token)
                .expect("media segment asset");
            assert!(!segment.is_playlist());
        }
    }
}
