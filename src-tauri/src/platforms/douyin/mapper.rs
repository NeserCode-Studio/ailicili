use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};

use serde_json::Value;

use super::DouyinError;
use crate::domain::{
    LiveDiscovery, LivePlaybackInfo, LiveRoomCard, LiveRoomInfo, LiveSection, LiveStatus,
    PlatformId, QualityOption, StreamProtocol, StreamSource,
};

const DISCOVERY_SECTION_TITLE: &str = "推荐直播";
const LIVE_HOME_PREFIX: &str = "https://live.douyin.com/";

pub(super) struct DiscoverySnapshot {
    pub(super) discovery: LiveDiscovery,
    pub(super) rooms: HashMap<String, DiscoveredRoom>,
}

#[derive(Clone)]
pub(super) struct DiscoveredRoom {
    pub(super) card: LiveRoomCard,
    pub(super) room: Value,
}

pub(super) fn parse_discovery_snapshot(html: &str) -> Result<DiscoverySnapshot, DouyinError> {
    let (visuals, flight_rooms) = parse_flight_data(html);
    let mut rooms = Vec::new();
    let mut seen = HashSet::new();
    let mut cursor = 0;

    while let Some(relative) = html[cursor..].find(LIVE_HOME_PREFIX) {
        let link_start = cursor + relative;
        let room_start = link_start + LIVE_HOME_PREFIX.len();
        let room_end = html[room_start..]
            .find(|character: char| !character.is_ascii_digit())
            .map(|offset| room_start + offset)
            .unwrap_or(html.len());
        let room_id = &html[room_start..room_end];
        cursor = room_end.max(link_start + 1);
        if !is_public_web_rid(room_id) || !seen.insert(room_id.to_string()) {
            continue;
        }

        let Some(anchor_start) = html[..link_start].rfind("<a ") else {
            continue;
        };
        let Some(anchor_offset) = html[link_start..].find("</a>") else {
            continue;
        };
        let anchor_end = link_start + anchor_offset + "</a>".len();
        let anchor = &html[anchor_start..anchor_end];
        let title = attribute_before(anchor, "data-e2e=\"livecard-title\"", "title")
            .map(|value| clean_html_text(&value))
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| format!("抖音直播 {room_id}"));
        let anchor_name = text_after_attribute(anchor, "data-e2e=\"livecard-metatext\"")
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| "抖音主播".to_string());
        let online = text_after_attribute(anchor, "data-e2e=\"livecard-usercount\"")
            .map(|value| parse_compact_count(&value))
            .unwrap_or_default();
        let visual = visuals.get(room_id);

        let live_status = flight_rooms
            .get(room_id)
            .and_then(|room| room.get("status"))
            .and_then(known_live_status)
            .unwrap_or(LiveStatus::Live);

        rooms.push(LiveRoomCard {
            platform: douyin_id(),
            room_id: room_id.to_string(),
            title,
            anchor_name,
            cover_url: visual.and_then(|value| value.cover_url.clone()),
            avatar_url: visual.and_then(|value| value.avatar_url.clone()),
            area_name: None,
            parent_area_name: None,
            online,
            live_status,
        });
    }

    if rooms.is_empty() {
        return Err(DouyinError::Invalid(
            "Douyin discovery page contained no live cards".to_string(),
        ));
    }

    let discovered_rooms = rooms
        .iter()
        .filter_map(|card| {
            flight_rooms.get(&card.room_id).cloned().map(|room| {
                (
                    card.room_id.clone(),
                    DiscoveredRoom {
                        card: card.clone(),
                        room,
                    },
                )
            })
        })
        .collect();

    Ok(DiscoverySnapshot {
        discovery: LiveDiscovery {
            sections: vec![LiveSection {
                id: "douyin-live-recommended".to_string(),
                title: DISCOVERY_SECTION_TITLE.to_string(),
                rooms,
            }],
        },
        rooms: discovered_rooms,
    })
}

#[derive(Default)]
struct FlightVisual {
    cover_url: Option<String>,
    avatar_url: Option<String>,
}

