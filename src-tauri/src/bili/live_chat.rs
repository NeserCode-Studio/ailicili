use std::{
    collections::{HashMap, VecDeque},
    io::{Cursor, Read},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, RwLock,
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use brotli::Decompressor;
use flate2::read::ZlibDecoder;
use futures_util::{SinkExt, StreamExt};
use http::header::{HeaderValue, COOKIE, ORIGIN, USER_AGENT};
use serde::Serialize;
use serde_json::{json, Value};
use tokio::time::{interval, sleep, MissedTickBehavior};
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::{connect_async, tungstenite::Message};
use uuid::Uuid;

use super::{
    client::BiliClient,
    error::BiliError,
    live::{LiveDanmakuConfig, LiveDanmakuHost},
};

const CHAT_SESSION_TTL: Duration = Duration::from_secs(2 * 60 * 60);
const MAX_CHAT_SESSIONS: usize = 8;
const MAX_CHAT_MESSAGES: usize = 160;
const MAX_RECENT_IDS: usize = 320;
const MAX_COMPRESSED_FRAME_BYTES: usize = 4 * 1024 * 1024;
const MAX_DECOMPRESSED_FRAME_BYTES: usize = 8 * 1024 * 1024;
const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(30);
const STOP_CHECK_INTERVAL: Duration = Duration::from_millis(500);
const RECONNECT_DELAY: Duration = Duration::from_secs(3);
const OPERATION_HEARTBEAT: u32 = 2;
const OPERATION_NOTIFICATION: u32 = 5;
const OPERATION_AUTHENTICATION: u32 = 7;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveChatMessage {
    pub sequence: u64,
    pub id: String,
    pub uid: String,
    pub username: String,
    pub text: String,
    pub color: u32,
    pub timestamp: u64,
    pub guard_level: u8,
    pub is_admin: bool,
    pub medal: Option<LiveChatMedal>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveChatMedal {
    pub name: String,
    pub level: u32,
    pub anchor_name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveChatStart {
    pub session_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveChatPoll {
    pub messages: Vec<LiveChatMessage>,
    pub cursor: u64,
    pub connected: bool,
    pub error: Option<String>,
}

struct LiveChatState {
    connected: bool,
    error: Option<String>,
    next_sequence: u64,
    messages: VecDeque<LiveChatMessage>,
    recent_ids: VecDeque<String>,
}

impl Default for LiveChatState {
    fn default() -> Self {
        Self {
            connected: false,
            error: None,
            next_sequence: 1,
            messages: VecDeque::new(),
            recent_ids: VecDeque::new(),
        }
    }
}

impl LiveChatState {
    fn add_message(
        &mut self,
        id: String,
        uid: String,
        username: String,
        text: String,
        color: u32,
        timestamp: u64,
        guard_level: u8,
        is_admin: bool,
        medal: Option<LiveChatMedal>,
    ) {
        let text = sanitize_chat_text(&text);
        if text.is_empty() || self.recent_ids.iter().any(|value| value == &id) {
            return;
        }

        let sequence = self.next_sequence;
        self.next_sequence = self.next_sequence.saturating_add(1);
        self.messages.push_back(LiveChatMessage {
            sequence,
            id: id.clone(),
            uid,
            username: sanitize_chat_text(&username),
            text,
            color,
            timestamp,
            guard_level,
            is_admin,
            medal,
        });
        self.recent_ids.push_back(id);
        while self.messages.len() > MAX_CHAT_MESSAGES {
            self.messages.pop_front();
        }
        while self.recent_ids.len() > MAX_RECENT_IDS {
            self.recent_ids.pop_front();
        }
    }
}

struct LiveChatSession {
    created_at: Instant,
    stopped: AtomicBool,
    state: RwLock<LiveChatState>,
}

#[derive(Default)]
pub struct LiveChatSessions {
    values: RwLock<HashMap<String, Arc<LiveChatSession>>>,
}

impl LiveChatSessions {
    pub fn new() -> Self {
        Self::default()
    }

    fn start(
        self: &Arc<Self>,
        cookie_header: String,
        room_id: u64,
        user_id: u64,
        config: LiveDanmakuConfig,
    ) -> Result<LiveChatStart, BiliError> {
        let id = Uuid::new_v4().to_string();
        let session = Arc::new(LiveChatSession {
            created_at: Instant::now(),
            stopped: AtomicBool::new(false),
            state: RwLock::new(LiveChatState::default()),
        });

        let mut values = self.values.write().map_err(|_| BiliError::Internal)?;
        let expired = values
            .iter()
            .filter(|(_, value)| value.created_at.elapsed() >= CHAT_SESSION_TTL)
            .map(|(id, _)| id.clone())
            .collect::<Vec<_>>();
        for expired_id in expired {
            if let Some(expired) = values.remove(&expired_id) {
                expired.stopped.store(true, Ordering::Release);
            }
        }
        if values.len() >= MAX_CHAT_SESSIONS {
            if let Some(oldest) = values
                .iter()
                .min_by_key(|(_, value)| value.created_at)
                .map(|(id, _)| id.clone())
            {
                if let Some(removed) = values.remove(&oldest) {
                    removed.stopped.store(true, Ordering::Release);
                }
            }
        }
        values.insert(id.clone(), session.clone());
        drop(values);

        tauri::async_runtime::spawn(run_chat_session(
            session,
            cookie_header,
            room_id,
            user_id,
            config,
        ));
        Ok(LiveChatStart { session_id: id })
    }

    pub fn poll(&self, session_id: &str, after: u64) -> Result<LiveChatPoll, BiliError> {
        let session = self.get(session_id)?;
        let state = session.state.read().map_err(|_| BiliError::Internal)?;
        let cursor = state.next_sequence.saturating_sub(1);
        let messages = state
            .messages
            .iter()
            .filter(|message| message.sequence > after)
            .cloned()
            .collect();
        Ok(LiveChatPoll {
            messages,
            cursor,
            connected: state.connected,
            error: state.error.clone(),
        })
    }

    pub fn stop(&self, session_id: &str) -> Result<(), BiliError> {
        let mut values = self.values.write().map_err(|_| BiliError::Internal)?;
        if let Some(session) = values.remove(session_id) {
            session.stopped.store(true, Ordering::Release);
        }
        Ok(())
    }

    fn get(&self, session_id: &str) -> Result<Arc<LiveChatSession>, BiliError> {
        if !valid_session_id(session_id) {
            return Err(BiliError::InvalidInput("invalid live chat session"));
        }
        self.values
            .read()
            .map_err(|_| BiliError::Internal)?
            .get(session_id)
            .filter(|session| session.created_at.elapsed() < CHAT_SESSION_TTL)
            .cloned()
            .ok_or_else(|| BiliError::InvalidInput("live chat session is missing or expired"))
    }
}

impl BiliClient {
    pub async fn start_live_chat(&self, room_id: u64) -> Result<LiveChatStart, BiliError> {
        let config = self.live_danmaku_config(room_id).await?;
        let cookie_header = self.search_cookie_header().await?;
        let user_id = self
            .session
            .user_id()
            .await
            .and_then(|value| value.parse().ok())
            .unwrap_or_default();
        self.live_chat
            .start(cookie_header, room_id, user_id, config)
    }

    pub fn poll_live_chat(&self, session_id: &str, after: u64) -> Result<LiveChatPoll, BiliError> {
        self.live_chat.poll(session_id, after)
    }

    pub fn stop_live_chat(&self, session_id: &str) -> Result<(), BiliError> {
        self.live_chat.stop(session_id)
    }
}

async fn run_chat_session(
    session: Arc<LiveChatSession>,
    cookie_header: String,
    room_id: u64,
    user_id: u64,
    config: LiveDanmakuConfig,
) {
    let mut host_index = 0usize;

    while !session.stopped.load(Ordering::Acquire)
        && session.created_at.elapsed() < CHAT_SESSION_TTL
    {
        let Some(host) = config.hosts.get(host_index % config.hosts.len()) else {
            set_chat_state(&session, false, Some("configuration_unavailable"));
            break;
        };
        host_index = host_index.saturating_add(1);

        match run_chat_connection(
            &session,
            host,
            room_id,
            user_id,
            &config.token,
            &cookie_header,
        )
        .await
        {
            Ok(()) if session.stopped.load(Ordering::Acquire) => break,
            Ok(()) => set_chat_state(&session, false, Some("connection_closed")),
            Err(error) => set_chat_state(&session, false, Some(chat_error_code(&error))),
        }

        if session.stopped.load(Ordering::Acquire) {
            break;
        }
        sleep(RECONNECT_DELAY).await;
    }

    set_chat_connected(&session, false);
}

async fn run_chat_connection(
    session: &Arc<LiveChatSession>,
    host: &LiveDanmakuHost,
    room_id: u64,
    user_id: u64,
    token: &str,
    cookie_header: &str,
) -> Result<(), BiliError> {
    let host_name = host
        .host
        .trim()
        .trim_start_matches("wss://")
        .trim_start_matches("https://")
        .trim_end_matches('/');
    if !safe_chat_host(host_name) {
        return Err(BiliError::InvalidResponse(
            "live chat host is not a Bilibili domain",
        ));
    }
    let url = format!("wss://{host_name}:{}/sub", host.wss_port);
    let mut request = url
        .as_str()
        .into_client_request()
        .map_err(|_| BiliError::Http)?;
    request.headers_mut().insert(
        COOKIE,
        HeaderValue::from_str(cookie_header).map_err(|_| BiliError::Http)?,
    );
    request.headers_mut().insert(
        ORIGIN,
        HeaderValue::from_static("https://live.bilibili.com"),
    );
    request.headers_mut().insert(
        USER_AGENT,
        HeaderValue::from_static(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 \
             (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
        ),
    );
    let (mut socket, _) = connect_async(request).await.map_err(|_| BiliError::Http)?;
    let authentication = json!({
        "uid": user_id,
        "roomid": room_id,
        "protover": 3,
        "platform": "web",
        "type": 2,
        "key": token,
    });
    if socket
        .send(Message::Binary(
            packet(
                OPERATION_AUTHENTICATION,
                authentication.to_string().as_bytes(),
            )
            .into(),
        ))
        .await
        .is_err()
    {
        return Err(BiliError::Http);
    }

    let mut heartbeat = interval(HEARTBEAT_INTERVAL);
    heartbeat.set_missed_tick_behavior(MissedTickBehavior::Delay);
    let mut stop_check = interval(STOP_CHECK_INTERVAL);
    stop_check.set_missed_tick_behavior(MissedTickBehavior::Delay);
    heartbeat.tick().await;
    stop_check.tick().await;

    loop {
        tokio::select! {
            _ = heartbeat.tick() => {
                socket
                    .send(Message::Binary(
                        packet(OPERATION_HEARTBEAT, b"[object Object]").into(),
                    ))
                    .await
                    .map_err(|_| BiliError::Http)?;
            }
            _ = stop_check.tick() => {
                if session.stopped.load(Ordering::Acquire) {
                    let _ = socket.close(None).await;
                    return Ok(());
                }
            }
            message = socket.next() => {
                match message {
                    Some(Ok(Message::Binary(bytes))) => {
                        if bytes.len() > MAX_COMPRESSED_FRAME_BYTES {
                            return Err(BiliError::InvalidResponse("live chat frame is too large"));
                        }
                        process_packets(session, &bytes, 0)?;
                    }
                    Some(Ok(Message::Text(text))) => {
                        handle_command(session, &text);
                    }
                    Some(Ok(Message::Ping(payload))) => {
                        socket
                            .send(Message::Pong(payload))
                            .await
                            .map_err(|_| BiliError::Http)?;
                    }
                    Some(Ok(Message::Close(_))) | None => return Ok(()),
                    Some(Ok(_)) => {}
                    Some(Err(_)) => return Err(BiliError::Http),
                }
            }
        }
    }
}

fn process_packets(session: &LiveChatSession, bytes: &[u8], depth: usize) -> Result<(), BiliError> {
    if depth > 3 {
        return Err(BiliError::InvalidResponse(
            "live chat packet nesting is too deep",
        ));
    }
    let mut offset = 0usize;
    while offset.saturating_add(16) <= bytes.len() {
        let header = &bytes[offset..offset + 16];
        let packet_length =
            u32::from_be_bytes(header[0..4].try_into().unwrap_or_default()) as usize;
        let header_length =
            u16::from_be_bytes(header[4..6].try_into().unwrap_or_default()) as usize;
        let protocol = u16::from_be_bytes(header[6..8].try_into().unwrap_or_default());
        let operation = u32::from_be_bytes(header[8..12].try_into().unwrap_or_default());
        if packet_length < header_length
            || header_length < 16
            || offset.saturating_add(packet_length) > bytes.len()
        {
            return Err(BiliError::InvalidResponse("invalid live chat packet"));
        }
        let body = &bytes[offset + header_length..offset + packet_length];

        if operation == OPERATION_NOTIFICATION {
            match protocol {
                2 => {
                    let decoded = decompress_zlib(body)?;
                    process_packets(session, &decoded, depth + 1)?;
                }
                3 => {
                    let decoded = decompress_brotli(body)?;
                    process_packets(session, &decoded, depth + 1)?;
                }
                _ => {
                    if let Ok(text) = std::str::from_utf8(body) {
                        handle_command(session, text);
                    }
                }
            }
        } else if operation == 8 {
            let mut state = session.state.write().map_err(|_| BiliError::Internal)?;
            state.connected = true;
            state.error = None;
        }

        offset = offset.saturating_add(packet_length);
    }
    Ok(())
}

fn decompress_zlib(bytes: &[u8]) -> Result<Vec<u8>, BiliError> {
    read_limited(ZlibDecoder::new(Cursor::new(bytes)))
}

fn decompress_brotli(bytes: &[u8]) -> Result<Vec<u8>, BiliError> {
    read_limited(Decompressor::new(Cursor::new(bytes), 16 * 1024))
}

fn read_limited(reader: impl Read) -> Result<Vec<u8>, BiliError> {
    let mut output = Vec::new();
    reader
        .take(MAX_DECOMPRESSED_FRAME_BYTES as u64 + 1)
        .read_to_end(&mut output)
        .map_err(|_| BiliError::InvalidResponse("cannot decompress live chat frame"))?;
    if output.len() > MAX_DECOMPRESSED_FRAME_BYTES {
        return Err(BiliError::InvalidResponse("live chat frame is too large"));
    }
    Ok(output)
}

fn handle_command(session: &LiveChatSession, text: &str) {
    let Ok(value) = serde_json::from_str::<Value>(text) else {
        return;
    };
    let Some(command) = value.get("cmd").and_then(Value::as_str) else {
        return;
    };
    if !command.starts_with("DANMU_MSG") {
        return;
    }
    let Some(info) = value.get("info").and_then(Value::as_array) else {
        return;
    };
    let Some(content) = info.get(1).and_then(Value::as_str) else {
        return;
    };
    let Some(user) = info.get(2).and_then(Value::as_array) else {
        return;
    };

    let metadata = info.get(0).and_then(Value::as_array);
    let raw_timestamp = metadata
        .and_then(|metadata| metadata.get(4))
        .and_then(Value::as_u64)
        .unwrap_or_else(current_timestamp_millis);
    let timestamp = if raw_timestamp > 10_000_000_000 {
        raw_timestamp / 1000
    } else {
        raw_timestamp
    };
    let uid = value_as_string(user.first())
        .map(|value| bounded_text(&value, 64))
        .unwrap_or_default();
    let username = value_as_string(user.get(1)).unwrap_or_default();
    let is_admin = user
        .get(2)
        .and_then(Value::as_u64)
        .is_some_and(|value| value > 0);
    let guard_level = user
        .get(4)
        .or_else(|| info.get(7))
        .and_then(Value::as_u64)
        .unwrap_or_default()
        .min(u8::MAX as u64) as u8;
    let color = metadata
        .and_then(|metadata| metadata.get(3))
        .and_then(Value::as_u64)
        .unwrap_or(16_777_215)
        .min(u32::MAX as u64) as u32;
    let medal = info
        .get(3)
        .and_then(Value::as_array)
        .and_then(|values| parse_medal(values));
    let id = format!("{uid}-{raw_timestamp}-{}", bounded_text(content, 64));

    if let Ok(mut state) = session.state.write() {
        state.add_message(
            id,
            uid,
            username,
            content.to_owned(),
            color,
            timestamp,
            guard_level,
            is_admin,
            medal,
        );
    }
}

fn parse_medal(values: &[Value]) -> Option<LiveChatMedal> {
    let level = values.first().and_then(Value::as_u64).unwrap_or_default() as u32;
    let name = values.get(1).and_then(Value::as_str).unwrap_or_default();
    if name.trim().is_empty() {
        return None;
    }
    Some(LiveChatMedal {
        name: sanitize_chat_text(name),
        level,
        anchor_name: values
            .get(2)
            .and_then(Value::as_str)
            .map(sanitize_chat_text)
            .unwrap_or_default(),
    })
}

fn value_as_string(value: Option<&Value>) -> Option<String> {
    match value? {
        Value::String(value) => Some(value.clone()),
        Value::Number(value) => Some(value.to_string()),
        _ => None,
    }
}

fn packet(operation: u32, payload: &[u8]) -> Vec<u8> {
    let packet_length = (16 + payload.len()) as u32;
    let mut output = Vec::with_capacity(packet_length as usize);
    output.extend_from_slice(&packet_length.to_be_bytes());
    output.extend_from_slice(&16u16.to_be_bytes());
    output.extend_from_slice(&1u16.to_be_bytes());
    output.extend_from_slice(&operation.to_be_bytes());
    output.extend_from_slice(&1u32.to_be_bytes());
    output.extend_from_slice(payload);
    output
}

fn set_chat_state(session: &LiveChatSession, connected: bool, error: Option<&str>) {
    if let Ok(mut state) = session.state.write() {
        state.connected = connected;
        state.error = error.map(str::to_owned);
    }
}

fn set_chat_connected(session: &LiveChatSession, connected: bool) {
    if let Ok(mut state) = session.state.write() {
        state.connected = connected;
    }
}

fn chat_error_code(error: &BiliError) -> &'static str {
    match error {
        BiliError::InvalidResponse(_) => "invalid_stream",
        BiliError::Upstream { .. } => "upstream_rejected",
        _ => "connection_failed",
    }
}

fn sanitize_chat_text(value: &str) -> String {
    value
        .chars()
        .filter(|character| !character.is_control() || *character == '\t')
        .take(500)
        .collect::<String>()
        .trim()
        .to_owned()
}

fn bounded_text(value: &str, max_chars: usize) -> String {
    value
        .chars()
        .filter(|character| !character.is_control())
        .take(max_chars)
        .collect()
}

fn safe_chat_host(value: &str) -> bool {
    !value.is_empty()
        && !value.contains('/')
        && !value.contains(':')
        && (value == "bilibili.com" || value.ends_with(".bilibili.com"))
}

fn current_timestamp_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(u64::MAX as u128) as u64
}

fn valid_session_id(value: &str) -> bool {
    value.len() == 36
        && value
            .chars()
            .all(|character| character.is_ascii_hexdigit() || character == '-')
}

#[cfg(test)]
mod tests {
    use std::{
        sync::{atomic::AtomicBool, RwLock},
        time::{Duration, Instant},
    };

    use crate::bili::client::BiliClient;

    use super::{
        packet, process_packets, safe_chat_host, LiveChatSession, LiveChatState,
        OPERATION_NOTIFICATION,
    };

    fn test_session() -> LiveChatSession {
        LiveChatSession {
            created_at: Instant::now(),
            stopped: AtomicBool::new(false),
            state: RwLock::new(LiveChatState::default()),
        }
    }

    #[test]
    fn builds_big_endian_bilibili_packets() {
        let packet = packet(7, b"{}");
        assert_eq!(u32::from_be_bytes(packet[0..4].try_into().unwrap()), 18);
        assert_eq!(u16::from_be_bytes(packet[4..6].try_into().unwrap()), 16);
        assert_eq!(u32::from_be_bytes(packet[8..12].try_into().unwrap()), 7);
    }

    #[test]
    fn parses_and_deduplicates_danmaku_messages() {
        let session = test_session();
        let payload = r#"{
            "cmd": "DANMU_MSG",
            "info": [
                [0, 1, 25, 16777215, 1793000000000],
                "测试弹幕",
                [42, "观众", 1, 0, 3],
                [12, "粉丝牌", "主播"]
            ]
        }"#
        .as_bytes();
        let frame = packet(OPERATION_NOTIFICATION, payload);
        process_packets(&session, &frame, 0).expect("first packet");
        process_packets(&session, &frame, 0).expect("duplicate packet");

        let state = session.state.read().expect("state");
        assert_eq!(state.messages.len(), 1);
        let message = state.messages.front().expect("message");
        assert_eq!(message.username, "观众");
        assert_eq!(message.text, "测试弹幕");
        assert_eq!(message.guard_level, 3);
        assert!(message.is_admin);
        assert_eq!(message.medal.as_ref().expect("medal").name, "粉丝牌");
    }

    #[test]
    fn ignores_viewer_unsafe_or_payment_messages() {
        let session = test_session();
        let payload = r#"{"cmd":"SEND_GIFT","data":{"giftName":"礼物"}}"#.as_bytes();
        let frame = packet(OPERATION_NOTIFICATION, payload);
        process_packets(&session, &frame, 0).expect("packet");

        assert!(session.state.read().expect("state").messages.is_empty());
    }

    #[test]
    fn bounds_message_identifiers_and_rejects_non_bilibili_hosts() {
        let session = test_session();
        let payload = serde_json::json!({
            "cmd": "DANMU_MSG",
            "info": [
                [0, 1, 25, 16777215, 1_793_000_000_000_u64],
                "x".repeat(10_000),
                ["9".repeat(10_000), "观众", 0, 0, 0]
            ]
        })
        .to_string();
        let frame = packet(OPERATION_NOTIFICATION, payload.as_bytes());
        process_packets(&session, &frame, 0).expect("packet");

        let state = session.state.read().expect("state");
        let message = state.messages.front().expect("message");
        assert!(message.id.len() < 160);
        assert!(message.uid.len() <= 64);
        assert!(safe_chat_host("broadcastlv.chat.bilibili.com"));
        assert!(!safe_chat_host("bilibili.com.example.net"));
        assert!(!safe_chat_host("127.0.0.1"));
    }

    #[ignore = "requires network access to Bilibili"]
    #[tokio::test]
    async fn live_chat_connection_smoke() {
        let client = BiliClient::new().expect("client");
        let page = client
            .live_rooms(None, None, 1, 12)
            .await
            .expect("live rooms");
        let room = page
            .rooms
            .iter()
            .find(|room| room.live_status == 1)
            .expect("live room");
        let chat = client
            .start_live_chat(room.room_id)
            .await
            .expect("start live chat");

        let mut poll = client
            .poll_live_chat(&chat.session_id, 0)
            .expect("poll live chat");
        for _ in 0..40 {
            if poll.connected {
                break;
            }
            tokio::time::sleep(Duration::from_millis(500)).await;
            poll = client
                .poll_live_chat(&chat.session_id, 0)
                .expect("poll live chat");
        }
        client
            .stop_live_chat(&chat.session_id)
            .expect("stop live chat");

        assert!(poll.connected, "live chat failed: {:?}", poll.error);
    }
}
