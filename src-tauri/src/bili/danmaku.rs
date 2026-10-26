use std::collections::BTreeMap;

use prost::Message;
use quick_xml::{events::Event, Reader};
use reqwest::header::{ACCEPT, COOKIE};
use serde::{Deserialize, Serialize};
use tokio::task::JoinSet;

use super::{client::BiliClient, error::BiliError};

const DANMAKU_SEGMENT_URL: &str = "https://api.bilibili.com/x/v2/dm/web/seg.so";
const DANMAKU_SEGMENT_SECONDS: u64 = 6 * 60;
const DANMAKU_SEGMENT_CONCURRENCY: usize = 6;
const MAX_DANMAKU_SEGMENTS: usize = 100;
const MAX_DANMAKU: usize = 30_000;

#[derive(Clone, PartialEq, Message)]
struct DanmakuSegmentReply {
    #[prost(message, repeated, tag = "1")]
    elems: Vec<DanmakuElem>,
}

#[derive(Clone, PartialEq, Message)]
struct DanmakuElem {
    #[prost(int32, tag = "2")]
    progress: i32,
    #[prost(int32, tag = "3")]
    mode: i32,
    #[prost(int32, tag = "4")]
    fontsize: i32,
    #[prost(uint32, tag = "5")]
    color: u32,
    #[prost(string, tag = "7")]
    content: String,
}

#[derive(Deserialize)]
struct DanmakuErrorEnvelope {
    code: i64,
    #[serde(default)]
    message: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DanmakuItem {
    pub progress_ms: u64,
    pub mode: u8,
    pub size: u16,
    pub color: u32,
    pub text: String,
}

impl BiliClient {
    pub async fn danmaku(
        &self,
        cid: u64,
        duration_seconds: u64,
    ) -> Result<Vec<DanmakuItem>, BiliError> {
        if cid == 0 {
            return Err(BiliError::InvalidInput("cid must be positive"));
        }

        let segment_count = duration_seconds
            .max(1)
            .div_ceil(DANMAKU_SEGMENT_SECONDS)
            .min(MAX_DANMAKU_SEGMENTS as u64) as usize;
        let cookie_header = self.search_cookie_header().await.ok();
        let mut successful_segments = 0;
        let mut first_error = None;
        let mut items = Vec::new();

        'segments: for chunk_start in (1..=segment_count).step_by(DANMAKU_SEGMENT_CONCURRENCY) {
            let chunk_end = (chunk_start + DANMAKU_SEGMENT_CONCURRENCY - 1).min(segment_count);
            let mut tasks = JoinSet::new();

            for segment_index in chunk_start..=chunk_end {
                tasks.spawn(fetch_danmaku_segment(
                    self.http.clone(),
                    cid,
                    segment_index as u64,
                    cookie_header.clone(),
                ));
            }

            while let Some(result) = tasks.join_next().await {
                match result {
                    Ok(Ok(mut segment)) => {
                        successful_segments += 1;
                        items.append(&mut segment);
                        if items.len() >= MAX_DANMAKU {
                            items.truncate(MAX_DANMAKU);
                            break 'segments;
                        }
                    }
                    Ok(Err(error)) => {
                        if first_error.is_none() {
                            first_error = Some(error);
                        }
                    }
                    Err(_) => {
                        if first_error.is_none() {
                            first_error =
                                Some(BiliError::InvalidResponse("danmaku segment task failed"));
                        }
                    }
                }
            }

            if chunk_start == 1 && successful_segments == 0 {
                return Err(first_error.unwrap_or(BiliError::InvalidResponse(
                    "danmaku segment response was empty",
                )));
            }
        }

        if successful_segments == 0 {
            return Err(first_error.unwrap_or(BiliError::InvalidResponse(
                "danmaku segment response was empty",
            )));
        }

