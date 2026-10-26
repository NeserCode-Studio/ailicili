use http::{
    header::{
        ACCEPT_RANGES, CACHE_CONTROL, CONTENT_LENGTH, CONTENT_RANGE, CONTENT_TYPE, ETAG, IF_RANGE,
        LAST_MODIFIED, RANGE,
    },
    Method, Response, StatusCode,
};
use tauri::{AppHandle, Manager, UriSchemeContext, UriSchemeResponder, Wry};

use super::client::BiliClient;

const ALLOW_HEADERS: &str = "Range, If-Range";
const EXPOSE_HEADERS: &str = "Content-Range, Content-Length, Accept-Ranges, Content-Type";

pub fn handle(
    app: AppHandle,
    _context: UriSchemeContext<'_, Wry>,
    request: http::Request<Vec<u8>>,
    responder: UriSchemeResponder,
) {
    if request.method() == Method::OPTIONS {
        responder.respond(preflight_response());
        return;
    }

    tauri::async_runtime::spawn(async move {
        let response = match serve(app, &request).await {
            Ok(response) => response,
            Err(status) => error_response(status),
        };
        responder.respond(response);
    });
}

async fn serve(
    app: AppHandle,
    request: &http::Request<Vec<u8>>,
) -> Result<Response<Vec<u8>>, StatusCode> {
    if !matches!(*request.method(), Method::GET | Method::HEAD) {
        return Err(StatusCode::METHOD_NOT_ALLOWED);
    }

    let segments = request
        .uri()
        .path()
        .split('/')
        .filter(|segment| !segment.is_empty())
        .collect::<Vec<_>>();
    let state = app.state::<BiliClient>();
    let media = state.media.clone();
    let live_media = state.live_media.clone();

    if let ["live", token, "index.m3u8"] = segments.as_slice() {
        let playlist = live_media
            .playlist(&state.http, token)
            .await
            .map_err(|error| live_status(&error))?;
        let bytes = playlist.into_bytes();
        let length = bytes.len();
        return Response::builder()
            .status(StatusCode::OK)
            .header(CONTENT_TYPE, "application/vnd.apple.mpegurl; charset=utf-8")
            .header(CACHE_CONTROL, "no-store")
            .header(CONTENT_LENGTH, length.to_string())
            .header("access-control-allow-origin", "*")
            .header("access-control-allow-headers", ALLOW_HEADERS)
            .header("access-control-expose-headers", EXPOSE_HEADERS)
            .header("cross-origin-resource-policy", "cross-origin")
            .body(if request.method() == Method::HEAD {
                Vec::new()
            } else {
                bytes
            })
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR);
    }

    if let ["live", token, "asset", asset_token] = segments.as_slice() {
        let asset = live_media
            .asset(token, asset_token)
            .ok_or(StatusCode::NOT_FOUND)?;
        if asset.is_playlist() {
            let playlist = live_media
                .asset_playlist(&state.http, token, asset_token)
                .await
                .map_err(|error| live_status(&error))?
                .ok_or(StatusCode::NOT_FOUND)?;
            let bytes = playlist.into_bytes();
            let length = bytes.len();
            return Response::builder()
                .status(StatusCode::OK)
                .header(CONTENT_TYPE, "application/vnd.apple.mpegurl; charset=utf-8")
                .header(CACHE_CONTROL, "no-store")
                .header(CONTENT_LENGTH, length.to_string())
                .header("access-control-allow-origin", "*")
                .header("access-control-allow-headers", ALLOW_HEADERS)
                .header("access-control-expose-headers", EXPOSE_HEADERS)
                .header("cross-origin-resource-policy", "cross-origin")
                .body(if request.method() == Method::HEAD {
                    Vec::new()
                } else {
                    bytes
                })
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR);
        }
        let upstream = state
            .http
            .request(request.method().clone(), asset.remote_url)
            .header(reqwest::header::COOKIE, asset.cookie_header)
            .header(reqwest::header::REFERER, asset.referer);
        return proxy_upstream(upstream, request).await;
    }

    if let ["mpd", token] = segments.as_slice() {
        let mpd = media.mpd(token).ok_or(StatusCode::NOT_FOUND)?;
        let bytes = mpd.into_bytes();
        let length = bytes.len();
        let mut builder = Response::builder()
            .status(StatusCode::OK)
            .header(CONTENT_TYPE, "application/dash+xml; charset=utf-8")
            .header(CACHE_CONTROL, "no-store")
            .header("access-control-allow-origin", "*")
            .header("access-control-expose-headers", EXPOSE_HEADERS);
        builder = builder.header(CONTENT_LENGTH, length.to_string());
        return builder
            .body(if request.method() == Method::HEAD {
                Vec::new()
            } else {
                bytes
            })
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR);
    }

    let ["media", token, kind, track] = segments.as_slice() else {
        return Err(StatusCode::NOT_FOUND);
    };
    let remote_url = media
        .media_url(token, kind, track)
        .ok_or(StatusCode::NOT_FOUND)?;
    let mut upstream = state.http.request(request.method().clone(), remote_url);
    if let Some(range) = request.headers().get(RANGE) {
        let value = range.to_str().map_err(|_| StatusCode::BAD_REQUEST)?;
        if value.len() > 128 || !value.starts_with("bytes=") {
            return Err(StatusCode::BAD_REQUEST);
        }
        upstream = upstream.header(RANGE, value);
    }
    if let Some(if_range) = request.headers().get(IF_RANGE) {
        if let Ok(value) = if_range.to_str() {
            upstream = upstream.header(IF_RANGE, value);
        }
    }
    if let Some(cookie_header) = state.session.cookie_header().await {
        upstream = upstream.header(reqwest::header::COOKIE, cookie_header);
    }

    proxy_upstream(upstream, request).await
}

