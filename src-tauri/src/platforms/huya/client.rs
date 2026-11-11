use std::{
    collections::HashMap,
    io::Read,
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use flate2::read::GzDecoder;
use md5::{Digest, Md5};
use reqwest::{
    header::{HeaderMap, ACCEPT, ACCEPT_ENCODING, CONTENT_ENCODING, REFERER},
    Response, Url,
};
use uuid::Uuid;

use super::{
    mapper,
    media::{fetch_media_response, validate_media_url},
    HuyaError,
};
use crate::domain::{LiveDiscovery, LivePlaybackInfo, LiveRoomInfo, StreamProtocol, StreamSource};

const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const HOME_URL: &str = "https://www.huya.com/";
const ROOM_BASE_URL: &str = "https://www.huya.com/";
const REQUEST_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(15);
const MEDIA_CONNECT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(15);
const MAX_HTML_RESPONSE_BYTES: usize = 4 * 1024 * 1024;
const MAX_PLAYLIST_RESPONSE_BYTES: usize = 2 * 1024 * 1024;
const MAX_ROOM_ID_LENGTH: usize = 32;
const MAX_STREAM_BINDINGS: usize = 512;
const MAX_CONSUMED_PLAYLISTS: usize = 512;
const CONSUMED_PLAYLIST_TTL: Duration = Duration::from_secs(300);
const PLAYLIST_REFRESH_ATTEMPTS: usize = 2;
const PLAYLIST_REFRESH_DELAY: Duration = Duration::from_millis(1_100);
const WEB_SIGNATURE_AHEAD_MS: u64 = 110_624;
const WEB_SIGNATURE_TTL: u64 = 100;
const WEB_SIGNATURE_SDK_VERSION: &str = "2403051612";

pub(crate) struct HuyaClient {
    http: reqwest::Client,
    media_http: reqwest::Client,
    room_request_sequence: AtomicU64,
    signature_sequence: AtomicU64,
    stream_rooms: Mutex<HashMap<String, String>>,
    consumed_playlists: Mutex<HashMap<String, Instant>>,
}

impl HuyaClient {
    pub(crate) fn new() -> Result<Self, reqwest::Error> {
        let http = reqwest::Client::builder()
            .user_agent(USER_AGENT)
            .timeout(REQUEST_TIMEOUT)
            .redirect(reqwest::redirect::Policy::none())
            .build()?;
        let media_http = reqwest::Client::builder()
            .user_agent(USER_AGENT)
            .connect_timeout(MEDIA_CONNECT_TIMEOUT)
            .redirect(reqwest::redirect::Policy::none())
            .build()?;
        Ok(Self {
            http,
            media_http,
            room_request_sequence: AtomicU64::new(1),
            signature_sequence: AtomicU64::new(1),
            stream_rooms: Mutex::new(HashMap::new()),
            consumed_playlists: Mutex::new(HashMap::new()),
        })
    }

    pub(crate) async fn discover(&self) -> Result<LiveDiscovery, HuyaError> {
        let html = self.get_html(HOME_URL).await?;
        mapper::parse_discovery(&html)
    }

    pub(crate) async fn room_info(&self, room_id: &str) -> Result<LiveRoomInfo, HuyaError> {
        let room_id = normalize_room_id(room_id)?;
        let html = self.get_room_html(&room_id).await?;
        mapper::parse_room_info(&html, &room_id)
    }

    pub(crate) async fn room_playback(
        &self,
        room_id: &str,
        quality: i64,
    ) -> Result<LivePlaybackInfo, HuyaError> {
        let room_id = normalize_room_id(room_id)?;
        let html = self.get_room_html_fresh(&room_id).await?;
        let playback = mapper::parse_playback(&html, &room_id, quality)?;
        self.remember_playback(&room_id, &playback);
        Ok(playback)
    }

    pub(crate) async fn media_response(
        &self,
        url: &str,
        request_headers: &HeaderMap,
    ) -> Result<Response, HuyaError> {
        let url = validate_media_url(url)?;
        let playlist = hls_stream_name(&url).and_then(|stream_name| {
            self.room_for_stream(&stream_name)
                .map(|room_id| (stream_name, room_id))
        });

        if let Some((_, room_id)) = playlist.as_ref() {
            if self.was_consumed(url.as_str()) {
                return match self
                    .fetch_signed_media_response(&url, request_headers)
                    .await
                {
                    Ok(response) => Ok(response),
                    Err(HuyaError::MediaExpired(status)) => self
                        .refresh_playlist_response(room_id, &url, request_headers)
                        .await
                        .map_err(|error| match error {
                            HuyaError::MediaExpired(_) => HuyaError::MediaExpired(status),
                            other => other,
                        }),
                    Err(error) => Err(error),
                };
            }
            self.mark_consumed(url.as_str());
        }

        match self
            .fetch_signed_media_response(&url, request_headers)
            .await
        {
            Ok(response) => Ok(response),
            Err(HuyaError::MediaExpired(status)) => match playlist.as_ref() {
                Some((_, room_id)) => {
                    self.refresh_playlist_response(room_id, &url, request_headers)
                        .await
                }
                None => Err(HuyaError::MediaExpired(status)),
            },
            Err(error) => Err(error),
        }
    }

    async fn fetch_signed_media_response(
        &self,
        original: &Url,
        request_headers: &HeaderMap,
    ) -> Result<Response, HuyaError> {
        let sequence = self.signature_sequence.fetch_add(1, Ordering::Relaxed);
        let timestamp_ms = unix_timestamp_ms();
        let entropy = Uuid::new_v4().as_u128() ^ u128::from(sequence);
        let signed = web_signed_media_url(original, timestamp_ms, entropy)
            .unwrap_or_else(|| original.clone());
        fetch_media_response(&self.media_http, signed, request_headers).await
    }

    async fn get_room_html(&self, room_id: &str) -> Result<String, HuyaError> {
        self.get_html(&format!("{ROOM_BASE_URL}{room_id}")).await
    }

    async fn get_room_html_fresh(&self, room_id: &str) -> Result<String, HuyaError> {
        let sequence = self.room_request_sequence.fetch_add(1, Ordering::Relaxed);
        self.get_html(&format!(
            "{ROOM_BASE_URL}{room_id}?_ailicili_refresh={sequence}"
        ))
        .await
    }

    fn remember_playback(&self, room_id: &str, playback: &LivePlaybackInfo) {
        let Ok(mut bindings) = self.stream_rooms.lock() else {
            return;
        };
        if bindings.len() >= MAX_STREAM_BINDINGS {
            bindings.clear();
        }
        for stream in &playback.streams {
            if stream.protocol != StreamProtocol::Hls {
                continue;
            }
            for url in std::iter::once(&stream.url).chain(stream.backup_urls.iter()) {
                let Ok(parsed) = Url::parse(url) else {
                    continue;
                };
                if let Some(stream_name) = hls_stream_name(&parsed) {
                    bindings.insert(stream_name, room_id.to_string());
                }
            }
        }
    }

    fn room_for_stream(&self, stream_name: &str) -> Option<String> {
        self.stream_rooms
            .lock()
            .ok()
            .and_then(|bindings| bindings.get(stream_name).cloned())
    }

    fn was_consumed(&self, url: &str) -> bool {
        let key = playlist_key(url);
        let Ok(mut consumed) = self.consumed_playlists.lock() else {
            return false;
        };
        let Some(seen_at) = consumed.get(&key).copied() else {
            return false;
        };
        if seen_at.elapsed() <= CONSUMED_PLAYLIST_TTL {
            return true;
        }
        consumed.remove(&key);
        false
    }

    fn mark_consumed(&self, url: &str) {
        let key = playlist_key(url);
        let Ok(mut consumed) = self.consumed_playlists.lock() else {
            return;
        };
        consumed.retain(|_, seen_at| seen_at.elapsed() <= CONSUMED_PLAYLIST_TTL);
        if consumed.len() >= MAX_CONSUMED_PLAYLISTS {
            consumed.clear();
        }
        consumed.insert(key, Instant::now());
    }

    async fn refresh_playlist_response(
        &self,
        room_id: &str,
        original: &Url,
        request_headers: &HeaderMap,
    ) -> Result<Response, HuyaError> {
        let stream_name = hls_stream_name(original)
            .ok_or_else(|| HuyaError::Invalid("Huya playlist has no stream name".to_string()))?;
        let cdn_key = media_cdn_key(original);
        let original_is_child = !is_huya_hls_master(original);
        let mut last_expired = None;

        for attempt in 0..PLAYLIST_REFRESH_ATTEMPTS {
            if attempt > 0 {
                tokio::time::sleep(PLAYLIST_REFRESH_DELAY).await;
            }
            let html = self.get_room_html_fresh(room_id).await?;
            let playback = mapper::parse_playback(&html, room_id, 0)?;
            let Some(candidate) =
                select_refreshed_playlist(&playback, &stream_name, &cdn_key, original.scheme())
            else {
                return Err(HuyaError::MediaExpired(403));
            };
            if self.was_consumed(candidate.as_str()) {
                continue;
            }

            self.mark_consumed(candidate.as_str());
            match self
                .fetch_signed_media_response(&candidate, request_headers)
                .await
            {
                Ok(master_or_level) if original_is_child => {
                    let child = first_child_playlist_url(master_or_level).await?;
                    self.mark_consumed(child.as_str());
                    match self
                        .fetch_signed_media_response(&child, request_headers)
                        .await
                    {
                        Ok(response) => return Ok(response),
                        Err(HuyaError::MediaExpired(status)) => {
                            last_expired = Some(status);
                        }
                        Err(error) => return Err(error),
                    }
                }
                Ok(response) => return Ok(response),
                Err(HuyaError::MediaExpired(status)) => {
                    last_expired = Some(status);
                }
                Err(error) => return Err(error),
            }
        }

        Err(last_expired
            .map(HuyaError::MediaExpired)
            .unwrap_or_else(|| HuyaError::MediaExpired(403)))
    }

    async fn get_html(&self, url: &str) -> Result<String, HuyaError> {
        let response = self
            .http
            .get(url)
            .header(ACCEPT, "text/html,application/xhtml+xml")
            .header(ACCEPT_ENCODING, "identity")
            .header(REFERER, HOME_URL)
            .header("accept-language", "zh-CN,zh;q=0.9,en;q=0.8")
            .send()
            .await?;
        let status = response.status();
        if !status.is_success() {
            return Err(HuyaError::Http(status.as_u16()));
        }
        read_text(response, MAX_HTML_RESPONSE_BYTES).await
    }
}

fn unix_timestamp_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(u128::from(u64::MAX)) as u64)
        .unwrap_or_default()
}

