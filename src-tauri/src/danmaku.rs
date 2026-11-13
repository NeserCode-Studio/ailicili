use std::fmt;

use crate::domain::{DanmakuItem, DanmakuMode};

pub const MAX_SEGMENT_BYTES: usize = 4 * 1024 * 1024;
pub const MAX_SEGMENT_ITEMS: usize = 20_000;
pub const MAX_SEGMENT_INDEX: u32 = 1_000;

const MAX_TEXT_CHARS: usize = 200;
const MAX_ID_CHARS: usize = 32;
const DEFAULT_FONT_SIZE: u16 = 25;
const DEFAULT_COLOR: u32 = 0x00FF_FFFF;

#[derive(Debug)]
pub struct ParseError(&'static str);

impl fmt::Display for ParseError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.0)
    }
}

#[derive(Debug, Default)]
pub struct ParsedSegment {
    pub items: Vec<DanmakuItem>,
    pub skipped_count: u32,
}

pub fn parse_video_segment(data: &[u8]) -> Result<ParsedSegment, ParseError> {
    if data.len() > MAX_SEGMENT_BYTES {
        return Err(ParseError("danmaku segment is too large"));
    }

    let mut reader = Reader::new(data);
    let mut parsed = ParsedSegment::default();
    while !reader.is_empty() {
        let key = reader.read_key()?;
        let field = key >> 3;
        let wire_type = key & 0x07;
        if field == 0 {
            return Err(ParseError("protobuf field number is zero"));
        }

        if field == 1 {
            if wire_type != WIRE_LENGTH_DELIMITED {
                return Err(ParseError("danmaku element has invalid wire type"));
            }
            let element = reader.read_bytes()?;
            match parse_element(element) {
                Ok(Some(item)) => {
                    if parsed.items.len() >= MAX_SEGMENT_ITEMS {
                        return Err(ParseError("danmaku segment has too many items"));
                    }
                    parsed.items.push(item);
                }
                Ok(None) | Err(_) => {
                    parsed.skipped_count = parsed.skipped_count.saturating_add(1);
                }
            }
        } else {
            reader.skip(wire_type)?;
        }
    }

    parsed.items.sort_by(|left, right| {
        left.time_ms
            .cmp(&right.time_ms)
            .then(left.id.cmp(&right.id))
    });
    Ok(parsed)
}

fn parse_element(data: &[u8]) -> Result<Option<DanmakuItem>, ParseError> {
    let mut reader = Reader::new(data);
    let mut numeric_id = None;
    let mut string_id = None;
    let mut time_ms = None;
    let mut mode = None;
    let mut font_size = DEFAULT_FONT_SIZE;
    let mut color = DEFAULT_COLOR;
    let mut text = None;

    while !reader.is_empty() {
        let key = reader.read_key()?;
        let field = key >> 3;
        let wire_type = key & 0x07;
        match (field, wire_type) {
            (1, WIRE_VARINT) => numeric_id = Some(reader.read_varint()?.to_string()),
            (2, WIRE_VARINT) => {
                let value = reader.read_varint()?;
                if value <= i32::MAX as u64 {
                    time_ms = Some(value as i64);
                }
            }
            (3, WIRE_VARINT) => {
                mode = danmaku_mode(reader.read_varint()?);
            }
            (4, WIRE_VARINT) => {
                let value = reader.read_varint()?;
                if (12..=64).contains(&value) {
                    font_size = value as u16;
                }
            }
            (5, WIRE_VARINT) => {
                let value = reader.read_varint()?;
                color = (value as u32) & 0x00FF_FFFF;
            }
            (7, WIRE_LENGTH_DELIMITED) => {
                let value = reader.read_utf8()?;
                let normalized = normalize_text(value);
                if !normalized.is_empty() {
                    text = Some(normalized);
                }
            }
            (12, WIRE_LENGTH_DELIMITED) => {
                let value = reader.read_utf8()?.trim();
                if is_valid_id(value) {
                    string_id = Some(value.to_string());
                }
            }
            (_, wire_type) => reader.skip(wire_type)?,
        }
    }

    let Some(mode) = mode else {
        return Ok(None);
    };
    let Some(text) = text else {
        return Ok(None);
    };
    let Some(time_ms) = time_ms else {
        return Ok(None);
    };
    let Some(id) = string_id.or(numeric_id) else {
        return Ok(None);
    };

    Ok(Some(DanmakuItem {
        id,
        text,
        time_ms,
        mode,
        font_size,
        color,
    }))
}

