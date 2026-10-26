use std::collections::BTreeMap;

use reqwest::header::COOKIE;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::{
    client::{ApiEnvelope, BiliClient},
    error::BiliError,
    types::image_url,
    wbi::{sign_query, unix_timestamp},
};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryVideo {
    pub aid: u64,
    pub bvid: String,
    pub cid: u64,
    pub title: String,
    pub cover_url: String,
    pub duration_seconds: u32,
    pub author_mid: u64,
    pub author_name: String,
    pub author_avatar_url: String,
    pub views: u64,
    pub progress_seconds: u32,
    pub viewed_at: Option<i64>,
    pub added_at: Option<i64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryPage {
    pub videos: Vec<LibraryVideo>,
    pub cursor_max: i64,
    pub cursor_view_at: i64,
    pub has_more: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchLaterPage {
    pub videos: Vec<LibraryVideo>,
    pub count: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FavoriteResourcePage {
    pub media_id: String,
    pub page: u32,
    pub page_size: u32,
    pub total: u64,
    pub has_more: bool,
    pub videos: Vec<LibraryVideo>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpaceProfile {
    pub mid: String,
    pub name: String,
    pub avatar_url: String,
    pub banner_url: String,
    pub signature: String,
    pub level: u32,
    pub following: u64,
    pub followers: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpaceVideoPage {
    pub videos: Vec<LibraryVideo>,
    pub page: u32,
    pub page_size: u32,
    pub total: u64,
    pub has_more: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResumePoint {
    pub last_play_time_seconds: u32,
    pub last_play_cid: u64,
}

impl BiliClient {
    pub async fn history(&self, max: i64, view_at: i64) -> Result<HistoryPage, BiliError> {
        let data: RawHistoryData = self
            .get_authenticated(
                "/x/web-interface/history/cursor",
                &[
                    ("max", max.max(0).to_string()),
                    ("view_at", view_at.max(0).to_string()),
                    ("business", "archive".to_owned()),
                    ("ps", "20".to_owned()),
                ],
            )
            .await?;
        let videos = data
            .list
            .into_iter()
            .filter(|item| item.history.business == "archive" && !item.history.bvid.is_empty())
            .map(|item| LibraryVideo {
                aid: item.history.oid,
                bvid: item.history.bvid,
                cid: item.history.cid,
                title: clean_text(&item.title),
                cover_url: image_url(&item.cover, "@672w_378h_1c.webp"),
                duration_seconds: item.duration,
                author_mid: item.author_mid,
                author_name: clean_text(&item.author_name),
                author_avatar_url: String::new(),
                views: 0,
                progress_seconds: item.progress.clamp(0, u32::MAX as i64) as u32,
                viewed_at: Some(item.view_at),
                added_at: None,
            })
            .collect();
        let has_more = data.cursor.max != 0;
        Ok(HistoryPage {
            videos,
            cursor_max: data.cursor.max,
            cursor_view_at: data.cursor.view_at,
            has_more,
        })
    }

    pub async fn delete_history(&self, aid: u64) -> Result<(), BiliError> {
        let form = BTreeMap::from([("kid".to_owned(), format!("archive_{aid}"))]);
        self.post_authenticated_form("/x/v2/history/delete", form)
            .await?;
        Ok(())
    }

    pub async fn clear_history(&self) -> Result<(), BiliError> {
        self.post_authenticated_form("/x/v2/history/clear", BTreeMap::new())
            .await?;
        Ok(())
    }

    pub async fn watch_later(&self) -> Result<WatchLaterPage, BiliError> {
        let data: RawWatchLaterData = self.get_authenticated("/x/v2/history/toview", &[]).await?;
        Ok(WatchLaterPage {
            count: data.count,
            videos: data
                .list
                .into_iter()
                .map(|item| LibraryVideo {
                    aid: item.aid,
                    bvid: item.bvid,
                    cid: item.cid,
                    title: clean_text(&item.title),
                    cover_url: image_url(&item.pic, "@672w_378h_1c.webp"),
                    duration_seconds: item.duration,
                    author_mid: item.owner.mid,
                    author_name: clean_text(&item.owner.name),
                    author_avatar_url: image_url(&item.owner.face, "@72w_72h_1c.webp"),
                    views: item.stat.view,
                    progress_seconds: item.progress.clamp(0, u32::MAX as i64) as u32,
                    viewed_at: None,
                    added_at: Some(item.add_at),
                })
                .collect(),
        })
    }

    pub async fn add_watch_later(&self, bvid: &str) -> Result<(), BiliError> {
        super::client::validate_bvid(bvid)?;
        let form = BTreeMap::from([("bvid".to_owned(), bvid.to_owned())]);
        self.post_authenticated_form("/x/v2/history/toview/add", form)
            .await?;
        Ok(())
    }

    pub async fn remove_watch_later(&self, aid: u64) -> Result<(), BiliError> {
        let form = BTreeMap::from([("aid".to_owned(), aid.to_string())]);
        self.post_authenticated_form("/x/v2/history/toview/del", form)
            .await?;
        Ok(())
    }

    pub async fn favorite_resources(
        &self,
        media_id: &str,
        page: u32,
    ) -> Result<FavoriteResourcePage, BiliError> {
        if media_id.is_empty()
            || media_id.len() > 20
            || !media_id.chars().all(|character| character.is_ascii_digit())
        {
            return Err(BiliError::InvalidInput("invalid favorite folder id"));
        }
        let page = page.clamp(1, 500);
        let data: RawFavoriteResources = self
            .get_authenticated(
                "/x/v3/fav/resource/list",
                &[
                    ("media_id", media_id.to_owned()),
                    ("pn", page.to_string()),
                    ("ps", "20".to_owned()),
                    ("keyword", String::new()),
                    ("order", "mtime".to_owned()),
                    ("type", "0".to_owned()),
                    ("tid", "0".to_owned()),
                    ("platform", "web".to_owned()),
                ],
            )
            .await?;
        let total = data.info.media_count;
        Ok(FavoriteResourcePage {
            media_id: media_id.to_owned(),
            page,
            page_size: 20,
            total,
            has_more: data.has_more,
            videos: data
                .medias
                .into_iter()
                .filter(|item| !item.bvid.is_empty())
                .map(|item| LibraryVideo {
                    aid: item.id,
                    bvid: item.bvid,
                    cid: item.page.unwrap_or_default().cid,
                    title: clean_text(&item.title),
                    cover_url: image_url(&item.cover, "@672w_378h_1c.webp"),
                    duration_seconds: item.duration,
                    author_mid: item.upper.mid,
                    author_name: clean_text(&item.upper.name),
                    author_avatar_url: image_url(&item.upper.face, "@72w_72h_1c.webp"),
                    views: item.cnt_info.play,
                    progress_seconds: 0,
                    viewed_at: None,
                    added_at: Some(item.fav_time),
                })
                .collect(),
        })
    }

    pub async fn resume_point(&self, bvid: &str, cid: u64) -> Result<ResumePoint, BiliError> {
        let data = self
            .wbi_value(
                "/x/player/wbi/v2",
                BTreeMap::from([
                    ("bvid".to_owned(), bvid.to_owned()),
                    ("cid".to_owned(), cid.to_string()),
                ]),
            )
            .await?;
        Ok(ResumePoint {
            last_play_time_seconds: data
                .get("lastPlayTime")
                .or_else(|| data.get("last_play_time"))
                .and_then(Value::as_u64)
                .unwrap_or_default()
                .div_ceil(1000)
                .try_into()
                .unwrap_or(u32::MAX),
            last_play_cid: data
                .get("lastPlayCid")
                .or_else(|| data.get("last_play_cid"))
                .and_then(Value::as_u64)
                .unwrap_or_default(),
        })
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn report_heartbeat(
        &self,
        aid: u64,
        cid: u64,
        bvid: &str,
        played_seconds: u32,
        duration_seconds: u32,
        play_type: u8,
    ) -> Result<(), BiliError> {
        super::client::validate_bvid(bvid)?;
        if aid == 0 || cid == 0 || duration_seconds == 0 {
            return Err(BiliError::InvalidInput("invalid heartbeat identifiers"));
        }
        let mut form = BTreeMap::from([
            ("aid".to_owned(), aid.to_string()),
            ("cid".to_owned(), cid.to_string()),
            ("bvid".to_owned(), bvid.to_owned()),
            ("played_time".to_owned(), played_seconds.to_string()),
            ("realtime".to_owned(), played_seconds.to_string()),
            ("video_duration".to_owned(), duration_seconds.to_string()),
            ("type".to_owned(), "3".to_owned()),
            ("sub_type".to_owned(), "0".to_owned()),
            ("dt".to_owned(), "2".to_owned()),
            ("play_type".to_owned(), play_type.to_string()),
        ]);
        let cookie_header = self.session.cookie_header().await;
        if let Some(mid) = self.session.user_id().await {
            form.insert("mid".to_owned(), mid);
        }
        if let Some(csrf) = self.session.csrf_token().await {
            form.insert("csrf".to_owned(), csrf);
        }
        let mut request = self
            .http
            .post("https://api.bilibili.com/x/click-interface/web/heartbeat")
            .form(&form);
        if let Some(cookie_header) = cookie_header {
            request = request.header(COOKIE, cookie_header);
        }
        let response = request.send().await?;
        let status = response.status();
        if !status.is_success() {
            return Err(BiliError::HttpStatus(status.as_u16()));
        }
        let envelope: ApiEnvelope<Value> = response.json().await?;
        if envelope.code != 0 {
            return Err(BiliError::Upstream {
                code: envelope.code,
                message: envelope.message.chars().take(160).collect(),
            });
        }
        Ok(())
    }

    pub async fn space_profile(&self, mid: u64) -> Result<SpaceProfile, BiliError> {
        if mid == 0 {
            return Err(BiliError::InvalidInput("user id must be positive"));
        }
        let info = self
            .wbi_value(
                "/x/space/wbi/acc/info",
                BTreeMap::from([("mid".to_owned(), mid.to_string())]),
            )
            .await?;
        let stat: RawRelationStat = self
            .get("/x/relation/stat", &[("vmid", mid.to_string())])
            .await
            .unwrap_or_default();
        Ok(SpaceProfile {
            mid: mid.to_string(),
            name: clean_text(info.get("name").and_then(Value::as_str).unwrap_or("")),
            avatar_url: image_url(
                info.get("face").and_then(Value::as_str).unwrap_or(""),
                "@160w_160h_1c.webp",
            ),
            banner_url: image_url(
                info.get("top_photo").and_then(Value::as_str).unwrap_or(""),
                "@1280w_320h_1c.webp",
            ),
            signature: clean_text(info.get("sign").and_then(Value::as_str).unwrap_or("")),
            level: info
                .get("level")
                .and_then(Value::as_u64)
                .unwrap_or_default()
                .min(u32::MAX as u64) as u32,
            following: stat.following,
            followers: stat.follower,
        })
    }

    pub async fn space_videos(&self, mid: u64, page: u32) -> Result<SpaceVideoPage, BiliError> {
        if mid == 0 {
            return Err(BiliError::InvalidInput("user id must be positive"));
        }
        let page = page.clamp(1, 500);
        let data = self
            .wbi_value(
                "/x/space/wbi/arc/search",
                BTreeMap::from([
                    ("mid".to_owned(), mid.to_string()),
                    ("pn".to_owned(), page.to_string()),
                    ("ps".to_owned(), "20".to_owned()),
                    ("order".to_owned(), "pubdate".to_owned()),
                    ("platform".to_owned(), "web".to_owned()),
                    ("web_location".to_owned(), "1550101".to_owned()),
                ]),
            )
            .await?;
        let total = data
            .pointer("/page/count")
            .and_then(Value::as_u64)
            .unwrap_or_default();
        let videos = data
            .pointer("/list/vlist")
            .and_then(Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .filter_map(|item| {
                        let bvid = item.get("bvid")?.as_str()?.to_owned();
                        if !bvid.starts_with("BV") {
                            return None;
                        }
                        Some(LibraryVideo {
                            aid: item.get("aid").and_then(Value::as_u64).unwrap_or_default(),
                            bvid,
                            cid: 0,
                            title: clean_text(
                                item.get("title").and_then(Value::as_str).unwrap_or(""),
                            ),
                            cover_url: image_url(
                                item.get("pic").and_then(Value::as_str).unwrap_or(""),
                                "@672w_378h_1c.webp",
                            ),
                            duration_seconds: parse_duration(
                                item.get("length").and_then(Value::as_str).unwrap_or(""),
                            ),
                            author_mid: mid,
                            author_name: clean_text(
                                item.get("author").and_then(Value::as_str).unwrap_or(""),
                            ),
                            author_avatar_url: String::new(),
                            views: item.get("play").and_then(Value::as_u64).unwrap_or_default(),
                            progress_seconds: 0,
                            viewed_at: None,
                            added_at: item.get("created").and_then(Value::as_i64),
                        })
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        Ok(SpaceVideoPage {
            has_more: page.saturating_mul(20) < total as u32,
            videos,
            page,
            page_size: 20,
            total,
        })
    }

    async fn wbi_value(
        &self,
        path: &str,
        params: BTreeMap<String, String>,
    ) -> Result<Value, BiliError> {
        let cookie_header = self.search_cookie_header().await?;
        let keys = self
            .wbi
            .keys(&self.http, Some(&cookie_header), false)
            .await?;
        let query = sign_query(params, &keys, unix_timestamp());
        let response = self
            .http
            .get(format!("https://api.bilibili.com{path}?{query}"))
            .header(COOKIE, cookie_header)
            .send()
            .await?;
        let status = response.status();
        if !status.is_success() {
            return Err(BiliError::HttpStatus(status.as_u16()));
        }
        let envelope: ApiEnvelope<Value> = response.json().await?;
        if envelope.code != 0 {
            return Err(BiliError::Upstream {
                code: envelope.code,
                message: envelope.message.chars().take(160).collect(),
            });
        }
        envelope.data.ok_or(BiliError::MissingData)
    }
}

#[derive(Debug, Default, Deserialize)]
struct RawHistoryData {
    #[serde(default)]
    cursor: RawHistoryCursor,
    #[serde(default)]
    list: Vec<RawHistoryItem>,
}

#[derive(Debug, Default, Deserialize)]
struct RawHistoryCursor {
    #[serde(default)]
    max: i64,
    #[serde(default)]
    view_at: i64,
}

#[derive(Debug, Default, Deserialize)]
struct RawHistoryItem {
    #[serde(default)]
    title: String,
    #[serde(default)]
    cover: String,
    #[serde(default)]
    duration: u32,
    #[serde(default)]
    author_name: String,
    #[serde(default)]
    author_mid: u64,
    #[serde(default)]
    view_at: i64,
    #[serde(default)]
    progress: i64,
    #[serde(default)]
    history: RawHistoryIdentity,
}

#[derive(Debug, Default, Deserialize)]
struct RawHistoryIdentity {
    #[serde(default)]
    oid: u64,
    #[serde(default)]
    cid: u64,
    #[serde(default)]
    bvid: String,
    #[serde(default)]
    business: String,
}

#[derive(Debug, Default, Deserialize)]
struct RawWatchLaterData {
    #[serde(default)]
    count: u64,
    #[serde(default)]
    list: Vec<RawWatchLaterItem>,
}

#[derive(Debug, Default, Deserialize)]
struct RawWatchLaterItem {
    #[serde(default)]
    aid: u64,
    #[serde(default)]
    bvid: String,
    #[serde(default)]
    cid: u64,
    #[serde(default)]
    title: String,
    #[serde(default)]
    pic: String,
    #[serde(default)]
    duration: u32,
    #[serde(default)]
    owner: RawOwner,
    #[serde(default)]
    stat: RawStat,
    #[serde(default)]
    progress: i64,
    #[serde(default)]
    add_at: i64,
}

#[derive(Debug, Default, Deserialize)]
struct RawFavoriteResources {
    #[serde(default)]
    info: RawFavoriteInfo,
    #[serde(default)]
    medias: Vec<RawFavoriteMedia>,
    #[serde(default)]
    has_more: bool,
}

#[derive(Debug, Default, Deserialize)]
struct RawFavoriteInfo {
    #[serde(default)]
    media_count: u64,
}

#[derive(Debug, Default, Deserialize)]
struct RawFavoriteMedia {
    #[serde(default)]
    id: u64,
    #[serde(default)]
    bvid: String,
    #[serde(default)]
    title: String,
    #[serde(default)]
    cover: String,
    #[serde(default)]
    duration: u32,
    #[serde(default)]
    upper: RawOwner,
    #[serde(default)]
    cnt_info: RawStat,
    #[serde(default)]
    fav_time: i64,
    page: Option<RawFavoritePage>,
}

#[derive(Debug, Default, Deserialize)]
struct RawFavoritePage {
    #[serde(default)]
    cid: u64,
}

#[derive(Debug, Default, Deserialize)]
struct RawOwner {
    #[serde(default)]
    mid: u64,
    #[serde(default)]
    name: String,
    #[serde(default)]
    face: String,
}

#[derive(Debug, Default, Deserialize)]
struct RawStat {
    #[serde(default)]
    view: u64,
    #[serde(default)]
    play: u64,
}

#[derive(Debug, Default, Deserialize)]
struct RawRelationStat {
    #[serde(default)]
    following: u64,
    #[serde(default)]
    follower: u64,
}

fn clean_text(value: &str) -> String {
    html_escape::decode_html_entities(value)
        .chars()
        .filter(|character| *character == '\n' || *character == '\t' || !character.is_control())
        .take(500)
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

#[cfg(test)]
mod tests {
    use super::parse_duration;

    #[test]
    fn parses_space_video_duration_strings() {
        assert_eq!(parse_duration("03:07"), 187);
        assert_eq!(parse_duration("1:02:03"), 3723);
        assert_eq!(parse_duration("bad"), 0);
    }
}
