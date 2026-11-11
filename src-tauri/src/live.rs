use std::collections::BTreeSet;

use serde_json::Value;

use crate::domain::{
    LiveDiscovery, LivePlaybackInfo, LiveRoomCard, LiveRoomInfo, LiveSection, LiveStatus,
    PagedLiveRooms, PlatformId, QualityOption, StreamProtocol, StreamSource,
};

pub fn parse_discovery(root: &Value) -> Result<LiveDiscovery, String> {
    let modules = root
        .pointer("/data/room_list")
        .and_then(Value::as_array)
        .ok_or_else(|| "missing live discovery modules".to_string())?;
    let mut sections = Vec::new();
    for module in modules {
        let module_info = module
            .get("module_info")
            .ok_or_else(|| "missing live discovery module info".to_string())?;
        let title = module_info
            .get("title")
            .and_then(Value::as_str)
            .map(clean_text)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| "missing live discovery module title".to_string())?;
        let id = value_id(module_info.get("id")).unwrap_or_else(|| title.clone());
        let rooms = module
            .get("list")
            .and_then(Value::as_array)
            .map(|items| items.iter().filter_map(parse_room_card).collect::<Vec<_>>())
            .unwrap_or_default();
        if !rooms.is_empty() {
            sections.push(LiveSection { id, title, rooms });
        }
    }
    if sections.is_empty() {
        return Err("live discovery returned no rooms".to_string());
    }
    Ok(LiveDiscovery { sections })
}

pub fn parse_search(root: &Value, requested_page: u32) -> Result<PagedLiveRooms, String> {
    let data = root
        .get("data")
        .ok_or_else(|| "missing live search data".to_string())?;
    let results = data
        .get("result")
        .and_then(Value::as_array)
        .ok_or_else(|| "missing live search result".to_string())?;
    let items = results
        .iter()
        .filter_map(parse_room_card)
        .collect::<Vec<_>>();
    let page = data
        .get("page")
        .and_then(value_i64)
        .unwrap_or(requested_page as i64)
        .max(1) as u32;
    let page_size = data
        .get("pagesize")
        .and_then(value_i64)
        .unwrap_or(items.len() as i64)
        .max(1);
    let total = data
        .get("numResults")
        .and_then(value_i64)
        .unwrap_or(items.len() as i64)
        .max(0);
    let has_more = data
        .get("numPages")
        .and_then(value_i64)
        .map(|pages| (page as i64) < pages)
        .unwrap_or((page as i64) * page_size < total)
        && !items.is_empty();
    Ok(PagedLiveRooms {
        page,
        items,
        has_more,
        total,
    })
}