fn parse_flight_data(html: &str) -> (HashMap<String, FlightVisual>, HashMap<String, Value>) {
    const MARKER: &str = "self.__pace_f.push(";

    let mut visuals = HashMap::new();
    let mut rooms = HashMap::new();
    let mut cursor = 0;
    while let Some(offset) = html[cursor..].find(MARKER) {
        cursor += offset + MARKER.len();
        let argument = html[cursor..].trim_start();
        if !argument.starts_with('[') {
            continue;
        }
        let Some(end) = json_container_end(argument) else {
            continue;
        };
        let Ok(parts) = serde_json::from_str::<Vec<Value>>(&argument[..end]) else {
            continue;
        };
        let Some(payload) = parts.get(1).and_then(Value::as_str) else {
            continue;
        };
        let Some((_, payload)) = payload.split_once(':') else {
            continue;
        };
        let Ok(flight) = serde_json::from_str::<Value>(payload) else {
            continue;
        };
        collect_flight_data(&flight, &mut visuals, &mut rooms);
    }
    (visuals, rooms)
}

fn collect_flight_data(
    value: &Value,
    visuals: &mut HashMap<String, FlightVisual>,
    rooms: &mut HashMap<String, Value>,
) {
    match value {
        Value::Object(object) => {
            if let Some(room_items) = object
                .get("roomsData")
                .and_then(|value| value.get("data"))
                .and_then(Value::as_array)
            {
                for room in room_items {
                    let Some(web_rid) = room.get("web_rid").and_then(value_id) else {
                        continue;
                    };
                    let cover_url = room
                        .get("cover")
                        .and_then(Value::as_str)
                        .and_then(normalize_https_url)
                        .or_else(|| first_url(room.pointer("/room/cover")));
                    let avatar_url = room
                        .get("avatar")
                        .and_then(Value::as_str)
                        .and_then(normalize_https_url)
                        .or_else(|| first_url(room.pointer("/room/owner/avatar_thumb")))
                        .or_else(|| first_url(room.pointer("/owner/avatar_thumb")));
                    if cover_url.is_some() || avatar_url.is_some() {
                        visuals.insert(
                            web_rid.clone(),
                            FlightVisual {
                                cover_url,
                                avatar_url,
                            },
                        );
                    }
                    if let Some(room) = room.get("room").filter(|value| value.is_object()) {
                        rooms.entry(web_rid).or_insert_with(|| room.clone());
                    }
                }
            }
            for child in object.values() {
                collect_flight_data(child, visuals, rooms);
            }
        }
        Value::Array(items) => {
            for child in items {
                collect_flight_data(child, visuals, rooms);
            }
        }
        _ => {}
    }
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

pub(super) fn parse_room_info(
    root: &Value,
    requested_room_id: &str,
) -> Result<LiveRoomInfo, DouyinError> {
    let room = room_entry(root)?;
    let owner = room.get("owner");
    let user = root.pointer("/data/user");
    let title = room
        .get("title")
        .and_then(Value::as_str)
        .map(clean_text)
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| format!("抖音直播 {requested_room_id}"));
    let anchor_name = user
        .and_then(|value| value.get("nickname"))
        .or_else(|| owner.and_then(|value| value.get("nickname")))
        .and_then(Value::as_str)
        .map(clean_text)
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "抖音主播".to_string());
    let tags = Vec::new();

    Ok(LiveRoomInfo {
        platform: douyin_id(),
        room_id: room_id(room).unwrap_or_else(|| requested_room_id.to_string()),
        title,
        anchor_name,
        anchor_id: owner
            .and_then(|value| value.get("id_str"))
            .and_then(value_i64),
        cover_url: first_url(room.get("cover")),
        avatar_url: first_url(owner.and_then(|value| value.get("avatar_thumb"))),
        area_name: None,
        parent_area_name: None,
        tags,
        live_status: parse_live_status(room.get("status")),
        started_at: room.get("live_start_time").and_then(value_i64),
    })
}

pub(super) fn parse_playback(
    root: &Value,
    requested_room_id: &str,
    requested_quality: i64,
) -> Result<LivePlaybackInfo, DouyinError> {
    let room = room_entry(root)?;
    let live_status = parse_live_status(room.get("status"));
    playback_from_room(room, requested_room_id, live_status, requested_quality)
}

