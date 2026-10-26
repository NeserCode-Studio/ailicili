use std::collections::{BTreeMap, BTreeSet};

use reqwest::{
    header::{COOKIE, REFERER},
    Client,
};
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;

use super::{
    client::BiliClient,
    error::BiliError,
    types::image_url,
    wbi::{should_refresh_wbi, sign_query, unix_timestamp},
};

const SEARCH_URL: &str = "https://api.bilibili.com/x/web-interface/wbi/search/type";
const SUGGEST_URL: &str = "https://s.search.bilibili.com/main/suggest";
const SPI_URL: &str = "https://api.bilibili.com/x/frontend/finger/spi";
const DEFAULT_PAGE_SIZE: u32 = 20;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SearchKind {
    Video,
    User,
    Pgc,
    Live,
}

impl SearchKind {
    pub fn parse(value: &str) -> Result<Self, BiliError> {
        match value {
            "video" => Ok(Self::Video),
            "user" => Ok(Self::User),
            "pgc" => Ok(Self::Pgc),
            "live" => Ok(Self::Live),
            _ => Err(BiliError::InvalidInput("unsupported search type")),
        }
    }

    fn api_type(self) -> &'static str {
        match self {
            Self::Video => "video",
            Self::User => "bili_user",
            Self::Pgc => "media_bangumi",
            Self::Live => "live",
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchPage {
    pub query: String,
    pub kind: SearchKind,
    pub page: u32,
    pub page_size: u32,
    pub total: u64,
    pub has_more: bool,
    pub items: Vec<SearchItem>,
}

#[derive(Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum SearchItem {
    Video {
        bvid: String,
        title: String,
        cover_url: String,
        author: String,
        duration_seconds: u32,
        views: u64,
        published_at: Option<u64>,
    },
    User {
        mid: String,
        name: String,
        avatar_url: String,
        bio: String,
        followers: u64,
        videos: u64,
        level: u32,
        target_url: String,
    },
    Pgc {
        season_id: String,
        title: String,
        cover_url: String,
        subtitle: String,
        description: String,
        score: Option<f32>,
        target_url: String,
    },
    Live {
        room_id: String,
        title: String,
        cover_url: String,
        anchor_name: String,
        anchor_avatar_url: String,
        area_name: String,
        online: u64,
        target_url: String,
    },
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchSuggestion {
    pub value: String,
    pub label: String,
}

enum SearchAttemptError {
    Wbi(BiliError),
    Fatal(BiliError),
}

#[derive(Deserialize)]
struct SearchData<T> {
    #[serde(default)]
    page: u32,
    #[serde(default, rename = "pagesize")]
    page_size: u32,
    #[serde(default, rename = "numResults")]
    total: u64,
    #[serde(default, rename = "numPages")]
    num_pages: u32,
    result: Option<T>,
    #[serde(default)]
    pageinfo: Option<LivePageInfo>,
}

#[derive(Default, Deserialize)]
struct LivePageInfo {
    #[serde(default)]
    live_room: LivePageCount,
}

#[derive(Default, Deserialize)]
struct LivePageCount {
    #[serde(default, rename = "numResults")]
    total: u64,
    #[serde(default, rename = "numPages")]
    num_pages: u32,
}

#[derive(Deserialize)]
struct Envelope<T> {
    code: i64,
    #[serde(default)]
    message: String,
    data: Option<T>,
}

#[derive(Default, Deserialize)]
struct RawVideo {
    #[serde(default)]
    bvid: String,
    #[serde(default)]
    title: String,
    #[serde(default)]
    author: String,
    #[serde(default)]
    pic: String,
    #[serde(default)]
    duration: Option<Value>,
    #[serde(default, deserialize_with = "deserialize_optional_u64")]
    play: Option<u64>,
    #[serde(default, deserialize_with = "deserialize_optional_u64")]
    pubdate: Option<u64>,
}

#[derive(Default, Deserialize)]
struct RawUser {
    #[serde(default, deserialize_with = "deserialize_optional_u64")]
    mid: Option<u64>,
    #[serde(default)]
    uname: String,
    #[serde(default)]
    usign: String,
    #[serde(default)]
    upic: String,
    #[serde(default, deserialize_with = "deserialize_optional_u64")]
    fans: Option<u64>,
    #[serde(default, deserialize_with = "deserialize_optional_u64")]
    videos: Option<u64>,
    #[serde(default, deserialize_with = "deserialize_optional_u64")]
    level: Option<u64>,
}

#[derive(Default, Deserialize)]
struct RawPgc {
    #[serde(default, deserialize_with = "deserialize_optional_u64")]
    season_id: Option<u64>,
    #[serde(default, deserialize_with = "deserialize_optional_u64")]
    media_id: Option<u64>,
    #[serde(default)]
    title: String,
    #[serde(default)]
    cover: String,
    #[serde(default)]
    index_show: String,
    #[serde(default)]
    desc: String,
    #[serde(default)]
    media_score: Option<RawMediaScore>,
}

#[derive(Default, Deserialize)]
struct RawMediaScore {
    #[serde(default)]
    score: Option<f32>,
}

#[derive(Default, Deserialize)]
struct RawLiveData {
    #[serde(default)]
    live_room: Vec<RawLiveRoom>,
}

#[derive(Default, Deserialize)]
struct RawLiveRoom {
    #[serde(default, deserialize_with = "deserialize_optional_u64")]
    roomid: Option<u64>,
    #[serde(default)]
    title: String,
    #[serde(default)]
    cover: String,
    #[serde(default)]
    uname: String,
    #[serde(default)]
    uface: String,
    #[serde(default)]
    cate_name: String,
    #[serde(default, deserialize_with = "deserialize_optional_u64")]
    online: Option<u64>,
}

#[derive(Deserialize)]
struct SpiData {
    b_3: String,
    #[serde(default)]
    b_4: String,
}

#[derive(Deserialize)]
struct SuggestData {
    #[serde(default)]
    tag: Vec<RawSuggestion>,
}

#[derive(Deserialize)]
struct RawSuggestion {
    #[serde(default)]
    value: Option<String>,
    #[serde(default)]
    name: Option<String>,
}

impl BiliClient {
    pub async fn search(
        &self,
        query: &str,
        kind: SearchKind,
        page: u32,
    ) -> Result<SearchPage, BiliError> {
        let query = normalize_query(query)?;
        let page = page.clamp(1, 50);
        let cookie_header = self.search_cookie_header().await?;
        let first_keys = self
            .wbi
            .keys(&self.http, Some(&cookie_header), false)
            .await?;

        let data = match self
            .search_once(&query, kind, page, &cookie_header, &first_keys)
            .await
        {
            Ok(data) => data,
            Err(SearchAttemptError::Fatal(error)) => return Err(error),
            Err(SearchAttemptError::Wbi(_)) => {
                let refreshed = self
                    .wbi
                    .keys(&self.http, Some(&cookie_header), true)
                    .await?;
                match self
                    .search_once(&query, kind, page, &cookie_header, &refreshed)
                    .await
                {
                    Ok(data) => data,
                    Err(SearchAttemptError::Wbi(error) | SearchAttemptError::Fatal(error)) => {
                        return Err(error);
                    }
                }
            }
        };

        map_search_page(query, kind, page, data)
    }

    pub async fn search_suggestions(&self, term: &str) -> Result<Vec<SearchSuggestion>, BiliError> {
        let term = normalize_query(term)?;
        let cookie_header = self.search_cookie_header().await.ok();
        let mut request = self
            .http
            .get(SUGGEST_URL)
            .header(REFERER, "https://search.bilibili.com/")
            .query(&[("term", term)]);
        if let Some(cookie_header) = cookie_header {
            request = request.header(COOKIE, cookie_header);
        }
        let response = request.send().await?;
        let status = response.status();
        if !status.is_success() {
            return Err(BiliError::HttpStatus(status.as_u16()));
        }
        let envelope: Envelope<SuggestData> = response.json().await?;
        if envelope.code != 0 {
            return Err(BiliError::Upstream {
                code: envelope.code,
                message: envelope.message.chars().take(160).collect(),
            });
        }
        let data = envelope.data.ok_or(BiliError::MissingData)?;
        let mut seen = BTreeSet::new();
        Ok(data
            .tag
            .into_iter()
            .filter_map(|item| {
                let value = clean_text(item.value.as_deref()?);
                if value.is_empty() || !seen.insert(value.clone()) {
                    return None;
                }
                Some(SearchSuggestion {
                    label: item
                        .name
                        .map(|name| clean_text(&name))
                        .filter(|name| !name.is_empty())
                        .unwrap_or_else(|| value.clone()),
                    value,
                })
            })
            .take(8)
            .collect())
    }

    async fn search_once(
        &self,
        query: &str,
        kind: SearchKind,
        page: u32,
        cookie_header: &str,
        keys: &super::wbi::WbiKeys,
    ) -> Result<Value, SearchAttemptError> {
        let mut params = BTreeMap::from([
            ("keyword".to_owned(), query.to_owned()),
            ("page".to_owned(), page.to_string()),
            ("pagesize".to_owned(), DEFAULT_PAGE_SIZE.to_string()),
            ("search_type".to_owned(), kind.api_type().to_owned()),
        ]);
        match kind {
            SearchKind::Video => {
                params.insert("duration".to_owned(), "0".to_owned());
                params.insert("order".to_owned(), "totalrank".to_owned());
                params.insert("tids".to_owned(), "0".to_owned());
            }
            SearchKind::User => {
                params.insert("order".to_owned(), "totalrank".to_owned());
                params.insert("order_sort".to_owned(), "0".to_owned());
                params.insert("user_type".to_owned(), "0".to_owned());
            }
            SearchKind::Pgc | SearchKind::Live => {}
        }
        let signed_query = sign_query(params, keys, unix_timestamp());
        let response = self
            .http
            .get(format!("{SEARCH_URL}?{signed_query}"))
            .header(COOKIE, cookie_header)
            .send()
            .await
            .map_err(|error| SearchAttemptError::Fatal(error.into()))?;
        let status = response.status();
        if !status.is_success() {
            return Err(SearchAttemptError::Fatal(BiliError::HttpStatus(
                status.as_u16(),
            )));
        }
        let envelope: Envelope<Value> = response
            .json()
            .await
            .map_err(|error| SearchAttemptError::Fatal(error.into()))?;
        if envelope.code != 0 {
            let error = BiliError::Upstream {
                code: envelope.code,
                message: envelope.message.chars().take(160).collect(),
            };
            return if should_refresh_wbi(envelope.code, &envelope.message) {
                Err(SearchAttemptError::Wbi(error))
            } else {
                Err(SearchAttemptError::Fatal(error))
            };
        }
        let data = envelope
            .data
            .ok_or_else(|| SearchAttemptError::Fatal(BiliError::MissingData))?;
        if data
            .get("v_voucher")
            .and_then(Value::as_str)
            .is_some_and(|value| !value.is_empty())
        {
            return Err(SearchAttemptError::Wbi(BiliError::InvalidResponse(
                "WBI challenge",
            )));
        }
        Ok(data)
    }

    pub(crate) async fn search_cookie_header(&self) -> Result<String, BiliError> {
        let session_header = self.session.cookie_header().await;
        let mut cookies = self.guest_cookies.read().await.clone().unwrap_or_default();
        if cookies.is_empty() {
            match issue_guest_identity(&self.http).await {
                Ok(issued) => {
                    cookies = issued;
                    *self.guest_cookies.write().await = Some(cookies.clone());
                }
                Err(error) if session_header.is_none() => return Err(error),
                Err(_) => {}
            }
        }

        let mut parts = cookies
            .into_iter()
            .map(|(name, value)| format!("{name}={value}"))
            .collect::<Vec<_>>();
        if let Some(session_header) = session_header {
            parts.push(session_header);
        }
        Ok(parts.join("; "))
    }
}

async fn issue_guest_identity(http: &Client) -> Result<BTreeMap<String, String>, BiliError> {
    let response = http
        .get(SPI_URL)
        .header(REFERER, "https://www.bilibili.com/")
        .send()
        .await?;
    let status = response.status();
    if !status.is_success() {
        return Err(BiliError::HttpStatus(status.as_u16()));
    }
    let envelope: Envelope<SpiData> = response.json().await?;
    if envelope.code != 0 {
        return Err(BiliError::Upstream {
            code: envelope.code,
            message: envelope.message.chars().take(160).collect(),
        });
    }
    let data = envelope.data.ok_or(BiliError::MissingData)?;
    if data.b_3.is_empty() {
        return Err(BiliError::InvalidResponse("missing guest buvid3"));
    }

    let mut cookies = BTreeMap::from([("buvid3".to_owned(), data.b_3)]);
    if !data.b_4.is_empty() {
        cookies.insert("buvid4".to_owned(), data.b_4);
    }
    Ok(cookies)
}

fn map_search_page(
    query: String,
    kind: SearchKind,
    requested_page: u32,
    value: Value,
) -> Result<SearchPage, BiliError> {
    match kind {
        SearchKind::Video => {
            let mut data: SearchData<Vec<RawVideo>> = serde_json::from_value(value)
                .map_err(|_| BiliError::InvalidResponse("invalid video search data"))?;
            let items = data
                .result
                .take()
                .unwrap_or_default()
                .into_iter()
                .filter_map(map_video)
                .collect::<Vec<_>>();
            Ok(build_page(query, kind, requested_page, data, items))
        }
        SearchKind::User => {
            let mut data: SearchData<Vec<RawUser>> = serde_json::from_value(value)
                .map_err(|_| BiliError::InvalidResponse("invalid user search data"))?;
            let items = data
                .result
                .take()
                .unwrap_or_default()
                .into_iter()
                .filter_map(map_user)
                .collect::<Vec<_>>();
            Ok(build_page(query, kind, requested_page, data, items))
        }
        SearchKind::Pgc => {
            let mut data: SearchData<Vec<RawPgc>> = serde_json::from_value(value)
                .map_err(|_| BiliError::InvalidResponse("invalid PGC search data"))?;
            let items = data
                .result
                .take()
                .unwrap_or_default()
                .into_iter()
                .filter_map(map_pgc)
                .collect::<Vec<_>>();
            Ok(build_page(query, kind, requested_page, data, items))
        }
        SearchKind::Live => {
            let data: SearchData<RawLiveData> = serde_json::from_value(value)
                .map_err(|_| BiliError::InvalidResponse("invalid live search data"))?;
            let items = data
                .result
                .as_ref()
                .map(|result| {
                    result
                        .live_room
                        .iter()
                        .filter_map(map_live_room)
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            Ok(build_page(query, kind, requested_page, data, items))
        }
    }
}

fn build_page<T>(
    query: String,
    kind: SearchKind,
    requested_page: u32,
    data: SearchData<T>,
    items: Vec<SearchItem>,
) -> SearchPage {
    let page = if data.page == 0 {
        requested_page
    } else {
        data.page
    };
    let page_size = if data.page_size == 0 {
        DEFAULT_PAGE_SIZE
    } else {
        data.page_size
    };
    let live_page = data.pageinfo.map(|info| info.live_room);
    let total = if kind == SearchKind::Live {
        live_page
            .as_ref()
            .map(|info| info.total)
            .unwrap_or(data.total)
    } else {
        data.total
    };
    let num_pages = if kind == SearchKind::Live {
        live_page
            .as_ref()
            .map(|info| info.num_pages)
            .unwrap_or(data.num_pages)
    } else {
        data.num_pages
    };
    let has_more = num_pages > page || (num_pages == 0 && items.len() >= page_size as usize);
    SearchPage {
        query,
        kind,
        page,
        page_size,
        total,
        has_more,
        items,
    }
}

fn map_video(raw: RawVideo) -> Option<SearchItem> {
    if !is_valid_bvid(&raw.bvid) {
        return None;
    }
    Some(SearchItem::Video {
        bvid: raw.bvid,
        title: clean_text(&raw.title),
        cover_url: image_url(&raw.pic, "@672w_378h_1c.webp"),
        author: clean_text(&raw.author),
        duration_seconds: parse_duration(raw.duration.as_ref()).unwrap_or_default(),
        views: raw.play.unwrap_or_default(),
        published_at: raw.pubdate,
    })
}

fn map_user(raw: RawUser) -> Option<SearchItem> {
    let mid = raw.mid?;
    if mid == 0 {
        return None;
    }
    Some(SearchItem::User {
        mid: mid.to_string(),
        name: clean_text(&raw.uname),
        avatar_url: image_url(&raw.upic, "@128w_128h_1c.webp"),
        bio: clean_text(&raw.usign),
        followers: raw.fans.unwrap_or_default(),
        videos: raw.videos.unwrap_or_default(),
        level: raw.level.unwrap_or_default().min(u32::MAX as u64) as u32,
        target_url: format!("https://space.bilibili.com/{mid}"),
    })
}

fn map_pgc(raw: RawPgc) -> Option<SearchItem> {
    let season_id = raw.season_id.filter(|value| *value > 0);
    let media_id = raw.media_id.filter(|value| *value > 0);
    let target_url = if let Some(season_id) = season_id {
        format!("https://www.bilibili.com/bangumi/play/ss{season_id}")
    } else if let Some(media_id) = media_id {
        format!("https://www.bilibili.com/bangumi/media/md{media_id}")
    } else {
        return None;
    };
    Some(SearchItem::Pgc {
        season_id: season_id.unwrap_or_default().to_string(),
        title: clean_text(&raw.title),
        cover_url: image_url(&raw.cover, "@672w_378h_1c.webp"),
        subtitle: clean_text(&raw.index_show),
        description: clean_text(&raw.desc),
        score: raw.media_score.and_then(|score| score.score),
        target_url,
    })
}

fn map_live_room(raw: &RawLiveRoom) -> Option<SearchItem> {
    let room_id = raw.roomid?;
    if room_id == 0 {
        return None;
    }
    Some(SearchItem::Live {
        room_id: room_id.to_string(),
        title: clean_text(&raw.title),
        cover_url: image_url(&raw.cover, "@672w_378h_1c.webp"),
        anchor_name: clean_text(&raw.uname),
        anchor_avatar_url: image_url(&raw.uface, "@96w_96h_1c.webp"),
        area_name: clean_text(&raw.cate_name),
        online: raw.online.unwrap_or_default(),
        target_url: format!("https://live.bilibili.com/{room_id}"),
    })
}

fn normalize_query(value: &str) -> Result<String, BiliError> {
    let value = value.trim();
    if value.is_empty() {
        return Err(BiliError::InvalidInput("search query cannot be empty"));
    }
    if value.chars().count() > 100 {
        return Err(BiliError::InvalidInput("search query is too long"));
    }
    Ok(value.to_owned())
}

fn parse_duration(value: Option<&Value>) -> Option<u32> {
    match value? {
        Value::String(value) => {
            let parts = value
                .split(':')
                .map(str::parse::<u32>)
                .collect::<Result<Vec<_>, _>>()
                .ok()?;
            if parts.is_empty() || parts.len() > 3 || parts.iter().skip(1).any(|part| *part >= 60) {
                return None;
            }
            parts.into_iter().try_fold(0_u32, |total, part| {
                total.checked_mul(60)?.checked_add(part)
            })
        }
        Value::Number(value) => value.as_u64()?.try_into().ok(),
        _ => None,
    }
}

fn is_valid_bvid(value: &str) -> bool {
    value.starts_with("BV")
        && (10..=24).contains(&value.len())
        && value
            .chars()
            .all(|character| character.is_ascii_alphanumeric())
}

fn clean_text(value: &str) -> String {
    html_escape::decode_html_entities(&strip_highlight_tags(value))
        .trim()
        .to_owned()
}

fn strip_highlight_tags(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    let mut rest = value;
    while let Some(start) = rest.find('<') {
        output.push_str(&rest[..start]);
        let after_start = &rest[start..];
        let Some(end) = after_start.find('>') else {
            output.push_str(after_start);
            return output;
        };
        let tag = &after_start[1..end].trim().to_ascii_lowercase();
        if !(tag == "em" || tag == "/em" || tag.starts_with("em ")) {
            output.push_str(&after_start[..=end]);
        }
        rest = &after_start[end + 1..];
    }
    output.push_str(rest);
    output
}

fn deserialize_optional_u64<'de, D>(deserializer: D) -> Result<Option<u64>, D::Error>
where
    D: Deserializer<'de>,
{
    let value = Option::<Value>::deserialize(deserializer)?;
    Ok(match value {
        Some(Value::Number(number)) => number
            .as_u64()
            .or_else(|| number.as_i64().and_then(|value| value.try_into().ok())),
        Some(Value::String(value)) => value.trim().parse().ok(),
        _ => None,
    })
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{clean_text, map_search_page, parse_duration, SearchItem, SearchKind};
    use crate::bili::client::BiliClient;

    #[test]
    fn cleans_search_highlights_and_entities() {
        assert_eq!(
            clean_text("Rust <em class=\"keyword\">入门</em> &amp; 实战"),
            "Rust 入门 & 实战"
        );
        assert_eq!(clean_text("<strong>keep</strong>"), "<strong>keep</strong>");
    }

    #[test]
    fn parses_search_duration_formats() {
        assert_eq!(parse_duration(Some(&json!("03:07"))), Some(187));
        assert_eq!(parse_duration(Some(&json!("1:02:03"))), Some(3723));
        assert_eq!(parse_duration(Some(&json!(95))), Some(95));
        assert_eq!(parse_duration(Some(&json!("1:99"))), None);
    }

    #[test]
    fn maps_video_and_user_results_to_a_discriminated_union() {
        let video = map_search_page(
            "rust".to_owned(),
            SearchKind::Video,
            1,
            json!({
                "page": 1,
                "pagesize": 20,
                "numResults": 2,
                "numPages": 1,
                "result": [{
                    "type": "video",
                    "bvid": "BV1xx411c7mD",
                    "title": "<em class=\"keyword\">Rust</em> 教程",
                    "author": "UP",
                    "pic": "//i0.hdslb.com/cover.jpg",
                    "duration": "03:07",
                    "play": 1234,
                    "pubdate": "1712345678"
                }]
            }),
        )
        .expect("video page");
        assert!(matches!(
            &video.items[0],
            SearchItem::Video { title, duration_seconds: 187, views: 1234, .. }
                if title == "Rust 教程"
        ));

        let user = map_search_page(
            "up".to_owned(),
            SearchKind::User,
            1,
            json!({
                "page": 1,
                "pagesize": 20,
                "numResults": 1,
                "numPages": 1,
                "result": [{
                    "mid": 42,
                    "uname": "UP主",
                    "usign": "简介",
                    "upic": "http://i0.hdslb.com/avatar.jpg",
                    "fans": 99,
                    "videos": 12,
                    "level": 6
                }]
            }),
        )
        .expect("user page");
        assert!(matches!(
            &user.items[0],
            SearchItem::User { mid, followers: 99, level: 6, .. } if mid == "42"
        ));
    }

    #[test]
    fn maps_live_rooms_and_pgc_targets() {
        let live = map_search_page(
            "live".to_owned(),
            SearchKind::Live,
            1,
            json!({
                "page": 1,
                "pagesize": 20,
                "numResults": 1,
                "numPages": 1,
                "result": {
                    "live_room": [{
                        "roomid": 123,
                        "title": "直播",
                        "cover": "//i0.hdslb.com/live.jpg",
                        "uname": "主播",
                        "uface": "",
                        "cate_name": "游戏",
                        "online": 500
                    }]
                }
            }),
        )
        .expect("live page");
        assert!(matches!(
            &live.items[0],
            SearchItem::Live { room_id, online: 500, .. } if room_id == "123"
        ));

        let pgc = map_search_page(
            "anime".to_owned(),
            SearchKind::Pgc,
            1,
            json!({
                "page": 1,
                "pagesize": 20,
                "numResults": 1,
                "numPages": 1,
                "result": [{
                    "season_id": 456,
                    "media_id": 789,
                    "title": "番剧",
                    "cover": "//i0.hdslb.com/pgc.jpg",
                    "index_show": "全 12 话",
                    "desc": "简介",
                    "media_score": { "score": 9.1 }
                }]
            }),
        )
        .expect("PGC page");
        assert!(matches!(
            &pgc.items[0],
            SearchItem::Pgc { target_url, score: Some(score), .. }
                if target_url.ends_with("/ss456") && (*score - 9.1).abs() < 0.001
        ));
    }

    #[ignore = "requires network access to Bilibili"]
    #[tokio::test]
    async fn live_search_smoke() {
        let client = BiliClient::new().expect("client");
        let page = client
            .search("Rust", SearchKind::Video, 1)
            .await
            .expect("live search");
        assert!(!page.items.is_empty());
        assert!(matches!(page.items[0], SearchItem::Video { .. }));
    }

    #[ignore = "requires network access to Bilibili"]
    #[tokio::test]
    async fn live_search_all_types_smoke() {
        let client = BiliClient::new().expect("client");
        for (kind, query) in [
            (SearchKind::Video, "孤独摇滚"),
            (SearchKind::User, "孤独摇滚"),
            (SearchKind::Pgc, "孤独摇滚"),
            (SearchKind::Live, "孤独摇滚"),
        ] {
            let page = client.search(query, kind, 1).await.expect("live search");
            println!(
                "kind={kind:?} total={} mapped={}",
                page.total,
                page.items.len()
            );
            assert!(page.total > 0, "expected results for {kind:?}");
            assert!(
                !page.items.is_empty(),
                "expected mapped results for {kind:?}"
            );
        }
    }
}