fn web_signed_media_url(url: &Url, timestamp_ms: u64, entropy: u128) -> Option<Url> {
    let stream_name = media_stream_name(url)?;
    let fm = query_value(url, "fm")?;
    let mut fs = query_value(url, "fs")?;
    let mut ctype = query_value(url, "ctype")?;
    let cdn = media_cdn_key(url);
    if matches!(cdn.as_str(), "tx" | "hw") {
        ctype = ctype.replace("tars_mp", "huya_webh5");
        fs = fs.replace("bhct", "bgct");
    }

    let decoded_fm = decode_base64(&fm)?;
    let decoded_fm = std::str::from_utf8(&decoded_fm).ok()?;
    let prefix = decoded_fm
        .split('_')
        .next()
        .filter(|value| !value.is_empty())?;
    let init_uuid =
        (((timestamp_ms % 10_000_000_000) * 1_000) + (entropy % 1_000) as u64) % 4_294_967_295;
    let uid = 1_400_000_000_000 + (entropy % 1_000_000) as u64;
    let seq_id = uid.saturating_add(timestamp_ms);
    let ws_time = format!(
        "{:x}",
        timestamp_ms.saturating_add(WEB_SIGNATURE_AHEAD_MS) / 1_000
    );
    let secret_hash = md5_hex(format!("{seq_id}|{ctype}|{WEB_SIGNATURE_TTL}"));
    let ws_secret = md5_hex(format!(
        "{prefix}_{uid}_{stream_name}_{secret_hash}_{ws_time}"
    ));
    let mut signed = url.clone();
    signed.set_query(None);
    {
        let mut query = signed.query_pairs_mut();
        query
            .append_pair("wsSecret", &ws_secret)
            .append_pair("wsTime", &ws_time)
            .append_pair("seqid", &seq_id.to_string())
            .append_pair("ctype", &ctype)
            .append_pair("ver", "1")
            .append_pair("fs", &fs)
            .append_pair("uuid", &init_uuid.to_string())
            .append_pair("u", &uid.to_string())
            .append_pair("t", &WEB_SIGNATURE_TTL.to_string())
            .append_pair("sv", WEB_SIGNATURE_SDK_VERSION)
            .append_pair("sdk_sid", &timestamp_ms.to_string())
            .append_pair("codec", "264")
            .append_pair("ratio", "");
    }
    Some(signed)
}

