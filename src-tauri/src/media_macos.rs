//! "Now playing" on macOS for Spotify and Apple Music, through AppleScript (`osascript`).
//!
//! macOS has no public API that tells an app what other apps are playing (the private
//! MediaRemote framework stopped working for third-party apps in macOS 15.4), so Perch asks the
//! two big players directly. The first time, macOS asks the user whether Perch may control
//! "Spotify" or "Music"; saying no just leaves the pill empty. Browsers and other players are
//! not covered on macOS.
//!
//! Safety: only these two app names are ever scripted, the scripts are fixed text with numbers
//! filled in, an app that is not running is never launched, and every script has a time limit.
//! The text the scripts return is parsed in `perch_core::mac_media`, where it is unit-tested.

use std::fs;
use std::process::Command;

use base64::Engine;
use perch_core::mac_media::{is_spotify_artwork_url, known_player, parse_track_line, sniff_image_mime, Track};

use super::{MediaSource, MediaState};

const PLAYERS: [&str; 2] = ["Spotify", "Music"];
const MAX_ARTWORK_BYTES: usize = 4_000_000;

/// Turns anything (including `missing value`) into text without raising an error.
const SAFE_HANDLER: &str = r#"on safe(x)
  try
    if x is missing value then return ""
    return x as string
  on error
    return ""
  end try
end safe
"#;

fn osascript(script: &str) -> Result<String, String> {
    let output = Command::new("osascript")
        .arg("-e")
        .arg(script)
        .output()
        .map_err(|e| format!("could not run osascript: {e}"))?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).into_owned())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

/// Is the app running? (`pgrep` never launches anything, unlike telling the app something.)
fn is_running(app: &str) -> bool {
    Command::new("pgrep")
        .args(["-x", app])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

fn state_script(app: &str) -> String {
    // Spotify reports the length in milliseconds and has a picture address; Music reports seconds
    // and hands over the picture itself.
    let (duration, artwork, id) = if app == "Spotify" {
        ("(duration of t)", "my safe(artwork url of t)", "my safe(id of t)")
    } else {
        ("(round ((duration of t) * 1000))", "\"\"", "my safe(database ID of t)")
    };
    format!(
        r#"{SAFE_HANDLER}with timeout of 2 seconds
  tell application "{app}"
    if player state is stopped then return "stopped"
    set t to current track
    set pos to round ((player position) * 1000)
    return (my safe(player state)) & tab & (my safe(name of t)) & tab & (my safe(artist of t)) & tab & (my safe(album of t)) & tab & (my safe({duration})) & tab & (pos as string) & tab & ({artwork}) & tab & ({id})
  end tell
end timeout"#
    )
}

fn read_track(app: &str) -> Option<Track> {
    parse_track_line(&osascript(&state_script(app)).ok()?)
}

/// Every running player that has a track loaded, in the order Spotify, Music.
fn running_tracks() -> Vec<(&'static str, Track)> {
    PLAYERS
        .iter()
        .filter(|app| is_running(app))
        .filter_map(|app| read_track(app).map(|t| (*app, t)))
        .collect()
}

/// The player the user chose, else one that is playing, else the first with a track.
fn choose<'a>(tracks: &'a [(&'static str, Track)], source: Option<&str>) -> Option<&'a (&'static str, Track)> {
    let wanted = source.and_then(known_player);
    wanted
        .and_then(|w| tracks.iter().find(|(app, _)| *app == w))
        .or_else(|| tracks.iter().find(|(_, t)| t.playing))
        .or_else(|| tracks.first())
}

pub fn read_state(source: Option<&str>) -> Result<MediaState, String> {
    let tracks = running_tracks();
    let sources: Vec<MediaSource> = tracks
        .iter()
        .map(|(app, t)| MediaSource { id: (*app).to_string(), playing: t.playing })
        .collect();
    let Some((app, t)) = choose(&tracks, source) else {
        return Ok(MediaState { sources, ..MediaState::default() });
    };
    Ok(MediaState {
        available: true,
        app: (*app).to_string(),
        title: t.title.clone(),
        artist: t.artist.clone(),
        album: t.album.clone(),
        playing: t.playing,
        position_ms: t.position_ms,
        duration_ms: t.duration_ms,
        can_play_pause: true,
        can_next: true,
        can_previous: true,
        can_seek: t.duration_ms > 0,
        track_key: format!("{app}|{}|{}|{}|{}", t.id, t.title, t.artist, t.album),
        sources,
    })
}

fn data_url(bytes: &[u8]) -> Option<String> {
    if bytes.is_empty() || bytes.len() > MAX_ARTWORK_BYTES {
        return None;
    }
    let mime = sniff_image_mime(bytes)?;
    Some(format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)))
}

pub fn read_thumbnail(source: Option<&str>) -> Result<Option<String>, String> {
    let tracks = running_tracks();
    let Some((app, t)) = choose(&tracks, source) else {
        return Ok(None);
    };
    if *app == "Spotify" {
        if !is_spotify_artwork_url(&t.artwork_url) {
            return Ok(None);
        }
        let max = MAX_ARTWORK_BYTES.to_string();
        let output = Command::new("curl")
            .args(["-sS", "-L", "--max-time", "5", "--max-filesize", &max, &t.artwork_url])
            .output()
            .map_err(|e| format!("could not run curl: {e}"))?;
        return Ok(if output.status.success() { data_url(&output.stdout) } else { None });
    }

    // Apple Music: write the picture to a temporary file, then read it back
    let path = std::env::temp_dir().join(format!("perch-artwork-{}", std::process::id()));
    let script = format!(
        r#"with timeout of 3 seconds
  tell application "Music"
    if (count of artworks of current track) is 0 then return "none"
    set d to raw data of artwork 1 of current track
  end tell
  set f to open for access (POSIX file "{}") with write permission
  try
    set eof f to 0
    write d to f
  end try
  close access f
  return "ok"
end timeout"#,
        path.display()
    );
    let result = osascript(&script);
    let bytes = fs::read(&path).ok();
    let _ = fs::remove_file(&path);
    Ok(match (result.ok().as_deref().map(str::trim), bytes) {
        (Some("ok"), Some(bytes)) => data_url(&bytes),
        _ => None,
    })
}

pub fn control(action: &str, position_ms: Option<u64>, source: Option<&str>) -> Result<(), String> {
    let tracks = running_tracks();
    let Some((app, _)) = choose(&tracks, source) else {
        return Err("no player is running".into());
    };
    let command = match action {
        "playPause" => "playpause".to_string(),
        "next" => "next track".to_string(),
        "previous" => "previous track".to_string(),
        "seek" => {
            let ms = position_ms.ok_or("seek needs a position")?;
            format!("set player position to ({ms} / 1000)")
        }
        other => return Err(format!("unknown action '{other}'")),
    };
    osascript(&format!(r#"with timeout of 2 seconds
  tell application "{app}" to {command}
end timeout"#))
    .map(|_| ())
}
