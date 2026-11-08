use crate::domain::{
    PagedVideos, PlaybackInfo, StreamProtocol, StreamSource, VideoCard, VideoDetail, VideoPage,
    VideoStats,
};
use serde_json::Value;
use std::time::Duration;

const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const API_BASE: &str = "https://api.bilibili.com";

#[derive(Debug, thiserror::Error)]
pub enum BiliError {
    #[error("network: {0}")]
    Network(#[from] reqwest::Error),
    #[error("api code {code}: {message}")]
    Api { code: i64, message: String },
    #[error("invalid response: {0}")]
    Invalid(String),
}

#[derive(Debug, Clone)]
pub struct BilibiliClient {
    http: reqwest::Client,
}

impl BilibiliClient {
    pub fn new() -> Result<Self, BiliError> {
        let http = reqwest::Client::builder()
            .user_agent(USER_AGENT)
            .timeout(Duration::from_secs(15))
            .build()?;
        Ok(Self { http })
    }

    async fn get_json(&self, path: &str, query: &[(&str, String)]) -> Result<Value, BiliError> {
        let response = self
            .http
            .get(format!("{API_BASE}{path}"))
            .header("referer", "https://www.bilibili.com/")
            .query(query)
            .send()
            .await?
            .error_for_status()?;
        let root: Value = response.json().await?;
        let code = root
            .get("code")
            .and_then(Value::as_i64)
            .ok_or_else(|| BiliError::Invalid("missing code".to_string()))?;
        if code != 0 {
            return Err(BiliError::Api {
                code,
                message: root
                    .get("message")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
            });
        }
        Ok(root)
    }

    pub async fn popular(&self, page: u32) -> Result<PagedVideos, BiliError> {
        let root = self
            .get_json(
                "/x/web-interface/popular",
                &[("ps", "20".to_string()), ("pn", page.to_string())],
            )
            .await?;
        let items = root
            .pointer("/data/list")
            .and_then(Value::as_array)
            .ok_or_else(|| BiliError::Invalid("missing popular list".to_string()))?
            .iter()
            .filter_map(parse_card)
            .collect::<Vec<_>>();
        let has_more = items.len() == 20;
        Ok(PagedVideos { page, items, has_more })
    }