pub fn parse_room_info(root: &Value, requested_room_id: &str) -> Result<LiveRoomInfo, String> {
    let room = root
        .pointer("/data/room_info")
        .ok_or_else(|| "missing live room info".to_string())?;
    let anchor = root
        .pointer("/data/anchor_info/base_info")
        .ok_or_else(|| "missing live anchor info".to_string())?;
    let room_id = value_id(room.get("room_id"))
        .or_else(|| value_id(room.get("short_id")))
        .unwrap_or_else(|| requested_room_id.to_string());
    let title = room_text(room, "title")?;
    let anchor_name = anchor
        .get("uname")
        .and_then(Value::as_str)
        .map(clean_text)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "missing live anchor name".to_string())?;
    let tags = room
        .get("tags")
        .and_then(Value::as_str)
        .map(|value| {
            value
                .split(',')
                .map(clean_text)
                .filter(|tag| !tag.is_empty())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    Ok(LiveRoomInfo {
        platform: PlatformId::bilibili(),
        room_id,
        title,
        anchor_name,
        anchor_id: anchor.get("uid").and_then(value_i64),
        cover_url: room
            .get("cover")
            .and_then(Value::as_str)
            .map(normalize_url_text)
            .filter(|value| !value.is_empty()),
        avatar_url: anchor
            .get("face")
            .and_then(Value::as_str)
            .map(normalize_url_text)
            .filter(|value| !value.is_empty()),
        area_name: room
            .get("area_name")
            .and_then(Value::as_str)
            .map(clean_text)
            .filter(|value| !value.is_empty()),
        parent_area_name: room
            .get("parent_area_name")
            .and_then(Value::as_str)
            .map(clean_text)
            .filter(|value| !value.is_empty()),
        tags,
        live_status: room
            .get("live_status")
            .and_then(parse_live_status)
            .unwrap_or(LiveStatus::Unknown),
        started_at: room.get("live_start_time").and_then(value_i64),
    })
}

pub fn parse_playback(root: &Value, requested_room_id: &str) -> Result<LivePlaybackInfo, String> {
    let data = root
        .get("data")
        .ok_or_else(|| "missing live playback data".to_string())?;
    let room_id = value_id(data.get("room_id")).unwrap_or_else(|| requested_room_id.to_string());
    let live_status = data
        .get("live_status")
        .and_then(parse_live_status)
        .unwrap_or(LiveStatus::Unknown);
    let mut streams = Vec::new();
    let mut advertised = BTreeSet::new();

    if let Some(protocols) = data
        .pointer("/playurl_info/playurl/stream")
        .and_then(Value::as_array)
    {
        for protocol in protocols {
            let Some(protocol_name) = protocol.get("protocol_name").and_then(Value::as_str) else {
                continue;
            };
            let stream_protocol = match protocol_name {
                "http_hls" => StreamProtocol::Hls,
                "http_stream" => StreamProtocol::Flv,
                _ => continue,
            };
            let Some(format) = preferred_format(
                protocol
                    .get("format")
                    .and_then(Value::as_array)
                    .map(Vec::as_slice)
                    .unwrap_or_default(),
                stream_protocol,
            ) else {
                continue;
            };
            let Some(codec) = preferred_codec(
                format
                    .get("codec")
                    .and_then(Value::as_array)
                    .map(Vec::as_slice)
                    .unwrap_or_default(),
            ) else {
                continue;
            };
            if let Some(values) = codec.get("accept_qn").and_then(Value::as_array) {
                advertised.extend(values.iter().filter_map(value_i64));
            }
            let quality_id = codec
                .get("current_qn")
                .and_then(value_i64)
                .or_else(|| advertised.iter().next_back().copied())
                .unwrap_or_default();
            let Some(base_url) = codec.get("base_url").and_then(Value::as_str) else {
                continue;
            };
            let codec_name = codec
                .get("codec_name")
                .and_then(Value::as_str)
                .unwrap_or("unknown");
            let urls = codec
                .get("url_info")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(|url_info| {
                    combine_stream_url(
                        url_info.get("host").and_then(Value::as_str),
                        base_url,
                        url_info.get("extra").and_then(Value::as_str),
                    )
                })
                .collect::<Vec<_>>();
            let Some((url, backups)) = urls.split_first() else {
                continue;
            };
            streams.push(StreamSource {
                id: format!(
                    "live-{room_id}-{}-{quality_id}-{codec_name}",
                    protocol_slug(stream_protocol),
                ),
                protocol: stream_protocol,
                url: url.clone(),
                backup_urls: backups.to_vec(),
                quality_id,
                quality_label: quality_label(quality_id),
                audio_url: None,
                audio_backup_urls: Vec::new(),
                codec: Some(codec_name.to_string()),
                audio_codec: None,
            });
        }
    }

    streams.sort_by_key(|stream| match stream.protocol {
        StreamProtocol::Flv => 0,
        StreamProtocol::Hls => 1,
        _ => 2,
    });
    let current_quality = streams.first().map(|stream| QualityOption {
        id: stream.quality_id,
        label: stream.quality_label.clone(),
    });
    let advertised_qualities = advertised
        .into_iter()
        .rev()
        .map(|id| QualityOption {
            id,
            label: quality_label(id),
        })
        .collect();
    Ok(LivePlaybackInfo {
        platform: PlatformId::bilibili(),
        room_id,
        live_status,
        streams,
        current_quality,
        advertised_qualities,
    })
}

fn parse_room_card(item: &Value) -> Option<LiveRoomCard> {
    let room_id = value_id(item.get("roomid"))?;
    let title = item
        .get("title")
        .and_then(Value::as_str)
        .map(clean_text)
        .filter(|value| !value.is_empty())?;
    let anchor_name = item
        .get("uname")
        .and_then(Value::as_str)
        .map(clean_text)
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "Bilibili".to_string());
    let cover_url = ["user_cover", "cover", "pic", "keyframe"]
        .iter()
        .find_map(|key| item.get(*key).and_then(Value::as_str))
        .map(normalize_url_text)
        .filter(|value| !value.is_empty());
    let avatar_url = item
        .get("uface")
        .or_else(|| item.get("face"))
        .and_then(Value::as_str)
        .map(normalize_url_text)
        .filter(|value| !value.is_empty());
    let live_status = item
        .get("live_status")
        .and_then(parse_live_status)
        .or_else(|| {
            item.get("status").and_then(Value::as_bool).map(|status| {
                if status {
                    LiveStatus::Live
                } else {
                    LiveStatus::Offline
                }
            })
        })
        .unwrap_or(LiveStatus::Unknown);

    Some(LiveRoomCard {
        platform: PlatformId::bilibili(),
        room_id,
        title,
        anchor_name,
        cover_url,
        avatar_url,
        area_name: item
            .get("area_v2_name")
            .or_else(|| item.get("cate_name"))
            .and_then(Value::as_str)
            .map(clean_text)
            .filter(|value| !value.is_empty()),
        parent_area_name: item
            .get("area_v2_parent_name")
            .and_then(Value::as_str)
            .map(clean_text)
            .filter(|value| !value.is_empty()),
        online: item.get("online").and_then(value_i64).unwrap_or_default(),
        live_status,
    })
}

