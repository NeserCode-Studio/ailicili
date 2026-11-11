use std::collections::HashSet;

use serde_json::Value;

use super::HuyaError;
use crate::domain::{
    LiveDiscovery, LivePlaybackInfo, LiveRoomCard, LiveRoomInfo, LiveSection, LiveStatus,
    PlatformId, QualityOption, StreamProtocol, StreamSource,
};

const DISCOVERY_SECTION_TITLE: &str = "热门直播";
const QUALITY_ID_OFFSET: i64 = 100_000;

pub(super) fn parse_discovery(html: &str) -> Result<LiveDiscovery, HuyaError> {
    let slides = extract_json_assignment(html, "slides")?;
    let items = slides
        .as_array()
        .ok_or_else(|| HuyaError::Invalid("Huya slides is not an array".to_string()))?;
    let mut rooms = Vec::new();
    let mut seen = HashSet::new();

    for item in items {
        let Some(room_id) = item.get("profileRoom").and_then(public_room_id) else {
            continue;
        };
        if !seen.insert(room_id.clone()) {
            continue;
        }
        let title = text_field(item, "introduction")
            .or_else(|| text_field(item, "title"))
            .unwrap_or_else(|| format!("虎牙直播 {room_id}"));
        let anchor_name = text_field(item, "nick").unwrap_or_else(|| "虎牙主播".to_string());
        let area_name = text_field(item, "gameFullName");
        let online = item
            .get("totalCount")
            .and_then(value_i64)
            .unwrap_or_default();

        rooms.push(LiveRoomCard {
            platform: huya_id(),
            room_id,
            title,
            anchor_name,
            cover_url: item
                .get("screenshot")
                .and_then(Value::as_str)
                .and_then(normalize_https_url),
            avatar_url: item
                .get("avatar180")
                .and_then(Value::as_str)
                .and_then(normalize_https_url),
            area_name,
            parent_area_name: None,
            online,
            live_status: LiveStatus::Live,
        });
    }

    if rooms.is_empty() {
        return Err(HuyaError::Invalid(
            "Huya discovery page contained no live cards".to_string(),
        ));
    }

    Ok(LiveDiscovery {
        sections: vec![LiveSection {
            id: "huya-live-recommended".to_string(),
            title: DISCOVERY_SECTION_TITLE.to_string(),
            rooms,
        }],
    })
}

pub(super) fn parse_room_info(
    html: &str,
    requested_room_id: &str,
) -> Result<LiveRoomInfo, HuyaError> {
    let document = parse_room_document(html, requested_room_id)?;
    Ok(document.room_info())
}

pub(super) fn parse_playback(
    html: &str,
    requested_room_id: &str,
    _requested_quality: i64,
) -> Result<LivePlaybackInfo, HuyaError> {
    let document = parse_room_document(html, requested_room_id)?;
    let live_status = parse_live_status(&document.room_data);
    let room_id = document.room_id.clone();
    if live_status != LiveStatus::Live {
        return Ok(LivePlaybackInfo {
            platform: huya_id(),
            room_id,
            live_status,
            streams: Vec::new(),
            current_quality: None,
            advertised_qualities: Vec::new(),
        });
    }

    let stream_data = document.stream_data()?;
    let live_info = stream_data.get("gameLiveInfo").unwrap_or(&Value::Null);
    let bit_rate = live_info
        .get("bitRate")
        .and_then(value_i64)
        .unwrap_or_default()
        .max(0);
    let quality = QualityOption {
        id: QUALITY_ID_OFFSET.saturating_add(bit_rate),
        label: quality_label(bit_rate, &document.room_data),
    };
    let stream_entries = stream_data
        .get("gameStreamInfoList")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            HuyaError::Invalid("Huya live room is missing its stream list".to_string())
        })?;
    let flv_urls = prioritized_urls(stream_entries, StreamProtocol::Flv);
    let hls_urls = prioritized_urls(stream_entries, StreamProtocol::Hls);
    let mut streams = Vec::new();
    append_stream(
        &mut streams,
        &room_id,
        &quality,
        StreamProtocol::Flv,
        flv_urls,
    );
    append_stream(
        &mut streams,
        &room_id,
        &quality,
        StreamProtocol::Hls,
        hls_urls,
    );
    let current_quality = (!streams.is_empty()).then(|| quality.clone());
    let advertised_qualities = current_quality.clone().into_iter().collect();

    Ok(LivePlaybackInfo {
        platform: huya_id(),
        room_id,
        live_status,
        streams,
        current_quality,
        advertised_qualities,
    })
}