    pub async fn video_detail(&self, video_id: &str) -> Result<VideoDetail, BiliError> {
        let root = self
            .get_json("/x/web-interface/view", &[("bvid", video_id.to_string())])
            .await?;
        let data = root
            .get("data")
            .ok_or_else(|| BiliError::Invalid("missing detail data".to_string()))?;
        let mut card = parse_card(data)
            .ok_or_else(|| BiliError::Invalid("invalid detail card".to_string()))?;
        card.source_kind = "detail".to_string();
        let mut pages = data
            .get("pages")
            .and_then(Value::as_array)
            .map(|pages| {
                pages
                    .iter()
                    .filter_map(|page| {
                        let cid = page.get("cid")?.as_i64()?;
                        Some(VideoPage {
                            page_index: page.get("page").and_then(Value::as_u64).unwrap_or_default() as u32,
                            cid,
                            title: page
                                .get("part")
                                .and_then(Value::as_str)
                                .or_else(|| page.get("title").and_then(Value::as_str))
                                .unwrap_or_default()
                                .to_string(),
                            duration: page.get("duration").and_then(Value::as_i64),
                        })
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();

        if pages.is_empty() {
            if let Some(cid) = card.cid {
                pages.push(VideoPage {
                    page_index: 1,
                    cid,
                    title: card.title.clone(),
                    duration: card.duration,
                });
            }
        }

        if pages.is_empty() {
            return Err(BiliError::Invalid("detail has no playable page".to_string()));
        }

        Ok(VideoDetail {
            card,
            description: data
                .get("desc")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            pages,
        })
    }

    pub async fn search(&self, keyword: &str, page: u32) -> Result<PagedVideos, BiliError> {
        let root = self
            .get_json(
                "/x/web-interface/search/type",
                &[
                    ("search_type", "video".to_string()),
                    ("keyword", keyword.to_string()),
                    ("page", page.to_string()),
                    ("page_size", "20".to_string()),
                ],
            )
            .await?;
        let mut items = root
            .pointer("/data/result")
            .and_then(Value::as_array)
            .ok_or_else(|| BiliError::Invalid("missing search result".to_string()))?
            .iter()
            .filter_map(parse_search_card)
            .collect::<Vec<_>>();
        for item in &mut items {
            item.source_kind = "search".to_string();
        }
        let has_more = items.len() == 20;
        Ok(PagedVideos { page, items, has_more })
    }

    pub async fn video_playback(
        &self,
        video_id: &str,
        cid: i64,
        quality: i64,
    ) -> Result<PlaybackInfo, BiliError> {
        let mut query = vec![
            ("cid", cid.to_string()),
            ("qn", quality.to_string()),
            ("fnval", "1".to_string()),
            ("fnver", "0".to_string()),
            ("platform", "html5".to_string()),
        ];
        if let Some(stripped) = video_id.strip_prefix("av") {
            query.push(("aid", stripped.to_string()));
        } else {
            query.push(("bvid", video_id.to_string()));
        }
        let root = self
            .get_json(
                "/x/player/playurl",
                &query,
            )
            .await?;
        let data = root
            .get("data")
            .ok_or_else(|| BiliError::Invalid("missing playback data".to_string()))?;
        let duration_ms = data
            .get("timelength")
            .and_then(Value::as_i64)
            .unwrap_or_default();
        let mut streams = Vec::new();

        if let Some(durl) = data.get("durl").and_then(Value::as_array) {
            for (index, item) in durl.iter().enumerate() {
                let url = item
                    .get("url")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string();
                if url.is_empty() {
                    continue;
                }
                streams.push(StreamSource {
                    id: format!("mp4-{index}"),
                    protocol: StreamProtocol::Mp4,
                    url,
                    quality_id: data.get("quality").and_then(Value::as_i64).unwrap_or_default(),
                    quality_label: format!(
                        "{}P",
                        data.get("quality").and_then(Value::as_i64).unwrap_or_default()
                    ),
                    audio_url: None,
                    codec: Some("mp4".to_string()),
                });
            }
        }

        if streams.is_empty() {
            return Err(BiliError::Invalid("no playable durl stream".to_string()));
        }

        Ok(PlaybackInfo {
            video_id: video_id.to_string(),
            cid,
            duration_ms,
            streams,
        })
    }
}

fn parse_card(value: &Value) -> Option<VideoCard> {
    let bvid = value.get("bvid").and_then(Value::as_str).unwrap_or_default();
    let aid = value.get("aid").and_then(Value::as_i64).unwrap_or_default();
    let video_id = if !bvid.is_empty() {
        bvid.to_string()
    } else if aid > 0 {
        format!("av{aid}")
    } else {
        return None;
    };
    let title = value
        .get("title")
        .and_then(Value::as_str)
        .map(strip_html_tags)
        .unwrap_or_default();
    let owner_value = value.get("owner").or_else(|| value.get("author"));
    let owner = owner_value.map(|owner| crate::domain::OwnerInfo {
        id: owner.get("mid").and_then(Value::as_i64).unwrap_or_default(),
        name: owner
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        avatar_url: owner
            .get("face")
            .and_then(Value::as_str)
            .map(normalize_url),
    });
    let stat = value.get("stat").map(|stat| VideoStats {
        view: stat
            .get("view")
            .and_then(Value::as_i64)
            .or_else(|| stat.get("video").and_then(Value::as_i64))
            .unwrap_or_default(),
        like: stat.get("like").and_then(Value::as_i64).unwrap_or_default(),
        danmaku: stat
            .get("danmaku")
            .and_then(Value::as_i64)
            .unwrap_or_default(),
    });

    Some(VideoCard {
        video_id,
        title,
        cover_url: value
            .get("pic")
            .or_else(|| value.get("cover"))
            .and_then(Value::as_str)
            .map(normalize_url),
        duration: value.get("duration").and_then(Value::as_i64),
        published_at: value.get("pubdate").and_then(Value::as_i64),
        owner,
        stats: stat.unwrap_or_default(),
        cid: value.get("cid").and_then(Value::as_i64),
        source_kind: "popular".to_string(),
    })
}

fn parse_search_card(value: &Value) -> Option<VideoCard> {
    let video_id = value.get("bvid")?.as_str()?.to_string();
    let title = value
        .get("title")
        .and_then(Value::as_str)
        .map(strip_html_tags)
        .unwrap_or_default();
    let duration_text = value
        .get("duration")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let duration = parse_duration_text(duration_text);
    let author = value.get("author").and_then(Value::as_str).unwrap_or_default();
    let mid = value.get("mid").and_then(Value::as_i64).unwrap_or_default();
    let stat = VideoStats {
        view: value.get("play").and_then(Value::as_i64).unwrap_or_default(),
        danmaku: value.get("video_review").and_then(Value::as_i64).unwrap_or_default(),
        like: 0,
    };

    Some(VideoCard {
        video_id,
        title,
        cover_url: value
            .get("pic")
            .and_then(Value::as_str)
            .map(normalize_url),
        duration,
        published_at: None,
        owner: Some(crate::domain::OwnerInfo {
            id: mid,
            name: author.to_string(),
            avatar_url: None,
        }),
        stats: stat,
        cid: None,
        source_kind: "search".to_string(),
    })
}

fn strip_html_tags(value: &str) -> String {
    value
        .chars()
        .fold((String::new(), false), |(mut output, in_tag), ch| {
            match ch {
                '<' => (output, true),
                '>' => (output, false),
                _ if !in_tag => {
                    output.push(ch);
                    (output, false)
                }
                _ => (output, true),
            }
        })
        .0
}

fn normalize_url(value: &str) -> String {
    if value.starts_with("//") {
        format!("https:{value}")
    } else if value.starts_with("http://") {
        value.replacen("http://", "https://", 1)
    } else if value.starts_with('/') && !value.starts_with("//") {
        format!("https:{value}")
    } else {
        value.to_string()
    }
}

fn parse_duration_text(value: &str) -> Option<i64> {
    let parts: Vec<i64> = value
        .split(':')
        .filter_map(|part| part.parse::<i64>().ok())
        .collect();
    match parts.as_slice() {
        [seconds] => Some(*seconds),
        [minutes, seconds] => Some(minutes * 60 + seconds),
        [hours, minutes, seconds] => Some(hours * 3600 + minutes * 60 + seconds),
        _ => None,
    }
}
