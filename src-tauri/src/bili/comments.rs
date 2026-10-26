use std::collections::BTreeMap;

use serde::{Deserialize, Deserializer, Serialize};

use super::{client::BiliClient, error::BiliError, types::image_url};

const COMMENT_PAGE_SIZE: u32 = 20;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommentPage {
    pub page: u32,
    pub page_size: u32,
    pub total: u64,
    pub has_more: bool,
    pub comments: Vec<CommentItem>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommentItem {
    pub id: String,
    pub author: CommentAuthor,
    pub message: String,
    pub emotes: Vec<CommentEmote>,
    pub likes: u64,
    pub created_at: i64,
    pub reply_count: u32,
    pub replies: Vec<CommentItem>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommentAuthor {
    pub mid: String,
    pub name: String,
    pub avatar_url: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommentEmote {
    pub key: String,
    pub url: String,
    pub width: u32,
    pub height: u32,
}

impl BiliClient {
    pub async fn comments(
        &self,
        aid: u64,
        page: u32,
        sort: &str,
    ) -> Result<CommentPage, BiliError> {
        if aid == 0 {
            return Err(BiliError::InvalidInput("aid must be positive"));
        }
        let page = page.clamp(1, 500);
        let sort = if sort == "time" { "0" } else { "1" };
        let data: RawReplyData = self
            .get(
                "/x/v2/reply",
                &[
                    ("type", "1".to_owned()),
                    ("oid", aid.to_string()),
                    ("pn", page.to_string()),
                    ("ps", COMMENT_PAGE_SIZE.to_string()),
                    ("sort", sort.to_owned()),
                ],
            )
            .await?;
        let total = data.page.count;
        let page = if data.page.num == 0 {
            page
        } else {
            data.page.num
        };
        let mut comments = Vec::new();
        for reply in data
            .top_replies
            .into_iter()
            .chain(data.upper.and_then(|upper| upper.top))
            .chain(data.replies)
        {
            if comments
                .iter()
                .any(|item: &CommentItem| item.id == reply.rpid.to_string())
            {
                continue;
            }
            comments.push(map_reply(reply));
        }
        let has_more = page.saturating_mul(COMMENT_PAGE_SIZE) < total as u32;
        Ok(CommentPage {
            page,
            page_size: COMMENT_PAGE_SIZE,
            total,
            has_more,
            comments,
        })
    }

    pub async fn post_comment(
        &self,
        aid: u64,
        message: &str,
        root: Option<u64>,
        parent: Option<u64>,
    ) -> Result<String, BiliError> {
        if aid == 0 {
            return Err(BiliError::InvalidInput("aid must be positive"));
        }
        let message = message.trim();
        if message.is_empty() || message.chars().count() > 1000 {
            return Err(BiliError::InvalidInput(
                "comment must contain 1 to 1000 characters",
            ));
        }
        if root.is_some() != parent.is_some() {
            return Err(BiliError::InvalidInput(
                "comment root and parent must be supplied together",
            ));
        }
        let mut form = BTreeMap::from([
            ("oid".to_owned(), aid.to_string()),
            ("type".to_owned(), "1".to_owned()),
            ("message".to_owned(), message.to_owned()),
            ("plat".to_owned(), "1".to_owned()),
        ]);
        if let (Some(root), Some(parent)) = (root, parent) {
            form.insert("root".to_owned(), root.to_string());
            form.insert("parent".to_owned(), parent.to_string());
        }
        let data = self
            .post_authenticated_form("/x/v2/reply/add", form)
            .await?;
        data.get("rpid_str")
            .and_then(serde_json::Value::as_str)
            .map(str::to_owned)
            .or_else(|| {
                data.get("rpid")
                    .and_then(serde_json::Value::as_u64)
                    .map(|value| value.to_string())
            })
            .ok_or(BiliError::InvalidResponse("missing comment id"))
    }
}

#[derive(Debug, Default, Deserialize)]
struct RawReplyData {
    #[serde(default)]
    page: RawReplyPage,
    #[serde(default, deserialize_with = "null_as_default")]
    replies: Vec<RawReply>,
    #[serde(default, deserialize_with = "null_as_default")]
    top_replies: Vec<RawReply>,
    upper: Option<RawUpper>,
}

#[derive(Debug, Default, Deserialize)]
struct RawReplyPage {
    #[serde(default)]
    count: u64,
    #[serde(default)]
    num: u32,
}

#[derive(Debug, Default, Deserialize)]
struct RawUpper {
    top: Option<RawReply>,
}

#[derive(Debug, Default, Deserialize)]
struct RawReply {
    #[serde(default)]
    rpid: u64,
    #[serde(default)]
    member: RawMember,
    #[serde(default)]
    content: RawContent,
    #[serde(default)]
    like: u64,
    #[serde(default)]
    ctime: i64,
    #[serde(default)]
    rcount: u32,
    #[serde(default, deserialize_with = "null_as_default")]
    replies: Vec<RawReply>,
}

#[derive(Debug, Default, Deserialize)]
struct RawMember {
    #[serde(default)]
    mid: serde_json::Value,
    #[serde(default)]
    uname: String,
    #[serde(default)]
    avatar: String,
}

#[derive(Debug, Default, Deserialize)]
struct RawContent {
    #[serde(default)]
    message: String,
    #[serde(default, deserialize_with = "null_as_default")]
    emote: BTreeMap<String, RawEmote>,
}

#[derive(Debug, Default, Deserialize)]
struct RawEmote {
    #[serde(default)]
    url: String,
    #[serde(default)]
    meta: RawEmoteMeta,
}

#[derive(Debug, Default, Deserialize)]
struct RawEmoteMeta {
    #[serde(default)]
    size: u32,
}

fn map_reply(reply: RawReply) -> CommentItem {
    let mid = reply
        .member
        .mid
        .as_u64()
        .map(|value| value.to_string())
        .or_else(|| reply.member.mid.as_str().map(str::to_owned))
        .unwrap_or_default();
    let emotes = reply
        .content
        .emote
        .into_iter()
        .filter_map(|(key, emote)| {
            let url = image_url(&emote.url, "@64w_64h_1c.webp");
            (!key.is_empty() && !url.is_empty()).then_some(CommentEmote {
                key,
                url,
                width: emote.meta.size.clamp(16, 96),
                height: emote.meta.size.clamp(16, 96),
            })
        })
        .collect();
    CommentItem {
        id: reply.rpid.to_string(),
        author: CommentAuthor {
            mid,
            name: clean_text(&reply.member.uname),
            avatar_url: image_url(&reply.member.avatar, "@72w_72h_1c.webp"),
        },
        message: clean_text(&reply.content.message),
        emotes,
        likes: reply.like,
        created_at: reply.ctime,
        reply_count: reply.rcount,
        replies: reply.replies.into_iter().take(3).map(map_reply).collect(),
    }
}

fn clean_text(value: &str) -> String {
    html_escape::decode_html_entities(value)
        .chars()
        .filter(|character| *character == '\n' || *character == '\t' || !character.is_control())
        .take(2000)
        .collect()
}

fn null_as_default<'de, D, T>(deserializer: D) -> Result<T, D::Error>
where
    D: Deserializer<'de>,
    T: Default + Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer).map(Option::unwrap_or_default)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{clean_text, map_reply, RawReply, RawReplyData};
    use crate::bili::client::BiliClient;

    #[test]
    fn maps_comment_emotes_and_embedded_replies() {
        let raw: RawReply = serde_json::from_value(json!({
            "rpid": 42,
            "member": {
                "mid": "9",
                "uname": "用户 &amp; 昵称",
                "avatar": "//i0.hdslb.com/avatar.jpg"
            },
            "content": {
                "message": "你好 [doge]",
                "emote": {
                    "[doge]": {
                        "url": "//i0.hdslb.com/doge.png",
                        "meta": { "size": 64 }
                    }
                }
            },
            "like": 7,
            "ctime": 100,
            "rcount": 1,
            "replies": [{
                "rpid": 43,
                "member": { "mid": 10, "uname": "回复", "avatar": "" },
                "content": { "message": "收到" }
            }]
        }))
        .expect("comment fixture");
        let item = map_reply(raw);
        assert_eq!(item.id, "42");
        assert_eq!(item.author.name, "用户 & 昵称");
        assert_eq!(item.emotes[0].key, "[doge]");
        assert!(item.emotes[0].url.starts_with("https://"));
        assert_eq!(item.replies[0].id, "43");
    }

    #[test]
    fn strips_control_characters_but_keeps_line_breaks() {
        assert_eq!(clean_text("a\u{1}b\nc"), "ab\nc");
    }

    #[test]
    fn accepts_null_collections_from_comment_payloads() {
        let raw: RawReplyData = serde_json::from_value(json!({
            "page": { "count": 1, "num": 1 },
            "replies": [{
                "rpid": 42,
                "member": { "mid": 9, "uname": "用户", "avatar": "" },
                "content": { "message": "评论", "emote": null },
                "replies": null
            }],
            "top_replies": null
        }))
        .expect("nullable comment fixture");

        assert_eq!(raw.replies.len(), 1);
        assert!(raw.replies[0].replies.is_empty());
        assert!(raw.top_replies.is_empty());
    }

    #[tokio::test]
    #[ignore = "requires network access to Bilibili"]
    async fn live_comments_smoke() {
        let client = BiliClient::new().expect("client");
        let page = client
            .comments(117_502_839_360_536, 1, "hot")
            .await
            .expect("comments response");

        assert!(page.total > 0);
        assert!(!page.comments.is_empty());
    }
}