struct RoomDocument {
    room_data: Value,
    profile_info: Value,
    player_config: Value,
    room_id: String,
    live_info: Value,
}

impl RoomDocument {
    fn room_info(&self) -> LiveRoomInfo {
        let title = text_field(&self.room_data, "introduction")
            .or_else(|| text_field(&self.live_info, "introduction"))
            .unwrap_or_else(|| format!("虎牙直播 {}", self.room_id));
        let anchor_name = text_field(&self.profile_info, "nick")
            .or_else(|| text_field(&self.live_info, "nick"))
            .unwrap_or_else(|| "虎牙主播".to_string());
        let cover_url = self
            .room_data
            .get("screenshot")
            .and_then(Value::as_str)
            .and_then(normalize_https_url)
            .or_else(|| {
                self.live_info
                    .get("screenshot")
                    .and_then(Value::as_str)
                    .and_then(normalize_https_url)
            });
        let avatar_url = self
            .profile_info
            .get("avatar")
            .and_then(Value::as_str)
            .and_then(normalize_https_url)
            .or_else(|| {
                self.live_info
                    .get("avatar180")
                    .and_then(Value::as_str)
                    .and_then(normalize_https_url)
            });
        let area_name = text_field(&self.room_data, "gameFullName")
            .or_else(|| text_field(&self.live_info, "gameFullName"));
        let anchor_id = self
            .room_data
            .get("id")
            .and_then(value_i64)
            .filter(|value| *value > 0)
            .or_else(|| {
                self.live_info
                    .get("uid")
                    .and_then(value_i64)
                    .filter(|value| *value > 0)
            });
        let started_at = self
            .room_data
            .get("startTime")
            .and_then(value_i64)
            .filter(|value| *value > 0);

        LiveRoomInfo {
            platform: huya_id(),
            room_id: self.room_id.clone(),
            title,
            anchor_name,
            anchor_id,
            cover_url,
            avatar_url,
            area_name,
            parent_area_name: None,
            tags: Vec::new(),
            live_status: parse_live_status(&self.room_data),
            started_at,
        }
    }

    fn stream_data(&self) -> Result<&Value, HuyaError> {
        let entries = self
            .player_config
            .pointer("/data")
            .and_then(Value::as_array)
            .ok_or(HuyaError::RoomNotFound)?;
        entries
            .iter()
            .find(|entry| {
                entry
                    .pointer("/gameLiveInfo/profileRoom")
                    .and_then(public_room_id)
                    .is_some_and(|room_id| room_id == self.room_id)
            })
            .or_else(|| entries.first())
            .ok_or(HuyaError::RoomNotFound)
    }
}

fn parse_room_document(html: &str, requested_room_id: &str) -> Result<RoomDocument, HuyaError> {
    let room_data = extract_json_assignment(html, "TT_ROOM_DATA")?;
    let profile_info = extract_json_assignment(html, "TT_PROFILE_INFO")?;
    let player_config = extract_json_property(html, "hyPlayerConfig", "stream")?;
    let live_info = player_config
        .pointer("/data/0/gameLiveInfo")
        .cloned()
        .unwrap_or(Value::Null);
    let room_id = room_data
        .get("profileRoom")
        .and_then(public_room_id)
        .unwrap_or_else(|| requested_room_id.to_string());

    Ok(RoomDocument {
        room_data,
        profile_info,
        player_config,
        room_id,
        live_info,
    })
}

