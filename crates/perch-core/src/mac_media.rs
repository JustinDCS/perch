//! Parsing for the macOS "now playing" support, which talks to Spotify and Apple Music through
//! AppleScript. The scripts live in `src-tauri`; the text they return is parsed here so it can be
//! tested on any machine.

/// One track as reported by a player, before it becomes the app's `MediaState`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Track {
    pub playing: bool,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub duration_ms: u64,
    pub position_ms: u64,
    /// where Spotify says the artwork is (empty for Apple Music, which gives the picture itself)
    pub artwork_url: String,
    /// the player's own id for the track
    pub id: String,
}

/// The scripts answer with eight tab-separated fields:
/// `state, title, artist, album, duration_ms, position_ms, artwork_url, id`
/// or the single word `stopped` when nothing is loaded.
pub fn parse_track_line(line: &str) -> Option<Track> {
    let line = line.trim_end_matches(['\n', '\r']);
    if line.is_empty() || line == "stopped" {
        return None;
    }
    let parts: Vec<&str> = line.splitn(8, '\t').collect();
    if parts.len() != 8 {
        return None;
    }
    let state = parts[0].trim().to_ascii_lowercase();
    // Spotify says "playing" / "paused"; Music says "playing" / "paused" / "fast forwarding" ...
    let playing = state == "playing";
    let number = |text: &str| -> u64 {
        // whole numbers only; a decimal comma or point (some locales) is cut off
        let digits: String = text.trim().chars().take_while(|c| c.is_ascii_digit()).collect();
        digits.parse().unwrap_or(0)
    };
    let duration_ms = number(parts[4]);
    Some(Track {
        playing,
        title: parts[1].trim().to_string(),
        artist: parts[2].trim().to_string(),
        album: parts[3].trim().to_string(),
        duration_ms,
        position_ms: number(parts[5]).min(if duration_ms > 0 { duration_ms } else { u64::MAX }),
        artwork_url: parts[6].trim().to_string(),
        id: parts[7].trim().to_string(),
    })
}

/// Spotify's artwork lives on its own image host; nothing else is fetched on its behalf.
pub fn is_spotify_artwork_url(url: &str) -> bool {
    url.starts_with("https://i.scdn.co/image/")
        && url.len() < 200
        && url.chars().all(|c| c.is_ascii_alphanumeric() || "/:._-".contains(c))
}

/// "image/png" or "image/jpeg" from the first bytes, or None for anything else.
pub fn sniff_image_mime(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("image/jpeg")
    } else if bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
        Some("image/png")
    } else {
        None
    }
}

/// Only these two apps are controlled; anything else a page passes as a source is ignored.
pub fn known_player(name: &str) -> Option<&'static str> {
    match name {
        "Spotify" => Some("Spotify"),
        "Music" => Some("Music"),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_playing_track() {
        let t = parse_track_line("playing\tBLOW HARDSTYLE\tGoldZoro\tSingles\t182000\t31500\thttps://i.scdn.co/image/ab67\tspotify:track:1\n").unwrap();
        assert!(t.playing);
        assert_eq!((t.title.as_str(), t.artist.as_str()), ("BLOW HARDSTYLE", "GoldZoro"));
        assert_eq!((t.duration_ms, t.position_ms), (182000, 31500));
        assert_eq!(t.id, "spotify:track:1");
    }

    #[test]
    fn paused_and_stopped() {
        assert!(!parse_track_line("paused\tA\tB\tC\t1000\t0\t\t7").unwrap().playing);
        assert_eq!(parse_track_line("stopped\n"), None);
        assert_eq!(parse_track_line(""), None);
    }

    #[test]
    fn rejects_the_wrong_shape() {
        assert_eq!(parse_track_line("playing\tonly\tthree"), None);
    }

    #[test]
    fn decimals_and_overruns_are_tamed() {
        let t = parse_track_line("playing\tA\tB\tC\t1000,5\t99999.5\t\t7").unwrap();
        assert_eq!(t.duration_ms, 1000);
        assert_eq!(t.position_ms, 1000, "position never passes the end");
    }

    #[test]
    fn titles_may_contain_odd_characters() {
        let t = parse_track_line("playing\tEXITIUM✱7lCJ✱IoO✱T6 - Slowed\tDJ\t\t5000\t10\t\t1").unwrap();
        assert!(t.title.starts_with("EXITIUM"));
        assert_eq!(t.album, "");
    }

    #[test]
    fn artwork_urls_are_limited_to_spotify() {
        assert!(is_spotify_artwork_url("https://i.scdn.co/image/ab67616d0000b273"));
        assert!(!is_spotify_artwork_url("https://evil.example/image/x"));
        assert!(!is_spotify_artwork_url("https://i.scdn.co/image/x;rm -rf"));
        assert!(!is_spotify_artwork_url("http://i.scdn.co/image/x"));
    }

    #[test]
    fn sniffs_images() {
        assert_eq!(sniff_image_mime(&[0xFF, 0xD8, 0xFF, 0xE0]), Some("image/jpeg"));
        assert_eq!(sniff_image_mime(&[0x89, b'P', b'N', b'G', 1]), Some("image/png"));
        assert_eq!(sniff_image_mime(b"<svg"), None);
    }

    #[test]
    fn only_two_players() {
        assert_eq!(known_player("Spotify"), Some("Spotify"));
        assert_eq!(known_player("Music"), Some("Music"));
        assert_eq!(known_player("Terminal"), None);
    }
}
