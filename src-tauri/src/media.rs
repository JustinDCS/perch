//! "Now playing". On Windows it uses the System Media Transport Controls (SMTC); on macOS see
//! `media_macos.rs`.
//!
//! SMTC is the same layer that powers the volume flyout and the lock screen media card, so one
//! implementation covers Spotify, Apple Music, browsers, VLC and anything else that reports to
//! Windows. No per-app integration or OAuth is needed.
//!
//! The WinRT calls block, so each command runs on a blocking thread.

use serde::Serialize;

/// One app that is reporting a media session to Windows.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaSource {
    /// The app's id, as Windows reports it (also what `source` arguments refer to).
    pub id: String,
    pub playing: bool,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaState {
    /// false when no app is reporting a media session.
    pub available: bool,
    pub app: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub playing: bool,
    pub position_ms: u64,
    pub duration_ms: u64,
    pub can_play_pause: bool,
    pub can_next: bool,
    pub can_previous: bool,
    pub can_seek: bool,
    /// Changes whenever the track changes; the UI uses it to know when to refetch artwork.
    pub track_key: String,
    /// Every app with a media session, so the UI can show that more than one is playing.
    pub sources: Vec<MediaSource>,
}

#[cfg(windows)]
mod imp {
    use super::{MediaSource, MediaState};
    use base64::Engine;
    use std::time::{SystemTime, UNIX_EPOCH};
    use windows::Media::Control::{
        GlobalSystemMediaTransportControlsSession as Session,
        GlobalSystemMediaTransportControlsSessionManager as Manager,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus as Status,
    };
    use windows::Storage::Streams::DataReader;
    use windows::Win32::System::WinRT::{RoInitialize, RO_INIT_MULTITHREADED};

    /// 100 ns ticks between 1601-01-01 (Windows epoch) and 1970-01-01 (Unix epoch).
    const WINDOWS_TO_UNIX_TICKS: i64 = 116_444_736_000_000_000;
    const MAX_ARTWORK_BYTES: u64 = 4_000_000;

    fn es<E: std::fmt::Display>(e: E) -> String {
        e.to_string()
    }

    fn init() {
        // Threads from the blocking pool are not COM-initialised. S_FALSE / "already
        // initialised" results are fine, so the result is ignored on purpose.
        let _ = unsafe { RoInitialize(RO_INIT_MULTITHREADED) };
    }

    fn manager() -> Result<Manager, String> {
        Manager::RequestAsync().map_err(es)?.get().map_err(es)
    }

    fn app_id(session: &Session) -> String {
        session
            .SourceAppUserModelId()
            .map(|s| s.to_string())
            .unwrap_or_default()
    }

    /// The session the user chose (by app id) if it is still there, otherwise the one Windows
    /// considers current. An Err from `GetCurrentSession` means "no current session".
    fn pick_session(manager: &Manager, source: Option<&str>) -> Option<Session> {
        if let Some(want) = source {
            if let Ok(sessions) = manager.GetSessions() {
                let count = sessions.Size().unwrap_or(0);
                for i in 0..count {
                    if let Ok(session) = sessions.GetAt(i) {
                        if app_id(&session) == want {
                            return Some(session);
                        }
                    }
                }
            }
        }
        manager.GetCurrentSession().ok()
    }

    /// Every media session and whether it is playing. Best effort: errors give a shorter list.
    fn list_sources(manager: &Manager) -> Vec<MediaSource> {
        let mut out = Vec::new();
        let Ok(sessions) = manager.GetSessions() else {
            return out;
        };
        let count = sessions.Size().unwrap_or(0);
        for i in 0..count {
            let Ok(session) = sessions.GetAt(i) else {
                continue;
            };
            let playing = session
                .GetPlaybackInfo()
                .and_then(|info| info.PlaybackStatus())
                .map(|status| status == Status::Playing)
                .unwrap_or(false);
            out.push(MediaSource {
                id: app_id(&session),
                playing,
            });
        }
        out
    }