fn query_value(url: &Url, key: &str) -> Option<String> {
    url.query()?.split('&').find_map(|pair| {
        let (raw_key, raw_value) = pair.split_once('=').unwrap_or((pair, ""));
        (percent_decode(raw_key)? == key)
            .then(|| percent_decode(raw_value))
            .flatten()
    })
}

fn percent_decode(value: &str) -> Option<String> {
    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            let high = hex_value(*bytes.get(index + 1)?)?;
            let low = hex_value(*bytes.get(index + 2)?)?;
            decoded.push((high << 4) | low);
            index += 3;
        } else {
            decoded.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(decoded).ok()
}

fn hex_value(value: u8) -> Option<u8> {
    match value {
        b'0'..=b'9' => Some(value - b'0'),
        b'a'..=b'f' => Some(value - b'a' + 10),
        b'A'..=b'F' => Some(value - b'A' + 10),
        _ => None,
    }
}

fn decode_base64(value: &str) -> Option<Vec<u8>> {
    let mut output = Vec::with_capacity(value.len() * 3 / 4);
    let mut buffer = 0u32;
    let mut bits = 0u8;

    for byte in value.bytes() {
        let value = match byte {
            b'A'..=b'Z' => byte - b'A',
            b'a'..=b'z' => byte - b'a' + 26,
            b'0'..=b'9' => byte - b'0' + 52,
            b'+' | b'-' => 62,
            b'/' | b'_' => 63,
            b'=' => break,
            b' ' | b'\t' | b'\r' | b'\n' => continue,
            _ => return None,
        };
        buffer = (buffer << 6) | u32::from(value);
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            output.push(((buffer >> bits) & 0xff) as u8);
            buffer &= (1 << bits) - 1;
        }
    }

    Some(output)
}

fn md5_hex(value: impl AsRef<[u8]>) -> String {
    format!("{:x}", Md5::digest(value.as_ref()))
}

