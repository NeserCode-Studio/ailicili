use serde::Serialize;
use thiserror::Error;

use super::session::SessionStoreError;

#[derive(Debug, Error)]
pub enum BiliError {
    #[error("Bilibili request failed")]
    Http,
    #[error("Bilibili returned HTTP {0}")]
    HttpStatus(u16),
    #[error("Bilibili returned code {code}: {message}")]
    Upstream { code: i64, message: String },
    #[error("Bilibili response did not contain data")]
    MissingData,
    #[error("Bilibili returned an invalid response: {0}")]
    InvalidResponse(&'static str),
    #[error("Invalid Bilibili request: {0}")]
    InvalidInput(&'static str),
    #[error("The login attempt is missing or expired")]
    LoginAttemptExpired,
    #[error("Sign in is required for this action")]
    AuthenticationRequired,
    #[error("This video cannot be played in the current client: {0}")]
    PlaybackUnavailable(&'static str),
    #[error("Internal Bilibili client state is unavailable")]
    Internal,
    #[error(transparent)]
    SessionStore(#[from] SessionStoreError),
}

impl From<reqwest::Error> for BiliError {
    fn from(_: reqwest::Error) -> Self {
        // Reqwest errors can include the full request URL, including signed query
        // parameters. Keep transport failures deliberately detail-free.
        Self::Http
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BiliCommandError {
    pub code: &'static str,
    pub message: String,
}

impl From<BiliError> for BiliCommandError {
    fn from(error: BiliError) -> Self {
        let code = match &error {
            BiliError::Http => "network_error",
            BiliError::HttpStatus(412) => "risk_control",
            BiliError::HttpStatus(404) => "not_found",
            BiliError::HttpStatus(_) => "http_error",
            BiliError::Upstream { code: -404, .. } => "not_found",
            BiliError::Upstream { code: -412, .. } => "risk_control",
            BiliError::Upstream { .. } => "upstream_error",
            BiliError::MissingData => "invalid_response",
            BiliError::InvalidResponse(_) => "invalid_response",
            BiliError::InvalidInput(_) => "invalid_input",
            BiliError::LoginAttemptExpired => "login_expired",
            BiliError::AuthenticationRequired => "authentication_required",
            BiliError::PlaybackUnavailable(_) => "playback_unavailable",
            BiliError::Internal => "internal_error",
            BiliError::SessionStore(_) => "credential_store",
        };

        Self {
            code,
            message: error.to_string(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{BiliCommandError, BiliError};

    #[test]
    fn network_errors_expose_no_request_details() {
        let request_error = reqwest::Client::new()
            .get("http://[invalid")
            .build()
            .expect_err("invalid URL should fail");
        let command_error = BiliCommandError::from(BiliError::from(request_error));

        assert_eq!(command_error.code, "network_error");
        assert_eq!(command_error.message, "Bilibili request failed");
    }
}
