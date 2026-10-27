//! The local inbox: lets programs on this PC ask the user a question and wait for the answer.
//!
//! The rules (key, loopback only, sizes, never answering for the user) and the socket server are
//! in `perch-core::inbox` and are unit-tested there. This file only connects them to the app:
//! it starts and stops the server, hands each question to the page, and passes the answer back.

use std::collections::HashMap;
use std::fs;
use std::net::TcpListener;
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Mutex};

use perch_core::inbox::{self, Ask, Delegate, Server};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::state::AppState;

const FIRST_PORT: u16 = 47600;
const PORT_TRIES: u16 = 10;

type Pending = Arc<Mutex<HashMap<u64, Sender<Option<String>>>>>;

/// Everything about the inbox that lives for the whole run of the app.
pub struct InboxState {
    server: Mutex<Option<Server>>,
    key: Arc<Mutex<String>>,
    pending: Pending,
}

impl InboxState {
    pub fn new(config_dir: &std::path::Path) -> Self {
        let key = fs::read_to_string(config_dir.join("inbox.key"))
            .map(|k| k.trim().to_string())
            .ok()
            .filter(|k| k.len() >= 32)
            .unwrap_or_else(|| {
                let fresh = inbox::new_key();
                let _ = fs::write(config_dir.join("inbox.key"), &fresh);
                fresh
            });
        Self { server: Mutex::new(None), key: Arc::new(Mutex::new(key)), pending: Arc::new(Mutex::new(HashMap::new())) }
    }
}

#[derive(Serialize, Clone)]
struct AskEvent {
    id: u64,
    title: String,
    detail: Option<String>,
    buttons: Vec<String>,
    source: Option<String>,
}

struct PageDelegate {
    app: AppHandle,
    pending: Pending,
}

impl Delegate for PageDelegate {
    fn ask(&self, id: u64, ask: Ask) -> Receiver<Option<String>> {
        let (tx, rx) = channel();
        if let Ok(mut pending) = self.pending.lock() {
            pending.insert(id, tx);
        }
        // a question must be seen, so bring the overlay back if it was hidden from the tray
        if let Some(window) = self.app.get_webview_window("main") {
            let _ = window.show();
        }
        let _ = self.app.emit(
            "inbox-ask",
            AskEvent { id, title: ask.title, detail: ask.detail, buttons: ask.buttons, source: ask.source },
        );
        rx
    }

    fn cancelled(&self, id: u64) {
        if let Ok(mut pending) = self.pending.lock() {
            pending.remove(&id);
        }
        let _ = self.app.emit("inbox-cancel", id);
    }
}

#[derive(Serialize, Deserialize, Default)]
struct InboxConfig {
    enabled: bool,
}

fn config_path(state: &AppState) -> std::path::PathBuf {
    state.config_dir.join("inbox.json")
}

fn load_enabled(state: &AppState) -> bool {
    fs::read_to_string(config_path(state))
        .ok()
        .and_then(|text| serde_json::from_str::<InboxConfig>(&text).ok())
        .map(|c| c.enabled)
        .unwrap_or(false)
}

fn start_server(app: &AppHandle, state: &AppState) -> Result<u16, String> {
    let mut slot = state.inbox.server.lock().map_err(|_| "internal state error")?;
    if let Some(server) = slot.as_ref() {
        return Ok(server.port);
    }
    let delegate = Arc::new(PageDelegate { app: app.clone(), pending: state.inbox.pending.clone() });
    for offset in 0..PORT_TRIES {
        // only ever the loopback address: nothing else on the network can reach this
        if let Ok(listener) = TcpListener::bind(("127.0.0.1", FIRST_PORT + offset)) {
            let server = inbox::start(listener, state.inbox.key.clone(), delegate).map_err(|e| e.to_string())?;
            let port = server.port;
            *slot = Some(server);
            return Ok(port);
        }
    }
    Err("could not find a free port for the inbox".into())
}

fn stop_server(state: &AppState) {
    if let Ok(mut slot) = state.inbox.server.lock() {
        if let Some(server) = slot.take() {
            server.stop();
        }
    }
    if let Ok(mut pending) = state.inbox.pending.lock() {
        pending.clear(); // dropping the senders tells waiting programs "dismissed"
    }
}

/// Called once at startup: turn the inbox on if the user left it on.
pub fn autostart(app: &AppHandle) {
    let state = app.state::<AppState>();
    if load_enabled(&state) {
        let _ = start_server(app, &state);
    }
}

#[derive(Serialize)]
pub struct InboxStatus {
    enabled: bool,
    port: Option<u16>,
    key: String,
}

fn status(state: &AppState) -> InboxStatus {
    let port = state.inbox.server.lock().ok().and_then(|s| s.as_ref().map(|s| s.port));
    let key = state.inbox.key.lock().map(|k| k.clone()).unwrap_or_default();
    InboxStatus { enabled: port.is_some(), port, key }
}

#[tauri::command]
pub fn inbox_status(state: State<'_, AppState>) -> InboxStatus {
    status(&state)
}

#[tauri::command]
pub fn inbox_set_enabled(app: AppHandle, state: State<'_, AppState>, enabled: bool) -> Result<InboxStatus, String> {
    if enabled {
        start_server(&app, &state)?;
    } else {
        stop_server(&state);
    }
    let text = serde_json::to_string(&InboxConfig { enabled }).map_err(|e| e.to_string())?;
    fs::write(config_path(&state), text).map_err(|e| format!("could not save the setting: {e}"))?;
    Ok(status(&state))
}

#[tauri::command]
pub fn inbox_regenerate_key(state: State<'_, AppState>) -> Result<InboxStatus, String> {
    let fresh = inbox::new_key();
    fs::write(state.config_dir.join("inbox.key"), &fresh).map_err(|e| format!("could not save the key: {e}"))?;
    *state.inbox.key.lock().map_err(|_| "internal state error")? = fresh;
    Ok(status(&state))
}

/// The user pressed a button (`Some(label)`) or dismissed the question (`None`).
#[tauri::command]
pub fn inbox_answer(state: State<'_, AppState>, id: u64, answer: Option<String>) -> Result<(), String> {
    let sender = state.inbox.pending.lock().map_err(|_| "internal state error")?.remove(&id);
    match sender {
        Some(tx) => tx.send(answer).map_err(|_| "the program that asked has gone away".to_string()),
        None => Err("that question is no longer waiting".into()),
    }
}