fn media_stream_name(url: &Url) -> Option<String> {
    let filename = url.path_segments()?.next_back()?;
    let suffix = if filename.ends_with(".m3u8") {
        ".m3u8"
    } else if filename.ends_with(".flv") {
        ".flv"
    } else {
        return None;
    };
    filename
        .strip_suffix(suffix)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn hls_stream_name(url: &Url) -> Option<String> {
    if !url.path().ends_with(".m3u8") {
        return None;
    }
    url.path_segments()?
        .next_back()?
        .strip_suffix(".m3u8")
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn playlist_key(url: &str) -> String {
    md5_hex(url)
}

fn is_huya_hls_master(url: &Url) -> bool {
    url.host_str()
        .map(|host| {
            let host = host.trim_end_matches('.').to_ascii_lowercase();
            host.ends_with(".hls.huya.com")
        })
        .unwrap_or(false)
}

fn media_cdn_key(url: &Url) -> String {
    let host = url
        .host_str()
        .unwrap_or_default()
        .trim_end_matches('.')
        .to_ascii_lowercase();
    let path = url.path().to_ascii_lowercase();
    for key in ["al", "hs", "tx", "hw"] {
        for protocol in ["hls", "flv"] {
            let marker = format!("{key}.{protocol}.huya.com");
            if host == marker || path.starts_with(&format!("/{marker}/")) {
                return key.to_string();
            }
        }
    }
    host
}

fn select_refreshed_playlist(
    playback: &LivePlaybackInfo,
    stream_name: &str,
    cdn_key: &str,
    original_scheme: &str,
) -> Option<Url> {
    let mut candidates = playback
        .streams
        .iter()
        .filter(|stream| stream.protocol == StreamProtocol::Hls)
        .flat_map(stream_playlist_urls)
        .filter_map(|value| Url::parse(value).ok())
        .filter(|url| hls_stream_name(url).as_deref() == Some(stream_name))
        .filter(|url| media_cdn_key(url) == cdn_key)
        .collect::<Vec<_>>();
    candidates.sort_by_key(|url| usize::from(url.scheme() != original_scheme));
    candidates.into_iter().next()
}

fn stream_playlist_urls(stream: &StreamSource) -> impl Iterator<Item = &String> {
    std::iter::once(&stream.url).chain(stream.backup_urls.iter())
}

async fn first_child_playlist_url(response: Response) -> Result<Url, HuyaError> {
    if response
        .content_length()
        .is_some_and(|length| length > MAX_PLAYLIST_RESPONSE_BYTES as u64)
    {
        return Err(HuyaError::Invalid(
            "Huya playlist response is too large".to_string(),
        ));
    }
    let base = response.url().clone();
    let bytes = response.bytes().await?;
    if bytes.len() > MAX_PLAYLIST_RESPONSE_BYTES {
        return Err(HuyaError::Invalid(
            "Huya playlist response is too large".to_string(),
        ));
    }
    let text = std::str::from_utf8(&bytes)
        .map_err(|_| HuyaError::Invalid("Huya playlist is not UTF-8".to_string()))?;
    if !text.trim_start_matches('\u{feff}').starts_with("#EXTM3U") {
        return Err(HuyaError::Invalid(
            "Huya master response is not an HLS playlist".to_string(),
        ));
    }
    let child = text
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty() && !line.starts_with('#'))
        .ok_or_else(|| HuyaError::Invalid("Huya master playlist is empty".to_string()))?;
    let child = base
        .join(&unescape_hls_uri(child))
        .map_err(|_| HuyaError::Invalid("Huya child playlist URL is invalid".to_string()))?;
    let child = validate_media_url(child.as_str())?;
    if !child.path().ends_with(".m3u8") {
        return Err(HuyaError::Invalid(
            "Huya master contains a media segment instead of a child playlist".to_string(),
        ));
    }
    Ok(child)
}

fn unescape_hls_uri(value: &str) -> String {
    value
        .replace("&amp;", "&")
        .replace("&#38;", "&")
        .replace("&quot;", "\"")
}

fn normalize_room_id(value: &str) -> Result<String, HuyaError> {
    let value = value.trim();
    if value.is_empty()
        || value.len() > MAX_ROOM_ID_LENGTH
        || !value.bytes().all(|byte| byte.is_ascii_digit())
        || value.bytes().all(|byte| byte == b'0')
    {
        return Err(HuyaError::RoomNotFound);
    }
    Ok(value.to_string())
}

async fn read_text(response: Response, max_bytes: usize) -> Result<String, HuyaError> {
    if response
        .content_length()
        .is_some_and(|length| length > max_bytes as u64)
    {
        return Err(HuyaError::Invalid("response body is too large".to_string()));
    }
    let encoding = response
        .headers()
        .get(CONTENT_ENCODING)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.trim().to_ascii_lowercase());
    let bytes = response.bytes().await?;
    if bytes.is_empty() {
        return Err(HuyaError::EmptyResponse);
    }
    let bytes = match encoding.as_deref() {
        None | Some("") | Some("identity") => bytes.to_vec(),
        Some("gzip") => decode_gzip(&bytes, max_bytes)?,
        Some(_) => {
            return Err(HuyaError::Invalid(
                "unsupported response content encoding".to_string(),
            ))
        }
    };
    if bytes.len() > max_bytes {
        return Err(HuyaError::Invalid("response body is too large".to_string()));
    }
    String::from_utf8(bytes).map_err(|_| HuyaError::Invalid("invalid UTF-8 response".to_string()))
}

