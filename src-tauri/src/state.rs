use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;

use perch_core::ApprovalStore;

use crate::inbox::InboxState;

/// Shared application state, created once in `setup`.
pub struct AppState {
    pub approvals: Mutex<ApprovalStore>,
    pub approvals_path: PathBuf,
    pub config_dir: PathBuf,
    pub http: reqwest::Client,
    pub inbox: InboxState,
}

impl AppState {
    pub fn new(config_dir: PathBuf) -> Result<Self, String> {
        let approvals_path = config_dir.join("approved-hosts.json");
        let http = reqwest::Client::builder()
            // A redirect could send an authenticated request to a host the user never approved.
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(10))
            .user_agent(concat!("Perch/", env!("CARGO_PKG_VERSION")))
            .build()
            .map_err(|e| e.to_string())?;

        Ok(Self {
            inbox: InboxState::new(&config_dir),
            approvals: Mutex::new(ApprovalStore::load(&approvals_path)),
            approvals_path,
            config_dir,
            http,
        })
    }
}