fn preferred_format<'a>(formats: &'a [Value], protocol: StreamProtocol) -> Option<&'a Value> {
    let preferred = match protocol {
        StreamProtocol::Hls => ["ts", "fmp4"],
        StreamProtocol::Flv => ["flv", ""],
        _ => ["", ""],
    };
    preferred
        .iter()
        .find_map(|name| {
            formats.iter().find(|format| {
                format
                    .get("format_name")
                    .and_then(Value::as_str)
                    .is_some_and(|value| value.eq_ignore_ascii_case(name))
            })
        })
        .or_else(|| formats.first())
}

fn preferred_codec(codecs: &[Value]) -> Option<&Value> {
    codecs
        .iter()
        .find(|codec| {
            codec
                .get("codec_name")
                .and_then(Value::as_str)
                .is_some_and(|name| name.eq_ignore_ascii_case("avc"))
        })
        .or_else(|| codecs.first())
}

fn combine_stream_url(host: Option<&str>, base_url: &str, extra: Option<&str>) -> Option<String> {
    let base = if base_url.starts_with("http://") || base_url.starts_with("https://") {
        base_url.to_string()
    } else {
        let host = normalize_url_text(host?.trim());
        if host.is_empty() {
            return None;
        }
        let base = if base_url.starts_with('/') {
            base_url.to_string()
        } else {
            format!("/{base_url}")
        };
        format!("{}{base}", host.trim_end_matches('/'))
    };
    let normalized = normalize_url_text(&base);
    if !normalized.starts_with("https://") {
        return None;
    }
    let extra = extra.unwrap_or_default().trim();
    if extra.is_empty() {
        Some(normalized)
    } else {
        let extra = extra.strip_prefix('?').unwrap_or(extra);
        if normalized.ends_with('?') {
            Some(format!("{normalized}{extra}"))
        } else if normalized.contains('?') {
            Some(format!("{normalized}&{extra}"))
        } else {
            Some(format!("{normalized}?{extra}"))
        }
    }
}

fn protocol_slug(protocol: StreamProtocol) -> &'static str {
    match protocol {
        StreamProtocol::Hls => "hls",
        StreamProtocol::Flv => "flv",
        StreamProtocol::Dash => "dash",
        StreamProtocol::Mp4 => "mp4",
    }
}

fn quality_label(quality_id: i64) -> String {
    match quality_id {
        0 => "默认".to_string(),
        80 => "流畅".to_string(),
        150 => "高清".to_string(),
        250 => "超清".to_string(),
        400 => "蓝光".to_string(),
        10000 => "原画".to_string(),
        20000 => "4K".to_string(),
        30000 => "杜比视界".to_string(),
        value => format!("QN {value}"),
    }
}

fn parse_live_status(value: &Value) -> Option<LiveStatus> {
    match value {
        Value::Bool(value) => Some(if *value {
            LiveStatus::Live
        } else {
            LiveStatus::Offline
        }),
        Value::Number(value) => match value.as_i64() {
            Some(1) => Some(LiveStatus::Live),
            Some(0) => Some(LiveStatus::Offline),
            Some(2) => Some(LiveStatus::Round),
            _ => Some(LiveStatus::Unknown),
        },
        Value::String(value) => match value.as_str() {
            "1" | "live" => Some(LiveStatus::Live),
            "0" | "offline" => Some(LiveStatus::Offline),
            "2" | "round" => Some(LiveStatus::Round),
            _ => Some(LiveStatus::Unknown),
        },
        _ => None,
    }
}

fn room_text(room: &Value, key: &str) -> Result<String, String> {
    room.get(key)
        .and_then(Value::as_str)
        .map(clean_text)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| format!("missing live room {key}"))
}