fn decode_gzip(bytes: &[u8], max_bytes: usize) -> Result<Vec<u8>, HuyaError> {
    let mut decoded = Vec::new();
    GzDecoder::new(bytes)
        .take(max_bytes as u64 + 1)
        .read_to_end(&mut decoded)
        .map_err(|_| HuyaError::Invalid("invalid gzip response".to_string()))?;
    if decoded.len() > max_bytes {
        return Err(HuyaError::Invalid("response body is too large".to_string()));
    }
    Ok(decoded)
}

#[cfg(test)]
mod tests {
    use std::io::Write;

    use flate2::{write::GzEncoder, Compression};
    use reqwest::header::CONTENT_TYPE;

    use super::*;

    async fn fetch_hls_media_segment(
        client: &HuyaClient,
        manifest_url: &str,
        manifest: Vec<u8>,
        request_headers: &HeaderMap,
    ) -> Result<(String, u64), String> {
        let mut current_url =
            reqwest::Url::parse(manifest_url).map_err(|_| "invalid HLS URL".to_string())?;
        let mut body = manifest;

        for _ in 0..3 {
            let text = String::from_utf8_lossy(&body);
            let uri = text
                .lines()
                .map(str::trim)
                .find(|line| !line.is_empty() && !line.starts_with('#'))
                .ok_or_else(|| "HLS playlist contained no media URI".to_string())?;
            current_url = current_url
                .join(uri)
                .map_err(|_| "invalid HLS media URL".to_string())?;
            let media_host = current_url.host_str().unwrap_or("<missing>").to_string();
            let response = client
                .media_response(current_url.as_str(), request_headers)
                .await
                .map_err(|error| {
                    format!("HLS media request failed at host={media_host}: {error}")
                })?;
            let status = response.status();
            if !status.is_success() {
                return Err(format!("HLS media returned HTTP {status}"));
            }
            let response_url = response.url().clone();
            let content_type = response
                .headers()
                .get(CONTENT_TYPE)
                .and_then(|value| value.to_str().ok())
                .unwrap_or("<missing>")
                .to_string();
            body = response
                .bytes()
                .await
                .map_err(|error| format!("HLS media body failed: {error}"))?
                .to_vec();
            if body.starts_with(b"#EXTM3U") {
                current_url = response_url;
                continue;
            }
            if body.is_empty() {
                return Err("HLS media segment was empty".to_string());
            }
            if content_type.starts_with("text/html") {
                return Err("HLS media segment returned HTML".to_string());
            }
            return Ok((content_type, body.len() as u64));
        }

        Err("HLS playlist nesting exceeded the smoke-test limit".to_string())
    }

    async fn validate_hls_stream(
        client: &HuyaClient,
        stream: &crate::domain::StreamSource,
        request_headers: &HeaderMap,
    ) -> Result<(String, u64), String> {
        let mut candidates = vec![stream.url.clone()];
        candidates.extend(stream.backup_urls.clone());
        let mut last_error = "HLS had no candidate URLs".to_string();

        for url in candidates {
            let host = reqwest::Url::parse(&url)
                .ok()
                .and_then(|url| url.host_str().map(ToString::to_string))
                .unwrap_or_else(|| "<invalid>".to_string());
            let response = match client.media_response(&url, request_headers).await {
                Ok(response) if response.status().is_success() => response,
                Ok(response) => {
                    last_error = format!("HLS host={host} returned HTTP {}", response.status());
                    eprintln!("{last_error}");
                    continue;
                }
                Err(error) => {
                    last_error = format!("HLS host={host} request failed: {error}");
                    eprintln!("{last_error}");
                    continue;
                }
            };
            let manifest = response.bytes().await.expect("HLS manifest body");
            if !manifest.starts_with(b"#EXTM3U") {
                last_error = format!(
                    "HLS host={host} was not a manifest ({} bytes)",
                    manifest.len()
                );
                eprintln!("{last_error}");
                continue;
            }
            match fetch_hls_media_segment(client, &url, manifest.to_vec(), request_headers).await {
                Ok(media) => return Ok(media),
                Err(error) => {
                    last_error = format!("HLS host={host} media failed: {error}");
                    eprintln!("{last_error}");
                }
            }
        }

        Err(last_error)
    }

    #[test]
    fn room_ids_accept_only_public_numeric_values() {
        assert_eq!(normalize_room_id(" 321123 ").unwrap(), "321123");
        for value in ["", "0", "000", "12a34", "-1", "123/456", "captainmo"] {
            assert!(matches!(
                normalize_room_id(value),
                Err(HuyaError::RoomNotFound)
            ));
        }
    }

