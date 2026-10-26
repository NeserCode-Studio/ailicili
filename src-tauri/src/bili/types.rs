use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, Deserialize)]
pub struct RawOwner {
    #[serde(default)]
    pub mid: u64,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub face: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct RawStat {
    #[serde(default)]
    pub view: u64,
    #[serde(default)]
    pub danmaku: u64,
    #[serde(default)]
    pub like: u64,
    #[serde(default)]
    pub reply: u64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RawRecommendationReason {
    #[serde(default)]
    pub content: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RawVideo {
    #[serde(default)]
    pub aid: u64,
    #[serde(default)]
    pub bvid: String,
    #[serde(default)]
    pub cid: Option<u64>,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub pic: String,
    #[serde(default)]
    pub owner: RawOwner,
    #[serde(default)]
    pub stat: RawStat,
    #[serde(default)]
    pub duration: u32,
    #[serde(default)]
    pub pubdate: i64,
    #[serde(default)]
    pub tname: Option<String>,
    #[serde(default)]
    pub rcmd_reason: Option<RawRecommendationReason>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoAuthor {
    pub mid: u64,
    pub name: String,
    pub avatar_url: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoStats {
    pub views: u64,
    pub danmaku: u64,
    pub likes: u64,
    pub comments: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoSummary {
    pub aid: u64,
    pub bvid: String,
    pub cid: Option<u64>,
    pub title: String,
    pub cover_url: String,
    pub author: VideoAuthor,
    pub stats: VideoStats,
    pub duration_seconds: u32,
    pub published_at: i64,
    pub category: Option<String>,
    pub recommendation_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PopularPage {
    pub videos: Vec<VideoSummary>,
    pub page: u32,
    pub page_size: u32,
    pub has_more: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RawPopularData {
    #[serde(default)]
    pub list: Vec<RawVideo>,
    #[serde(default)]
    pub no_more: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RawVideoPage {
    #[serde(default)]
    pub cid: u64,
    #[serde(default)]
    pub page: u32,
    #[serde(default)]
    pub part: String,
    #[serde(default)]
    pub duration: u32,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RawDimension {
    #[serde(default)]
    pub width: u32,
    #[serde(default)]
    pub height: u32,
    #[serde(default)]
    pub rotate: u32,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RawVideoDetailData {
    #[serde(default)]
    pub aid: u64,
    #[serde(default)]
    pub bvid: String,
    #[serde(default)]
    pub cid: u64,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub pic: String,
    #[serde(default)]
    pub desc: String,
    #[serde(default)]
    pub owner: RawOwner,
    #[serde(default)]
    pub stat: RawStat,
    #[serde(default)]
    pub duration: u32,
    #[serde(default)]
    pub pubdate: i64,
    #[serde(default)]
    pub tname: Option<String>,
    #[serde(default)]
    pub pages: Vec<RawVideoPage>,
    #[serde(default)]
    pub dimension: Option<RawDimension>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoPart {
    pub cid: u64,
    pub page: u32,
    pub title: String,
    pub duration_seconds: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoDimension {
    pub width: u32,
    pub height: u32,
    pub rotate: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoDetail {
    pub video: VideoSummary,
    pub description: String,
    pub parts: Vec<VideoPart>,
    pub dimension: Option<VideoDimension>,
}

impl RawVideo {
    pub fn into_summary(self) -> VideoSummary {
        VideoSummary {
            aid: self.aid,
            bvid: self.bvid,
            cid: self.cid,
            title: self.title,
            cover_url: image_url(&self.pic, "@672w_378h_1c.webp"),
            author: VideoAuthor {
                mid: self.owner.mid,
                name: self.owner.name,
                avatar_url: image_url(&self.owner.face, "@96w_96h_1c.webp"),
            },
            stats: VideoStats {
                views: self.stat.view,
                danmaku: self.stat.danmaku,
                likes: self.stat.like,
                comments: self.stat.reply,
            },
            duration_seconds: self.duration,
            published_at: self.pubdate,
            category: self.tname,
            recommendation_reason: self
                .rcmd_reason
                .map(|reason| reason.content)
                .filter(|content| !content.is_empty()),
        }
    }
}

impl RawVideoDetailData {
    pub fn into_detail(self) -> VideoDetail {
        let video = VideoSummary {
            aid: self.aid,
            bvid: self.bvid,
            cid: Some(self.cid),
            title: self.title,
            cover_url: image_url(&self.pic, "@1280w_720h_1c.webp"),
            author: VideoAuthor {
                mid: self.owner.mid,
                name: self.owner.name,
                avatar_url: image_url(&self.owner.face, "@128w_128h_1c.webp"),
            },
            stats: VideoStats {
                views: self.stat.view,
                danmaku: self.stat.danmaku,
                likes: self.stat.like,
                comments: self.stat.reply,
            },
            duration_seconds: self.duration,
            published_at: self.pubdate,
            category: self.tname,
            recommendation_reason: None,
        };

        VideoDetail {
            video,
            description: self.desc,
            parts: self
                .pages
                .into_iter()
                .map(|part| VideoPart {
                    cid: part.cid,
                    page: part.page,
                    title: part.part,
                    duration_seconds: part.duration,
                })
                .collect(),
            dimension: self.dimension.map(|dimension| VideoDimension {
                width: dimension.width,
                height: dimension.height,
                rotate: dimension.rotate,
            }),
        }
    }
}

pub(crate) fn image_url(value: &str, transform: &str) -> String {
    let value = value.trim();
    let normalized = if let Some(rest) = value.strip_prefix("http://") {
        format!("https://{rest}")
    } else if let Some(rest) = value.strip_prefix("//") {
        format!("https://{rest}")
    } else {
        value.to_owned()
    };

    if normalized.is_empty() {
        return String::new();
    }
    if normalized.contains('@') {
        return normalized;
    }

    format!("{normalized}{transform}")
}

#[cfg(test)]
mod tests {
    use super::{RawVideo, RawVideoDetailData};

    const POPULAR_FIXTURE: &str = r#"{
        "aid": 117502839360536,
        "bvid": "BV19wnQ6sExk",
        "cid": 43053026889,
        "title": "测试视频",
        "pic": "http://i2.hdslb.com/bfs/archive/cover.jpg",
        "owner": {
            "mid": 50329118,
            "name": "测试UP主",
            "face": "https://i2.hdslb.com/bfs/face/avatar.jpg"
        },
        "stat": {
            "view": 2523805,
            "danmaku": 28857,
            "like": 39287
        },
        "duration": 4424,
        "pubdate": 1792951186,
        "tname": "电子竞技",
        "rcmd_reason": {
            "content": "百万播放"
        }
    }"#;

    #[test]
    fn maps_popular_video_to_stable_summary() {
        let raw: RawVideo = serde_json::from_str(POPULAR_FIXTURE).expect("fixture parses");
        let summary = raw.into_summary();

        assert_eq!(summary.bvid, "BV19wnQ6sExk");
        assert_eq!(summary.author.name, "测试UP主");
        assert_eq!(summary.stats.views, 2523805);
        assert_eq!(
            summary.cover_url,
            "https://i2.hdslb.com/bfs/archive/cover.jpg@672w_378h_1c.webp"
        );
        assert_eq!(summary.recommendation_reason.as_deref(), Some("百万播放"));
    }

    #[test]
    fn maps_video_detail_parts_and_dimensions() {
        let fixture = r#"{
            "aid": 1,
            "bvid": "BV1xx411c7mD",
            "cid": 10,
            "title": "测试详情",
            "pic": "//i1.hdslb.com/cover.jpg",
            "desc": "简介",
            "owner": { "mid": 2, "name": "UP", "face": "" },
            "stat": { "view": 3, "danmaku": 4, "like": 5 },
            "duration": 120,
            "pubdate": 100,
            "pages": [
                { "cid": 10, "page": 1, "part": "P1", "duration": 60 }
            ],
            "dimension": { "width": 1920, "height": 1080, "rotate": 0 }
        }"#;
        let raw: RawVideoDetailData = serde_json::from_str(fixture).expect("fixture parses");
        let detail = raw.into_detail();

        assert_eq!(detail.parts.len(), 1);
        assert_eq!(detail.parts[0].title, "P1");
        assert_eq!(detail.dimension.expect("dimension").height, 1080);
        assert!(detail.video.cover_url.starts_with("https://"));
    }
}