        items.sort_by_key(|item| item.progress_ms);
        Ok(items)
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn send_danmaku(
        &self,
        aid: u64,
        cid: u64,
        bvid: &str,
        message: &str,
        progress_ms: u64,
        mode: u8,
        color: u32,
        font_size: u16,
    ) -> Result<String, BiliError> {
        super::client::validate_bvid(bvid)?;
        let message = message.trim();
        let char_count = message.chars().count();
        if message.is_empty() || char_count > 100 {
            return Err(BiliError::InvalidInput(
                "danmaku must contain 1 to 100 characters",
            ));
        }
        if !matches!(mode, 1 | 4 | 5) {
            return Err(BiliError::InvalidInput("unsupported danmaku mode"));
        }
        if !matches!(font_size, 18 | 25 | 36) {
            return Err(BiliError::InvalidInput("unsupported danmaku font size"));
        }
        if color > 0xFF_FF_FF {
            return Err(BiliError::InvalidInput("invalid danmaku color"));
        }

        let rnd = super::wbi::unix_timestamp();
        let form = BTreeMap::from([
            ("type".to_owned(), "1".to_owned()),
            ("aid".to_owned(), aid.to_string()),
            ("oid".to_owned(), cid.to_string()),
            ("bvid".to_owned(), bvid.to_owned()),
            ("msg".to_owned(), message.to_owned()),
            ("progress".to_owned(), progress_ms.to_string()),
            ("mode".to_owned(), mode.to_string()),
            ("color".to_owned(), color.to_string()),
            ("fontsize".to_owned(), font_size.to_string()),
            ("pool".to_owned(), "0".to_owned()),
            ("plat".to_owned(), "1".to_owned()),
            ("rnd".to_owned(), rnd.to_string()),
        ]);
        let data = self.post_authenticated_form("/x/v2/dm/post", form).await?;
        let id = data
            .get("dmid_str")
            .and_then(serde_json::Value::as_str)
            .map(str::to_owned)
            .or_else(|| {
                data.get("dmid")
                    .and_then(serde_json::Value::as_u64)
                    .map(|value| value.to_string())
            })
            .ok_or(BiliError::InvalidResponse("missing danmaku id"))?;
        Ok(id)
    }
}

async fn fetch_danmaku_segment(
    http: reqwest::Client,
    cid: u64,
    segment_index: u64,
    cookie_header: Option<String>,
) -> Result<Vec<DanmakuItem>, BiliError> {
    let mut request = http
        .get(DANMAKU_SEGMENT_URL)
        .header(ACCEPT, "application/octet-stream")
        .query(&[
            ("type", "1".to_owned()),
            ("oid", cid.to_string()),
            ("segment_index", segment_index.to_string()),
        ]);
    if let Some(cookie_header) = cookie_header {
        request = request.header(COOKIE, cookie_header);
    }

    let response = request.send().await?;
    let status = response.status();
    if !status.is_success() {
        return Err(BiliError::HttpStatus(status.as_u16()));
    }
    let bytes = response.bytes().await?;
    parse_response(&bytes)
}

pub fn parse_response(bytes: &[u8]) -> Result<Vec<DanmakuItem>, BiliError> {
    match bytes.first() {
        Some(b'<') => parse_xml(bytes),
        Some(b'{') => {
            let envelope: DanmakuErrorEnvelope = serde_json::from_slice(bytes)
                .map_err(|_| BiliError::InvalidResponse("invalid danmaku error response"))?;
            Err(BiliError::Upstream {
                code: envelope.code,
                message: envelope.message.chars().take(160).collect(),
            })
        }
        _ => parse_protobuf(bytes),
    }
}

fn parse_protobuf(bytes: &[u8]) -> Result<Vec<DanmakuItem>, BiliError> {
    let reply = DanmakuSegmentReply::decode(bytes)
        .map_err(|_| BiliError::InvalidResponse("invalid danmaku protobuf"))?;
    let mut items = reply
        .elems
        .into_iter()
        .filter_map(build_protobuf_item)
        .take(MAX_DANMAKU)
        .collect::<Vec<_>>();
    items.sort_by_key(|item| item.progress_ms);
    Ok(items)
}

fn build_protobuf_item(elem: DanmakuElem) -> Option<DanmakuItem> {
    normalize_item(
        u64::try_from(elem.progress).ok()?,
        u8::try_from(elem.mode).ok()?,
        u16::try_from(elem.fontsize).ok()?,
        elem.color,
        &elem.content,
    )
}

fn parse_xml(xml: &[u8]) -> Result<Vec<DanmakuItem>, BiliError> {
    let mut reader = Reader::from_reader(xml);
    reader.config_mut().trim_text(false);
    let mut buffer = Vec::new();
    let mut current: Option<String> = None;
    let mut items = Vec::new();

    loop {
        match reader.read_event_into(&mut buffer) {
            Ok(Event::Start(event)) if event.name().as_ref() == "d" => {
                current = event
                    .try_get_attribute("p")
                    .map_err(|_| BiliError::InvalidResponse("invalid danmaku attribute"))?
                    .map(|attribute| attribute.value.to_string());
            }
            Ok(Event::Text(text)) if current.is_some() => {
                let content = text.as_ref().to_owned();
                if let Some(item) = current.take().and_then(|meta| build_item(&meta, &content)) {
                    items.push(item);
                    if items.len() >= MAX_DANMAKU {
                        break;
                    }
                }
            }
            Ok(Event::End(event)) if event.name().as_ref() == "d" => {
                current = None;
            }
            Ok(Event::Eof) => break,
            Err(_) => return Err(BiliError::InvalidResponse("invalid danmaku XML")),
            _ => {}
        }
        buffer.clear();
    }
    items.sort_by_key(|item| item.progress_ms);
    Ok(items)
}

fn build_item(meta: &str, raw_text: &str) -> Option<DanmakuItem> {
    let mut parts = meta.split(',');
    let progress_seconds = parts.next()?.parse::<f64>().ok()?;
    let mode = parts.next()?.parse::<u8>().ok()?;
    let size = parts.next()?.parse::<u16>().ok()?;
    let color = parts.next()?.parse::<u32>().ok()?;
    if !progress_seconds.is_finite() || progress_seconds < 0.0 {
        return None;
    }
    normalize_item(
        (progress_seconds * 1000.0).round().min(u64::MAX as f64) as u64,
        mode,
        size,
        color,
        raw_text,
    )
}

fn normalize_item(
    progress_ms: u64,
    mode: u8,
    size: u16,
    color: u32,
    raw_text: &str,
) -> Option<DanmakuItem> {
    if !matches!(mode, 1..=5) {
        return None;
    }
    let text = raw_text
        .chars()
        .filter(|character| *character == '\t' || !character.is_control())
        .take(200)
        .collect::<String>();
    if text.trim().is_empty() {
        return None;
    }
    Some(DanmakuItem {
        progress_ms,
        mode,
        size: size.clamp(12, 64),
        color: color & 0xFF_FF_FF,
        text,
    })
}

#[cfg(test)]
mod tests {
    use super::{build_item, parse_response, parse_xml};
    use crate::bili::error::BiliError;

