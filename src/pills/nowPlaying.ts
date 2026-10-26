// "Now playing" pill: the same controls as a music app's miniplayer (artwork, title, artist,
// previous / play-pause / next, progress with seek). It reads the Windows media session, so it
// works with Spotify, Apple Music, browsers and anything else that reports to Windows.

import { type MediaAction, type MediaState, errorText, ipc } from "../ipc";
import { clear, formatTime, h } from "../ui/dom";
import { icon } from "../ui/icons";
import type { NowPlayingPill, PillHost, PillView } from "./types";

const POLL_MS = 1000;
const TICK_MS = 250;

/** "SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify" -> "Spotify", "chrome.exe" -> "chrome" */
export function friendlyApp(appId: string): string {
  const afterBang = appId.includes("!") ? (appId.split("!").pop() ?? appId) : appId;
  return afterBang.replace(/\.exe$/i, "");
}

export function createNowPlayingPill(manifest: NowPlayingPill, host: PillHost): PillView {
  const art = h("img", { class: "np-art", attrs: { alt: "", draggable: "false" }, hidden: true });
  const title = h("div", { class: "np-title" });
  const artist = h("div", { class: "np-artist" });
  const source = h("div", { class: "np-source" });

  const prevBtn = h("button", { class: "icon-btn", title: "Previous", aria: { label: "Previous" } }, icon("previous", 20));
  const playBtn = h("button", { class: "icon-btn np-play", title: "Play", aria: { label: "Play" } });
  const nextBtn = h("button", { class: "icon-btn", title: "Next", aria: { label: "Next" } }, icon("next", 20));

  const seek = h("input", {
    class: "np-seek",
    type: "range",
    attrs: { min: "0", max: "1", step: "1000", "aria-label": "Seek" },
  });
  const elapsed = h("span", { class: "np-time", text: "0:00" });
  const total = h("span", { class: "np-time", text: "0:00" });

  const empty = h("div", { class: "np-empty", text: "Nothing is playing" });
  const player = h(
    "div",
    { class: "np-player", hidden: true },
    h("div", { class: "np-top" }, art, h("div", { class: "np-meta" }, title, artist, source), playBtn),
    h("div", { class: "np-progress" }, prevBtn, elapsed, seek, total, nextBtn),
  );

  const root = h(
    "section",
    { class: "pill pill-now-playing", data: { kind: "now-playing", tone: "neutral" } },
    h(
      "div",
      { class: "pill-head" },
      h("span", { class: "pill-icon" }, icon("music", 14)),
      h("span", { class: "pill-name", text: manifest.name }),
    ),
    empty,
    player,
  );

  if (manifest.accent) root.style.setProperty("--pill-accent", manifest.accent);

  let current: MediaState | null = null;
  let receivedAt = 0;
  let lastTrackKey = "";
  let dragging = false;
  let inFlight = false;
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let tickTimer: ReturnType<typeof setInterval> | undefined;

  function currentPosition(): number {
    if (!current) return 0;
    let pos = current.positionMs;
    if (current.playing) pos += performance.now() - receivedAt;
    return current.durationMs > 0 ? Math.min(pos, current.durationMs) : pos;
  }

  function paintProgress(): void {
    if (!current) return;
    const pos = currentPosition();
    elapsed.textContent = formatTime(pos);
    total.textContent = current.durationMs > 0 ? formatTime(current.durationMs) : "--:--";
    if (!dragging) seek.value = String(pos);
  }

  function loadArtwork(trackKey: string): void {
    art.hidden = true;
    ipc
      .mediaThumbnail()
      .then((url) => {
        // only ever accept an image data URL from the backend, and only for the current track
        if (url && url.startsWith("data:image/") && lastTrackKey === trackKey) {
          art.src = url;
          art.hidden = false;
        }
      })
      .catch(() => {
        art.hidden = true;
      });
  }

  function paint(s: MediaState): void {
    current = s;
    receivedAt = performance.now();

    empty.textContent = "Nothing is playing";
    empty.hidden = s.available;
    player.hidden = !s.available;
    host.reportMusic(s.available && s.playing);
    host.reportChip(manifest.id, s.available ? { icon: "♪", text: s.title || "Playing" } : null);
    if (!s.available) return;

    title.textContent = s.title || "Unknown title";
    artist.textContent = s.artist || "Unknown artist";
    source.textContent = friendlyApp(s.app);

    clear(playBtn);
    playBtn.append(icon(s.playing ? "pause" : "play", 22));
    playBtn.title = s.playing ? "Pause" : "Play";
    playBtn.setAttribute("aria-label", playBtn.title);
    playBtn.disabled = !s.canPlayPause;
    prevBtn.disabled = !s.canPrevious;
    nextBtn.disabled = !s.canNext;

    seek.max = String(Math.max(1, s.durationMs));
    seek.disabled = !s.canSeek || s.durationMs <= 0;
    paintProgress();

    if (s.trackKey !== lastTrackKey) {
      lastTrackKey = s.trackKey;
      loadArtwork(s.trackKey);
    }
  }

  async function poll(): Promise<void> {
    if (inFlight) return;
    inFlight = true;
    try {
      paint(await ipc.mediaState());
    } catch (err) {
      empty.textContent = `Media unavailable: ${errorText(err)}`;
      empty.hidden = false;
      player.hidden = true;
      host.reportMusic(false);
      host.reportChip(manifest.id, null);
    } finally {
      inFlight = false;
    }
  }

  async function send(action: MediaAction, positionMs?: number): Promise<void> {
    try {
      await ipc.mediaControl(action, positionMs);
    } catch {
      // the app may not support this action right now; the next poll shows the real state
    }
    void poll();
  }

  prevBtn.addEventListener("click", () => void send("previous"));
  nextBtn.addEventListener("click", () => void send("next"));
  playBtn.addEventListener("click", () => void send("playPause"));

  seek.addEventListener("pointerdown", () => {
    dragging = true;
  });
  seek.addEventListener("input", () => {
    elapsed.textContent = formatTime(Number(seek.value));
  });
  seek.addEventListener("change", () => {
    dragging = false;
    void send("seek", Number(seek.value));
  });
  seek.addEventListener("pointercancel", () => {
    dragging = false;
  });

  return {
    id: manifest.id,
    el: root,
    start() {
      void poll();
      pollTimer = setInterval(() => void poll(), POLL_MS);
      tickTimer = setInterval(paintProgress, TICK_MS);
    },
    stop() {
      if (pollTimer) clearInterval(pollTimer);
      if (tickTimer) clearInterval(tickTimer);
      host.reportMusic(false);
      host.reportChip(manifest.id, null);
    },
  };
}
