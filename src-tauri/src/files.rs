//! User-editable pill and avatar JSON files in `%APPDATA%\co.za.dyncomp.perch\{pips,avatars}`.

use std::fs;
use std::path::PathBuf;

use perch_core::{sanitize_json_file_name, MAX_USER_FILE_BYTES};
use serde::Serialize;
use tauri::State;

use crate::state::AppState;

const MAX_FILES: usize = 100;

#[derive(Serialize)]
pub struct UserFile {
    pub name: String,
    pub content: String,
}

fn kind_dir(state: &AppState, kind: &str) -> Result<PathBuf, String> {
    match kind {
        "pips" | "avatars" => Ok(state.config_dir.join(kind)),
        _ => Err("unknown file kind".into()),
    }
}

#[tauri::command]
pub fn list_user_files(state: State<'_, AppState>, kind: String) -> Result<Vec<UserFile>, String> {
    let dir = kind_dir(&state, &kind)?;
    let mut files = Vec::new();

    let entries = match fs::read_dir(&dir) {
        Ok(entries) => entries,
        Err(_) => return Ok(files), // folder not created yet: nothing to load
    };

    for entry in entries.flatten() {
        // skips directories and symlinks
        if !entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
            continue;
        }
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        if entry
            .metadata()
            .map(|m| m.len() as usize > MAX_USER_FILE_BYTES)
            .unwrap_or(true)
        {
            continue;
        }
        if let (Some(name), Ok(content)) = (
            path.file_name().map(|n| n.to_string_lossy().into_owned()),
            fs::read_to_string(&path),
        ) {
            files.push(UserFile { name, content });
        }
    }

    files.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    files.truncate(MAX_FILES);
    Ok(files)
}

#[tauri::command]
pub fn save_user_file(
    state: State<'_, AppState>,
    kind: String,
    name: String,
    content: String,
) -> Result<String, String> {
    let dir = kind_dir(&state, &kind)?;
    let file_name = sanitize_json_file_name(&name).ok_or("that file name is not allowed")?;

    if content.len() > MAX_USER_FILE_BYTES {
        return Err("file is too large".into());
    }
    serde_json::from_str::<serde_json::Value>(&content).map_err(|_| "file is not valid JSON")?;

    fs::create_dir_all(&dir).map_err(|e| format!("could not create folder: {e}"))?;
    fs::write(dir.join(&file_name), content).map_err(|e| format!("could not save file: {e}"))?;
    Ok(file_name)
}

#[tauri::command]
pub fn open_config_dir(state: State<'_, AppState>) -> Result<(), String> {
    #[cfg(windows)]
    let opener = "explorer";
    #[cfg(target_os = "macos")]
    let opener = "open";
    #[cfg(all(not(windows), not(target_os = "macos")))]
    let opener = "xdg-open";

    std::process::Command::new(opener)
        .arg(&state.config_dir)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("could not open folder: {e}"))
}