fn danmaku_mode(value: u64) -> Option<DanmakuMode> {
    match value {
        1..=3 | 6 => Some(DanmakuMode::Scroll),
        4 => Some(DanmakuMode::Bottom),
        5 => Some(DanmakuMode::Top),
        _ => None,
    }
}

fn normalize_text(value: &str) -> String {
    let mut normalized = String::new();
    let mut previous_was_space = false;
    for character in value.trim().chars().take(MAX_TEXT_CHARS) {
        let character = if character.is_control() || character.is_whitespace() {
            ' '
        } else {
            character
        };
        if character == ' ' {
            if previous_was_space {
                continue;
            }
            previous_was_space = true;
        } else {
            previous_was_space = false;
        }
        normalized.push(character);
    }
    normalized.trim_end().to_string()
}

fn is_valid_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_ID_CHARS
        && value.bytes().all(|byte| byte.is_ascii_digit())
}

const WIRE_VARINT: u64 = 0;
const WIRE_FIXED_64: u64 = 1;
const WIRE_LENGTH_DELIMITED: u64 = 2;
const WIRE_FIXED_32: u64 = 5;

struct Reader<'a> {
    data: &'a [u8],
    offset: usize,
}

impl<'a> Reader<'a> {
    fn new(data: &'a [u8]) -> Self {
        Self { data, offset: 0 }
    }

    fn is_empty(&self) -> bool {
        self.offset == self.data.len()
    }

    fn read_key(&mut self) -> Result<u64, ParseError> {
        self.read_varint()
    }

    fn read_varint(&mut self) -> Result<u64, ParseError> {
        let mut value = 0_u64;
        for index in 0..10 {
            let byte = *self
                .data
                .get(self.offset)
                .ok_or(ParseError("truncated protobuf varint"))?;
            self.offset += 1;
            if index == 9 && byte > 1 {
                return Err(ParseError("protobuf varint overflow"));
            }
            value |= u64::from(byte & 0x7F) << (index * 7);
            if byte & 0x80 == 0 {
                return Ok(value);
            }
        }
        Err(ParseError("protobuf varint overflow"))
    }