async fn proxy_upstream(
    upstream: reqwest::RequestBuilder,
    request: &http::Request<Vec<u8>>,
) -> Result<Response<Vec<u8>>, StatusCode> {
    let upstream = upstream.send().await.map_err(|_| StatusCode::BAD_GATEWAY)?;
    let status =
        StatusCode::from_u16(upstream.status().as_u16()).map_err(|_| StatusCode::BAD_GATEWAY)?;
    let mut builder = Response::builder()
        .status(status)
        .header("access-control-allow-origin", "*")
        .header("access-control-allow-headers", ALLOW_HEADERS)
        .header("access-control-expose-headers", EXPOSE_HEADERS)
        .header("cross-origin-resource-policy", "cross-origin");

    for header in [
        CONTENT_TYPE,
        CONTENT_LENGTH,
        CONTENT_RANGE,
        ACCEPT_RANGES,
        CACHE_CONTROL,
        ETAG,
        LAST_MODIFIED,
    ] {
        if let Some(value) = upstream.headers().get(&header) {
            builder = builder.header(header, value.clone());
        }
    }
    if !upstream.headers().contains_key(ACCEPT_RANGES) {
        builder = builder.header(ACCEPT_RANGES, "bytes");
    }

    let body = if request.method() == Method::HEAD {
        Vec::new()
    } else {
        upstream
            .bytes()
            .await
            .map_err(|_| StatusCode::BAD_GATEWAY)?
            .to_vec()
    };
    builder
        .body(body)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

fn live_status(error: &super::error::BiliError) -> StatusCode {
    match error {
        super::error::BiliError::InvalidInput(_) | super::error::BiliError::InvalidResponse(_) => {
            StatusCode::NOT_FOUND
        }
        _ => StatusCode::BAD_GATEWAY,
    }
}

fn preflight_response() -> Response<Vec<u8>> {
    Response::builder()
        .status(StatusCode::NO_CONTENT)
        .header("access-control-allow-origin", "*")
        .header("access-control-allow-methods", "GET, HEAD, OPTIONS")
        .header("access-control-allow-headers", ALLOW_HEADERS)
        .header("access-control-expose-headers", EXPOSE_HEADERS)
        .header("access-control-max-age", "86400")
        .body(Vec::new())
        .expect("static preflight response")
}

fn error_response(status: StatusCode) -> Response<Vec<u8>> {
    let body = status
        .canonical_reason()
        .unwrap_or("media error")
        .as_bytes()
        .to_vec();
    Response::builder()
        .status(status)
        .header(CONTENT_TYPE, "text/plain; charset=utf-8")
        .header(CONTENT_LENGTH, body.len().to_string())
        .header("access-control-allow-origin", "*")
        .header("access-control-expose-headers", EXPOSE_HEADERS)
        .body(body)
        .expect("static error response")
}

#[cfg(test)]
mod tests {
    use http::Method;

    use super::{preflight_response, ALLOW_HEADERS, EXPOSE_HEADERS};

    #[test]
    fn preflight_allows_range_requests_and_exposes_media_headers() {
        let response = preflight_response();
        assert_eq!(response.status(), http::StatusCode::NO_CONTENT);
        assert_eq!(
            response.headers().get("access-control-allow-headers"),
            Some(&http::HeaderValue::from_static(ALLOW_HEADERS))
        );
        assert_eq!(
            response.headers().get("access-control-expose-headers"),
            Some(&http::HeaderValue::from_static(EXPOSE_HEADERS))
        );
        assert!(response
            .headers()
            .get("access-control-allow-methods")
            .and_then(|value| value.to_str().ok())
            .is_some_and(|value| value.contains(Method::GET.as_str())));
    }
}