fn extract_json_assignment(html: &str, variable: &str) -> Result<Value, HuyaError> {
    let marker = format!("var {variable}");
    let marker_start = html.find(&marker).ok_or_else(|| {
        HuyaError::Invalid(format!("Huya page is missing embedded variable {variable}"))
    })?;
    let after_marker = &html[marker_start + marker.len()..];
    let equals = after_marker
        .find('=')
        .ok_or_else(|| HuyaError::Invalid(format!("Huya variable {variable} has no value")))?;
    let value_start = after_marker[equals + 1..].trim_start();
    if !value_start.starts_with('{') && !value_start.starts_with('[') {
        return Err(HuyaError::Invalid(format!(
            "Huya variable {variable} is not a JSON object or array"
        )));
    }
    let end = json_container_end(value_start)
        .ok_or_else(|| HuyaError::Invalid(format!("Huya variable {variable} is truncated")))?;
    serde_json::from_str(&value_start[..end])
        .map_err(|_| HuyaError::Invalid(format!("Huya variable {variable} is not valid JSON")))
}

fn extract_json_property(html: &str, variable: &str, property: &str) -> Result<Value, HuyaError> {
    let marker = format!("var {variable}");
    let marker_start = html.find(&marker).ok_or_else(|| {
        HuyaError::Invalid(format!("Huya page is missing embedded variable {variable}"))
    })?;
    let rest = &html[marker_start + marker.len()..];
    let property_marker = format!("{property}:");
    let property_start = rest.find(&property_marker).ok_or_else(|| {
        HuyaError::Invalid(format!(
            "Huya variable {variable} is missing property {property}"
        ))
    })?;
    let value_start = rest[property_start + property_marker.len()..].trim_start();
    if !value_start.starts_with('{') && !value_start.starts_with('[') {
        return Err(HuyaError::Invalid(format!(
            "Huya property {variable}.{property} is not a JSON object or array"
        )));
    }
    let end = json_container_end(value_start).ok_or_else(|| {
        HuyaError::Invalid(format!("Huya property {variable}.{property} is truncated"))
    })?;
    serde_json::from_str(&value_start[..end]).map_err(|_| {
        HuyaError::Invalid(format!(
            "Huya property {variable}.{property} is not valid JSON"
        ))
    })
}

fn json_container_end(value: &str) -> Option<usize> {
    let mut depth = 0usize;
    let mut in_string = false;
    let mut escaped = false;
    for (index, character) in value.char_indices() {
        if in_string {
            if escaped {
                escaped = false;
            } else if character == '\\' {
                escaped = true;
            } else if character == '"' {
                in_string = false;
            }
            continue;
        }
        match character {
            '"' => in_string = true,
            '[' | '{' => depth += 1,
            ']' | '}' => {
                depth = depth.checked_sub(1)?;
                if depth == 0 {
                    return Some(index + character.len_utf8());
                }
            }
            _ => {}
        }
    }
    None
}

fn parse_live_status(room_data: &Value) -> LiveStatus {
    if room_data
        .get("isReplay")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        return LiveStatus::Round;
    }
    if room_data
        .get("isOff")
        .and_then(Value::as_bool)
        .unwrap_or(false)
        || room_data
            .get("state")
            .and_then(Value::as_str)
            .is_some_and(|state| state.eq_ignore_ascii_case("OFF"))
    {
        return LiveStatus::Offline;
    }
    if room_data
        .get("state")
        .and_then(Value::as_str)
        .is_some_and(|state| state.eq_ignore_ascii_case("ON"))
        && room_data
            .get("isOn")
            .and_then(Value::as_bool)
            .unwrap_or(false)
    {
        return LiveStatus::Live;
    }
    LiveStatus::Unknown
}

fn prioritized_urls(entries: &[Value], protocol: StreamProtocol) -> Vec<String> {
    let mut candidates = entries
        .iter()
        .flat_map(|entry| {
            let priority = entry
                .get("iWebPriorityRate")
                .and_then(value_i64)
                .unwrap_or_default();
            compose_stream_url(entry, protocol)
                .map(|url| {
                    stream_url_variants(&url)
                        .into_iter()
                        .map(move |url| (priority, url))
                })
                .into_iter()
                .flatten()
        })
        .collect::<Vec<_>>();
    candidates.sort_by(|left, right| right.0.cmp(&left.0));

    let mut seen = HashSet::new();
    candidates
        .into_iter()
        .map(|(_, url)| url)
        .filter(|url| seen.insert(url.clone()))
        .collect()
}