    #[test]
    fn parses_and_sorts_supported_danmaku_modes() {
        let xml = br#"<?xml version="1.0"?><i>
            <d p="3.5,1,25,16777215,1,0,x,1,10">rolling</d>
            <d p="1.0,5,25,16711680,1,0,x,2,10">top</d>
            <d p="2.0,4,18,255,1,0,x,3,10">bottom</d>
            <d p="2.5,7,25,16777215,1,0,x,4,10">special</d>
            <d p="4.0,1,25,16777215,1,0,x,5,10">   </d>
        </i>"#;
        let items = parse_xml(xml).expect("danmaku XML");
        assert_eq!(items.len(), 3);
        assert_eq!(items[0].progress_ms, 1000);
        assert_eq!(items[1].mode, 4);
        assert_eq!(items[2].text, "rolling");
    }

    #[test]
    fn rejects_invalid_metadata_and_bounds_colors() {
        assert!(build_item("bad", "text").is_none());
        assert!(build_item("1,9,25,0,0,0,id,0,0", "text").is_none());
        let item =
            build_item("1,1,999,4294967295,0,0,id,0,0", " text\x01 ").expect("normalized item");
        assert_eq!(item.size, 64);
        assert_eq!(item.color, 0xFF_FF_FF);
        assert_eq!(item.text, " text ");
    }

    #[test]
    fn parses_protobuf_segments_and_drops_unsupported_modes() {
        let bytes = [
            0x0A, 0x12, 0x10, 0xE8, 0x07, 0x18, 0x01, 0x20, 0x19, 0x28, 0xFF, 0xFF, 0x7F, 0x3A,
            0x05, b'h', b'e', b'l', b'l', b'o', 0x0A, 0x0F, 0x10, 0xD0, 0x0F, 0x18, 0x07, 0x20,
            0x19, 0x28, 0x00, 0x3A, 0x04, b's', b'k', b'i', b'p',
        ];

        let items = parse_response(&bytes).expect("protobuf danmaku");
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].progress_ms, 1000);
        assert_eq!(items[0].mode, 1);
        assert_eq!(items[0].text, "hello");
    }

    #[test]
    fn reports_json_errors_from_binary_endpoints() {
        let result = parse_response(br#"{"code":-352,"message":"risk control"}"#);
        assert!(matches!(
            result,
            Err(BiliError::Upstream {
                code: -352,
                ref message
            }) if message == "risk control"
        ));
    }
}
