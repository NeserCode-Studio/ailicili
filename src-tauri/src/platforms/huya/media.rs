use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

use reqwest::{
    header::{HeaderMap, ACCEPT, LOCATION, REFERER},
    Response, Url,
};

use super::HuyaError;

const MAX_MEDIA_REDIRECTS: usize = 4;
const ALLOWED_MEDIA_HOST_SUFFIXES: [&str; 3] = ["bytefcdnrd.com", "huya.com", "smtcdns.net"];
const ALLOWED_HTTP_IP_PATH_PREFIXES: [&str; 3] = [
    "/al.hls.huya.com/",
    "/hs.hls.huya.com/",
    "/tx.hls.huya.com/",
];

pub(super) async fn fetch_media_response(
    client: &reqwest::Client,
    mut url: Url,
    request_headers: &HeaderMap,
) -> Result<Response, HuyaError> {
    for redirect_count in 0..=MAX_MEDIA_REDIRECTS {
        let response = client
            .get(url.clone())
            .header(ACCEPT, "*/*")
            .header(REFERER, "https://www.huya.com/")
            .header("origin", "https://www.huya.com")
            .header("accept-language", "zh-CN,zh;q=0.9,en;q=0.8")
            .headers(request_headers.clone())
            .send()
            .await?;
        let status = response.status();
        if status.is_redirection() {
            if redirect_count == MAX_MEDIA_REDIRECTS {
                return Err(HuyaError::RedirectRejected);
            }
            let location = response
                .headers()
                .get(LOCATION)
                .and_then(|value| value.to_str().ok())
                .ok_or(HuyaError::RedirectRejected)?;
            url = redirect_url(&url, location)?;
            continue;
        }
        if matches!(status.as_u16(), 401 | 403 | 410) {
            return Err(HuyaError::MediaExpired(status.as_u16()));
        }
        return Ok(response);
    }
    Err(HuyaError::RedirectRejected)
}

pub(super) fn validate_media_url(value: &str) -> Result<Url, HuyaError> {
    let url = Url::parse(value).map_err(|_| HuyaError::MediaUrlRejected)?;
    let expected_port = match url.scheme() {
        "https" => 443,
        "http" => 80,
        _ => return Err(HuyaError::MediaUrlRejected),
    };
    if !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some_and(|port| port != expected_port)
        || url.fragment().is_some()
    {
        return Err(HuyaError::MediaUrlRejected);
    }

    let host = url
        .host_str()
        .map(|host| host.trim_end_matches('.'))
        .map(str::to_ascii_lowercase)
        .ok_or(HuyaError::MediaUrlRejected)?;
    if let Ok(address) = parse_ip_host(&host) {
        if !is_public_ip(address) {
            return Err(HuyaError::MediaUrlRejected);
        }
        if url.scheme() == "http"
            && !ALLOWED_HTTP_IP_PATH_PREFIXES
                .iter()
                .any(|prefix| url.path().starts_with(prefix))
        {
            return Err(HuyaError::MediaUrlRejected);
        }
        return Ok(url);
    }
    if ALLOWED_MEDIA_HOST_SUFFIXES
        .iter()
        .any(|suffix| host == *suffix || host.ends_with(&format!(".{suffix}")))
    {
        Ok(url)
    } else {
        Err(HuyaError::MediaUrlRejected)
    }
}

