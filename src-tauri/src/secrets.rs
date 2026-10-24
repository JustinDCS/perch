//! Secrets live in the OS credential store (Windows Credential Manager).
//!
//! The web view can *write* and *delete* a secret and ask whether one exists, but there is
//! deliberately no command that reads one back: only Rust code attaches secrets to requests.

use perch_core::{valid_secret_name, MAX_SECRET_CHARS};

const SERVICE: &str = "perch";

fn entry(name: &str) -> Result<keyring::Entry, String> {
    if !valid_secret_name(name) {
        return Err("invalid secret name".into());
    }
    keyring::Entry::new(SERVICE, name).map_err(|e| format!("keychain error: {e}"))
}

/// Read a secret for attaching to an outgoing request. Never exposed as a command.
pub fn read(name: &str) -> Result<String, String> {
    match entry(name)?.get_password() {
        Ok(value) => Ok(value),
        Err(keyring::Error::NoEntry) => Err(format!("SECRET_MISSING:{name}")),
        Err(e) => Err(format!("keychain error: {e}")),
    }
}

#[tauri::command]
pub fn secret_set(name: String, value: String) -> Result<(), String> {
    if value.is_empty() || value.chars().count() > MAX_SECRET_CHARS {
        return Err(format!("secret must be 1-{MAX_SECRET_CHARS} characters"));
    }
    entry(&name)?
        .set_password(&value)
        .map_err(|e| format!("keychain error: {e}"))
}

#[tauri::command]
pub fn secret_exists(name: String) -> Result<bool, String> {
    match entry(&name)?.get_password() {
        Ok(_) => Ok(true),
        Err(keyring::Error::NoEntry) => Ok(false),
        Err(e) => Err(format!("keychain error: {e}")),
    }
}

#[tauri::command]
pub fn secret_delete(name: String) -> Result<(), String> {
    match entry(&name)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("keychain error: {e}")),
    }
}
