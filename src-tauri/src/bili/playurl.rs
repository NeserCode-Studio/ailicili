use std::{
    collections::{BTreeMap, HashMap},
    sync::{Arc, RwLock},
    time::{Duration, Instant},
};

use reqwest::{
    header::{COOKIE, REFERER},
    Url,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::{
    client::{validate_bvid, ApiEnvelope, BiliClient},
    error::BiliError,
    wbi::{should_refresh_wbi, sign_query, unix_timestamp, WbiKeys},
};

const PLAYURL_URL: &str = "https://api.bilibili.com/x/player/wbi/playurl";
const SESSION_TTL: Duration = Duration::from_secs(20 * 60);
const MAX_SESSIONS: usize = 24;
pub const MEDIA_ORIGIN: &str = "http://bilistream.localhost";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackSession {
    pub session_id: String,
    pub mpd_url: String,
    pub expires_in_seconds: u64,
    pub duration_ms: u64,
    pub selected_quality: u32,
    pub qualities: Vec<PlaybackQuality>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackQuality {
    pub id: u32,
    pub label: String,
    pub width: u32,
    pub height: u32,
    pub bandwidth: u64,
}

#[derive(Debug, Clone)]
struct MediaTrack {
    remote_url: String,
    codecs: String,
    bandwidth: u64,
    width: u32,
    height: u32,
    initialization_range: String,
    index_range: String,
}

#[derive(Debug, Clone)]
struct MediaSession {
    token: String,
    created_at: Instant,
    duration_ms: u64,
    video: BTreeMap<u32, MediaTrack>,
    audio: BTreeMap<u32, MediaTrack>,
}

#[derive(Debug, Clone, Copy)]
pub enum MediaKind {
    Video,
    Audio,
}

impl MediaKind {
    fn parse(value: &str) -> Option<Self> {
        match value {
            "video" => Some(Self::Video),
            "audio" => Some(Self::Audio),
            _ => None,
        }
    }
}

#[derive(Default)]
pub struct MediaSessions {
    values: RwLock<HashMap<String, Arc<MediaSession>>>,
}

impl MediaSessions {
    pub fn new() -> Self {
        Self::default()
    }

    fn insert(&self, session: MediaSession) -> Result<(), BiliError> {
        let token = session.token.clone();
        let mut values = self.values.write().map_err(|_| BiliError::Internal)?;
        values.retain(|_, value| value.created_at.elapsed() < SESSION_TTL);
        if values.len() >= MAX_SESSIONS {
            if let Some(oldest) = values
                .iter()
                .min_by_key(|(_, value)| value.created_at)
                .map(|(token, _)| token.clone())
            {
                values.remove(&oldest);
            }
        }
        values.insert(token, Arc::new(session));
        Ok(())
    }

    fn get(&self, token: &str) -> Option<Arc<MediaSession>> {
        if !valid_token(token) {
            return None;
        }
        let values = self.values.read().ok()?;
        values
            .get(token)
            .filter(|session| session.created_at.elapsed() < SESSION_TTL)
            .cloned()
    }

    pub fn mpd(&self, token: &str) -> Option<String> {
        self.get(token).map(|session| session.to_mpd())
    }

    pub fn media_url(&self, token: &str, kind: &str, track_id: &str) -> Option<String> {
        let kind = MediaKind::parse(kind)?;
        let track_id = track_id.parse::<u32>().ok()?;
        let session = self.get(token)?;
        let tracks = match kind {
            MediaKind::Video => &session.video,
            MediaKind::Audio => &session.audio,
        };
        tracks.get(&track_id).map(|track| track.remote_url.clone())
    }
}

impl MediaSession {
    fn to_mpd(&self) -> String {
        let duration = format_duration(self.duration_ms);
        let video = self.video.values().map(|_| ()).count();
        let mut output = String::with_capacity(4096 + video * 600);
        output.push_str(r#"<?xml version="1.0" encoding="UTF-8"?>"#);
        output.push_str(&format!(
            r#"<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" profiles="urn:mpeg:dash:profile:isoff-on-demand:2011" mediaPresentationDuration="{duration}" minBufferTime="PT1.5S"><Period>"#
        ));
        output.push_str(
            r#"<AdaptationSet id="video" contentType="video" mimeType="video/mp4" segmentAlignment="true" startWithSAP="1" subsegmentAlignment="true" subsegmentStartsWithSAP="1">"#,
        );
        for (quality, track) in &self.video {
            output.push_str(&format!(
                r#"<Representation id="video-{quality}" bandwidth="{}" width="{}" height="{}" codecs="{}"><BaseURL>{MEDIA_ORIGIN}/media/{}/video/{quality}</BaseURL><SegmentBase indexRange="{}"><Initialization range="{}"/></SegmentBase></Representation>"#,
                track.bandwidth.max(1),
                track.width,
                track.height,
                xml_escape(&track.codecs),
                self.token,
                xml_escape(&track.index_range),
                xml_escape(&track.initialization_range),
            ));
        }
        output.push_str("</AdaptationSet>");
        output.push_str(
            r#"<AdaptationSet id="audio" contentType="audio" mimeType="audio/mp4" segmentAlignment="true" startWithSAP="1" subsegmentAlignment="true" subsegmentStartsWithSAP="1">"#,
        );
        for (id, track) in &self.audio {
            output.push_str(&format!(
                r#"<Representation id="audio-{id}" bandwidth="{}" codecs="{}"><BaseURL>{MEDIA_ORIGIN}/media/{}/audio/{id}</BaseURL><SegmentBase indexRange="{}"><Initialization range="{}"/></SegmentBase></Representation>"#,
                track.bandwidth.max(1),
                xml_escape(&track.codecs),
                self.token,
                xml_escape(&track.index_range),
                xml_escape(&track.initialization_range),
            ));
        }
        output.push_str("</AdaptationSet></Period></MPD>");
        output
    }
}

impl BiliClient {
    pub async fn create_playback_session(
        &self,
        bvid: &str,
        cid: u64,
        qn: u32,
    ) -> Result<PlaybackSession, BiliError> {
        validate_bvid(bvid)?;
        if cid == 0 {
            return Err(BiliError::InvalidInput("cid must be positive"));
        }
        let qn = if qn == 0 { 80 } else { qn.clamp(16, 127) };
        let cookie_header = self.search_cookie_header().await?;
        let keys = self
            .wbi
            .keys(&self.http, Some(&cookie_header), false)
            .await?;

        let (data, used_keys) = match self
            .playurl_once(bvid, cid, qn, &cookie_header, &keys)
            .await
        {
            Ok(data) => (data, keys),
            Err(error) if error.retryable_wbi() => {
                let keys = self
                    .wbi
                    .keys(&self.http, Some(&cookie_header), true)
                    .await?;
                let data = self
                    .playurl_once(bvid, cid, qn, &cookie_header, &keys)
                    .await?;
                (data, keys)
            }
            Err(error) => return Err(error),
        };
        let _ = used_keys;

        let dash = data
            .dash
            .ok_or(BiliError::PlaybackUnavailable("DASH stream is missing"))?;
        let mut video = BTreeMap::new();
        for track in dash
            .video
            .into_iter()
            .filter(|track| browser_playable_video_codec(&track.codecs))
        {
            let Some((id, mapped)) = map_track(track) else {
                continue;
            };
            video
                .entry(id)
                .and_modify(|existing: &mut MediaTrack| {
                    if mapped.bandwidth > existing.bandwidth {
                        *existing = mapped.clone();
                    }
                })
                .or_insert(mapped);
        }
        video.retain(|_, track| {
            !track.initialization_range.is_empty() && !track.index_range.is_empty()
        });
        if video.is_empty() {
            return Err(BiliError::PlaybackUnavailable(
                "no browser-playable video representation",
            ));
        }

        let mut audio = BTreeMap::new();
        if let Some(track) = dash
            .audio
            .into_iter()
            .filter(|track| browser_playable_audio_codec(&track.codecs))
            .filter_map(map_track)
            .filter(|(_, track)| {
                !track.initialization_range.is_empty() && !track.index_range.is_empty()
            })
            .max_by_key(|(_, track)| track.bandwidth)
        {
            audio.insert(track.0, track.1);
        }
        if audio.is_empty() {
            return Err(BiliError::PlaybackUnavailable(
                "no browser-playable audio representation",
            ));
        }

        let mut qualities = video
            .iter()
            .map(|(id, track)| {
                let label = data
                    .accept_quality
                    .iter()
                    .position(|quality| quality == id)
                    .and_then(|index| data.accept_description.get(index))
                    .filter(|label| !label.trim().is_empty())
                    .cloned()
                    .unwrap_or_else(|| format!("{id}P"));
                PlaybackQuality {
                    id: *id,
                    label,
                    width: track.width,
                    height: track.height,
                    bandwidth: track.bandwidth,
                }
            })
            .collect::<Vec<_>>();
        qualities.sort_by(|left, right| {
            right
                .height
                .cmp(&left.height)
                .then_with(|| right.bandwidth.cmp(&left.bandwidth))
        });

        let selected_quality = qualities
            .iter()
            .find(|quality| quality.id == data.quality)
            .or_else(|| qualities.first())
            .map(|quality| quality.id)
            .unwrap_or(qn);
        let duration_ms = dash_duration_ms(dash.duration_seconds);
        let token = Uuid::new_v4().to_string();
        let session = MediaSession {
            token: token.clone(),
            created_at: Instant::now(),
            duration_ms,
            video,
            audio,
        };
        self.media.insert(session)?;

        Ok(PlaybackSession {
            session_id: token.clone(),
            mpd_url: format!("{MEDIA_ORIGIN}/mpd/{token}"),
            expires_in_seconds: SESSION_TTL.as_secs(),
            duration_ms,
            selected_quality,
            qualities,
        })
    }

    async fn playurl_once(
        &self,
        bvid: &str,
        cid: u64,
        qn: u32,
        cookie_header: &str,
        keys: &WbiKeys,
    ) -> Result<RawPlayData, BiliError> {
        let params = BTreeMap::from([
            ("bvid".to_owned(), bvid.to_owned()),
            ("cid".to_owned(), cid.to_string()),
            ("qn".to_owned(), qn.to_string()),
            ("fnval".to_owned(), "4048".to_owned()),
            ("fnver".to_owned(), "0".to_owned()),
            ("fourk".to_owned(), "1".to_owned()),
            ("platform".to_owned(), "pc".to_owned()),
        ]);
        let signed_query = sign_query(params, keys, unix_timestamp());
        let response = self
            .http
            .get(format!("{PLAYURL_URL}?{signed_query}"))
            .header(COOKIE, cookie_header)
            .header(REFERER, format!("https://www.bilibili.com/video/{bvid}/"))
            .send()
            .await?;
        let status = response.status();
        if !status.is_success() {
            return Err(BiliError::HttpStatus(status.as_u16()));
        }
        let envelope: ApiEnvelope<RawPlayData> = response.json().await?;
        if envelope.code != 0 {
            return Err(BiliError::Upstream {
                code: envelope.code,
                message: envelope.message.chars().take(160).collect(),
            });
        }
        if envelope
            .data
            .as_ref()
            .and_then(|data| data.v_voucher.as_deref())
            .is_some_and(|voucher| !voucher.is_empty())
        {
            return Err(BiliError::Upstream {
                code: -403,
                message: "WBI challenge".to_owned(),
            });
        }
        envelope.data.ok_or(BiliError::MissingData)
    }
}

impl BiliError {
    fn retryable_wbi(&self) -> bool {
        matches!(self, Self::Upstream { code, message } if should_refresh_wbi(*code, message))
    }
}

#[derive(Debug, Deserialize)]
struct RawPlayData {
    #[serde(default)]
    quality: u32,
    #[serde(default)]
    accept_quality: Vec<u32>,
    #[serde(default)]
    accept_description: Vec<String>,
    #[serde(default)]
    v_voucher: Option<String>,
    dash: Option<RawDash>,
}

#[derive(Debug, Deserialize)]
struct RawDash {
    #[serde(default, rename = "duration")]
    duration_seconds: u64,
    #[serde(default)]
    video: Vec<RawDashTrack>,
    #[serde(default)]
    audio: Vec<RawDashTrack>,
}

#[derive(Debug, Deserialize)]
struct RawDashTrack {
    #[serde(default, rename = "baseUrl")]
    base_url_camel: String,
    #[serde(default, rename = "base_url")]
    base_url_snake: String,
    #[serde(default)]
    codecs: String,
    #[serde(default)]
    bandwidth: u64,
    #[serde(default)]
    width: u32,
    #[serde(default)]
    height: u32,
    #[serde(default)]
    id: u32,
    #[serde(default, rename = "segmentBase")]
    segment_base_camel: Option<RawSegmentBase>,
    #[serde(default, rename = "segment_base")]
    segment_base_snake: Option<RawSegmentBase>,
}

#[derive(Debug, Deserialize)]
struct RawSegmentBase {
    #[serde(default)]
    initialization: String,
    #[serde(default, rename = "indexRange")]
    index_range_camel: String,
    #[serde(default, rename = "index_range")]
    index_range_snake: String,
    #[serde(default, rename = "indexrange")]
    index_range_lower: String,
}

fn map_track(raw: RawDashTrack) -> Option<(u32, MediaTrack)> {
    if raw.id == 0 {
        return None;
    }
    let base_url = if raw.base_url_camel.is_empty() {
        raw.base_url_snake
    } else {
        raw.base_url_camel
    };
    let remote = normalize_media_url(&base_url)?;
    let segment = raw.segment_base_camel.or(raw.segment_base_snake)?;
    let index_range = if segment.index_range_camel.is_empty() {
        if segment.index_range_snake.is_empty() {
            segment.index_range_lower
        } else {
            segment.index_range_snake
        }
    } else {
        segment.index_range_camel
    };
    Some((
        raw.id,
        MediaTrack {
            remote_url: remote,
            codecs: raw.codecs,
            bandwidth: raw.bandwidth,
            width: raw.width,
            height: raw.height,
            initialization_range: segment.initialization,
            index_range,
        },
    ))
}

fn normalize_media_url(value: &str) -> Option<String> {
    let value = value.trim();
    let value = if let Some(rest) = value.strip_prefix("//") {
        format!("https://{rest}")
    } else if let Some(rest) = value.strip_prefix("http://") {
        format!("https://{rest}")
    } else {
        value.to_owned()
    };
    let url = Url::parse(&value).ok()?;
    if url.scheme() != "https" || !allowed_cdn_host(url.host_str()?) {
        return None;
    }
    Some(url.to_string())
}

fn allowed_cdn_host(host: &str) -> bool {
    let host = host.to_ascii_lowercase();
    ["bilivideo.com", "bilivideo.cn"]
        .iter()
        .any(|suffix| host == *suffix || host.ends_with(&format!(".{suffix}")))
        || host == "upos-hz-mirrorakam.akamaized.net"
}

fn browser_playable_video_codec(codecs: &str) -> bool {
    codecs
        .split(',')
        .next()
        .is_some_and(|codec| codec.trim().starts_with("avc1"))
}

fn browser_playable_audio_codec(codecs: &str) -> bool {
    codecs
        .split(',')
        .next()
        .is_some_and(|codec| codec.trim().starts_with("mp4a"))
}

fn valid_token(token: &str) -> bool {
    token.len() == 36
        && token
            .chars()
            .all(|character| character.is_ascii_hexdigit() || character == '-')
}

fn format_duration(duration_ms: u64) -> String {
    let seconds = duration_ms as f64 / 1000.0;
    format!("PT{seconds:.3}S")
}

fn dash_duration_ms(duration_seconds: u64) -> u64 {
    duration_seconds.saturating_mul(1000).max(1)
}

fn xml_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use super::{
        allowed_cdn_host, browser_playable_audio_codec, browser_playable_video_codec,
        dash_duration_ms, format_duration, normalize_media_url, MediaSession, MediaTrack,
    };
    use crate::bili::client::BiliClient;

    #[test]
    fn accepts_only_known_bilibili_media_hosts() {
        assert!(allowed_cdn_host("upos-sz-mirrorcos.bilivideo.com"));
        assert!(allowed_cdn_host("bilivideo.cn"));
        assert!(allowed_cdn_host("upos-hz-mirrorakam.akamaized.net"));
        assert!(!allowed_cdn_host("bilivideo.com.example.org"));
        assert!(!allowed_cdn_host("127.0.0.1"));
        assert!(normalize_media_url("//upos.example.bilivideo.com/a.m4s").is_some());
        assert!(normalize_media_url("javascript:alert(1)").is_none());
    }

    #[test]
    fn generated_mpd_contains_only_opaque_media_paths() {
        let token = "123e4567-e89b-12d3-a456-426614174000";
        let track = MediaTrack {
            remote_url: "https://secret.example.bilivideo.com/video.m4s?token=secret".to_owned(),
            codecs: "avc1.640028".to_owned(),
            bandwidth: 1_000_000,
            width: 1920,
            height: 1080,
            initialization_range: "0-999".to_owned(),
            index_range: "1000-1999".to_owned(),
        };
        let session = MediaSession {
            token: token.to_owned(),
            created_at: std::time::Instant::now(),
            duration_ms: 61_500,
            video: BTreeMap::from([(80, track.clone())]),
            audio: BTreeMap::from([(30280, track)]),
        };
        let mpd = session.to_mpd();
        assert!(mpd.contains("mediaPresentationDuration=\"PT61.500S\""));
        assert!(mpd.contains(&format!("/media/{token}/video/80")));
        assert!(!mpd.contains("secret.example"));
        assert!(!mpd.contains("token=secret"));
    }

    #[test]
    fn duration_format_is_stable() {
        assert_eq!(format_duration(1), "PT0.001S");
        assert_eq!(format_duration(3_723_456), "PT3723.456S");
        assert_eq!(dash_duration_ms(1), 1_000);
        assert_eq!(dash_duration_ms(3_031), 3_031_000);
    }

    #[test]
    fn accepts_only_webview_compatible_codecs() {
        assert!(browser_playable_video_codec("avc1.64001F"));
        assert!(!browser_playable_video_codec("hvc1.1.6.L120.90"));
        assert!(!browser_playable_video_codec(
            "av01.0.08M.08.0.110.01.01.01.0"
        ));
        assert!(browser_playable_audio_codec("mp4a.40.2"));
        assert!(!browser_playable_audio_codec("ec-3"));
        assert!(!browser_playable_audio_codec("fLaC"));
    }

    #[tokio::test]
    #[ignore = "requires network access to Bilibili"]
    async fn live_playback_session_and_range_smoke() {
        let client = BiliClient::new().expect("client");
        let bvid = "BV19wnQ6sExk";
        let cid = 43_053_026_889;
        let session = client
            .create_playback_session(bvid, cid, 80)
            .await
            .expect("playback session");
        assert!(
            session.duration_ms > 60_000,
            "DASH duration must be converted from seconds to milliseconds"
        );
        let media_session = client
            .media
            .get(&session.session_id)
            .expect("internal media session");
        assert!(media_session
            .video
            .values()
            .all(|track| browser_playable_video_codec(&track.codecs)));
        assert!(media_session
            .audio
            .values()
            .all(|track| browser_playable_audio_codec(&track.codecs)));
        let quality = session.qualities.first().expect("quality");
        let media_url = client
            .media
            .media_url(&session.session_id, "video", &quality.id.to_string())
            .expect("video track");
        let response = client
            .http
            .get(media_url)
            .header(reqwest::header::RANGE, "bytes=0-1023")
            .send()
            .await
            .expect("video range response");

        assert!(response.status().is_success());
        assert!(!response.bytes().await.expect("video bytes").is_empty());
    }
}