fn redirect_url(current: &Url, location: &str) -> Result<Url, HuyaError> {
    let next = current
        .join(location)
        .map_err(|_| HuyaError::RedirectRejected)?;
    if validate_media_url(next.as_str()).is_ok() {
        return Ok(next);
    }

    let current_host = current
        .host_str()
        .map(str::to_ascii_lowercase)
        .unwrap_or_default();
    let next_host = next
        .host_str()
        .map(str::to_ascii_lowercase)
        .unwrap_or_default();
    let is_huya_flv_source = current.scheme() == "http"
        && current.port().is_none_or(|port| port == 80)
        && current_host.ends_with(".flv.huya.com");
    let is_public_flv_redirect = next.scheme() == "http"
        && next.port().is_none_or(|port| port == 80)
        && parse_ip_host(&next_host).ok().is_some_and(is_public_ip)
        && next.path().starts_with("/src/")
        && next.path().ends_with(".flv");
    if is_huya_flv_source && is_public_flv_redirect {
        Ok(next)
    } else {
        Err(HuyaError::RedirectRejected)
    }
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
    fn media_urls_allow_observed_huya_hosts_and_public_ips() {
        for value in [
            "https://tx.hls.huya.com/src/fixture.m3u8?token=fixture",
            "https://al.flv.huya.com/src/fixture.flv?token=fixture",
            "https://fixture.v.smtcdns.net/live/segment.ts",
            "https://fixture.bytefcdnrd.com/live/stream.flv",
            "https://8.8.8.8/live/segment.ts",
            "http://hs.hls.huya.com:80/src/fixture.ts?token=fixture",
            "http://223.111.94.28:80/tx.hls.huya.com/src/fixture.m3u8?token=fixture",
        ] {
            assert!(validate_media_url(value).is_ok(), "{value}");
        }
    }

    #[test]
    fn media_urls_reject_unsafe_schemes_hosts_ports_and_credentials() {
        for value in [
            "https://localhost/live.m3u8",
            "https://127.0.0.1/live.m3u8",
            "https://10.0.0.1/live.m3u8",
            "https://169.254.1.1/live.m3u8",
            "https://192.168.1.1/live.m3u8",
            "https://[::1]/live.m3u8",
            "https://[fc00::1]/live.m3u8",
            "https://tx.hls.huya.com:8443/src/live.m3u8",
            "https://user:pass@tx.hls.huya.com/src/live.m3u8",
            "https://tx.hls.huya.com/src/live.m3u8#fragment",
            "https://evilhuya.com/live/segment.ts",
            "https://huya.com.evil.example/live/segment.ts",
            "https://evilbytefcdnrd.com/live/stream.flv",
            "https://bytefcdnrd.com.evil.example/live/stream.flv",
            "http://example.com/live/segment.ts",
            "http://8.8.8.8/live/segment.ts",
            "http://8.8.8.8/tx.hls.huya.com.evil/segment.ts",
            "http://127.0.0.1/tx.hls.huya.com/segment.ts",
            "http://hs.hls.huya.com:443/src/live.ts",
            "https://hs.hls.huya.com:80/src/live.ts",
        ] {
            assert!(validate_media_url(value).is_err(), "{value}");
        }
    }

    #[test]
    fn relative_redirect_is_resolved_and_revalidated() {
        let current = Url::parse("https://tx.flv.huya.com/src/start.flv").expect("fixture URL");
        let redirected = redirect_url(&current, "/cdn/stream.flv").unwrap();
        assert_eq!(
            redirected.as_str(),
            "https://tx.flv.huya.com/cdn/stream.flv"
        );

        let current = Url::parse("http://tx.flv.huya.com/src/start.flv").expect("fixture URL");
        let redirected =
            redirect_url(&current, "http://8.8.8.8/src/fixture.flv").expect("CDN IP redirect");
        assert_eq!(redirected.as_str(), "http://8.8.8.8/src/fixture.flv");
    }

    #[test]
    fn private_or_unapproved_redirect_targets_are_rejected() {
        let current = Url::parse("https://tx.flv.huya.com/src/start.flv").expect("fixture URL");
        assert!(redirect_url(&current, "http://10.0.0.1/stream.flv").is_err());
        assert!(redirect_url(&current, "https://127.0.0.1/stream.flv").is_err());
        assert!(redirect_url(&current, "https://example.com/stream.flv").is_err());

        let current = Url::parse("https://tx.flv.huya.com/src/start.flv").expect("fixture URL");
        assert!(redirect_url(&current, "http://8.8.8.8/src/fixture.flv").is_err());
        let current = Url::parse("http://tx.flv.huya.com/src/start.flv").expect("fixture URL");
        assert!(redirect_url(&current, "http://127.0.0.1/src/fixture.flv").is_err());
        assert!(redirect_url(&current, "http://8.8.8.8/not-flv/stream.flv").is_err());
    }
}
