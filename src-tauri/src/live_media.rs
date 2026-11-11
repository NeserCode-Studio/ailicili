use std::{
    collections::{BTreeMap, HashMap},
    sync::{Arc, Mutex},
    time::Duration,
};

use log::warn;
use reqwest::{
    header::{HeaderMap, HeaderName, HeaderValue},
    Response,
};
use tauri::{ipc::Response as IpcResponse, State};
use tokio::sync::{Mutex as AsyncMutex, Notify};

use crate::{domain::CommandError, AppState};

const LIVE_MEDIA_READ_TIMEOUT: Duration = Duration::from_secs(10);
const LIVE_MEDIA_HEADER_TIMEOUT: Duration = Duration::from_secs(20);
const MAX_REQUEST_ID_LENGTH: usize = 128;
const MAX_MEDIA_URL_LENGTH: usize = 8_192;
const MEDIA_CHUNK_MARKER: u8 = 1;
const MEDIA_END_MARKER: u8 = 0;
const LIVE_MEDIA_DIAGNOSTIC_REV: &str = "media-response-v1";

#[derive(Default)]
pub struct LiveMediaRequests(Mutex<HashMap<String, Arc<LiveMediaStream>>>);

struct LiveMediaStream {
    response: AsyncMutex<Response>,
    cancel: Notify,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LiveMediaOpen {
    request_id: Option<String>,
    status: u16,
    status_text: String,
    url: String,
    http_version: String,
    headers: BTreeMap<String, String>,
}

#[tauri::command]
pub async fn open_live_media_stream(
    state: State<'_, AppState>,
    requests: State<'_, LiveMediaRequests>,
    url: String,
    headers: Option<BTreeMap<String, String>>,
) -> Result<LiveMediaOpen, CommandError> {
    if url.len() > MAX_MEDIA_URL_LENGTH {
        return Err(media_error("直播媒体地址无效。"));
    }
    let request_headers = media_request_headers(headers.as_ref())?;
    let response = tokio::time::timeout(
        LIVE_MEDIA_HEADER_TIMEOUT,
        state.bilibili.live_media_response(&url, &request_headers),
    )
    .await
    .map_err(|_| media_error("直播媒体请求超时。"))?
    .map_err(CommandError::from)?;

    let status = response.status();
    let status_text = status.canonical_reason().unwrap_or_default().to_string();
    let response_url = response.url().clone();
    let response_url_string = response_url.as_str().to_string();
    let response_host = response_url.host_str().unwrap_or("<missing>").to_string();
    let http_version = format!("{:?}", response.version()).to_ascii_lowercase();
    let response_headers = response_headers(response.headers());
    let response_header_names = response
        .headers()
        .keys()
        .map(|name| name.as_str().to_string())
        .collect::<std::collections::BTreeSet<_>>();
    if !status.is_success() {
        let content_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or("<missing>")
            .to_string();
        let body = tokio::time::timeout(Duration::from_secs(2), response.text())
            .await
            .ok()
            .and_then(Result::ok)
            .unwrap_or_default();
        warn!(
            target: "Bilibili/LiveMedia",
            "live media rejected diag={LIVE_MEDIA_DIAGNOSTIC_REV} status={} host={} http={http_version} content_type={content_type:?} header_names={response_header_names:?} body_length={} body_preview={:?}",
            status.as_u16(),
            response_host,
            body.len(),
            diagnostic_body_preview(&body),
        );
        return Ok(LiveMediaOpen {
            request_id: None,
            status: status.as_u16(),
            status_text,
            url: response_url_string,
            http_version,
            headers: response_headers,
        });
    }
    let request_id = Some(requests.start(response)?);

    Ok(LiveMediaOpen {
        request_id,
        status: status.as_u16(),
        status_text,
        url: response_url_string,
        http_version,
        headers: response_headers,
    })
}

#[tauri::command]
pub async fn read_live_media_stream(
    requests: State<'_, LiveMediaRequests>,
    request_id: String,
) -> Result<IpcResponse, CommandError> {
    let request_id = validate_request_id(&request_id)?;
    let stream = requests.get(&request_id)?;
    let mut response = stream.response.lock().await;

    loop {
        let result = tokio::select! {
            _ = stream.cancel.notified() => {
                requests.finish(&request_id);
                return Err(media_code("liveMediaInterrupted", "直播媒体流已关闭。"));
            }
            result = tokio::time::timeout(LIVE_MEDIA_READ_TIMEOUT, response.chunk()) => result,
        };
        match result {
            Err(_) => {
                requests.finish(&request_id);
                return Err(media_code("liveMediaTimeout", "直播媒体流读取超时。"));
            }
            Ok(Err(_)) => {
                requests.finish(&request_id);
                return Err(media_code("liveMediaInterrupted", "直播媒体流连接已中断。"));
            }
            Ok(Ok(Some(chunk))) if chunk.is_empty() => continue,
            Ok(Ok(Some(chunk))) => {
                return Ok(IpcResponse::new(media_chunk_packet(&chunk)));
            }
            Ok(Ok(None)) => {
                requests.finish(&request_id);
                return Ok(IpcResponse::new(media_end_packet()));
            }
        }
    }
}

#[tauri::command]
pub fn close_live_media_stream(requests: State<'_, LiveMediaRequests>, request_id: String) {
    requests.cancel(&request_id);
}

impl LiveMediaRequests {
    fn start(&self, response: Response) -> Result<String, CommandError> {
        let request_id = uuid::Uuid::new_v4().simple().to_string();
        let stream = Arc::new(LiveMediaStream {
            response: AsyncMutex::new(response),
            cancel: Notify::new(),
        });
        self.0
            .lock()
            .map_err(|_| media_error("直播媒体请求状态不可用。"))?
            .insert(request_id.clone(), stream);
        Ok(request_id)
    }

