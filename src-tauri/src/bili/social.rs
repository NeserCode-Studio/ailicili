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
            .get::<RawArchiveRelation>(
                "/x/web-interface/archive/relation",
                &[("bvid", bvid.to_owned())],
            )
            .await?;
        let followed = if author_mid > 0 {
            self.user_followed(author_mid).await.unwrap_or(false)
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
        let relation: RawUserRelation =
            self.get("/x/relation", &[("fid", mid.to_string())]).await?;
        Ok(relation.attribute & 2 != 0)
    }

    pub async fn like_video(&self, bvid: &str, liked: bool) -> Result<(), BiliError> {
        super::client::validate_bvid(bvid)?;
        let mut form = BTreeMap::from([
            ("bvid".to_owned(), bvid.to_owned()),
            ("like".to_owned(), if liked { "1" } else { "2" }.to_owned()),
        ]);
        archive_risk_fields(&mut form, bvid, &self.session_user_id().await?);
        self.post_authenticated_form("/x/web-interface/archive/like", form)
            .await?;
        Ok(())
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
        let mut form = BTreeMap::from([
            ("bvid".to_owned(), bvid.to_owned()),
            ("multiply".to_owned(), multiply.to_string()),
            (
                "select_like".to_owned(),
                if with_like { "1" } else { "0" }.to_owned(),
            ),
        ]);
        archive_risk_fields(&mut form, bvid, &self.session_user_id().await?);
        self.post_authenticated_form("/x/web-interface/coin/add", form)
            .await?;
        Ok(())
    }

    pub async fn triple_video(&self, bvid: &str) -> Result<TripleResult, BiliError> {
        super::client::validate_bvid(bvid)?;
        let mut form = BTreeMap::from([("bvid".to_owned(), bvid.to_owned())]);
        archive_risk_fields(&mut form, bvid, &self.session_user_id().await?);
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
        let form = BTreeMap::from([
            ("fid".to_owned(), mid.to_string()),
            ("act".to_owned(), if follow { "1" } else { "2" }.to_owned()),
            ("re_src".to_owned(), "14".to_owned()),
            ("gaia_source".to_owned(), "web_main".to_owned()),
            ("spmid".to_owned(), "333.999.0.0".to_owned()),
            (
                "extend_content".to_owned(),
                format!(r#"{{"entity":"user","entity_id":{mid}}}"#),
            ),
        ]);
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

fn archive_risk_fields(form: &mut BTreeMap<String, String>, bvid: &str, mid: &str) {
    form.insert("re_src".to_owned(), "14".to_owned());
    form.insert("gaia_source".to_owned(), "web_main".to_owned());
    form.insert("spmid".to_owned(), "333.788.0.0".to_owned());
    form.insert(
        "extend_content".to_owned(),
        format!(r#"{{"entity":"video","entity_id":"{bvid}","mid":{mid}}}"#),
    );
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
    use super::RawArchiveRelation;

    #[test]
    fn maps_partial_archive_relation_payloads() {
        let relation: RawArchiveRelation =
            serde_json::from_str(r#"{"like":true,"coin":1,"favorite":false}"#)
                .expect("relation fixture");
        assert!(relation.like);
        assert_eq!(relation.coin, 1);
        assert!(!relation.favorite);
    }
}
