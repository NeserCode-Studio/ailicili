use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

use reqwest::{
    header::{HeaderMap, ACCEPT, LOCATION, REFERER},
    Response, Url,
};

use super::DouyinError;

const MAX_MEDIA_REDIRECTS: usize = 4;
const ALLOWED_MEDIA_HOST_SUFFIXES: [&str; 13] = [
    "100ycdn.com",
    "ctcdn.com.cn",
    "douyin.com",
    "douyincdn.com",
    "douyinvod.com",
    "bytefcdn.com",
    "bytefcdnrd.com",
    "livehwc4.com",
    "mediaainet.com",
    "pstatp.com",
    "smtcdns.net",
    "volccdn.com",
    "zjcdn.com",
];

pub(super) async fn fetch_media_response(
    client: &reqwest::Client,
    mut url: Url,
    request_headers: &HeaderMap,
) -> Result<Response, DouyinError> {
    for redirect_count in 0..=MAX_MEDIA_REDIRECTS {
        let response = client
            .get(url.clone())
            .header(ACCEPT, "*/*")
            .header(REFERER, "https://live.douyin.com/")
            .header("origin", "https://live.douyin.com")
            .header("accept-language", "zh-CN,zh;q=0.9,en;q=0.8")
            .headers(request_headers.clone())
            .send()
            .await?;
        let status = response.status();
        if status.is_redirection() {
            if redirect_count == MAX_MEDIA_REDIRECTS {
                return Err(DouyinError::RedirectRejected);
            }
            let location = response
                .headers()
                .get(LOCATION)
                .and_then(|value| value.to_str().ok())
                .ok_or(DouyinError::RedirectRejected)?;
            url = redirect_url(&url, location)?;
            continue;
        }
        if matches!(status.as_u16(), 401 | 403 | 410) {
            return Err(DouyinError::MediaExpired);
        }
        return Ok(response);
    }
    Err(DouyinError::RedirectRejected)
}

pub(super) fn validate_media_url(value: &str) -> Result<Url, DouyinError> {
    let url = Url::parse(value).map_err(|_| DouyinError::MediaUrlRejected)?;
    if url.scheme() != "https"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some_and(|port| port != 443)
        || url.fragment().is_some()
    {
        return Err(DouyinError::MediaUrlRejected);
    }

    let host = url
        .host_str()
        .map(|host| host.trim_end_matches('.'))
        .map(str::to_ascii_lowercase)
        .ok_or(DouyinError::MediaUrlRejected)?;
    if let Ok(address) = parse_ip_host(&host) {
        if !is_public_ip(address) {
            return Err(DouyinError::MediaUrlRejected);
        }
        return Ok(url);
    }
    if ALLOWED_MEDIA_HOST_SUFFIXES
        .iter()
        .any(|suffix| host == *suffix || host.ends_with(&format!(".{suffix}")))
    {
        Ok(url)
    } else {
        Err(DouyinError::MediaUrlRejected)
    }
}

fn redirect_url(current: &Url, location: &str) -> Result<Url, DouyinError> {
    let next = current
        .join(location)
        .map_err(|_| DouyinError::RedirectRejected)?;
    validate_media_url(next.as_str()).map_err(|_| DouyinError::RedirectRejected)
}

fn parse_ip_host(host: &str) -> Result<IpAddr, ()> {
    host.trim_start_matches('[')
        .trim_end_matches(']')
        .parse()
        .map_err(|_| ())
}

fn is_public_ip(address: IpAddr) -> bool {
    match address {
        IpAddr::V4(address) => is_public_ipv4(address),
        IpAddr::V6(address) => is_public_ipv6(address),
    }
}