fn compose_stream_url(entry: &Value, protocol: StreamProtocol) -> Option<String> {
    let (base_key, suffix_key, anti_key) = match protocol {
        StreamProtocol::Hls => ("sHlsUrl", "sHlsUrlSuffix", "sHlsAntiCode"),
        StreamProtocol::Flv => ("sFlvUrl", "sFlvUrlSuffix", "sFlvAntiCode"),
        _ => return None,
    };
    let base = entry.get(base_key)?.as_str()?.trim().trim_end_matches('/');
    let stream_name = entry.get("sStreamName")?.as_str()?.trim();
    let suffix = entry
        .get(suffix_key)?
        .as_str()?
        .trim()
        .trim_start_matches('.');
    let anti_code = entry.get(anti_key)?.as_str()?.trim();
    if base.is_empty() || stream_name.is_empty() || suffix.is_empty() {
        return None;
    }

    let mut value = format!("{base}/{stream_name}.{suffix}");
    if !anti_code.is_empty() {
        value.push(if anti_code.starts_with('?') { '&' } else { '?' });
        value.push_str(anti_code.trim_start_matches('?'));
    }
    normalize_stream_url(&value)
}

fn append_stream(
    streams: &mut Vec<StreamSource>,
    room_id: &str,
    quality: &QualityOption,
    protocol: StreamProtocol,
    mut urls: Vec<String>,
) {
    let protocol_slug = match protocol {
        StreamProtocol::Hls => "hls",
        StreamProtocol::Flv => "flv",
        _ => return,
    };
    if urls.is_empty() {
        return;
    }
    let url = urls.remove(0);
    streams.push(StreamSource {
        id: format!("huya-{room_id}-{protocol_slug}-{}", quality.id),
        protocol,
        url,
        backup_urls: urls,
        quality_id: quality.id,
        quality_label: quality.label.clone(),
        audio_url: None,
        audio_backup_urls: Vec::new(),
        codec: None,
        audio_codec: None,
    });
}

fn quality_label(bit_rate: i64, room_data: &Value) -> String {
    if bit_rate <= 0 {
        return "当前画质".to_string();
    }
    if bit_rate % 1_000 == 0 {
        let prefix = room_data
            .get("isBluRay")
            .and_then(value_i64)
            .is_some_and(|value| value > 0)
            .then_some("蓝光")
            .unwrap_or_default();
        return format!("{prefix}{}M", bit_rate / 1_000);
    }
    format!("{bit_rate}Kbps")
}

fn public_room_id(value: &Value) -> Option<String> {
    let room_id = value_id(value)?;
    (!room_id.is_empty()
        && room_id.len() <= 32
        && !room_id.bytes().all(|byte| byte == b'0')
        && room_id.bytes().all(|byte| byte.is_ascii_digit()))
    .then_some(room_id)
}

fn value_id(value: &Value) -> Option<String> {
    if let Some(value) = value.as_i64() {
        return (value > 0).then(|| value.to_string());
    }
    if let Some(value) = value.as_u64() {
        return (value > 0).then(|| value.to_string());
    }
    value
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty() && *value != "0")
        .map(ToString::to_string)
}

fn value_i64(value: &Value) -> Option<i64> {
    value
        .as_i64()
        .or_else(|| value.as_str().and_then(|value| value.parse().ok()))
}

fn text_field(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(clean_text)
        .filter(|value| !value.is_empty())
}

