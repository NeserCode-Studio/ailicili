use std::collections::BTreeMap;

use md5::{Digest, Md5};

const MIXIN_KEY_TAB: [usize; 64] = [
    46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29,
    28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25,
    54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
];

pub fn extract_key_stem(url: &str) -> Option<String> {
    let file_name = url
        .rsplit('/')
        .next()
        .filter(|segment| !segment.is_empty())?;
    let (stem, extension) = file_name.rsplit_once('.')?;
    if stem.is_empty() || extension.is_empty() {
        return None;
    }
    Some(stem.to_string())
}

pub fn mixin_key(img_key: &str, sub_key: &str) -> Option<String> {
    if img_key.is_empty() || sub_key.is_empty() {
        return None;
    }
    let combined = format!("{img_key}{sub_key}");
    let bytes = combined.as_bytes();
    let key = MIXIN_KEY_TAB
        .iter()
        .filter_map(|index| bytes.get(*index).copied())
        .map(char::from)
        .take(32)
        .collect::<String>();
    (key.len() == 32).then_some(key)
}

pub fn sign_params(
    params: impl IntoIterator<Item = (String, String)>,
    mixin_key: &str,
    timestamp: u64,
) -> Vec<(String, String)> {
    let mut values = params
        .into_iter()
        .map(|(key, value)| (key, filter_value(&value)))
        .collect::<BTreeMap<_, _>>();
    values.insert("wts".to_string(), timestamp.to_string());

    let query = values
        .iter()
        .map(|(key, value)| format!("{}={}", rfc3986_encode(key), rfc3986_encode(value)))
        .collect::<Vec<_>>()
        .join("&");
    let digest = Md5::digest(format!("{query}{mixin_key}").as_bytes());
    values.insert("w_rid".to_string(), format!("{digest:x}"));
    values.into_iter().collect()
}

fn filter_value(value: &str) -> String {
    value
        .chars()
        .filter(|character| !"!'()*".contains(*character))
        .collect()
}

fn rfc3986_encode(value: &str) -> String {
    let mut encoded = String::new();
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                encoded.push(char::from(byte));
            }
            _ => encoded.push_str(&format!("%{byte:02X}")),
        }
    }
    encoded
}

#[cfg(test)]
mod tests {
    use super::*;

    const IMG_KEY: &str = "abcdefghijklmnopqrstuvwxyz123456";
    const SUB_KEY: &str = "ABCDEFGHIJKLMNOPQRSTUVWXYZ654321";

    #[test]
    fn extracts_nav_key_stem() {
        assert_eq!(
            extract_key_stem("https://i0.hdslb.com/bfs/wbi/abc123.png"),
            Some("abc123".to_string())
        );
        assert_eq!(
            extract_key_stem("https://i0.hdslb.com/bfs/wbi/no-extension"),
            None
        );
    }

    #[test]
    fn creates_stable_mixin_key() {
        assert_eq!(
            mixin_key(IMG_KEY, SUB_KEY).as_deref(),
            Some("OPscVixApSk66dND2LfRBjKt43oHmGJn")
        );
    }

    #[test]
    fn signs_sorted_params_with_fixed_vector() {
        let signed = sign_params(
            [
                ("foo".to_string(), "value!'()*".to_string()),
                ("bar".to_string(), "space value".to_string()),
            ],
            &mixin_key(IMG_KEY, SUB_KEY).unwrap(),
            1_700_000_000,
        );
        assert_eq!(
            signed,
            vec![
                ("bar".to_string(), "space value".to_string()),
                ("foo".to_string(), "value".to_string()),
                (
                    "w_rid".to_string(),
                    "e0bbf3c23838f46f9b7b2785d19dd01e".to_string()
                ),
                ("wts".to_string(), "1700000000".to_string()),
            ]
        );
    }

    #[test]
    fn encodes_non_ascii_and_spaces_as_utf8_percent_bytes() {
        assert_eq!(rfc3986_encode("中文 a"), "%E4%B8%AD%E6%96%87%20a");
    }
}