pub(super) fn parse_discovered_room_info(card: &LiveRoomCard, room: &Value) -> LiveRoomInfo {
    LiveRoomInfo {
        platform: douyin_id(),
        room_id: card.room_id.clone(),
        title: card.title.clone(),
        anchor_name: card.anchor_name.clone(),
        anchor_id: None,
        cover_url: card.cover_url.clone(),
        avatar_url: card.avatar_url.clone(),
        area_name: card.area_name.clone(),
        parent_area_name: card.parent_area_name.clone(),
        tags: Vec::new(),
        live_status: parse_live_status(room.get("status")),
        started_at: None,
    }
}

pub(super) fn parse_discovered_playback(
    room: &Value,
    requested_room_id: &str,
    requested_quality: i64,
) -> Result<LivePlaybackInfo, DouyinError> {
    let live_status = parse_live_status(room.get("status"));
    playback_from_room(room, requested_room_id, live_status, requested_quality)
}

fn playback_from_room(
    room: &Value,
    requested_room_id: &str,
    live_status: LiveStatus,
    requested_quality: i64,
) -> Result<LivePlaybackInfo, DouyinError> {
    let room_id = room_id(room).unwrap_or_else(|| requested_room_id.to_string());
    if live_status != LiveStatus::Live {
        return Ok(LivePlaybackInfo {
            platform: douyin_id(),
            room_id,
            live_status,
            streams: Vec::new(),
            current_quality: None,
            advertised_qualities: Vec::new(),
        });
    }

    let stream_url = room.get("stream_url").unwrap_or(&Value::Null);
    let hls = quality_urls(stream_url, "hls_pull_url_map", "hls_pull_url");
    let flv = quality_urls(stream_url, "flv_pull_url", "flv_url");
    let mut keys = hls
        .keys()
        .chain(flv.keys())
        .cloned()
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    keys.sort_by(|left, right| quality_order(left).cmp(&quality_order(right)));

    let qualities = keys
        .into_iter()
        .enumerate()
        .map(|(index, key)| QualityEntry {
            id: quality_id(&key, index),
            label: quality_label(&key),
            key,
        })
        .collect::<Vec<_>>();
    let default_resolution = stream_url
        .get("default_resolution")
        .and_then(Value::as_str)
        .map(canonical_quality_key);
    let selected = qualities
        .iter()
        .find(|quality| quality.id == requested_quality)
        .or_else(|| {
            default_resolution
                .as_ref()
                .and_then(|key| qualities.iter().find(|quality| &quality.key == key))
        })
        .or_else(|| qualities.first());

    let advertised_qualities = qualities
        .iter()
        .map(|quality| QualityOption {
            id: quality.id,
            label: quality.label.clone(),
        })
        .collect::<Vec<_>>();
    let mut streams = Vec::new();
    let mut current_quality = None;

    if let Some(selected) = selected {
        current_quality = Some(QualityOption {
            id: selected.id,
            label: selected.label.clone(),
        });
        append_stream_source(
            &mut streams,
            &room_id,
            selected,
            StreamProtocol::Hls,
            hls.get(&selected.key),
        );
        append_stream_source(
            &mut streams,
            &room_id,
            selected,
            StreamProtocol::Flv,
            flv.get(&selected.key),
        );
    }

    Ok(LivePlaybackInfo {
        platform: douyin_id(),
        room_id,
        live_status,
        streams,
        current_quality,
        advertised_qualities,
    })
}

struct QualityEntry {
    key: String,
    id: i64,
    label: String,
}

fn room_entry(root: &Value) -> Result<&Value, DouyinError> {
    root.pointer("/data/data/0")
        .ok_or(DouyinError::RoomNotFound)
}

fn room_id(room: &Value) -> Option<String> {
    room.get("id_str")
        .and_then(value_id)
        .or_else(|| room.get("id").and_then(value_id))
}

fn quality_urls(stream_url: &Value, map_key: &str, fallback_key: &str) -> BTreeMap<String, String> {
    let mut urls = BTreeMap::new();
    if let Some(map) = stream_url.get(map_key).and_then(Value::as_object) {
        for (key, value) in map {
            if let Some(value) = value.as_str().and_then(normalize_stream_url) {
                urls.insert(canonical_quality_key(key), value);
            }
        }
    }
    if urls.is_empty() {
        if let Some(value) = stream_url
            .get(fallback_key)
            .and_then(Value::as_str)
            .and_then(normalize_stream_url)
        {
            let key = stream_url
                .get("default_resolution")
                .and_then(Value::as_str)
                .map(canonical_quality_key)
                .unwrap_or_else(|| "DEFAULT".to_string());
            urls.insert(key, value);
        }
    }
    urls
}