    #[test]
    fn gzip_page_is_decoded_with_a_decompressed_size_limit() {
        let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
        encoder.write_all(b"fixture page").unwrap();
        let compressed = encoder.finish().unwrap();

        assert_eq!(decode_gzip(&compressed, 64).unwrap(), b"fixture page");
        assert!(matches!(
            decode_gzip(&compressed, 4),
            Err(HuyaError::Invalid(_))
        ));
    }

    #[test]
    fn web_signature_is_rewritten_for_hls_and_flv() {
        let query = HashMap::from([
            ("fm".to_string(), "Zml4dHVyZV9wcmVmaXg=".to_string()),
            ("ctype".to_string(), "tars_mp".to_string()),
            ("fs".to_string(), "bhct".to_string()),
        ]);
        let hls = Url::parse_with_params(
            "https://hs.hls.huya.com/src/fixture-stream.m3u8",
            query.iter(),
        )
        .unwrap();
        let signed_hls = web_signed_media_url(&hls, 1_700_000_000_123, 123_456).unwrap();
        let signed_hls_query = signed_hls
            .query_pairs()
            .map(|(key, value)| (key.into_owned(), value.into_owned()))
            .collect::<HashMap<_, _>>();
        assert_eq!(signed_hls.path(), "/src/fixture-stream.m3u8");
        assert_eq!(
            signed_hls_query.get("wsSecret").map(String::as_str),
            Some("b3bdfa297c8106d6b623e7a48023e70d")
        );
        assert_eq!(
            signed_hls_query.get("wsTime").map(String::as_str),
            Some("6553f16e")
        );
        assert_eq!(
            signed_hls_query.get("seqid").map(String::as_str),
            Some("3100000123579")
        );
        assert_eq!(
            signed_hls_query.get("ctype").map(String::as_str),
            Some("tars_mp")
        );
        assert_eq!(signed_hls_query.get("fs").map(String::as_str), Some("bhct"));
        assert_eq!(
            signed_hls_query.get("u").map(String::as_str),
            Some("1400000123456")
        );
        assert_eq!(
            signed_hls_query.get("uuid").map(String::as_str),
            Some("123456")
        );
        assert_eq!(signed_hls_query.get("t").map(String::as_str), Some("100"));
        assert_eq!(
            signed_hls_query.get("sv").map(String::as_str),
            Some("2403051612")
        );
        assert_eq!(
            signed_hls_query.get("sdk_sid").map(String::as_str),
            Some("1700000000123")
        );
        assert_eq!(signed_hls_query.get("ver").map(String::as_str), Some("1"));
        assert_eq!(signed_hls_query.get("ratio").map(String::as_str), Some(""));

        let flv = Url::parse_with_params(
            "https://tx.flv.huya.com/src/fixture-stream.flv",
            query.iter(),
        )
        .unwrap();
        let signed_flv = web_signed_media_url(&flv, 1_700_000_000_123, 123_456).unwrap();
        let signed_flv_query = signed_flv
            .query_pairs()
            .map(|(key, value)| (key.into_owned(), value.into_owned()))
            .collect::<HashMap<_, _>>();

        assert_eq!(signed_flv.path(), "/src/fixture-stream.flv");
        assert_eq!(
            signed_flv_query.get("wsSecret").map(String::as_str),
            Some("b4aa2e4b5dec61b63b500b3126b617bd")
        );
        assert_eq!(
            signed_flv_query.get("ctype").map(String::as_str),
            Some("huya_webh5")
        );
        assert_eq!(signed_flv_query.get("fs").map(String::as_str), Some("bgct"));
    }

    #[test]
    fn web_signature_base64_decoder_accepts_padded_and_url_safe_input() {
        assert_eq!(
            decode_base64("Zml4dHVyZV9wcmVmaXg=").unwrap(),
            b"fixture_prefix"
        );
        assert_eq!(
            decode_base64("Zml4dHVyZV9wcmVmaXg").unwrap(),
            b"fixture_prefix"
        );
        assert!(decode_base64("not base64!").is_none());

        let url =
            Url::parse("https://hs.hls.huya.com/src/fixture.m3u8?fm=a+b%3D&ctype=tars_mp&fs=bhct")
                .unwrap();
        assert_eq!(query_value(&url, "fm").as_deref(), Some("a+b="));
    }

    #[test]
    fn hls_playlist_identity_distinguishes_cdn_and_child_urls() {
        let master =
            Url::parse("http://hs.hls.huya.com/src/fixture-stream.m3u8?token=fixture").unwrap();
        let child = Url::parse(
            "http://120.206.185.224/tx.hls.huya.com/src/fixture-stream.m3u8?token=fixture",
        )
        .unwrap();

        assert_eq!(hls_stream_name(&master).as_deref(), Some("fixture-stream"));
        assert_eq!(hls_stream_name(&child).as_deref(), Some("fixture-stream"));
        assert_eq!(media_cdn_key(&master), "hs");
        assert_eq!(media_cdn_key(&child), "tx");
        assert!(is_huya_hls_master(&master));
        assert!(!is_huya_hls_master(&child));
    }

