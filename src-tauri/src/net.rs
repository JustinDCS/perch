//! Network access for REST/JSON pills.
//!
//! All requests are made here, in Rust, not in the web view. That keeps API keys out of the
//! page, avoids CORS problems, and lets us enforce the host-approval list in one place.

use perch_core::{check_url, valid_host_key, MAX_RESPONSE_BYTES};
use reqwest::header::{HeaderName, HeaderValue};
use reqwest::Method;
use serde::Deserialize;
use tauri::State;

use crate::secrets;
use crate::state::AppState;

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum AuthSpec {
    Bearer { secret: String },
    Header { name: String, secret: String },
    Basic { user: String, secret: String },
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchRequest {
    pub url: String,
    pub method: Option<String>,
    pub auth: Option<AuthSpec>,
    pub body: Option<serde_json::Value>,
}

const FORBIDDEN_HEADERS: &[&str] = &[
    "host",
    "content-length",
    "transfer-encoding",
    "connection",
    "cookie",
    "set-cookie",
    "proxy-authorization",
];

fn header_name(name: &str) -> Result<HeaderName, String> {
    if FORBIDDEN_HEADERS.contains(&name.to_ascii_lowercase().as_str()) {
        return Err(format!("header '{name}' is not allowed"));
    }
    HeaderName::from_bytes(name.as_bytes()).map_err(|_| format!("invalid header name '{name}'"))
}

/// Perform a pill's request and return the parsed JSON response.
///
/// Errors that the UI reacts to start with a machine-readable prefix:
/// `HOST_NOT_APPROVED:<host>` and `SECRET_MISSING:<name>`.
#[tauri::command]
pub async fn fetch_json(
    state: State<'_, AppState>,
    req: FetchRequest,
) -> Result<serde_json::Value, String> {
    let checked = check_url(&req.url).map_err(|e| e.to_string())?;

    {
        let approvals = state
            .approvals
            .lock()
            .map_err(|_| "internal state error".to_string())?;
        if !approvals.is_approved(&checked.host_key) {
            return Err(format!("HOST_NOT_APPROVED:{}", checked.host_key));
        }
    }

    let method = match req
        .method
        .as_deref()
        .unwrap_or("GET")
        .to_ascii_uppercase()
        .as_str()
    {
        "GET" => Method::GET,
        "POST" => Method::POST,
        other => return Err(format!("method '{other}' is not supported")),
    };

    let mut builder = state
        .http
        .request(method, checked.url)
        .header(reqwest::header::ACCEPT, "application/json");

    match req.auth {
        None => {}
        Some(AuthSpec::Bearer { secret }) => {
            let token = secrets::read(&secret)?;
            builder = builder.bearer_auth(token);
        }
        Some(AuthSpec::Header { name, secret }) => {
            let value = secrets::read(&secret)?;
            let mut value =
                HeaderValue::from_str(&value).map_err(|_| "secret is not a valid header value")?;
            value.set_sensitive(true);
            builder = builder.header(header_name(&name)?, value);
        }
        Some(AuthSpec::Basic { user, secret }) => {
            let password = secrets::read(&secret)?;
            builder = builder.basic_auth(user, Some(password));
        }
    }

    if let Some(body) = req.body {
        builder = builder.json(&body);
    }

    // `without_url` so an error message can never echo a URL that carries a query-string token.
    let mut response = builder
        .send()
        .await
        .map_err(|e| format!("request failed: {}", e.without_url()))?;

    let status = response.status();
    if status.is_redirection() {
        return Err("the server answered with a redirect (not followed)".into());
    }
    if !status.is_success() {
        return Err(format!("HTTP {}", status.as_u16()));
    }
    if let Some(len) = response.content_length() {
        if len as usize > MAX_RESPONSE_BYTES {
            return Err("response is too large".into());
        }
    }

    let mut body: Vec<u8> = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| format!("request failed: {}", e.without_url()))?
    {
        if body.len() + chunk.len() > MAX_RESPONSE_BYTES {
            return Err("response is too large".into());
        }
        body.extend_from_slice(&chunk);
    }

    serde_json::from_slice(&body).map_err(|_| "response is not valid JSON".to_string())
}

#[tauri::command]
pub fn approved_hosts(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let approvals = state
        .approvals
        .lock()
        .map_err(|_| "internal state error".to_string())?;
    Ok(approvals.hosts())
}

#[tauri::command]
pub fn approve_host(state: State<'_, AppState>, host: String) -> Result<(), String> {
    if !valid_host_key(&host) {
        return Err("invalid host".into());
    }
    let mut approvals = state
        .approvals
        .lock()
        .map_err(|_| "internal state error".to_string())?;
    if approvals.approve(&host) {
        approvals
            .save(&state.approvals_path)
            .map_err(|e| format!("could not save approvals: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
pub fn revoke_host(state: State<'_, AppState>, host: String) -> Result<(), String> {
    let mut approvals = state
        .approvals
        .lock()
        .map_err(|_| "internal state error".to_string())?;
    if approvals.revoke(&host) {
        approvals
            .save(&state.approvals_path)
            .map_err(|e| format!("could not save approvals: {e}"))?;
    }
    Ok(())
}