fn append_stream_source(
    streams: &mut Vec<StreamSource>,
    room_id: &str,
    quality: &QualityEntry,
    protocol: StreamProtocol,
    url: Option<&String>,
) {
    let Some(url) = url else {
        return;
    };
    let protocol_slug = match protocol {
        StreamProtocol::Hls => "hls",
        StreamProtocol::Flv => "flv",
        _ => return,
    };
    streams.push(StreamSource {
        id: format!(
            "douyin-{room_id}-{protocol_slug}-{}",
            quality_slug(&quality.key)
        ),
        protocol,
        url: url.clone(),
        backup_urls: Vec::new(),
        quality_id: quality.id,
        quality_label: quality.label.clone(),
        audio_url: None,
        audio_backup_urls: Vec::new(),
        codec: None,
        audio_codec: None,
    });
}

fn canonical_quality_key(value: &str) -> String {
    value.trim().to_ascii_uppercase()
}

fn quality_order(value: &str) -> (u8, String) {
    let rank = match value {
        "ORIGIN" => 0,
        "FULL_HD1" => 1,
        "HD1" => 2,
        "SD1" => 3,
        "SD2" => 4,
        _ => 5,
    };
    (rank, value.to_string())
}

fn quality_id(key: &str, unknown_index: usize) -> i64 {
    match key {
        "ORIGIN" => 10_000,
        "FULL_HD1" => 400,
        "HD1" => 250,
        "SD1" => 150,
        "SD2" => 80,
        _ => 20_000 + unknown_index as i64,
    }
}

fn quality_label(key: &str) -> String {
    match key {
        "ORIGIN" => "原画".to_string(),
        "FULL_HD1" => "超清".to_string(),
        "HD1" => "高清".to_string(),
        "SD1" => "标清".to_string(),
        "SD2" => "流畅".to_string(),
        value => value.to_string(),
    }
}

fn quality_slug(value: &str) -> String {
    value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect()
}

fn parse_live_status(value: Option<&Value>) -> LiveStatus {
    value
        .and_then(known_live_status)
        .unwrap_or(LiveStatus::Unknown)
}

fn known_live_status(value: &Value) -> Option<LiveStatus> {
    match value_i64(value) {
        Some(2) => Some(LiveStatus::Live),
        Some(4) => Some(LiveStatus::Offline),
        _ => None,
    }
}

fn first_url(value: Option<&Value>) -> Option<String> {
    value?
        .get("url_list")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .find_map(Value::as_str)
        .and_then(normalize_https_url)
}