fn is_public_ipv4(address: Ipv4Addr) -> bool {
    let octets = address.octets();
    !(address.is_unspecified()
        || address.is_loopback()
        || address.is_private()
        || address.is_link_local()
        || address.is_broadcast()
        || address.is_multicast()
        || octets[0] == 0
        || octets[0] >= 240
        || (octets[0] == 100 && (64..=127).contains(&octets[1]))
        || (octets[0] == 192 && octets[1] == 0 && octets[2] == 0)
        || (octets[0] == 192 && octets[1] == 0 && octets[2] == 2)
        || (octets[0] == 198 && matches!(octets[1], 18 | 19))
        || (octets[0] == 198 && octets[1] == 51 && octets[2] == 100)
        || (octets[0] == 203 && octets[1] == 0 && octets[2] == 113))
}

fn is_public_ipv6(address: Ipv6Addr) -> bool {
    if let Some(mapped) = address.to_ipv4_mapped() {
        return is_public_ipv4(mapped);
    }
    let segments = address.segments();
    !(address.is_unspecified()
        || address.is_loopback()
        || address.is_multicast()
        || (segments[0] & 0xfe00) == 0xfc00
        || (segments[0] & 0xffc0) == 0xfe80
        || (segments[0] == 0x2001 && segments[1] == 0x0db8))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn media_urls_allow_vendor_hosts_and_public_cdn_ips() {
        for value in [
            "https://pull-hls-f1.douyincdn.com/live/index.m3u8?token=fixture",
            "https://pull-flv-f1.douyincdn.com/live/stream.flv?token=fixture",
            "https://fixture.100ycdn.com/live/segment.ts",
            "https://fixture.ctcdn.com.cn/live/segment.ts",
            "https://fixture.livehwc4.com/live/segment.ts",
            "https://fixture.mediaainet.com/live/stream.flv",
            "https://fixture.v.smtcdns.net/live/stream.flv",
            "https://8.8.8.8/live/segment.ts",
        ] {
            assert!(validate_media_url(value).is_ok(), "{value}");
        }
    }

    #[test]
    fn media_urls_reject_unsafe_schemes_hosts_ports_and_credentials() {
        for value in [
            "http://pull-hls-f1.douyincdn.com/live.m3u8",
            "https://localhost/live.m3u8",
            "https://127.0.0.1/live.m3u8",
            "https://10.0.0.1/live.m3u8",
            "https://169.254.1.1/live.m3u8",
            "https://192.168.1.1/live.m3u8",
            "https://[::1]/live.m3u8",
            "https://[fc00::1]/live.m3u8",
            "https://pull-hls-f1.douyincdn.com:8443/live.m3u8",
            "https://user:pass@pull-hls-f1.douyincdn.com/live.m3u8",
            "https://pull-hls-f1.douyincdn.com/live.m3u8#fragment",
            "https://evil100ycdn.com/live/segment.ts",
            "https://100ycdn.com.evil.example/live/segment.ts",
            "https://evillivehwc4.com/live/segment.ts",
            "https://livehwc4.com.evil.example/live/segment.ts",
        ] {
            assert!(validate_media_url(value).is_err(), "{value}");
        }
    }

    #[test]
    fn relative_redirect_is_resolved_and_revalidated() {
        let current =
            Url::parse("https://pull-flv-f1.douyincdn.com/live/start.flv").expect("fixture URL");
        let redirected = redirect_url(&current, "/cdn/stream.flv").unwrap();
        assert_eq!(
            redirected.as_str(),
            "https://pull-flv-f1.douyincdn.com/cdn/stream.flv"
        );

        let public_ip =
            Url::parse("https://8.8.8.8/live/stream.flv").expect("fixture redirect target");
        assert!(validate_media_url(public_ip.as_str()).is_ok());
    }

    #[test]
    fn private_redirect_targets_are_rejected() {
        let current =
            Url::parse("https://pull-flv-f1.douyincdn.com/live/start.flv").expect("fixture URL");
        assert!(redirect_url(&current, "http://10.0.0.1/stream.flv").is_err());
        assert!(redirect_url(&current, "https://127.0.0.1/stream.flv").is_err());
        assert!(redirect_url(&current, "https://example.com/stream.flv").is_err());
    }
}