    fn now_windows_ticks() -> i64 {
        let since_unix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos() / 100)
            .unwrap_or(0) as i64;
        since_unix + WINDOWS_TO_UNIX_TICKS
    }

    pub fn read_state(source: Option<&str>) -> Result<MediaState, String> {
        init();
        let manager = manager()?;
        let sources = list_sources(&manager);
        let Some(session) = pick_session(&manager, source) else {
            return Ok(MediaState {
                sources,
                ..MediaState::default()
            });
        };

        let props = session
            .TryGetMediaPropertiesAsync()
            .map_err(es)?
            .get()
            .map_err(es)?;
        let title = props.Title().map(|s| s.to_string()).unwrap_or_default();
        let artist = props.Artist().map(|s| s.to_string()).unwrap_or_default();
        let album = props.AlbumTitle().map(|s| s.to_string()).unwrap_or_default();
        let app = app_id(&session);

        let info = session.GetPlaybackInfo().map_err(es)?;
        let playing = info.PlaybackStatus().map_err(es)? == Status::Playing;
        let controls = info.Controls().map_err(es)?;
        let can_play_pause = controls.IsPlayEnabled().unwrap_or(false)
            || controls.IsPauseEnabled().unwrap_or(false);
        let can_next = controls.IsNextEnabled().unwrap_or(false);
        let can_previous = controls.IsPreviousEnabled().unwrap_or(false);
        let can_seek = controls.IsPlaybackPositionEnabled().unwrap_or(false);

        let (mut position_ticks, duration_ticks) = match session.GetTimelineProperties() {
            Ok(tl) => {
                let start = tl.StartTime().map(|t| t.Duration).unwrap_or(0);
                let end = tl.EndTime().map(|t| t.Duration).unwrap_or(0);
                let pos = tl.Position().map(|t| t.Duration).unwrap_or(0);
                let mut position = (pos - start).max(0);
                // Apps only report their position now and then; extrapolate while playing.
                if playing {
                    if let Ok(updated) = tl.LastUpdatedTime() {
                        let elapsed = now_windows_ticks() - updated.UniversalTime;
                        if elapsed > 0 {
                            position += elapsed;
                        }
                    }
                }
                (position, (end - start).max(0))
            }
            Err(_) => (0, 0),
        };
        if duration_ticks > 0 {
            position_ticks = position_ticks.min(duration_ticks);
        }

        Ok(MediaState {
            available: true,
            track_key: format!("{app}|{title}|{artist}|{album}"),
            app,
            title,
            artist,
            album,
            playing,
            position_ms: (position_ticks / 10_000) as u64,
            duration_ms: (duration_ticks / 10_000) as u64,
            can_play_pause,
            can_next,
            can_previous,
            can_seek,
            sources,
        })
    }

    /// Album art as a `data:` URL, or `None` if the app provides none.
    pub fn read_thumbnail(source: Option<&str>) -> Result<Option<String>, String> {
        init();
        let Some(session) = pick_session(&manager()?, source) else {
            return Ok(None);
        };
        let props = session
            .TryGetMediaPropertiesAsync()
            .map_err(es)?
            .get()
            .map_err(es)?;
        let Ok(reference) = props.Thumbnail() else {
            return Ok(None);
        };

        let stream = reference.OpenReadAsync().map_err(es)?.get().map_err(es)?;
        let size = stream.Size().map_err(es)?;
        if size == 0 || size > MAX_ARTWORK_BYTES {
            return Ok(None);
        }

        let reader = DataReader::CreateDataReader(&stream).map_err(es)?;
        reader.LoadAsync(size as u32).map_err(es)?.get().map_err(es)?;
        let mut bytes = vec![0u8; size as usize];
        reader.ReadBytes(&mut bytes).map_err(es)?;

        let content_type = stream
            .ContentType()
            .map(|s| s.to_string())
            .unwrap_or_default();
        let mime = if content_type.starts_with("image/") {
            content_type
        } else {
            "image/png".to_string()
        };
        let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
        Ok(Some(format!("data:{mime};base64,{encoded}")))
    }

    pub fn control(action: &str, position_ms: Option<u64>, source: Option<&str>) -> Result<(), String> {
        init();
        let Some(session) = pick_session(&manager()?, source) else {
            return Err("nothing is playing".into());
        };
        match action {
            "playPause" => {
                session.TryTogglePlayPauseAsync().map_err(es)?.get().map_err(es)?;
            }
            "next" => {
                session.TrySkipNextAsync().map_err(es)?.get().map_err(es)?;
            }
            "previous" => {
                session.TrySkipPreviousAsync().map_err(es)?.get().map_err(es)?;
            }
            "seek" => {
                let ms = position_ms.ok_or("seek needs a position")?;
                let start = session
                    .GetTimelineProperties()
                    .and_then(|tl| tl.StartTime())
                    .map(|t| t.Duration)
                    .unwrap_or(0);
                let ticks = start + (ms as i64).saturating_mul(10_000);
                session
                    .TryChangePlaybackPositionAsync(ticks)
                    .map_err(es)?
                    .get()
                    .map_err(es)?;
            }
            other => return Err(format!("unknown media action '{other}'")),
        }
        Ok(())
    }
}

#[cfg(target_os = "macos")]
#[path = "media_macos.rs"]
mod imp;

/// Other systems: these stubs only keep the crate compiling.
#[cfg(not(any(windows, target_os = "macos")))]
mod imp {
    use super::MediaState;

    pub fn read_state(_source: Option<&str>) -> Result<MediaState, String> {
        Ok(MediaState::default())
    }

    pub fn read_thumbnail(_source: Option<&str>) -> Result<Option<String>, String> {
        Ok(None)
    }

    pub fn control(_action: &str, _position_ms: Option<u64>, _source: Option<&str>) -> Result<(), String> {
        Err("now-playing controls are only available on Windows and macOS".into())
    }
}

#[tauri::command]
pub async fn media_get_state(source: Option<String>) -> Result<MediaState, String> {
    tauri::async_runtime::spawn_blocking(move || imp::read_state(source.as_deref()))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn media_get_thumbnail(source: Option<String>) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || imp::read_thumbnail(source.as_deref()))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn media_control(action: String, position_ms: Option<u64>, source: Option<String>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || imp::control(&action, position_ms, source.as_deref()))
        .await
        .map_err(|e| e.to_string())?
}
