use std::collections::BTreeSet;

use reqwest::header::{COOKIE, REFERER};
use serde::{de::DeserializeOwned, Deserialize, Deserializer, Serialize};
use serde_json::Value;

use super::{client::BiliClient, error::BiliError, types::image_url};

const PGC_INDEX_URL: &str = "https://api.bilibili.com/pgc/season/index/result";
const PGC_TIMELINE_URL: &str = "https://api.bilibili.com/pgc/web/timeline/v2";
const PGC_SEASON_URL: &str = "https://api.bilibili.com/pgc/view/web/season";
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PgcMediaSummary {
    pub season_id: String,
    pub media_id: String,
    pub title: String,
    pub cover_url: String,
    pub subtitle: String,
    pub index_show: String,
    pub order_label: String,
    pub score: Option<f32>,
    pub finished: bool,
    pub season_type: u8,
    pub badge: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PgcIndexPage {
    pub season_type: u8,
    pub page: u32,
    pub page_size: u32,
    pub total: u64,
    pub has_more: bool,
    pub items: Vec<PgcMediaSummary>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PgcTimelineEpisode {
    pub episode_id: String,
    pub season_id: String,
    pub title: String,
    pub episode_title: String,
    pub cover_url: String,
    pub published_at: u64,
    pub is_published: bool,
    pub is_delayed: bool,
    pub delay_reason: Option<String>,
    pub target_url: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PgcTimelineDay {
    pub date: String,
    pub date_timestamp: u64,
    pub day_of_week: u8,
    pub is_today: bool,
    pub episodes: Vec<PgcTimelineEpisode>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PgcTimeline {
    pub latest: Vec<PgcTimelineEpisode>,
    pub days: Vec<PgcTimelineDay>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PgcEpisode {
    pub ep_id: String,
    pub aid: u64,
    pub bvid: String,
    pub cid: u64,
    pub title: String,
    pub long_title: String,
    pub cover_url: String,
    pub duration_seconds: u32,
    pub published_at: u64,
    pub badge: Option<String>,
    pub section_type: u8,
    pub playback_available: bool,
    pub requires_membership: bool,
    pub target_url: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PgcEpisodeSection {
    pub id: String,
    pub title: String,
    pub episodes: Vec<PgcEpisode>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PgcRating {
    pub score: f32,
    pub count: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PgcSeasonStats {
    pub views: u64,
    pub favorites: u64,
    pub likes: u64,
    pub danmaku: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PgcSeasonSummary {
    pub season_id: String,
    pub title: String,
    pub cover_url: String,
    pub badge: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PgcSeasonDetail {
    pub season_id: String,
    pub media_id: String,
    pub title: String,
    pub original_title: String,
    pub cover_url: String,
    pub description: String,
    pub subtitle: String,
    pub new_episode: String,
    pub publish_date: Option<String>,
    pub finished: bool,
    pub rating: Option<PgcRating>,
    pub stats: PgcSeasonStats,
    pub styles: Vec<String>,
    pub areas: Vec<String>,
    pub episodes: Vec<PgcEpisode>,
    pub sections: Vec<PgcEpisodeSection>,
    pub related_seasons: Vec<PgcSeasonSummary>,
    pub web_url: String,
}

#[derive(Debug, Deserialize)]
struct PgcEnvelope<T> {
    code: i64,
    #[serde(default)]
    message: String,
    data: Option<T>,
    result: Option<T>,
}

impl<T> PgcEnvelope<T> {
    fn into_payload(self) -> Result<T, BiliError> {
        if self.code != 0 {
            return Err(BiliError::Upstream {
                code: self.code,
                message: self.message.chars().take(160).collect(),
            });
        }
        self.data.or(self.result).ok_or(BiliError::MissingData)
    }
}

#[derive(Debug, Default, Deserialize)]
struct RawPgcIndexData {
    #[serde(default)]
    has_next: u64,
    #[serde(default)]
    list: Vec<RawPgcIndexItem>,
    #[serde(default)]
    num: u32,
    #[serde(default)]
    size: u32,
    #[serde(default)]
    total: u64,
}

#[derive(Debug, Default, Deserialize)]
struct RawPgcIndexItem {
    #[serde(default, deserialize_with = "deserialize_optional_u64")]
    season_id: Option<u64>,
    #[serde(default, deserialize_with = "deserialize_optional_u64")]
    media_id: Option<u64>,
    #[serde(default)]
    title: String,
    #[serde(default)]
    cover: String,
    #[serde(default, rename = "subTitle")]
    subtitle: String,
    #[serde(default)]
    index_show: String,
    #[serde(default)]
    order: String,
    #[serde(default)]
    score: String,
    #[serde(default, deserialize_with = "deserialize_optional_u64")]
    is_finish: Option<u64>,
    #[serde(default, deserialize_with = "deserialize_optional_u64")]
    season_type: Option<u64>,
    #[serde(default)]
    badge: String,
}

#[derive(Debug, Default, Deserialize)]
struct RawPgcTimelineData {
    #[serde(default)]
    latest: Vec<RawPgcTimelineEpisode>,
    #[serde(default)]
    timeline: Vec<RawPgcTimelineDay>,
}

#[derive(Debug, Default, Deserialize)]
struct RawPgcTimelineDay {
    #[serde(default)]
    date: String,
    #[serde(default)]
    date_ts: u64,
    #[serde(default)]
    day_of_week: u8,
    #[serde(default)]
    episodes: Value,
    #[serde(default, deserialize_with = "deserialize_optional_u64")]
    is_today: Option<u64>,
}

#[derive(Debug, Clone, Default, Deserialize)]
struct RawPgcTimelineEpisode {
    #[serde(default)]
    episode_id: u64,
    #[serde(default)]
    season_id: u64,
    #[serde(default)]
    title: String,
    #[serde(default)]
    pub_index: String,
    #[serde(default)]
    cover: String,
    #[serde(default)]
    ep_cover: String,
    #[serde(default)]
    pub_ts: u64,
    #[serde(default, deserialize_with = "deserialize_optional_u64")]
    published: Option<u64>,
    #[serde(default)]
    delay: u64,
    #[serde(default)]
    delay_reason: String,
}

#[derive(Debug, Default, Deserialize)]
struct RawPgcSeason {
    #[serde(default)]
    season_id: u64,
    #[serde(default)]
    media_id: u64,
    #[serde(default)]
    season_title: String,
    #[serde(default)]
    title: String,
    #[serde(default)]
    cover: String,
    #[serde(default)]
    evaluate: String,
    #[serde(default)]
    subtitle: String,
    #[serde(default)]
    rating: Option<RawPgcRating>,
    #[serde(default)]
    publish: Option<RawPgcPublish>,
    #[serde(default)]
    new_ep: Option<RawPgcNewEpisode>,
    #[serde(default)]
    stat: RawPgcStat,
    #[serde(default)]
    styles: Vec<String>,
    #[serde(default)]
    areas: Value,
    #[serde(default)]
    episodes: Vec<RawPgcEpisode>,
    #[serde(default)]
    section: Vec<RawPgcSection>,
    #[serde(default)]
    seasons: Vec<RawPgcRelatedSeason>,
}

#[derive(Debug, Default, Deserialize)]
struct RawPgcRating {
    #[serde(default)]
    score: f32,
    #[serde(default)]
    count: u64,
}

#[derive(Debug, Default, Deserialize)]
struct RawPgcPublish {
    #[serde(default)]
    pub_time: String,
    #[serde(default, deserialize_with = "deserialize_optional_u64")]
    is_finish: Option<u64>,
}

#[derive(Debug, Default, Deserialize)]
struct RawPgcNewEpisode {
    #[serde(default)]
    desc: String,
}

#[derive(Debug, Default, Deserialize)]
struct RawPgcStat {
    #[serde(default)]
    views: u64,
    #[serde(default)]
    favorites: u64,
    #[serde(default)]
    likes: u64,
    #[serde(default)]
    danmakus: u64,
}

#[derive(Debug, Default, Deserialize)]
struct RawNamedValue {
    #[serde(default)]
    name: String,
}

#[derive(Debug, Default, Deserialize)]
struct RawPgcEpisode {
    #[serde(default)]
    ep_id: u64,
    #[serde(default)]
    id: u64,
    #[serde(default)]
    aid: u64,
    #[serde(default)]
    bvid: String,
    #[serde(default)]
    cid: u64,
    #[serde(default)]
    title: String,
    #[serde(default)]
    long_title: String,
    #[serde(default)]
    show_title: String,
    #[serde(default)]
    cover: String,
    #[serde(default)]
    duration: u64,
    #[serde(default)]
    pub_time: u64,
    #[serde(default)]
    badge: String,
    #[serde(default)]
    section_type: u8,
    #[serde(default)]
    link: String,
    #[serde(default, rename = "showDrmLoginDialog")]
    show_drm_login_dialog: bool,
    #[serde(default)]
    rights: RawPgcRights,
}

#[derive(Debug, Default, Deserialize)]
struct RawPgcRights {
    #[serde(default)]
    area_limit: u8,
}

#[derive(Debug, Default, Deserialize)]
struct RawPgcSection {
    #[serde(default)]
    id: u64,
    #[serde(default)]
    title: String,
    #[serde(default)]
    episodes: Vec<RawPgcEpisode>,
}

#[derive(Debug, Default, Deserialize)]
struct RawPgcRelatedSeason {
    #[serde(default)]
    season_id: u64,
    #[serde(default)]
    season_title: String,
    #[serde(default)]
    cover: String,
    #[serde(default)]
    badge: String,
}

impl BiliClient {
    pub async fn pgc_index(
        &self,
        season_type: u8,
        page: u32,
        page_size: u32,
        year: Option<u32>,
        is_finished: Option<bool>,
    ) -> Result<PgcIndexPage, BiliError> {
        validate_season_type(season_type)?;
        if let Some(year) = year {
            if !(1990..=2100).contains(&year) {
                return Err(BiliError::InvalidInput("unsupported PGC year"));
            }
        }

        let page = page.clamp(1, 200);
        let page_size = page_size.clamp(1, 30);
        let mut query = vec![
            ("st", season_type.to_string()),
            ("order", "3".to_owned()),
            ("sort", "0".to_owned()),
            ("season_type", season_type.to_string()),
            ("page", page.to_string()),
            ("pagesize", page_size.to_string()),
            ("type", "1".to_owned()),
            ("season_version", "-1".to_owned()),
            ("spoken_language_type", "-1".to_owned()),
            ("area", "-1".to_owned()),
            ("copyright", "-1".to_owned()),
            ("season_status", "-1".to_owned()),
            ("season_month", "-1".to_owned()),
            ("style_id", "-1".to_owned()),
            (
                "year",
                year.map_or_else(|| "-1".to_owned(), |value| value.to_string()),
            ),
            (
                "is_finish",
                is_finished.map_or_else(
                    || "-1".to_owned(),
                    |finished| {
                        if finished {
                            "1".to_owned()
                        } else {
                            "0".to_owned()
                        }
                    },
                ),
            ),
        ];
        query.sort_unstable_by_key(|(key, _)| *key);

        let data: RawPgcIndexData = self
            .get_pgc_payload(
                PGC_INDEX_URL,
                &query,
                "https://www.bilibili.com/anime/index/",
            )
            .await?;
        Ok(map_index_page(season_type, page, page_size, data))
    }

    pub async fn pgc_timeline(&self, season_type: u8) -> Result<PgcTimeline, BiliError> {
        validate_timeline_season_type(season_type)?;
        let data: RawPgcTimelineData = self
            .get_pgc_payload(
                PGC_TIMELINE_URL,
                &[("season_type", season_type.to_string())],
                "https://www.bilibili.com/anime/timeline/",
            )
            .await?;
        map_timeline(data)
    }

    pub async fn pgc_season(&self, season_id: u64) -> Result<PgcSeasonDetail, BiliError> {
        if season_id == 0 {
            return Err(BiliError::InvalidInput("season id must be positive"));
        }
        let data: RawPgcSeason = self
            .get_pgc_payload(
                PGC_SEASON_URL,
                &[("season_id", season_id.to_string())],
                "https://www.bilibili.com/anime/",
            )
            .await?;
        map_season(data)
    }

    async fn get_pgc_payload<T: DeserializeOwned>(
        &self,
        url: &str,
        query: &[(&str, String)],
        referer: &str,
    ) -> Result<T, BiliError> {
        let request = self.http.get(url).query(query).header(REFERER, referer);
        let request = if let Some(cookie_header) = self.session.cookie_header().await {
            request.header(COOKIE, cookie_header)
        } else {
            request
        };
        let response = request.send().await?;
        let status = response.status();
        if !status.is_success() {
            return Err(BiliError::HttpStatus(status.as_u16()));
        }
        let envelope: PgcEnvelope<T> = response
            .json()
            .await
            .map_err(|_| BiliError::InvalidResponse("invalid PGC response"))?;
        envelope.into_payload()
    }
}

fn validate_season_type(season_type: u8) -> Result<(), BiliError> {
    if (1..=4).contains(&season_type) {
        Ok(())
    } else {
        Err(BiliError::InvalidInput("unsupported PGC season type"))
    }
}

fn validate_timeline_season_type(season_type: u8) -> Result<(), BiliError> {
    if matches!(season_type, 1 | 4) {
        Ok(())
    } else {
        Err(BiliError::InvalidInput(
            "PGC timeline is unavailable for this season type",
        ))
    }
}

fn map_index_page(
    season_type: u8,
    requested_page: u32,
    requested_page_size: u32,
    data: RawPgcIndexData,
) -> PgcIndexPage {
    let page = if data.num == 0 {
        requested_page
    } else {
        data.num
    };
    let page_size = if data.size == 0 {
        requested_page_size
    } else {
        data.size
    };
    let items = data
        .list
        .into_iter()
        .filter_map(|item| map_index_item(item, season_type))
        .collect::<Vec<_>>();
    let has_more = data.has_next != 0
        || (data.total > 0 && page.saturating_mul(page_size) < data.total as u32)
        || items.len() >= page_size as usize;
    PgcIndexPage {
        season_type,
        page,
        page_size,
        total: data.total,
        has_more,
        items,
    }
}

fn map_index_item(item: RawPgcIndexItem, fallback_type: u8) -> Option<PgcMediaSummary> {
    let season_id = item.season_id.filter(|value| *value > 0)?;
    let score = item.score.trim().parse::<f32>().ok();
    Some(PgcMediaSummary {
        season_id: season_id.to_string(),
        media_id: item.media_id.unwrap_or_default().to_string(),
        title: item.title,
        cover_url: image_url(&item.cover, "@336w_454h_1c.webp"),
        subtitle: item.subtitle,
        index_show: item.index_show,
        order_label: item.order,
        score,
        finished: item.is_finish.is_some_and(|value| value == 1),
        season_type: item
            .season_type
            .and_then(|value| u8::try_from(value).ok())
            .filter(|value| (1..=4).contains(value))
            .unwrap_or(fallback_type),
        badge: non_empty(item.badge),
    })
}

fn map_timeline(data: RawPgcTimelineData) -> Result<PgcTimeline, BiliError> {
    let mut seen = BTreeSet::new();
    let latest = data
        .latest
        .into_iter()
        .filter_map(map_timeline_episode)
        .filter(|episode| seen.insert(episode.episode_id.clone()))
        .collect();

    let days = data
        .timeline
        .into_iter()
        .map(|day| {
            let episodes = parse_timeline_episodes(day.episodes)
                .into_iter()
                .filter_map(map_timeline_episode)
                .collect();
            PgcTimelineDay {
                date: day.date,
                date_timestamp: day.date_ts,
                day_of_week: day.day_of_week.min(7),
                is_today: day.is_today.is_some_and(|value| value == 1),
                episodes,
            }
        })
        .collect();

    Ok(PgcTimeline { latest, days })
}

fn parse_timeline_episodes(value: Value) -> Vec<RawPgcTimelineEpisode> {
    match value {
        Value::Array(values) => values
            .into_iter()
            .filter_map(|value| serde_json::from_value(value).ok())
            .collect(),
        _ => Vec::new(),
    }
}

fn map_timeline_episode(raw: RawPgcTimelineEpisode) -> Option<PgcTimelineEpisode> {
    if raw.season_id == 0 || raw.title.trim().is_empty() {
        return None;
    }
    let episode_id = raw.episode_id.to_string();
    let target_url = if raw.episode_id > 0 {
        format!("https://www.bilibili.com/bangumi/play/ep{episode_id}")
    } else {
        format!("https://www.bilibili.com/bangumi/play/ss{}", raw.season_id)
    };
    Some(PgcTimelineEpisode {
        episode_id,
        season_id: raw.season_id.to_string(),
        title: raw.title,
        episode_title: raw.pub_index,
        cover_url: image_url(
            if raw.ep_cover.trim().is_empty() {
                &raw.cover
            } else {
                &raw.ep_cover
            },
            "@672w_378h_1c.webp",
        ),
        published_at: raw.pub_ts,
        is_published: raw.published.is_some_and(|value| value == 1),
        is_delayed: raw.delay == 1,
        delay_reason: non_empty(raw.delay_reason),
        target_url,
    })
}

fn map_season(raw: RawPgcSeason) -> Result<PgcSeasonDetail, BiliError> {
    if raw.season_id == 0 {
        return Err(BiliError::InvalidResponse("missing PGC season id"));
    }
    let web_url = format!("https://www.bilibili.com/bangumi/play/ss{}", raw.season_id);
    Ok(PgcSeasonDetail {
        season_id: raw.season_id.to_string(),
        media_id: raw.media_id.to_string(),
        title: if raw.season_title.trim().is_empty() {
            raw.title.clone()
        } else {
            raw.season_title
        },
        original_title: raw.title,
        cover_url: image_url(&raw.cover, "@1280w_720h_1c.webp"),
        description: raw.evaluate,
        subtitle: raw.subtitle,
        new_episode: raw.new_ep.map(|episode| episode.desc).unwrap_or_default(),
        publish_date: raw
            .publish
            .as_ref()
            .map(|publish| publish.pub_time.clone())
            .filter(|value| !value.trim().is_empty()),
        finished: raw
            .publish
            .as_ref()
            .and_then(|publish| publish.is_finish)
            .is_some_and(|value| value == 1),
        rating: raw.rating.and_then(|rating| {
            (rating.score > 0.0).then_some(PgcRating {
                score: rating.score,
                count: rating.count,
            })
        }),
        stats: PgcSeasonStats {
            views: raw.stat.views,
            favorites: raw.stat.favorites,
            likes: raw.stat.likes,
            danmaku: raw.stat.danmakus,
        },
        styles: raw
            .styles
            .into_iter()
            .map(|style| style.trim().to_owned())
            .filter(|style| !style.is_empty())
            .collect(),
        areas: named_values(raw.areas),
        episodes: raw.episodes.into_iter().filter_map(map_episode).collect(),
        sections: raw
            .section
            .into_iter()
            .filter_map(|section| {
                let episodes = section
                    .episodes
                    .into_iter()
                    .filter_map(map_episode)
                    .collect::<Vec<_>>();
                (!episodes.is_empty()).then_some(PgcEpisodeSection {
                    id: section.id.to_string(),
                    title: section.title,
                    episodes,
                })
            })
            .collect(),
        related_seasons: raw
            .seasons
            .into_iter()
            .filter_map(|season| {
                (season.season_id > 0).then_some(PgcSeasonSummary {
                    season_id: season.season_id.to_string(),
                    title: season.season_title,
                    cover_url: image_url(&season.cover, "@336w_189h_1c.webp"),
                    badge: non_empty(season.badge),
                })
            })
            .collect(),
        web_url,
    })
}

fn map_episode(raw: RawPgcEpisode) -> Option<PgcEpisode> {
    let ep_id = if raw.ep_id == 0 { raw.id } else { raw.ep_id };
    if ep_id == 0 {
        return None;
    }
    let target_url = if raw.link.trim().is_empty() {
        format!("https://www.bilibili.com/bangumi/play/ep{ep_id}")
    } else {
        raw.link
    };
    let title = if raw.show_title.trim().is_empty() {
        if raw.long_title.trim().is_empty() {
            raw.title
        } else {
            raw.long_title.clone()
        }
    } else {
        raw.show_title
    };
    let requires_membership = raw.badge.contains("会员") || raw.badge.contains("大会员");
    let playback_available = !raw.show_drm_login_dialog
        && raw.rights.area_limit == 0
        && raw.cid > 0
        && !raw.bvid.trim().is_empty();
    Some(PgcEpisode {
        ep_id: ep_id.to_string(),
        aid: raw.aid,
        bvid: raw.bvid,
        cid: raw.cid,
        title,
        long_title: raw.long_title,
        cover_url: image_url(&raw.cover, "@672w_378h_1c.webp"),
        duration_seconds: u32::try_from(raw.duration / 1000).unwrap_or(u32::MAX),
        published_at: raw.pub_time,
        badge: non_empty(raw.badge),
        section_type: raw.section_type,
        playback_available,
        requires_membership,
        target_url,
    })
}

fn named_values(value: Value) -> Vec<String> {
    match value {
        Value::Array(values) => values
            .into_iter()
            .filter_map(|value| serde_json::from_value::<RawNamedValue>(value).ok())
            .map(|value| value.name)
            .filter(|value| !value.trim().is_empty())
            .collect(),
        Value::Object(_) => serde_json::from_value::<RawNamedValue>(value)
            .ok()
            .map(|value| value.name)
            .filter(|value| !value.trim().is_empty())
            .into_iter()
            .collect(),
        _ => Vec::new(),
    }
}

fn non_empty(value: String) -> Option<String> {
    let value = value.trim();
    (!value.is_empty()).then(|| value.to_owned())
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
        Some(Value::Bool(value)) => Some(u64::from(value)),
        _ => None,
    })
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{
        map_index_page, map_season, map_timeline, validate_season_type,
        validate_timeline_season_type, RawPgcIndexData, RawPgcSeason, RawPgcTimelineData,
    };
    use crate::bili::client::BiliClient;

    #[test]
    fn validates_supported_pgc_types() {
        assert!(validate_season_type(1).is_ok());
        assert!(validate_season_type(4).is_ok());
        assert!(validate_season_type(0).is_err());
        assert!(validate_season_type(5).is_err());
    }

    #[test]
    fn validates_pgc_timeline_types() {
        assert!(validate_timeline_season_type(1).is_ok());
        assert!(validate_timeline_season_type(4).is_ok());
        assert!(validate_timeline_season_type(2).is_err());
        assert!(validate_timeline_season_type(3).is_err());
    }

    #[test]
    fn maps_index_items_and_pagination() {
        let data: RawPgcIndexData = serde_json::from_value(json!({
            "has_next": 1,
            "num": 2,
            "size": 18,
            "total": 90,
            "list": [{
                "season_id": 47836,
                "media_id": 21226899,
                "title": "鬼灭之刃 柱训练篇",
                "cover": "//i0.hdslb.com/cover.jpg",
                "subTitle": "羁绊连结",
                "index_show": "全8话",
                "order": "1770.4万追番",
                "score": "9.7",
                "is_finish": 1,
                "season_type": 1,
                "badge": "大会员"
            }]
        }))
        .expect("index fixture");
        let page = map_index_page(1, 1, 18, data);

        assert_eq!(page.page, 2);
        assert!(page.has_more);
        assert_eq!(page.items[0].season_id, "47836");
        assert_eq!(page.items[0].score, Some(9.7));
        assert!(page.items[0].finished);
        assert!(page.items[0].cover_url.starts_with("https://"));
    }

    #[test]
    fn maps_timeline_and_hides_empty_string_schedule_slots() {
        let data: RawPgcTimelineData = serde_json::from_value(json!({
            "latest": [{
                "episode_id": 826497,
                "season_id": 47836,
                "title": "鬼灭之刃 柱训练篇",
                "pub_index": "第1话",
                "ep_cover": "//i0.hdslb.com/episode.jpg",
                "pub_ts": 1719057600,
                "published": 1,
                "delay": 0
            }],
            "timeline": [{
                "date": "10-26",
                "date_ts": 1792944000,
                "day_of_week": 1,
                "is_today": 1,
                "episodes": " "
            }]
        }))
        .expect("timeline fixture");
        let timeline = map_timeline(data).expect("timeline");

        assert_eq!(timeline.latest.len(), 1);
        assert_eq!(timeline.latest[0].episode_title, "第1话");
        assert!(timeline.latest[0].is_published);
        assert!(timeline.days[0].episodes.is_empty());
        assert!(timeline.days[0].is_today);
    }

    #[test]
    fn maps_season_episodes_sections_and_gating() {
        let data: RawPgcSeason = serde_json::from_value(json!({
            "season_id": 47836,
            "media_id": 21226899,
            "season_title": "鬼灭之刃 柱训练篇",
            "title": "鬼灭之刃",
            "cover": "//i0.hdslb.com/cover.jpg",
            "evaluate": "简介",
            "rating": { "score": 9.7, "count": 12000 },
            "publish": { "pub_time": "2024-06-22 20:00:00", "is_finish": 1 },
            "new_ep": { "desc": "已完结, 全8话" },
            "stat": { "views": 100, "favorites": 20, "likes": 30, "danmakus": 40 },
            "styles": ["热血", "奇幻"],
            "areas": { "name": "日本" },
            "episodes": [{
                "ep_id": 826497,
                "aid": 1455924625,
                "bvid": "BV15i421v7FQ",
                "cid": 1602741036,
                "show_title": "第1话 为了消灭鬼舞辻无惨",
                "long_title": "为了消灭鬼舞辻无惨",
                "cover": "//i0.hdslb.com/episode.jpg",
                "duration": 2938060,
                "pub_time": 1719057600,
                "rights": { "area_limit": 0 }
            }],
            "section": [{
                "id": 101648,
                "title": "PV＆其他",
                "episodes": [{
                    "id": 826486,
                    "aid": 1555676283,
                    "bvid": "BV1j1421C7bs",
                    "cid": 1580564672,
                    "show_title": "PV",
                    "cover": "",
                    "duration": 96000,
                    "rights": { "area_limit": 0 }
                }]
            }],
            "seasons": [{
                "season_id": 26801,
                "season_title": "立志篇",
                "cover": "//i0.hdslb.com/related.jpg"
            }]
        }))
        .expect("season fixture");
        let detail = map_season(data).expect("season detail");

        assert_eq!(detail.episodes.len(), 1);
        assert_eq!(detail.episodes[0].duration_seconds, 2938);
        assert!(detail.episodes[0].playback_available);
        assert_eq!(detail.sections[0].episodes[0].title, "PV");
        assert_eq!(detail.areas, vec!["日本"]);
        assert_eq!(detail.related_seasons.len(), 1);
        assert!(detail.finished);
    }

    #[ignore = "requires network access to Bilibili"]
    #[tokio::test]
    async fn live_pgc_smoke() {
        let client = BiliClient::new().expect("client");
        let index = client
            .pgc_index(1, 1, 6, None, None)
            .await
            .expect("PGC index");
        let timeline = client.pgc_timeline(1).await.expect("PGC timeline");
        let variety_timeline = client.pgc_timeline(4).await.expect("PGC variety timeline");
        let season = client.pgc_season(47836).await.expect("PGC season detail");

        assert!(!index.items.is_empty());
        assert!(!timeline.days.is_empty());
        assert!(!variety_timeline.days.is_empty());
        assert!(!season.episodes.is_empty());
    }
}
