use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::{client::BiliClient, error::BiliError, types::image_url};

const DYNAMIC_FEED_PATH: &str = "/x/polymer/web-dynamic/v1/feed/all";
const DYNAMIC_FEATURES: &str = "itemOpusStyle,listOnlyfans,opusBigCover,onlyfansVote,decorationCard,onlyfansAssetsV2,forwardListHidden,ugcDelete";
const MAX_IMAGES: usize = 9;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DynamicPage {
    pub items: Vec<DynamicItem>,
    pub offset: String,
    pub update_baseline: String,
    pub has_more: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DynamicItem {
    pub id: String,
    pub kind: String,
    pub author: DynamicAuthor,
    pub published_at: i64,
    pub text: String,
    pub images: Vec<DynamicImage>,
    pub video: Option<DynamicVideo>,
    pub stats: DynamicStats,
    pub target_url: String,
    pub only_fans: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DynamicAuthor {
    pub mid: String,
    pub name: String,
    pub avatar_url: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DynamicImage {
    pub url: String,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DynamicVideo {
    pub bvid: String,
    pub title: String,
    pub cover_url: String,
    pub duration_seconds: u32,
    pub views: u64,
    pub danmaku: u64,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DynamicStats {
    pub likes: u64,
    pub comments: u64,
    pub forwards: u64,
}

impl BiliClient {
    pub async fn dynamic_feed(&self, offset: Option<String>) -> Result<DynamicPage, BiliError> {
        let offset = offset.unwrap_or_default();
        if offset.len() > 512
            || !offset
                .chars()
                .all(|character| character.is_ascii_alphanumeric() || "_-=".contains(character))
        {
            return Err(BiliError::InvalidInput("invalid dynamic cursor"));
        }

        let mut query = vec![
            ("features", DYNAMIC_FEATURES.to_owned()),
            ("web_location", "333.1365".to_owned()),
        ];
        if !offset.is_empty() {
            query.push(("offset", offset));
        }
        let data: RawDynamicPage = self.get_authenticated(DYNAMIC_FEED_PATH, &query).await?;
        Ok(map_dynamic_page(data))
    }
}

#[derive(Debug, Default, Deserialize)]
struct RawDynamicPage {
    #[serde(default)]
    items: Vec<RawDynamicItem>,
    #[serde(default)]
    offset: String,
    #[serde(default)]
    update_baseline: String,
    #[serde(default)]
    has_more: bool,
}

#[derive(Debug, Default, Deserialize)]
struct RawDynamicItem {
    #[serde(default)]
    id_str: String,
    #[serde(default, rename = "type")]
    kind: String,
    #[serde(default)]
    visible: bool,
    #[serde(default)]
    basic: RawDynamicBasic,
    #[serde(default)]
    modules: Value,
}

#[derive(Debug, Default, Deserialize)]
struct RawDynamicBasic {
    #[serde(default)]
    jump_url: String,
    #[serde(default)]
    is_only_fans: bool,
}

fn map_dynamic_page(data: RawDynamicPage) -> DynamicPage {
    DynamicPage {
        items: data
            .items
            .into_iter()
            .filter(|item| item.visible)
            .filter_map(map_dynamic_item)
            .collect(),
        offset: data.offset,
        update_baseline: data.update_baseline,
        has_more: data.has_more,
    }
}

fn map_dynamic_item(item: RawDynamicItem) -> Option<DynamicItem> {
    if item.id_str.is_empty()
        || item.id_str.len() > 32
        || !item
            .id_str
            .chars()
            .all(|character| character.is_ascii_digit())
    {
        return None;
    }

    let author = item.modules.pointer("/module_author")?;
    let author_mid = u64_at(author, "/mid")
        .or_else(|| i64_at(author, "/mid").and_then(|value| value.try_into().ok()))
        .unwrap_or_default();
    let author_name = clean_text(string_at(author, "/name").as_deref().unwrap_or(""));
    if author_mid == 0 || author_name.is_empty() {
        return None;
    }

    let video = map_video(&item.modules);
    let text = dynamic_text(&item.modules);
    let images = dynamic_images(&item.modules);
    if text.is_empty() && images.is_empty() && video.is_none() {
        return None;
    }

    let authors_published_at = i64_at(author, "/pub_ts").unwrap_or_default();
    let target_url = video
        .as_ref()
        .map(|video| format!("https://www.bilibili.com/video/{}", video.bvid))
        .or_else(|| safe_jump_url(&item.basic.jump_url))
        .unwrap_or_else(|| format!("https://t.bilibili.com/{}", item.id_str));
    let kind = match item.kind.as_str() {
        "DYNAMIC_TYPE_AV" => "video",
        "DYNAMIC_TYPE_DRAW" => "image",
        "DYNAMIC_TYPE_ARTICLE" => "article",
        "DYNAMIC_TYPE_FORWARD" => "forward",
        _ => "text",
    };

    Some(DynamicItem {
        id: item.id_str,
        kind: kind.to_owned(),
        author: DynamicAuthor {
            mid: author_mid.to_string(),
            name: author_name,
            avatar_url: image_url(
                string_at(author, "/face").as_deref().unwrap_or(""),
                "@96w_96h_1c.webp",
            ),
        },
        published_at: authors_published_at,
        text,
        images,
        video,
        stats: DynamicStats {
            likes: u64_at(&item.modules, "/module_stat/like/count").unwrap_or_default(),
            comments: u64_at(&item.modules, "/module_stat/comment/count").unwrap_or_default(),
            forwards: u64_at(&item.modules, "/module_stat/forward/count").unwrap_or_default(),
        },
        target_url,
        only_fans: item.basic.is_only_fans,
    })
}

fn dynamic_text(modules: &Value) -> String {
    [
        "/module_dynamic/desc/text",
        "/module_dynamic/major/opus/summary/text",
        "/module_dynamic/major/opus/title",
        "/module_dynamic/major/article/title",
        "/module_dynamic/major/article/desc",
    ]
    .into_iter()
    .filter_map(|path| string_at(modules, path))
    .map(|value| clean_text(&value))
    .find(|value| !value.is_empty())
    .unwrap_or_default()
}

fn dynamic_images(modules: &Value) -> Vec<DynamicImage> {
    let mut images = Vec::new();
    let mut seen = std::collections::HashSet::new();

    for (path, url_key) in [
        ("/module_dynamic/major/draw/items", "src"),
        ("/module_dynamic/major/opus/pics", "url"),
    ] {
        let Some(values) = modules.pointer(path).and_then(Value::as_array) else {
            continue;
        };
        for value in values {
            let Some(raw_url) = value.get(url_key).and_then(Value::as_str) else {
                continue;
            };
            let url = image_url(raw_url, "@960w_960h_1e_1c.webp");
            if url.is_empty() || !seen.insert(url.clone()) {
                continue;
            }
            images.push(DynamicImage {
                url,
                width: u64_at(value, "/width")
                    .unwrap_or_default()
                    .min(u32::MAX as u64) as u32,
                height: u64_at(value, "/height")
                    .unwrap_or_default()
                    .min(u32::MAX as u64) as u32,
            });
            if images.len() >= MAX_IMAGES {
                return images;
            }
        }
    }
    images
}

fn map_video(modules: &Value) -> Option<DynamicVideo> {
    let archive = modules.pointer("/module_dynamic/major/archive")?;
    let bvid = string_at(archive, "/bvid")?;
    if !super::client::validate_bvid(&bvid).is_ok() {
        return None;
    }
    Some(DynamicVideo {
        bvid,
        title: clean_text(string_at(archive, "/title").as_deref().unwrap_or("")),
        cover_url: image_url(
            string_at(archive, "/cover").as_deref().unwrap_or(""),
            "@672w_378h_1c.webp",
        ),
        duration_seconds: parse_duration(
            string_at(archive, "/duration_text")
                .as_deref()
                .unwrap_or(""),
        ),
        views: compact_count(string_at(archive, "/stat/play").as_deref().unwrap_or("")),
        danmaku: compact_count(string_at(archive, "/stat/danmaku").as_deref().unwrap_or("")),
    })
}

fn string_at(value: &Value, path: &str) -> Option<String> {
    value.pointer(path)?.as_str().map(str::to_owned)
}

fn u64_at(value: &Value, path: &str) -> Option<u64> {
    value.pointer(path)?.as_u64()
}

fn i64_at(value: &Value, path: &str) -> Option<i64> {
    value.pointer(path)?.as_i64()
}

fn clean_text(value: &str) -> String {
    html_escape::decode_html_entities(value)
        .chars()
        .filter(|character| *character == '\n' || *character == '\t' || !character.is_control())
        .take(4000)
        .collect()
}

fn parse_duration(value: &str) -> u32 {
    value
        .split(':')
        .map(str::parse::<u32>)
        .collect::<Result<Vec<_>, _>>()
        .ok()
        .filter(|parts| !parts.is_empty() && parts.len() <= 3)
        .and_then(|parts| {
            parts.into_iter().try_fold(0_u32, |total, part| {
                total.checked_mul(60)?.checked_add(part)
            })
        })
        .unwrap_or_default()
}

fn compact_count(value: &str) -> u64 {
    let value = value.trim();
    let (number, multiplier) = if let Some(value) = value.strip_suffix('亿') {
        (value, 100_000_000_f64)
    } else if let Some(value) = value.strip_suffix('万') {
        (value, 10_000_f64)
    } else {
        (value, 1_f64)
    };
    number
        .parse::<f64>()
        .ok()
        .filter(|value| value.is_finite() && *value >= 0.0)
        .map(|value| (value * multiplier).round() as u64)
        .unwrap_or_default()
}

fn safe_jump_url(value: &str) -> Option<String> {
    let value = if value.starts_with("//") {
        format!("https:{value}")
    } else {
        value.to_owned()
    };
    let url = reqwest::Url::parse(&value).ok()?;
    let host = url.host_str()?.to_ascii_lowercase();
    let allowed = host == "bilibili.com" || host.ends_with(".bilibili.com") || host == "b23.tv";
    (url.scheme() == "https" && allowed).then(|| url.to_string())
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{compact_count, map_dynamic_page, parse_duration, RawDynamicPage};

    #[test]
    fn maps_video_dynamic_into_stable_dto() {
        let raw: RawDynamicPage = serde_json::from_value(json!({
            "has_more": true,
            "offset": "next_cursor-1",
            "update_baseline": "baseline",
            "items": [{
                "id_str": "123456789",
                "type": "DYNAMIC_TYPE_AV",
                "visible": true,
                "basic": { "jump_url": "//t.bilibili.com/123456789" },
                "modules": {
                    "module_author": {
                        "mid": 42,
                        "name": "测试 UP",
                        "face": "//i0.hdslb.com/avatar.jpg",
                        "pub_ts": 100
                    },
                    "module_dynamic": {
                        "desc": { "text": "动态正文" },
                        "major": {
                            "archive": {
                                "bvid": "BV1xx411c7mD",
                                "title": "视频标题",
                                "cover": "//i1.hdslb.com/cover.jpg",
                                "duration_text": "01:02",
                                "stat": { "play": "1.2万", "danmaku": "42" }
                            }
                        }
                    },
                    "module_stat": {
                        "comment": { "count": 3 },
                        "forward": { "count": 4 },
                        "like": { "count": 5 }
                    }
                }
            }]
        }))
        .expect("dynamic fixture");
        let page = map_dynamic_page(raw);
        assert_eq!(page.items.len(), 1);
        assert_eq!(page.items[0].author.mid, "42");
        assert_eq!(page.items[0].video.as_ref().unwrap().views, 12_000);
        assert_eq!(page.items[0].video.as_ref().unwrap().duration_seconds, 62);
        assert_eq!(page.items[0].stats.likes, 5);
        assert_eq!(
            page.items[0].target_url,
            "https://www.bilibili.com/video/BV1xx411c7mD"
        );
    }

    #[test]
    fn rejects_invisible_and_unsafe_items() {
        let raw: RawDynamicPage = serde_json::from_value(json!({
            "items": [
                { "id_str": "1", "visible": false },
                {
                    "id_str": "2",
                    "type": "DYNAMIC_TYPE_WORD",
                    "visible": true,
                    "basic": { "jump_url": "javascript:alert(1)" },
                    "modules": {
                        "module_author": { "mid": 1, "name": "UP", "pub_ts": 1 },
                        "module_dynamic": { "desc": { "text": "hello" } }
                    }
                }
            ]
        }))
        .expect("dynamic fixture");
        let page = map_dynamic_page(raw);
        assert_eq!(page.items.len(), 1);
        assert_eq!(page.items[0].target_url, "https://t.bilibili.com/2");
    }

    #[test]
    fn parses_bounded_media_metadata() {
        assert_eq!(parse_duration("1:02:03"), 3723);
        assert_eq!(parse_duration("bad"), 0);
        assert_eq!(compact_count("1.5万"), 15_000);
        assert_eq!(compact_count("2.1亿"), 210_000_000);
        assert_eq!(compact_count(""), 0);
    }
}
