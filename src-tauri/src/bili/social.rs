use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use super::{client::BiliClient, error::BiliError};

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoActionState {
    pub liked: bool,
    pub coined: u32,
    pub favorited: bool,
    pub followed: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TripleResult {
    pub liked: bool,
    pub coined: bool,
    pub favorited: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FavoriteFolder {
    pub id: String,
    pub title: String,
    pub media_count: u64,
}

impl BiliClient {
    pub async fn video_action_state(
        &self,
        bvid: &str,
        author_mid: u64,
    ) -> Result<VideoActionState, BiliError> {
        let archive = self
            .get_authenticated::<RawArchiveRelation>(
                "/x/web-interface/archive/relation",
                &[("bvid", bvid.to_owned())],
            )
            .await?;
        let followed = if author_mid > 0 {
            self.user_followed(author_mid).await?
        } else {
            false
        };
        Ok(VideoActionState {
            liked: archive.like,
            coined: archive.coin.min(2) as u32,
            favorited: archive.favorite,
            followed,
        })
    }

    pub async fn user_followed(&self, mid: u64) -> Result<bool, BiliError> {
        if mid == 0 {
            return Ok(false);
        }
        let relation: RawUserRelation = self
            .get_authenticated("/x/relation", &[("fid", mid.to_string())])
            .await?;
        Ok(relation_is_followed(relation.attribute))
    }

    pub async fn like_video(&self, bvid: &str, liked: bool) -> Result<(), BiliError> {
        super::client::validate_bvid(bvid)?;
        let form = like_form(bvid, liked);
        match self
            .post_authenticated_form("/x/web-interface/archive/like", form)
            .await
        {
            Ok(_) => Ok(()),
            Err(error) if like_error_is_idempotent(liked, &error) => Ok(()),
            Err(error) => Err(error),
        }
    }

    pub async fn coin_video(
        &self,
        bvid: &str,
        multiply: u8,
        with_like: bool,
    ) -> Result<(), BiliError> {
        super::client::validate_bvid(bvid)?;
        if !(1..=2).contains(&multiply) {
            return Err(BiliError::InvalidInput("coin count must be 1 or 2"));
        }
        let form = coin_form(bvid, multiply, with_like);
        self.post_authenticated_form("/x/web-interface/coin/add", form)
            .await?;
        Ok(())
    }

    pub async fn triple_video(&self, bvid: &str) -> Result<TripleResult, BiliError> {
        super::client::validate_bvid(bvid)?;
        let form = triple_form(bvid);
        let data = self
            .post_authenticated_form("/x/web-interface/archive/like/triple", form)
            .await?;
        Ok(TripleResult {
            liked: data
                .get("like")
                .and_then(serde_json::Value::as_bool)
                .unwrap_or(false),
            coined: data
                .get("coin")
                .and_then(serde_json::Value::as_bool)
                .unwrap_or(false),
            favorited: data
                .get("fav")
                .and_then(serde_json::Value::as_bool)
                .unwrap_or(false),
        })
    }

    pub async fn follow_user(&self, mid: u64, follow: bool) -> Result<(), BiliError> {
        if mid == 0 {
            return Err(BiliError::InvalidInput("user id must be positive"));
        }
        let form = follow_form(mid, follow);
        self.post_authenticated_form("/x/relation/modify", form)
            .await?;
        Ok(())
    }

    pub async fn favorite_folders(&self) -> Result<Vec<FavoriteFolder>, BiliError> {
        let mid = self.session_user_id().await?;
        let data: RawFavoriteFolders = self
            .get_authenticated("/x/v3/fav/folder/created/list-all", &[("up_mid", mid)])
            .await?;
        Ok(data
            .list
            .into_iter()
            .filter(|folder| folder.id > 0)
            .map(|folder| FavoriteFolder {
                id: folder.id.to_string(),
                title: folder.title,
                media_count: folder.media_count,
            })
            .collect())
    }

    pub async fn set_video_favorite(
        &self,
        aid: u64,
        add_media_ids: &[String],
        remove_media_ids: &[String],
    ) -> Result<(), BiliError> {
        if aid == 0 {
            return Err(BiliError::InvalidInput("aid must be positive"));
        }
        let valid_ids = |ids: &[String]| {
            ids.iter().all(|id| {
                !id.is_empty()
                    && id.len() <= 20
                    && id.chars().all(|character| character.is_ascii_digit())
            })
        };
        if !valid_ids(add_media_ids) || !valid_ids(remove_media_ids) {
            return Err(BiliError::InvalidInput("invalid favorite folder id"));
        }
        let form = BTreeMap::from([
            ("rid".to_owned(), aid.to_string()),
            ("type".to_owned(), "2".to_owned()),
            ("add_media_ids".to_owned(), add_media_ids.join(",")),
            ("del_media_ids".to_owned(), remove_media_ids.join(",")),
        ]);
        self.post_authenticated_form("/x/v3/fav/resource/deal", form)
            .await?;
        Ok(())
    }
}

fn like_form(bvid: &str, liked: bool) -> BTreeMap<String, String> {
    BTreeMap::from([
        ("bvid".to_owned(), bvid.to_owned()),
        ("like".to_owned(), if liked { "1" } else { "2" }.to_owned()),
    ])
}

fn coin_form(bvid: &str, multiply: u8, with_like: bool) -> BTreeMap<String, String> {
    BTreeMap::from([
        ("bvid".to_owned(), bvid.to_owned()),
        ("multiply".to_owned(), multiply.to_string()),
        (
            "select_like".to_owned(),
            if with_like { "1" } else { "0" }.to_owned(),
        ),
    ])
}

fn triple_form(bvid: &str) -> BTreeMap<String, String> {
    BTreeMap::from([("bvid".to_owned(), bvid.to_owned())])
}

fn follow_form(mid: u64, follow: bool) -> BTreeMap<String, String> {
    BTreeMap::from([
        ("fid".to_owned(), mid.to_string()),
        ("act".to_owned(), if follow { "1" } else { "2" }.to_owned()),
        ("re_src".to_owned(), "14".to_owned()),
    ])
}

fn relation_is_followed(attribute: i64) -> bool {
    attribute & 2 != 0
}

fn like_error_is_idempotent(liked: bool, error: &BiliError) -> bool {
    matches!(
        (liked, error),
        (true, BiliError::Upstream { code: 65006, .. })
            | (false, BiliError::Upstream { code: 65004, .. })
    )
}

#[derive(Debug, Default, Deserialize)]
struct RawArchiveRelation {
    #[serde(default)]
    like: bool,
    #[serde(default)]
    coin: i64,
    #[serde(default)]
    favorite: bool,
}

#[derive(Debug, Default, Deserialize)]
struct RawUserRelation {
    #[serde(default)]
    attribute: i64,
}

#[derive(Debug, Default, Deserialize)]
struct RawFavoriteFolders {
    #[serde(default)]
    list: Vec<RawFavoriteFolder>,
}

#[derive(Debug, Default, Deserialize)]
struct RawFavoriteFolder {
    #[serde(default)]
    id: u64,
    #[serde(default)]
    title: String,
    #[serde(default)]
    media_count: u64,
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;

    use crate::bili::client::BiliClient;

    use super::{
        coin_form, follow_form, like_error_is_idempotent, like_form, relation_is_followed,
        triple_form, RawArchiveRelation,
    };
    use crate::bili::error::BiliError;

    #[test]
    fn maps_partial_archive_relation_payloads() {
        let relation: RawArchiveRelation =
            serde_json::from_str(r#"{"like":true,"coin":1,"favorite":false}"#)
                .expect("relation fixture");
        assert!(relation.like);
        assert_eq!(relation.coin, 1);
        assert!(!relation.favorite);
    }

    #[test]
    fn sends_only_documented_video_action_fields() {
        let like = like_form("BV19wnQ6sExk", true);
        assert_eq!(like.get("like").map(String::as_str), Some("1"));
        assert_eq!(
            like.keys().cloned().collect::<BTreeSet<_>>(),
            BTreeSet::from(["bvid".to_owned(), "like".to_owned()])
        );

        let coin = coin_form("BV19wnQ6sExk", 2, true);
        assert_eq!(coin.get("multiply").map(String::as_str), Some("2"));
        assert_eq!(coin.get("select_like").map(String::as_str), Some("1"));
        assert_eq!(
            coin.keys().cloned().collect::<BTreeSet<_>>(),
            BTreeSet::from([
                "bvid".to_owned(),
                "multiply".to_owned(),
                "select_like".to_owned(),
            ])
        );

        assert_eq!(
            triple_form("BV19wnQ6sExk")
                .keys()
                .cloned()
                .collect::<BTreeSet<_>>(),
            BTreeSet::from(["bvid".to_owned()])
        );
    }

    #[test]
    fn follow_status_and_form_match_the_documented_relation_api() {
        assert!(!relation_is_followed(0));
        assert!(relation_is_followed(2));
        assert!(relation_is_followed(6));
        assert!(!relation_is_followed(128));

        let follow = follow_form(42, true);
        assert_eq!(follow.get("fid").map(String::as_str), Some("42"));
        assert_eq!(follow.get("act").map(String::as_str), Some("1"));
        assert_eq!(follow.get("re_src").map(String::as_str), Some("14"));
        assert_eq!(
            follow.keys().cloned().collect::<BTreeSet<_>>(),
            BTreeSet::from(["act".to_owned(), "fid".to_owned(), "re_src".to_owned()])
        );
    }

    #[test]
    fn treats_already_applied_like_errors_as_success() {
        let already_liked = BiliError::Upstream {
            code: 65006,
            message: "already liked".to_owned(),
        };
        let already_unliked = BiliError::Upstream {
            code: 65004,
            message: "already unliked".to_owned(),
        };
        let other_error = BiliError::Upstream {
            code: 65007,
            message: "other error".to_owned(),
        };

        assert!(like_error_is_idempotent(true, &already_liked));
        assert!(like_error_is_idempotent(false, &already_unliked));
        assert!(!like_error_is_idempotent(false, &already_liked));
        assert!(!like_error_is_idempotent(true, &already_unliked));
        assert!(!like_error_is_idempotent(true, &other_error));
    }

    #[ignore = "requires network access and an authenticated Bilibili session"]
    #[tokio::test]
    async fn live_authenticated_video_action_state_smoke() {
        let client = BiliClient::new().expect("client");
        assert!(
            client
                .auth_status()
                .await
                .expect("auth status")
                .authenticated,
            "an authenticated session is required"
        );

        let detail = client
            .video_detail("BV1xx411c7mD")
            .await
            .expect("video detail");
        let state = client
            .video_action_state(&detail.video.bvid, detail.video.author.mid)
            .await
            .expect("authenticated action state");
        assert!(state.coined <= 2);
    }
}