    fn get(&self, request_id: &str) -> Result<Arc<LiveMediaStream>, CommandError> {
        self.0
            .lock()
            .map_err(|_| media_error("直播媒体请求状态不可用。"))?
            .get(request_id)
            .cloned()
            .ok_or_else(|| media_error("直播媒体请求已失效。"))
    }

    fn cancel(&self, request_id: &str) {
        if let Ok(mut requests) = self.0.lock() {
            if let Some(stream) = requests.remove(request_id) {
                stream.cancel.notify_one();
            }
        }
    }

    fn finish(&self, request_id: &str) {
        if let Ok(mut requests) = self.0.lock() {
            requests.remove(request_id);
        }
    }
}

fn validate_request_id(value: &str) -> Result<String, CommandError> {
    let value = value.trim();
    if value.is_empty()
        || value.len() > MAX_REQUEST_ID_LENGTH
        || !value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
    {
        return Err(media_error("直播媒体请求标识无效。"));
    }
    Ok(value.to_string())
}

fn media_request_headers(
    headers: Option<&BTreeMap<String, String>>,
) -> Result<HeaderMap, CommandError> {
    let mut request_headers = HeaderMap::new();
    let Some(headers) = headers else {
        return Ok(request_headers);
    };
    for (name, value) in headers {
        let name = name.to_ascii_lowercase();
        if !matches!(name.as_str(), "accept" | "range") {
            continue;
        }
        let header_name = HeaderName::from_bytes(name.as_bytes())
            .map_err(|_| media_error("直播媒体请求头无效。"))?;
        let header_value =
            HeaderValue::from_str(value).map_err(|_| media_error("直播媒体请求头无效。"))?;
        request_headers.insert(header_name, header_value);
    }
    Ok(request_headers)
}

fn response_headers(headers: &HeaderMap) -> BTreeMap<String, String> {
    const ALLOWED_HEADERS: [&str; 6] = [
        "accept-ranges",
        "cache-control",
        "content-length",
        "content-range",
        "content-type",
        "etag",
    ];
    ALLOWED_HEADERS
        .into_iter()
        .filter_map(|name| {
            headers
                .get(name)
                .and_then(|value| value.to_str().ok())
                .map(|value| (name.to_string(), value.to_string()))
        })
        .collect()
}

fn media_code(code: &str, message: impl Into<String>) -> CommandError {
    CommandError::new(code, message)
}

fn media_error(message: impl Into<String>) -> CommandError {
    media_code("liveMediaError", message)
}

fn media_chunk_packet(chunk: &[u8]) -> Vec<u8> {
    let mut packet = Vec::with_capacity(chunk.len() + 1);
    packet.extend_from_slice(chunk);
    packet.push(MEDIA_CHUNK_MARKER);
    packet
}

fn media_end_packet() -> Vec<u8> {
    vec![MEDIA_END_MARKER]
}

fn diagnostic_body_preview(body: &str) -> String {
    let compact = body.split_whitespace().collect::<Vec<_>>().join(" ");
    let lower = compact.to_ascii_lowercase();
    if compact.is_empty() {
        return "<empty>".to_string();
    }
    if compact.len() > 160
        || lower.contains("http")
        || lower.contains("cookie")
        || lower.contains("token")
        || lower.contains("sig")
        || lower.contains("secret")
    {
        return "<omitted>".to_string();
    }
    compact
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn media_chunk_packet_preserves_payload_bytes() {
        let chunk = [0, MEDIA_CHUNK_MARKER, MEDIA_END_MARKER, 0xff, 0];
        let packet = media_chunk_packet(&chunk);

        assert_eq!(&packet[..chunk.len()], &chunk);
        assert_eq!(packet.last(), Some(&MEDIA_CHUNK_MARKER));
        assert_eq!(packet.len(), chunk.len() + 1);
    }

    #[test]
    fn media_end_packet_is_unambiguous() {
        assert_eq!(media_end_packet(), vec![MEDIA_END_MARKER]);
        assert_ne!(media_end_packet(), media_chunk_packet(&[]));
    }
}