fn clean_text(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn normalize_stream_url(value: &str) -> Option<String> {
    let value = value.trim();
    let value = if value.starts_with("//") {
        format!("https:{value}")
    } else if value.starts_with("http://") || value.starts_with("https://") {
        value.to_string()
    } else {
        return None;
    };
    let url = reqwest::Url::parse(&value).ok()?;
    if !matches!(url.scheme(), "http" | "https")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some_and(|port| match url.scheme() {
            "http" => port != 80,
            "https" => port != 443,
            _ => true,
        })
        || url.host_str().is_none()
    {
        return None;
    }
    Some(url.to_string())
}

fn normalize_https_url(value: &str) -> Option<String> {
    let value = value.trim();
    if value.is_empty() {
        return None;
    }
    if value.starts_with("//") {
        return Some(format!("https:{value}"));
    }
    if let Some(value) = value.strip_prefix("http://") {
        return Some(format!("https://{value}"));
    }
    value.starts_with("https://").then(|| value.to_string())
}

fn stream_url_variants(value: &str) -> Vec<String> {
    let Ok(mut alternate) = reqwest::Url::parse(value) else {
        return Vec::new();
    };
    let next_scheme = if alternate.scheme() == "http" {
        "https"
    } else {
        "http"
    };
    if alternate.set_scheme(next_scheme).is_err() {
        return vec![value.to_string()];
    }
    alternate.set_port(None).ok();
    let alternate = alternate.to_string();
    if alternate == value {
        vec![alternate]
    } else {
        vec![value.to_string(), alternate]
    }
}

fn huya_id() -> PlatformId {
    PlatformId::new("huya").expect("Huya platform id must be valid")
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn discovery_maps_public_room_id_separately_from_anchor_uid() {
        let html = include_str!("../../../tests/fixtures/huya/live/discovery.html");
        let discovery = parse_discovery(html).unwrap();

        assert_eq!(discovery.sections.len(), 1);
        assert_eq!(discovery.sections[0].rooms.len(), 2);
        let room = &discovery.sections[0].rooms[0];
        assert_eq!(room.room_id, "321123");
        assert_eq!(room.anchor_name, "Fixture anchor");
        assert_eq!(room.title, "Fixture introduction");
        assert_eq!(room.area_name.as_deref(), Some("CS2"));
        assert_eq!(room.online, 12_000);
        assert_eq!(
            room.cover_url.as_deref(),
            Some("https://live-cover.msstatic.com/fixture-cover.jpg")
        );
        assert_eq!(
            room.avatar_url.as_deref(),
            Some("https://huyaimg.msstatic.com/fixture-avatar.jpg")
        );
    }

    #[test]
    fn live_room_maps_confirmed_profile_fields_and_public_room_id() {
        let html = include_str!("../../../tests/fixtures/huya/live/room-live.html");
        let room = parse_room_info(html, "999999").unwrap();

        assert_eq!(room.room_id, "321123");
        assert_eq!(room.anchor_id, Some(1_199_652_774_074));
        assert_eq!(room.anchor_name, "Fixture anchor");
        assert_eq!(room.title, "Fixture introduction");
        assert_eq!(room.area_name.as_deref(), Some("CS2"));
        assert_eq!(room.live_status, LiveStatus::Live);
        assert_eq!(room.started_at, Some(1_794_360_924));
        assert!(room.tags.is_empty());
    }

    #[test]
    fn playback_prefers_sustained_flv_and_keeps_hls_as_backup() {
        let html = include_str!("../../../tests/fixtures/huya/live/room-live.html");
        let playback = parse_playback(html, "321123", 0).unwrap();

        assert_eq!(playback.streams.len(), 2);
        assert_eq!(playback.streams[0].protocol, StreamProtocol::Flv);
        assert_eq!(playback.streams[1].protocol, StreamProtocol::Hls);
        assert!(playback.streams[0]
            .url
            .starts_with("http://tx.flv.huya.com/"));
        assert_eq!(playback.streams[0].backup_urls.len(), 5);
        assert!(playback.streams[0].backup_urls[0].starts_with("https://tx.flv.huya.com/"));
        assert!(playback.streams[0].backup_urls[1].starts_with("http://hs.flv.huya.com/"));
        assert!(playback.streams[0].backup_urls[2].starts_with("https://hs.flv.huya.com/"));
        assert!(playback.streams[1]
            .url
            .starts_with("http://tx.hls.huya.com/"));
        assert_eq!(playback.streams[1].backup_urls.len(), 5);
        assert!(playback.streams[1].backup_urls[0].starts_with("https://tx.hls.huya.com/"));
        assert!(playback.streams[1].backup_urls[1].starts_with("http://hs.hls.huya.com/"));
        assert!(playback.streams[1].backup_urls[2].starts_with("https://hs.hls.huya.com/"));
        assert_eq!(
            playback
                .current_quality
                .as_ref()
                .map(|value| value.label.as_str()),
            Some("蓝光30M")
        );
        assert_eq!(playback.advertised_qualities.len(), 1);
    }

    #[test]
    fn offline_room_never_exposes_retained_streams() {
        let html = include_str!("../../../tests/fixtures/huya/live/room-offline.html");
        let playback = parse_playback(html, "1", 0).unwrap();

        assert_eq!(playback.room_id, "1");
        assert_eq!(playback.live_status, LiveStatus::Offline);
        assert!(playback.streams.is_empty());
        assert!(playback.current_quality.is_none());
        assert!(playback.advertised_qualities.is_empty());
    }

    #[test]
    fn replay_and_unknown_states_do_not_require_live_streams() {
        assert_eq!(
            parse_live_status(&json!({
                "state": "OFF",
                "isOn": false,
                "isOff": false,
                "isReplay": true
            })),
            LiveStatus::Round
        );
        assert_eq!(
            parse_live_status(&json!({
                "state": "PREPARING",
                "isOn": false,
                "isOff": false,
                "isReplay": false
            })),
            LiveStatus::Unknown
        );
    }

    #[test]
    fn duplicate_and_malformed_cdn_urls_are_skipped() {
        let entries = vec![
            json!({
                "iWebPriorityRate": 100,
                "sStreamName": "fixture",
                "sFlvUrl": "http://tx.flv.huya.com/src",
                "sFlvUrlSuffix": "flv",
                "sFlvAntiCode": "token=fixture",
                "sHlsUrl": "http://tx.hls.huya.com/src",
                "sHlsUrlSuffix": "m3u8",
                "sHlsAntiCode": "token=fixture"
            }),
            json!({
                "iWebPriorityRate": 50,
                "sStreamName": "fixture",
                "sFlvUrl": "http://tx.flv.huya.com/src",
                "sFlvUrlSuffix": "flv",
                "sFlvAntiCode": "token=fixture",
                "sHlsUrl": "http://tx.hls.huya.com/src",
                "sHlsUrlSuffix": "m3u8",
                "sHlsAntiCode": "token=fixture"
            }),
            json!({
                "iWebPriorityRate": 80,
                "sStreamName": "fixture",
                "sFlvUrl": "ftp://invalid.huya.com/src",
                "sFlvUrlSuffix": "flv",
                "sFlvAntiCode": "token=fixture",
                "sHlsUrl": "ftp://invalid.huya.com/src",
                "sHlsUrlSuffix": "m3u8",
                "sHlsAntiCode": "token=fixture"
            }),
        ];

        let hls_urls = prioritized_urls(&entries, StreamProtocol::Hls);
        assert_eq!(hls_urls.len(), 2);
        assert!(hls_urls[0].starts_with("http://tx.hls.huya.com/"));
        assert!(hls_urls[1].starts_with("https://tx.hls.huya.com/"));

        let flv_urls = prioritized_urls(&entries, StreamProtocol::Flv);
        assert_eq!(flv_urls.len(), 2);
        assert!(flv_urls[0].starts_with("http://tx.flv.huya.com/"));
        assert!(flv_urls[1].starts_with("https://tx.flv.huya.com/"));

        let variants = stream_url_variants("https://hs.flv.huya.com/src/fixture.flv?token=fixture");
        assert_eq!(variants.len(), 2);
        assert!(variants[0].starts_with("https://hs.flv.huya.com/"));
        assert!(variants[1].starts_with("http://hs.flv.huya.com/"));
    }
}