fn normalize_stream_url(value: &str) -> Option<String> {
    let value = normalize_https_url(value)?;
    let url = reqwest::Url::parse(&value).ok()?;
    if url.scheme() != "https"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some_and(|port| port != 443)
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

fn clean_text(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn clean_html_text(value: &str) -> String {
    clean_text(&decode_html_entities(value))
}

fn is_public_web_rid(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 32
        && !value.bytes().all(|byte| byte == b'0')
        && value.bytes().all(|byte| byte.is_ascii_digit())
}

fn attribute_before(section: &str, marker: &str, attribute: &str) -> Option<String> {
    let marker_start = section.find(marker)?;
    let prefix = &section[..marker_start];
    let attribute_start = prefix.rfind(&format!("{attribute}=\""))?;
    if marker_start.saturating_sub(attribute_start) > 512 {
        return None;
    }
    let value_start = attribute_start + attribute.len() + 2;
    let value_end = section[value_start..].find('"')? + value_start;
    Some(section[value_start..value_end].to_string())
}

fn text_after_attribute(section: &str, marker: &str) -> Option<String> {
    let marker_start = section.find(marker)?;
    let content_start = section[marker_start..].find('>')? + marker_start + 1;
    let content_end = section[content_start..].find('<')? + content_start;
    Some(clean_html_text(&section[content_start..content_end]))
}

fn parse_compact_count(value: &str) -> i64 {
    let value = value
        .trim()
        .replace(',', "")
        .replace('+', "")
        .replace(' ', "");
    let (number, multiplier) = if let Some(value) = value.strip_suffix('万') {
        (value, 10_000.0)
    } else if let Some(value) = value.strip_suffix('亿') {
        (value, 100_000_000.0)
    } else {
        (value.as_str(), 1.0)
    };
    number
        .parse::<f64>()
        .map(|value| (value * multiplier).round() as i64)
        .unwrap_or_default()
}

fn decode_html_entities(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    let mut rest = value;
    while let Some(start) = rest.find('&') {
        output.push_str(&rest[..start]);
        let entity = &rest[start + 1..];
        let Some(end) = entity.find(';') else {
            output.push_str(&rest[start..]);
            return output;
        };
        let entity_body = &entity[..end];
        if let Some(decoded) = decode_html_entity(entity_body) {
            output.push(decoded);
            rest = &entity[end + 1..];
        } else {
            output.push('&');
            rest = entity;
        }
    }
    output.push_str(rest);
    output
}

fn decode_html_entity(entity: &str) -> Option<char> {
    match entity {
        "amp" => Some('&'),
        "lt" => Some('<'),
        "gt" => Some('>'),
        "quot" => Some('"'),
        "apos" => Some('\''),
        value if value.starts_with("#x") || value.starts_with("#X") => {
            u32::from_str_radix(&value[2..], 16)
                .ok()
                .and_then(char::from_u32)
        }
        value if value.starts_with('#') => value[1..].parse().ok().and_then(char::from_u32),
        _ => None,
    }
}

fn douyin_id() -> PlatformId {
    PlatformId::new("douyin").expect("Douyin platform id must be valid")
}

#[cfg(test)]
mod tests {
    use serde_json::Map;

    use super::*;

    fn live_fixture() -> Value {
        serde_json::from_str(include_str!(
            "../../../tests/fixtures/douyin/live/enter-live.json"
        ))
        .unwrap()
    }

    #[test]
    fn discovery_parses_server_rendered_cards() {
        let html = include_str!("../../../tests/fixtures/douyin/live/discovery.html");
        let snapshot = parse_discovery_snapshot(html).unwrap();
        let discovery = snapshot.discovery;

        assert_eq!(discovery.sections.len(), 1);
        assert_eq!(discovery.sections[0].rooms.len(), 2);
        assert_eq!(discovery.sections[0].rooms[0].room_id, "100001");
        assert_eq!(discovery.sections[0].rooms[0].anchor_name, "Fixture anchor");
        assert_eq!(discovery.sections[0].rooms[0].online, 12_000);
        assert_eq!(
            discovery.sections[0].rooms[0].cover_url.as_deref(),
            Some("https://p3.douyinpic.com/fixture-cover.webp")
        );
        assert_eq!(
            discovery.sections[0].rooms[0].avatar_url.as_deref(),
            Some("https://p3.douyinpic.com/fixture-avatar.jpeg")
        );
        assert_eq!(snapshot.rooms.len(), 2);
    }

    #[test]
    fn discovery_snapshot_supplies_room_info_and_playback_fallback() {
        let html = include_str!("../../../tests/fixtures/douyin/live/discovery.html");
        let snapshot = parse_discovery_snapshot(html).unwrap();
        let discovered = snapshot.rooms.get("100001").unwrap();
        let info = parse_discovered_room_info(&discovered.card, &discovered.room);
        let playback = parse_discovered_playback(&discovered.room, "100001", 10_000).unwrap();

        assert_eq!(info.room_id, "100001");
        assert_eq!(info.title, "Fixture & live");
        assert_eq!(playback.live_status, LiveStatus::Live);
        assert_eq!(playback.streams.len(), 2);
        assert_eq!(playback.streams[0].protocol, StreamProtocol::Hls);
        assert_eq!(playback.streams[1].protocol, StreamProtocol::Flv);
        assert_eq!(
            playback.current_quality.as_ref().map(|value| value.id),
            Some(250)
        );
    }

    #[test]
    fn discovery_snapshot_never_exposes_streams_for_ended_or_unknown_rooms() {
        let html = include_str!("../../../tests/fixtures/douyin/live/discovery.html");
        let mut snapshot = parse_discovery_snapshot(html).unwrap();
        let discovered = snapshot.rooms.get_mut("100002").unwrap();
        discovered.room["status"] = Value::from(4);

        let info = parse_discovered_room_info(&discovered.card, &discovered.room);
        let playback = parse_discovered_playback(&discovered.room, "100002", 10_000).unwrap();

        assert_eq!(info.live_status, LiveStatus::Offline);
        assert_eq!(playback.live_status, LiveStatus::Offline);
        assert!(playback.streams.is_empty());
        assert!(playback.current_quality.is_none());

        snapshot.rooms.get_mut("100002").unwrap().room["status"] = Value::from(9);
        let discovered = snapshot.rooms.get("100002").unwrap();
        let playback = parse_discovered_playback(&discovered.room, "100002", 10_000).unwrap();

        assert_eq!(playback.live_status, LiveStatus::Unknown);
        assert!(playback.streams.is_empty());
    }

    #[test]
    fn live_room_maps_only_confirmed_public_fields() {
        let room = parse_room_info(&live_fixture(), "100001").unwrap();

        assert_eq!(room.room_id, "7000000000000000001");
        assert_eq!(room.anchor_name, "Fixture anchor");
        assert_eq!(room.live_status, LiveStatus::Live);
        assert!(room.tags.is_empty());
        assert!(room.area_name.is_none());
        assert_eq!(
            room.cover_url.as_deref(),
            Some("https://example.invalid/cover.jpg")
        );
    }

    #[test]
    fn playback_prefers_hls_and_uses_default_resolution() {
        let playback = parse_playback(&live_fixture(), "100001", 10_000).unwrap();

        assert_eq!(playback.streams.len(), 2);
        assert_eq!(playback.streams[0].protocol, StreamProtocol::Hls);
        assert_eq!(playback.streams[1].protocol, StreamProtocol::Flv);
        assert_eq!(
            playback.current_quality.as_ref().map(|value| value.id),
            Some(250)
        );
        assert_eq!(playback.advertised_qualities.len(), 3);
        assert!(playback.streams[0].url.contains("hls"));
    }

    #[test]
    fn requested_quality_selects_real_room_key() {
        let playback = parse_playback(&live_fixture(), "100001", 400).unwrap();

        assert_eq!(
            playback.current_quality.as_ref().map(|value| value.id),
            Some(400)
        );
        assert_eq!(playback.streams[0].quality_id, 400);
        assert!(playback.streams[0].url.contains("FULL_HD1"));
    }

    #[test]
    fn ended_room_never_exposes_retained_streams() {
        let root: Value = serde_json::from_str(include_str!(
            "../../../tests/fixtures/douyin/live/enter-ended.json"
        ))
        .unwrap();
        let playback = parse_playback(&root, "100002", 10_000).unwrap();

        assert_eq!(playback.live_status, LiveStatus::Offline);
        assert!(playback.streams.is_empty());
        assert!(playback.current_quality.is_none());
    }

    #[test]
    fn unknown_status_never_exposes_retained_streams() {
        let mut root = live_fixture();
        root["data"]["data"][0]["status"] = Value::from(9);
        let playback = parse_playback(&root, "100001", 10_000).unwrap();

        assert_eq!(playback.live_status, LiveStatus::Unknown);
        assert!(playback.streams.is_empty());
    }

    #[test]
    fn duplicate_keys_across_protocols_are_advertised_once() {
        let playback = parse_playback(&live_fixture(), "100001", 10_000).unwrap();
        let ids = playback
            .advertised_qualities
            .iter()
            .map(|quality| quality.id)
            .collect::<BTreeSet<_>>();

        assert_eq!(ids.len(), playback.advertised_qualities.len());
    }

    #[test]
    fn compact_chinese_counts_are_supported() {
        assert_eq!(parse_compact_count("1.2万"), 12_000);
        assert_eq!(parse_compact_count("2亿"), 200_000_000);
        assert_eq!(parse_compact_count("1,234"), 1_234);
    }

    #[test]
    fn quality_map_does_not_duplicate_entries_in_union() {
        let map = Map::from_iter([
            ("HD1".to_string(), Value::from("https://example.invalid/a")),
            ("SD1".to_string(), Value::from("https://example.invalid/b")),
        ]);
        let stream_url = serde_json::json!({ "hls_pull_url_map": map });
        let urls = quality_urls(&stream_url, "hls_pull_url_map", "hls_pull_url");

        assert_eq!(urls.len(), 2);
    }
}
