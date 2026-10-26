//! Platform-independent safety rules for Perch.
//!
//! Everything in here is plain Rust with no OS or UI dependencies, so it can be
//! unit-tested on any machine. The Tauri app (`src-tauri`) calls into it before
//! it touches the network, the keychain or the file system.

pub mod inbox;

use std::collections::BTreeSet;
use std::fs;
use std::net::{Ipv4Addr, Ipv6Addr};
use std::path::Path;

use serde::{Deserialize, Serialize};
use url::{Host, Url};

/// Largest response body a pill may download.
pub const MAX_RESPONSE_BYTES: usize = 1_048_576;
/// Largest pill / avatar JSON file Perch will read or save.
pub const MAX_USER_FILE_BYTES: usize = 256 * 1024;
/// Windows Credential Manager stores secrets as UTF-16 blobs of at most 2560 bytes,
/// so keep comfortably below that.
pub const MAX_SECRET_CHARS: usize = 1000;

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum PolicyError {
    #[error("not a valid URL")]
    Invalid,
    #[error("only http and https URLs are allowed")]
    Scheme,
    #[error("URLs must not contain a username or password")]
    Credentials,
    #[error("URL has no host")]
    NoHost,
    #[error("plain http is only allowed for localhost and private-network addresses")]
    InsecureRemote,
    #[error("link-local addresses (169.254.0.0/16, fe80::/10) are blocked")]
    LinkLocal,
}

/// A URL that passed [`check_url`], plus the key used for host approvals.
#[derive(Debug, Clone)]
pub struct CheckedUrl {
    pub url: Url,
    /// Lower-case `host` or `host:port` (port only when it is not the scheme default).
    pub host_key: String,
}

fn is_link_local_v4(ip: &Ipv4Addr) -> bool {
    ip.is_link_local()
}

fn is_link_local_v6(ip: &Ipv6Addr) -> bool {
    if let Some(v4) = ip.to_ipv4_mapped() {
        return is_link_local_v4(&v4);
    }
    (ip.segments()[0] & 0xffc0) == 0xfe80
}

fn is_unique_local_v6(ip: &Ipv6Addr) -> bool {
    (ip.segments()[0] & 0xfe00) == 0xfc00
}

/// Validate a URL a pill wants to request.
///
/// * http(s) only, no credentials in the URL
/// * plain `http` only for loopback / private-network targets
/// * link-local addresses (including cloud metadata endpoints) are always refused
pub fn check_url(raw: &str) -> Result<CheckedUrl, PolicyError> {
    let url = Url::parse(raw).map_err(|_| PolicyError::Invalid)?;

    match url.scheme() {
        "http" | "https" => {}
        _ => return Err(PolicyError::Scheme),
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(PolicyError::Credentials);
    }

    let host = url.host().ok_or(PolicyError::NoHost)?;
    let local = match &host {
        Host::Domain(d) => {
            let d = d.to_ascii_lowercase();
            d == "localhost" || d.ends_with(".localhost")
        }
        Host::Ipv4(ip) => {
            if is_link_local_v4(ip) {
                return Err(PolicyError::LinkLocal);
            }
            ip.is_loopback() || ip.is_private()
        }
        Host::Ipv6(ip) => {
            if is_link_local_v6(ip) {
                return Err(PolicyError::LinkLocal);
            }
            ip.is_loopback() || is_unique_local_v6(ip)
        }
    };

    if url.scheme() == "http" && !local {
        return Err(PolicyError::InsecureRemote);
    }

    let mut host_key = url
        .host_str()
        .ok_or(PolicyError::NoHost)?
        .to_ascii_lowercase();
    if let Some(port) = url.port() {
        host_key.push(':');
        host_key.push_str(&port.to_string());
    }

    Ok(CheckedUrl { url, host_key })
}

/// A host key is what the UI shows in the approval prompt and what we store.
pub fn valid_host_key(key: &str) -> bool {
    !key.is_empty()
        && key.len() <= 255
        && key
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | ':' | '[' | ']'))
}

/// Names of secrets stored in the OS credential store.
pub fn valid_secret_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 64
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
}

/// Turn a user-supplied file name into a safe `<name>.json`, or `None` if it cannot be made safe.
pub fn sanitize_json_file_name(name: &str) -> Option<String> {
    let name = name.trim();
    let stem = name.strip_suffix(".json").unwrap_or(name);

    if stem.is_empty() || stem.len() > 64 {
        return None;
    }
    if !stem
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | ' ' | '.'))
    {
        return None;
    }
    if stem.starts_with('.') || stem.ends_with('.') || stem.ends_with(' ') {
        return None;
    }

    // Windows reserved device names (CON, NUL, COM1, LPT1 ...), with or without an extension.
    let upper = stem.to_ascii_uppercase();
    let base = upper.split('.').next().unwrap_or("");
    let reserved = matches!(base, "CON" | "PRN" | "AUX" | "NUL")
        || (base.len() == 4
            && (base.starts_with("COM") || base.starts_with("LPT"))
            && base.as_bytes()[3].is_ascii_digit());
    if reserved {
        return None;
    }

    Some(format!("{stem}.json"))
}

/// The set of hosts the user has allowed pills to contact. Persisted as JSON.
#[derive(Debug, Default, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ApprovalStore {
    hosts: BTreeSet<String>,
}

impl ApprovalStore {
    /// Load from disk. A missing or unreadable file means "nothing approved yet".
    pub fn load(path: &Path) -> Self {
        fs::read(path)
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default()
    }

    /// Save atomically (write a temp file, then rename over the target).
    pub fn save(&self, path: &Path) -> std::io::Result<()> {
        let tmp = path.with_extension("json.tmp");
        fs::write(&tmp, serde_json::to_vec_pretty(self)?)?;
        fs::rename(&tmp, path)
    }