    #[tokio::test]
    #[ignore = "set HUYA_HLS_REFRESH_SMOKE_ROOM_ID to a live public room with an HLS source"]
    async fn repeated_hls_playlist_requests_refresh_the_signed_url() {
        let room_id = std::env::var("HUYA_HLS_REFRESH_SMOKE_ROOM_ID")
            .expect("HUYA_HLS_REFRESH_SMOKE_ROOM_ID must name a live public room");
        let client = HuyaClient::new().expect("HTTP client");
        let playback = client
            .room_playback(&room_id, 0)
            .await
            .expect("room playback");
        let candidates = playback
            .streams
            .iter()
            .filter(|stream| stream.protocol == StreamProtocol::Hls)
            .flat_map(stream_playlist_urls)
            .collect::<Vec<_>>();
        let headers = HeaderMap::new();
        let mut working_playlist = None;

        for candidate in &candidates {
            let Ok(response) = client.media_response(candidate, &headers).await else {
                continue;
            };
            if !response.status().is_success() {
                continue;
            }
            let body = response.bytes().await.expect("HLS playlist body");
            if body.starts_with(b"#EXTM3U") {
                working_playlist = Some((*candidate).clone());
                break;
            }
        }
        let playlist =
            working_playlist.expect("no Huya HLS candidate returned a playable manifest");
        let parsed = Url::parse(&playlist).expect("working HLS URL");
        eprintln!(
            "repeated playlist source cdn={} scheme={} host={}",
            media_cdn_key(&parsed),
            parsed.scheme(),
            parsed.host_str().unwrap_or("<missing>")
        );

        for attempt in 0..2 {
            let response = client
                .media_response(&playlist, &headers)
                .await
                .unwrap_or_else(|error| {
                    panic!("HLS playlist refresh attempt {attempt} failed: {error}")
                });
            assert!(
                response.status().is_success(),
                "HLS playlist refresh attempt {attempt} returned {}",
                response.status()
            );
            let body = response.bytes().await.expect("HLS playlist body");
            assert!(body.starts_with(b"#EXTM3U"));
        }

        let mut nested_child = None;
        for candidate in candidates {
            let response = match client.media_response(candidate, &headers).await {
                Ok(response) if response.status().is_success() => response,
                _ => continue,
            };
            let base = response.url().clone();
            let body = response.bytes().await.expect("HLS playlist body");
            let Some(uri) = String::from_utf8_lossy(&body)
                .lines()
                .map(str::trim)
                .find(|line| !line.is_empty() && !line.starts_with('#'))
                .map(ToString::to_string)
            else {
                continue;
            };
            let Ok(url) = base.join(&unescape_hls_uri(&uri)) else {
                continue;
            };
            if url.path().ends_with(".m3u8") {
                nested_child = Some(url);
                break;
            }
        }
        if let Some(nested_child) = nested_child {
            for attempt in 0..3 {
                let response = client
                    .media_response(nested_child.as_str(), &headers)
                    .await
                    .unwrap_or_else(|error| {
                        panic!("HLS child playlist attempt {attempt} failed: {error}")
                    });
                assert!(
                    response.status().is_success(),
                    "HLS child playlist attempt {attempt} returned {}",
                    response.status()
                );
                let body = response.bytes().await.expect("HLS child playlist body");
                assert!(body.starts_with(b"#EXTM3U"));
            }
        } else {
            eprintln!("selected Huya room exposes media playlists without a nested child");
        }
    }

    #[tokio::test]
    #[ignore = "requires live Huya network access and a currently live public room"]
    async fn live_discovery_and_room_smoke() {
        let client = HuyaClient::new().expect("HTTP client");
        let discovery = client.discover().await.expect("live discovery");
        assert!(
            discovery
                .sections
                .iter()
                .flat_map(|section| section.rooms.iter())
                .any(|room| room.cover_url.is_some() && room.avatar_url.is_some()),
            "Huya discovery did not expose both cover and avatar URLs"
        );

        let mut checked = 0;
        for room in discovery
            .sections
            .iter()
            .flat_map(|section| section.rooms.iter())
            .take(8)
        {
            let info = match client.room_info(&room.room_id).await {
                Ok(info) => info,
                Err(error) => {
                    eprintln!("room {} info failed: {error}", room.room_id);
                    continue;
                }
            };
            if info.live_status != crate::domain::LiveStatus::Live {
                eprintln!("room {} is not live: {:?}", room.room_id, info.live_status);
                continue;
            }
            let playback = match client.room_playback(&room.room_id, 0).await {
                Ok(playback) => playback,
                Err(error) => {
                    eprintln!("room {} playback failed: {error}", room.room_id);
                    continue;
                }
            };
            let hls = playback
                .streams
                .iter()
                .find(|stream| stream.protocol == crate::domain::StreamProtocol::Hls);
            let Some(hls) = hls else {
                eprintln!("room {} is missing HLS", room.room_id);
                continue;
            };

            let empty_headers = HeaderMap::new();
            let hls_result = validate_hls_stream(&client, hls, &empty_headers).await;
            let Ok((hls_content_type, hls_length)) = hls_result else {
                continue;
            };
            eprintln!(
                "room {} HLS passed content_type={hls_content_type:?} bytes={hls_length}",
                room.room_id,
            );
            checked += 1;
            break;
        }
        assert!(checked > 0, "no live Huya room yielded playable HLS");
    }