    fn read_bytes(&mut self) -> Result<&'a [u8], ParseError> {
        let length = self.read_varint()?;
        let length = usize::try_from(length).map_err(|_| ParseError("protobuf length overflow"))?;
        let end = self
            .offset
            .checked_add(length)
            .ok_or(ParseError("protobuf length overflow"))?;
        let bytes = self
            .data
            .get(self.offset..end)
            .ok_or(ParseError("truncated protobuf bytes"))?;
        self.offset = end;
        Ok(bytes)
    }

    fn read_utf8(&mut self) -> Result<&'a str, ParseError> {
        std::str::from_utf8(self.read_bytes()?)
            .map_err(|_| ParseError("protobuf string is not valid UTF-8"))
    }

    fn skip(&mut self, wire_type: u64) -> Result<(), ParseError> {
        match wire_type {
            WIRE_VARINT => {
                self.read_varint()?;
            }
            WIRE_FIXED_64 => self.advance(8)?,
            WIRE_LENGTH_DELIMITED => {
                self.read_bytes()?;
            }
            WIRE_FIXED_32 => self.advance(4)?,
            _ => return Err(ParseError("unsupported protobuf wire type")),
        }
        Ok(())
    }

    fn advance(&mut self, length: usize) -> Result<(), ParseError> {
        self.offset = self
            .offset
            .checked_add(length)
            .filter(|end| *end <= self.data.len())
            .ok_or(ParseError("truncated protobuf field"))?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::DanmakuSegment;

    fn varint(mut value: u64) -> Vec<u8> {
        let mut bytes = Vec::new();
        loop {
            let mut byte = (value & 0x7F) as u8;
            value >>= 7;
            if value != 0 {
                byte |= 0x80;
            }
            bytes.push(byte);
            if value == 0 {
                return bytes;
            }
        }
    }

    fn field_varint(field: u64, value: u64) -> Vec<u8> {
        let mut bytes = varint(field << 3);
        bytes.extend(varint(value));
        bytes
    }

    fn field_bytes(field: u64, value: &[u8]) -> Vec<u8> {
        let mut bytes = varint((field << 3) | WIRE_LENGTH_DELIMITED);
        bytes.extend(varint(value.len() as u64));
        bytes.extend_from_slice(value);
        bytes
    }

    fn element() -> Vec<u8> {
        let mut bytes = field_varint(1, 42);
        bytes.extend(field_varint(2, 12_345));
        bytes.extend(field_varint(3, 5));
        bytes.extend(field_varint(4, 25));
        bytes.extend(field_varint(5, 0x112233));
        bytes.extend(field_bytes(7, "弹幕\n正文".as_bytes()));
        bytes.extend(field_bytes(12, b"9007199254740993"));
        bytes.extend(field_varint(99, 7));
        bytes
    }

    #[test]
    fn parses_known_fields_and_skips_unknown_fields() {
        let mut segment = field_varint(99, 7);
        segment.extend(field_bytes(1, &element()));
        let parsed = parse_video_segment(&segment).unwrap();
        assert_eq!(parsed.skipped_count, 0);
        assert_eq!(
            parsed.items,
            vec![DanmakuItem {
                id: "9007199254740993".to_string(),
                text: "弹幕 正文".to_string(),
                time_ms: 12_345,
                mode: DanmakuMode::Top,
                font_size: 25,
                color: 0x11_2233,
            }]
        );
    }

    #[test]
    fn skips_invalid_items_without_losing_valid_items() {
        let mut invalid = field_varint(2, 100);
        invalid.extend(field_bytes(7, b"missing identity"));
        let mut segment = field_bytes(1, &invalid);
        segment.extend(field_bytes(1, &element()));

        let parsed = parse_video_segment(&segment).unwrap();
        assert_eq!(parsed.items.len(), 1);
        assert_eq!(parsed.skipped_count, 1);
    }

    #[test]
    fn normalizes_and_truncates_text() {
        let text = format!("{}\n\t尾部", "字".repeat(MAX_TEXT_CHARS + 20));
        let mut element = field_varint(1, 1);
        element.extend(field_varint(2, 0));
        element.extend(field_varint(3, 1));
        element.extend(field_bytes(7, text.as_bytes()));

        let parsed = parse_video_segment(&field_bytes(1, &element)).unwrap();
        assert_eq!(parsed.items[0].text.chars().count(), MAX_TEXT_CHARS);
        assert!(!parsed.items[0].text.contains('\n'));
    }

    #[test]
    fn rejects_truncated_segment() {
        let error = parse_video_segment(&[0x0A, 0x05, 0x01]).unwrap_err();
        assert_eq!(error.to_string(), "truncated protobuf bytes");
    }

    #[test]
    fn rejects_varint_overflow() {
        let bytes = [0x80; 11];
        let error = parse_video_segment(&bytes).unwrap_err();
        assert_eq!(error.to_string(), "protobuf varint overflow");
    }

    #[test]
    fn rejects_oversized_segment_before_parsing() {
        let error = parse_video_segment(&vec![0; MAX_SEGMENT_BYTES + 1]).unwrap_err();
        assert_eq!(error.to_string(), "danmaku segment is too large");
    }

    #[test]
    fn maps_supported_modes_and_skips_advanced_modes() {
        assert_eq!(danmaku_mode(1), Some(DanmakuMode::Scroll));
        assert_eq!(danmaku_mode(4), Some(DanmakuMode::Bottom));
        assert_eq!(danmaku_mode(5), Some(DanmakuMode::Top));
        assert_eq!(danmaku_mode(6), Some(DanmakuMode::Scroll));
        assert_eq!(danmaku_mode(7), None);
    }

    #[test]
    fn rejects_segments_above_the_item_limit() {
        let mut element = field_varint(1, 1);
        element.extend(field_varint(2, 0));
        element.extend(field_varint(3, 1));
        element.extend(field_bytes(7, b"limit"));
        let mut segment = Vec::new();
        for _ in 0..=MAX_SEGMENT_ITEMS {
            segment.extend(field_bytes(1, &element));
        }

        let error = parse_video_segment(&segment).unwrap_err();
        assert_eq!(error.to_string(), "danmaku segment has too many items");
    }

    #[test]
    fn serializes_the_frontend_danmaku_contract() {
        let segment = DanmakuSegment {
            cid: 42,
            segment_index: 2,
            items: vec![DanmakuItem {
                id: "9007199254740993".to_string(),
                text: "camelCase".to_string(),
                time_ms: 360_000,
                mode: DanmakuMode::Top,
                font_size: 25,
                color: 0x11_2233,
            }],
            ended: false,
            skipped_count: 1,
        };
        let value = serde_json::to_value(segment).unwrap();

        assert_eq!(value["segmentIndex"], 2);
        assert_eq!(value["skippedCount"], 1);
        assert_eq!(value["items"][0]["timeMs"], 360_000);
        assert_eq!(value["items"][0]["fontSize"], 25);
        assert_eq!(value["items"][0]["mode"], "top");
        assert_eq!(value["items"][0]["id"], "9007199254740993");
    }
}