fn value_id(value: Option<&Value>) -> Option<String> {
    let value = value?;
    if let Some(value) = value.as_i64() {
        return Some(value.to_string());
    }
    if let Some(value) = value.as_u64() {
        return Some(value.to_string());
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
    strip_html_tags(value).trim().to_string()
}

fn strip_html_tags(value: &str) -> String {
    value
        .chars()
        .fold(
            (String::new(), false),
            |(mut output, in_tag), character| match character {
                '<' => (output, true),
                '>' => (output, false),
                _ if !in_tag => {
                    output.push(character);
                    (output, false)
                }
                _ => (output, true),
            },
        )
        .0
}

fn normalize_url_text(value: &str) -> String {
    if value.starts_with("//") {
        format!("https:{value}")
    } else if value.starts_with("http://") {
        value.replacen("http://", "https://", 1)
    } else {
        value.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn discovery_fixture_is_grouped_and_normalized() {
        let root: Value = serde_json::from_str(include_str!(
            "../tests/fixtures/bilibili/live/discovery.json"
        ))
        .unwrap();
        let discovery = parse_discovery(&root).unwrap();

        assert_eq!(discovery.sections.len(), 2);
        assert_eq!(discovery.sections[0].title, "推荐直播");
        assert_eq!(discovery.sections[0].rooms.len(), 2);
        assert_eq!(
            discovery.sections[0].rooms[0].cover_url.as_deref(),
            Some("https://example.invalid/live-cover.jpg")
        );
        assert_eq!(discovery.sections[1].rooms[0].room_id, "2002");
    }

    #[test]
    fn search_fixture_preserves_pagination_and_cleans_highlight_tags() {
        let root: Value =
            serde_json::from_str(include_str!("../tests/fixtures/bilibili/live/search.json"))
                .unwrap();
        let page = parse_search(&root, 1).unwrap();

        assert_eq!(page.page, 1);
        assert_eq!(page.total, 35);
        assert_eq!(page.items.len(), 2);
        assert!(page.has_more);
        assert_eq!(page.items[0].area_name.as_deref(), Some("英雄联盟"));
        assert_eq!(page.items[0].online, 12345);
    }

    #[test]
    fn room_fixture_maps_status_anchor_and_tags() {
        let root: Value = serde_json::from_str(include_str!(
            "../tests/fixtures/bilibili/live/room-info.json"
        ))
        .unwrap();
        let room = parse_room_info(&root, "1001").unwrap();

        assert_eq!(room.room_id, "1001");
        assert_eq!(room.live_status, LiveStatus::Live);
        assert_eq!(room.anchor_name, "Fixture anchor");
        assert_eq!(room.tags, vec!["tag one", "tag two"]);
        assert_eq!(room.started_at, Some(1_700_000_000));
    }

    #[test]
    fn playback_fixture_prefers_avc_and_builds_hls_and_flv_urls() {
        let root: Value = serde_json::from_str(include_str!(
            "../tests/fixtures/bilibili/live/room-play.json"
        ))
        .unwrap();
        let playback = parse_playback(&root, "1001").unwrap();

        assert_eq!(playback.live_status, LiveStatus::Live);
        assert_eq!(playback.streams.len(), 2);
        assert_eq!(playback.streams[0].protocol, StreamProtocol::Flv);
        assert_eq!(playback.streams[1].protocol, StreamProtocol::Hls);
        assert_eq!(playback.streams[0].codec.as_deref(), Some("avc"));
        assert_eq!(playback.streams[0].quality_id, 250);
        assert_eq!(
            playback.streams[0].url,
            "https://example.invalid/live/stream.flv?token=fixture"
        );
        assert_eq!(
            playback.streams[0].backup_urls,
            vec!["https://backup.example.invalid/live/stream.flv?token=fixture"]
        );
        assert!(playback
            .advertised_qualities
            .iter()
            .any(|quality| quality.id == 10_000));
    }

    #[test]
    fn offline_playback_can_return_no_sources() {
        let root = serde_json::json!({
            "data": {
                "room_id": 1001,
                "live_status": 0
            }
        });
        let playback = parse_playback(&root, "1001").unwrap();

        assert_eq!(playback.live_status, LiveStatus::Offline);
        assert!(playback.streams.is_empty());
        assert!(playback.current_quality.is_none());
    }

    #[test]
    fn stream_url_join_does_not_duplicate_query_markers() {
        assert_eq!(
            combine_stream_url(
                Some("https://example.invalid"),
                "/live/stream.flv?",
                Some("expires=fixture&sig=fixture"),
            ),
            Some("https://example.invalid/live/stream.flv?expires=fixture&sig=fixture".to_string())
        );
        assert_eq!(
            combine_stream_url(
                Some("https://example.invalid"),
                "/live/stream.flv",
                Some("?expires=fixture&sig=fixture"),
            ),
            Some("https://example.invalid/live/stream.flv?expires=fixture&sig=fixture".to_string())
        );
    }
}