    #[tokio::test]
    #[ignore = "set HUYA_LIVE_SMOKE_ROOM_ID to a currently live public room"]
    async fn configured_live_room_hls_smoke() {
        let room_id = std::env::var("HUYA_LIVE_SMOKE_ROOM_ID")
            .expect("HUYA_LIVE_SMOKE_ROOM_ID must name a live public room");
        let client = HuyaClient::new().expect("HTTP client");
        let info = client.room_info(&room_id).await.expect("room info");
        assert_eq!(
            info.live_status,
            crate::domain::LiveStatus::Live,
            "configured room is not live"
        );
        let playback = client
            .room_playback(&room_id, 0)
            .await
            .expect("room playback");
        let hls = playback
            .streams
            .iter()
            .find(|stream| stream.protocol == crate::domain::StreamProtocol::Hls)
            .expect("HLS source");
        let headers = HeaderMap::new();
        let (content_type, length) = validate_hls_stream(&client, hls, &headers)
            .await
            .expect("playable HLS media");
        eprintln!(
            "configured room {room_id} HLS passed content_type={content_type:?} bytes={length}"
        );
    }

    #[tokio::test]
    #[ignore = "set HUYA_FLV_SMOKE_ROOM_ID to a currently live public room"]
    async fn configured_live_room_flv_stays_open() {
        let room_id = std::env::var("HUYA_FLV_SMOKE_ROOM_ID")
            .expect("HUYA_FLV_SMOKE_ROOM_ID must name a live public room");
        let client = HuyaClient::new().expect("HTTP client");
        let playback = client
            .room_playback(&room_id, 0)
            .await
            .expect("room playback");
        let candidates = playback
            .streams
            .iter()
            .filter(|stream| stream.protocol == crate::domain::StreamProtocol::Flv)
            .flat_map(stream_playlist_urls)
            .collect::<Vec<_>>();
        assert!(!candidates.is_empty(), "Huya room has no FLV source");

        let headers = HeaderMap::new();
        let mut last_error = "no FLV candidate returned a media response".to_string();
        for candidate in candidates {
            let response = match tokio::time::timeout(
                Duration::from_secs(20),
                client.media_response(candidate, &headers),
            )
            .await
            {
                Ok(Ok(response)) if response.status().is_success() => response,
                Ok(Ok(response)) => {
                    last_error = format!("FLV request returned HTTP {}", response.status());
                    continue;
                }
                Ok(Err(error)) => {
                    last_error = format!("FLV request failed: {error}");
                    continue;
                }
                Err(_) => {
                    last_error = "FLV request timed out".to_string();
                    continue;
                }
            };
            let content_type = response
                .headers()
                .get(reqwest::header::CONTENT_TYPE)
                .and_then(|value| value.to_str().ok())
                .unwrap_or_default()
                .to_ascii_lowercase();
            if !content_type.contains("flv") {
                last_error = format!("FLV response had content type {content_type:?}");
                continue;
            }

            let started = Instant::now();
            let mut bytes = 0usize;
            let mut response = response;
            loop {
                let chunk =
                    match tokio::time::timeout(Duration::from_secs(10), response.chunk()).await {
                        Ok(Ok(Some(chunk))) if !chunk.is_empty() => chunk,
                        Ok(Ok(Some(_))) => continue,
                        Ok(Ok(None)) => {
                            last_error = format!(
                                "FLV stream ended after {:.1}s and {bytes} bytes",
                                started.elapsed().as_secs_f64()
                            );
                            break;
                        }
                        Ok(Err(error)) => {
                            last_error = format!("FLV stream read failed: {error}");
                            break;
                        }
                        Err(_) => {
                            last_error = format!(
                                "FLV stream stalled after {:.1}s and {bytes} bytes",
                                started.elapsed().as_secs_f64()
                            );
                            break;
                        }
                    };
                bytes = bytes.saturating_add(chunk.len());
                if started.elapsed() >= Duration::from_secs(65) {
                    assert!(
                        bytes > 1_000_000,
                        "FLV stream stayed open but returned too few bytes: {bytes}"
                    );
                    eprintln!(
                        "configured room {room_id} FLV stayed open for {:.1}s and returned {bytes} bytes",
                        started.elapsed().as_secs_f64()
                    );
                    return;
                }
            }
        }

        panic!("no Huya FLV candidate stayed open: {last_error}");
    }
}