    pub fn is_approved(&self, host_key: &str) -> bool {
        self.hosts.contains(host_key)
    }

    /// Returns true if the set changed.
    pub fn approve(&mut self, host_key: &str) -> bool {
        self.hosts.insert(host_key.to_string())
    }

    /// Returns true if the set changed.
    pub fn revoke(&mut self, host_key: &str) -> bool {
        self.hosts.remove(host_key)
    }

    pub fn hosts(&self) -> Vec<String> {
        self.hosts.iter().cloned().collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key(raw: &str) -> String {
        check_url(raw).unwrap().host_key
    }

    #[test]
    fn allows_https_and_builds_host_key() {
        assert_eq!(key("https://API.Example.com/v1/items?x=1"), "api.example.com");
        assert_eq!(key("https://example.com:8443/a"), "example.com:8443");
        // default port is not part of the key
        assert_eq!(key("https://example.com:443/a"), "example.com");
    }

    #[test]
    fn rejects_bad_schemes_and_credentials() {
        assert_eq!(check_url("ftp://example.com").unwrap_err(), PolicyError::Scheme);
        assert_eq!(check_url("file:///etc/passwd").unwrap_err(), PolicyError::Scheme);
        assert_eq!(check_url("not a url").unwrap_err(), PolicyError::Invalid);
        assert_eq!(
            check_url("https://user:pw@example.com").unwrap_err(),
            PolicyError::Credentials
        );
        assert_eq!(
            check_url("https://user@example.com").unwrap_err(),
            PolicyError::Credentials
        );
    }

    #[test]
    fn plain_http_only_for_local_targets() {
        assert_eq!(
            check_url("http://example.com").unwrap_err(),
            PolicyError::InsecureRemote
        );
        assert_eq!(
            check_url("http://8.8.8.8/x").unwrap_err(),
            PolicyError::InsecureRemote
        );
        assert!(check_url("http://localhost:3000/api").is_ok());
        assert!(check_url("http://app.localhost/api").is_ok());
        assert!(check_url("http://127.0.0.1:8080").is_ok());
        assert!(check_url("http://192.168.1.20/status").is_ok());
        assert!(check_url("http://10.0.0.5").is_ok());
        assert!(check_url("http://[::1]:9000/").is_ok());
        assert!(check_url("http://[fd12:3456::1]/").is_ok());
    }

    #[test]
    fn link_local_is_always_blocked() {
        for raw in [
            "http://169.254.169.254/latest/meta-data",
            "https://169.254.169.254/",
            "https://[fe80::1]/",
            "https://[::ffff:169.254.169.254]/",
        ] {
            assert_eq!(check_url(raw).unwrap_err(), PolicyError::LinkLocal, "{raw}");
        }
    }

    #[test]
    fn host_key_and_secret_name_shapes() {
        assert!(valid_host_key("example.com"));
        assert!(valid_host_key("example.com:8443"));
        assert!(valid_host_key("[::1]:9000"));
        assert!(!valid_host_key(""));
        assert!(!valid_host_key("exa mple.com"));
        assert!(!valid_host_key("example.com/path"));

        assert!(valid_secret_name("jira-token"));
        assert!(valid_secret_name("a.b_c-1"));
        assert!(!valid_secret_name(""));
        assert!(!valid_secret_name("has space"));
        assert!(!valid_secret_name(&"x".repeat(65)));
    }

    #[test]
    fn file_names_are_sanitised() {
        assert_eq!(sanitize_json_file_name("my pill.json").as_deref(), Some("my pill.json"));
        assert_eq!(sanitize_json_file_name("jira").as_deref(), Some("jira.json"));
        assert_eq!(sanitize_json_file_name("a.b-c_d").as_deref(), Some("a.b-c_d.json"));
        // surrounding whitespace is trimmed before any check
        assert_eq!(sanitize_json_file_name("  trailing ").as_deref(), Some("trailing.json"));

        for bad in [
            "",
            ".json",
            "..",
            "../evil",
            "..\\evil",
            "sub/dir",
            "C:\\x",
            ".hidden",
            "trailing.",
            "trailing .json",
            "CON",
            "nul.json",
            "COM1",
            "lpt9.txt",
            "emoji😀",
        ] {
            assert_eq!(sanitize_json_file_name(bad), None, "{bad:?}");
        }
        assert_eq!(sanitize_json_file_name(&"a".repeat(65)), None);
        // COM10 is not a reserved device name
        assert!(sanitize_json_file_name("COM10").is_some());
    }

    #[test]
    fn approvals_round_trip_on_disk() {
        let dir = std::env::temp_dir().join(format!("perch-core-test-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("approved-hosts.json");

        let mut store = ApprovalStore::load(&path);
        assert!(store.hosts().is_empty());
        assert!(store.approve("api.example.com"));
        assert!(!store.approve("api.example.com"));
        assert!(store.approve("localhost:3000"));
        store.save(&path).unwrap();

        let loaded = ApprovalStore::load(&path);
        assert!(loaded.is_approved("api.example.com"));
        assert!(loaded.is_approved("localhost:3000"));
        assert!(!loaded.is_approved("evil.example.net"));
        assert_eq!(loaded, store);

        let mut loaded = loaded;
        assert!(loaded.revoke("api.example.com"));
        assert!(!loaded.revoke("api.example.com"));
        assert!(!loaded.is_approved("api.example.com"));

        // a corrupt file must never grant anything
        fs::write(&path, b"{ not json").unwrap();
        assert!(ApprovalStore::load(&path).hosts().is_empty());

        fs::remove_dir_all(&dir).ok();
    }
}
