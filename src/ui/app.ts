import {
  availableMonitors,
  currentMonitor,
  cursorPosition,
  getCurrentWindow,
  LogicalSize,
  PhysicalPosition,
  primaryMonitor,
  type Monitor,
} from "@tauri-apps/api/window";
import { createView } from "../avatar/any";
import { nextPeekDelay } from "../avatar/life";
import type { AvatarView } from "../avatar/renderer";
import { createSoundPlayer } from "../sound/player";
import type { SoundMode } from "../sound/sounds";
import { loadConfig, resolveAvatar, type Config } from "../config";
import { inTauri, ipc } from "../ipc";
import { hostOf } from "../pills/manifest";
import { createNowPlayingPill } from "../pills/nowPlaying";
import { createRestPill } from "../pills/rest";
import type { Chip, PillHost, PillManifest, PillView, Tone } from "../pills/types";
import {
  getAvatarFile,
  getDisabledPills,
  getGazeMode,
  getHiddenChips,
  getHideWhenQuiet,
  getOpenDelay,
  getPeeks,
  getPlacement,
  getSoundMode,
  getSoundVolume,
  setAvatarFile,
  setChipShown,
  setGazeMode,
  setHideWhenQuiet,
  setOpenDelay,
  setPeeks,
  setPillEnabled,
  setPlacement,
  setSoundMode,
  setSoundVolume,
} from "../settings";
import { clear, h } from "./dom";
import { icon } from "./icons";
import { confirmDialog } from "./modal";
import { visibleChips } from "./chips";
import { fracForCentre, monitorAt, monitorKey, resolvePlacement, windowOrigin, type MonitorBox } from "./placement";
import { renderSettings } from "./settings";

type Mode = "hidden" | "peek" | "small" | "home";

const LEAVE_DELAY_MS = 600;
/** how far the pointer must travel on the avatar before it counts as a drag, not a click */
const DRAG_THRESHOLD_PX = 6;
const SLEEP_AFTER_MS = 10 * 60 * 1000;
const TONE_RANK: Record<Tone, number> = { neutral: 0, good: 1, warn: 2, danger: 3 };

export async function mountApp(root: HTMLElement): Promise<void> {
  let config: Config = await loadConfig();
  let view: "pills" | "settings" = "pills";
  let pillViews: PillView[] = [];
  let avatarView: AvatarView | null = null;
  let musicPlaying = false;
  let hideWhenQuiet = getHideWhenQuiet();
  const tones = new Map<string, Tone>();
  const chips = new Map<string, Chip>();

  // how the island is being held open
  let hovering = false;
  let pinned = false;
  let alertOpen = false;
  let modalOpen = false;
  let leaveTimer: ReturnType<typeof setTimeout> | undefined;
  let openDelay = getOpenDelay();
  let dragging = false;
  let gazeMode = getGazeMode();
  let peeksOn = getPeeks();
  let playingSources = 0;
  let soundMode: SoundMode = getSoundMode();
  let soundVolume = getSoundVolume();
  const sound = createSoundPlayer(() => ({ mode: soundMode, volume: soundVolume }));
  // the hidden avatar sometimes slides out, looks around, winks and slides back
  type Peek = "off" | "in" | "hold" | "out";
  let peek: Peek = "off";
  let peekTimers: ReturnType<typeof setTimeout>[] = [];
  let peekSchedule: ReturnType<typeof setTimeout> | undefined;

  // ---- layout ------------------------------------------------------------------------------
  const avatarSlot = h("div", { class: "avatar-slot" });
  const perch = h("button", { class: "perch", title: "Click to keep open, drag to move", aria: { label: "Keep open", pressed: "false" } }, avatarSlot);
  const label = h("div", { class: "island-label" });
  const settingsBtn = h("button", { class: "icon-btn", title: "Library", aria: { label: "Library" } });
  const collapseBtn = h("button", { class: "icon-btn", title: "Collapse", aria: { label: "Collapse" } }, icon("up", 18));
  const head = h("div", { class: "island-head" }, label, settingsBtn, collapseBtn);
  const chipRow = h("div", { class: "chips" });
  const body = h("div", { class: "body" });
  const islandBody = h("div", { class: "island-body" }, head, chipRow, body);
  const island = h(
    "div",
    { class: "island", data: { mode: "small", tone: "neutral" } },
    h("div", { class: "shoulder left" }),
    h("div", { class: "shoulder right" }),
    islandBody,
    perch,
  );
  // shows how long is left before the island opens; it follows the pointer
  const ring = h("div", { class: "dwell-ring", hidden: true, aria: { hidden: "true" } });
  ring.innerHTML =
    '<svg viewBox="0 0 24 24" width="22" height="22"><circle class="track" cx="12" cy="12" r="9"/><circle class="fill" cx="12" cy="12" r="9" pathLength="1"/></svg>';
  island.append(ring);
  root.append(island);

  // ---- window sizing and placement: the window hugs the island, flush with a monitor's top ------
  let lastSize = "";
  let fitting = false;

  function toBox(m: Monitor): MonitorBox {
    return {
      x: m.workArea.position.x,
      y: m.workArea.position.y,
      width: m.workArea.size.width,
      height: m.workArea.size.height,
      scale: m.scaleFactor,
      key: monitorKey(m.position.x, m.position.y),
    };
  }

  async function monitorBoxes(): Promise<MonitorBox[]> {
    return (await availableMonitors()).map(toBox);
  }

  async function fitWindow(): Promise<void> {
    if (!inTauri || fitting || dragging) return;
    const width = Math.ceil(island.offsetWidth);
    const height = Math.ceil(island.offsetHeight);
    const key = `${width}x${height}`;
    if (width < 40 || height < 8 || key === lastSize) return;
    lastSize = key;
    fitting = true;
    try {
      const win = getCurrentWindow();
      const [boxes, current, primary] = await Promise.all([monitorBoxes(), currentMonitor(), primaryMonitor()]);
      const fallbackMonitor = current ?? primary;
      const spot = resolvePlacement(getPlacement(), boxes, fallbackMonitor ? toBox(fallbackMonitor) : undefined);
      if (spot) {
        const origin = windowOrigin(spot.monitor, spot.xFrac, width * spot.monitor.scale);
        await win.setPosition(new PhysicalPosition(origin.x, origin.y));
      }
      await win.setSize(new LogicalSize(width, height));
      if (spot) {
        // the size just changed, so centre again using the real physical width
        const real = (await win.outerSize()).width;
        const origin = windowOrigin(spot.monitor, spot.xFrac, real);
        await win.setPosition(new PhysicalPosition(origin.x, origin.y));
      }
    } catch {
      // the next size change tries again
      lastSize = "";
    } finally {
      fitting = false;
      if (`${Math.ceil(island.offsetWidth)}x${Math.ceil(island.offsetHeight)}` !== lastSize) void fitWindow();
    }
  }
  new ResizeObserver(() => void fitWindow()).observe(island);

  // ---- avatar, status and chips --------------------------------------------------------------
  let asleep = false;
  let sleepTimer: ReturnType<typeof setTimeout> | undefined;
  function wake(): void {
    clearTimeout(sleepTimer);
    sleepTimer = undefined;
    if (asleep) {
      asleep = false;
      sound.play("wake");
      refresh();
    }
  }

  function worstTone(): Tone {
    let worst: Tone = musicPlaying ? "good" : "neutral";
    for (const tone of tones.values()) if (TONE_RANK[tone] > TONE_RANK[worst]) worst = tone;
    return worst;
  }

  function baseMode(): Mode {
    if (view === "settings" || modalOpen || pinned || alertOpen || hovering) return "home";
    const worst = worstTone();
    const active = musicPlaying || TONE_RANK[worst] >= TONE_RANK.warn;
    if (hideWhenQuiet && !active) return "hidden";
    return shownChips().length > 0 ? "small" : hideWhenQuiet ? "hidden" : "small";
  }

  function shownChips(): [string, Chip][] {
    return visibleChips(
      config.pills.map((p) => p.id),
      chips,
      tones,
      getHiddenChips(),
    );
  }

  function currentMode(): Mode {
    if (dragging) return island.dataset.mode as Mode;
    const mode = baseMode();
    if (peek !== "off") {
      if (mode === "hidden") return "peek";
      cancelPeek(); // something happened: no time for games
    }
    return mode;
  }

  function cancelPeek(): void {
    for (const t of peekTimers) clearTimeout(t);
    peekTimers = [];
    peek = "off";
    island.dataset.peek = "off";
  }

  function schedulePeek(): void {
    clearTimeout(peekSchedule);
    if (!peeksOn) return;
    peekSchedule = setTimeout(startPeek, nextPeekDelay());
  }

  function startPeek(): void {
    if (!peeksOn || peek !== "off" || dragging || asleep || document.hidden || baseMode() !== "hidden") {
      schedulePeek();
      return;
    }
    const at = (ms: number, fn: () => void) => peekTimers.push(setTimeout(fn, ms));
    const set = (next: Peek) => {
      peek = next;
      island.dataset.peek = next;
    };
    set("in");
    sound.play("peek");
    refresh();
    at(450, () => {
      set("hold");
      avatarView?.glance(-0.9, 0.2, 700);
    });
    at(1150, () => avatarView?.glance(0.9, 0.1, 600));
    at(1800, () => {
      avatarView?.glance(0, 0.1, 700);
      avatarView?.react("wink");
      sound.play("wink");
    });
    at(2600, () => {
      set("out");
      avatarView?.react("perk");
    });
    at(3000, () => {
      cancelPeek();
      refresh();
      schedulePeek();
    });
  }

  function paintChips(): void {
    clear(chipRow);
    const accents = new Map(config.pills.map((p) => [p.id, p.accent] as const));
    const kinds = new Map(config.pills.map((p) => [p.id, p.kind] as const));
    const shown = shownChips();
    for (const [id, chip] of shown) {
      const el = h(
        "span",
        { class: "chip", data: { tone: tones.get(id) ?? "neutral", kind: kinds.get(id) ?? "rest" } },
        chip.icon ? h("span", { class: "chip-icon", text: chip.icon }) : null,
        h("span", { class: "chip-text", text: chip.text }),
      );
      const accent = accents.get(id);
      if (accent) el.style.setProperty("--pill-accent", accent);
      chipRow.append(el);
    }
    if (shown.length === 0) chipRow.append(h("span", { class: "chip chip-quiet" }, h("span", { class: "chip-text", text: "All quiet" })));
  }

  function refresh(): void {
    const alerts = [...tones.values()].filter((t) => t === "danger").length;
    const busy = alerts > 0 || musicPlaying;
    if (busy) {
      asleep = false;
      clearTimeout(sleepTimer);
      sleepTimer = undefined;
    } else if (!asleep && sleepTimer === undefined) {
      sleepTimer = setTimeout(() => {
        sleepTimer = undefined;
        asleep = true;
        sound.play("sleep");
        refresh();
      }, SLEEP_AFTER_MS);
    }
    const state = alerts > 0 ? "attention" : musicPlaying ? "music" : asleep ? "asleep" : "idle";
    avatarView?.setState(state);

    const count = config.pills.length - getDisabledPills().size;
    label.textContent =
      view === "settings"
        ? "LIBRARY"
        : alerts > 0
          ? `${alerts} NEED${alerts === 1 ? "S" : ""} YOU`
          : musicPlaying
            ? `PLAYING · ${count} PILL${count === 1 ? "" : "S"}`
            : asleep
              ? "RESTING"
              : "ALL QUIET";
    label.dataset.state = state;

    paintChips();
    island.dataset.tone = worstTone();
    island.dataset.mode = currentMode();
    perch.setAttribute("aria-pressed", String(pinned));
    perch.title = pinned ? "Let go" : "Keep open";
    perch.setAttribute("aria-label", perch.title);
    for (const el of [head, body]) el.hidden = island.dataset.mode !== "home";
    chipRow.hidden = island.dataset.mode !== "small";
    void fitWindow();
  }

  function renderAvatar(): void {
    avatarView?.destroy();
    clear(avatarSlot);
    avatarView = createView(resolveAvatar(config, getAvatarFile()));
    avatarSlot.append(avatarView.el);
    refresh();
  }

  // ---- gaze: the avatar looks at the pointer, wherever it is on screen ------------------------
  /** how far away (in logical pixels) the pointer must be for the avatar to look at it fully */
  const GAZE_RANGE_PX = 320;
  let lastCursor = "";
  let gazeBusy = false;
  async function trackPointer(): Promise<void> {
    if (gazeBusy || document.hidden || !avatarView) return;
    // by default the eyes only follow the pointer while the island is open
    if (gazeMode === "never" || (gazeMode === "open" && island.dataset.mode !== "home")) {
      if (lastCursor !== "") avatarView.lookAway();
      lastCursor = "";
      return;
    }
    gazeBusy = true;
    try {
      const [cursor, position] = await Promise.all([cursorPosition(), getCurrentWindow().outerPosition()]);
      const key = `${cursor.x},${cursor.y}`;
      if (key === lastCursor) return; // a still pointer is not news; interest fades by itself
      lastCursor = key;
      const box = perch.getBoundingClientRect();
      const scale = window.devicePixelRatio || 1;
      const cx = position.x + (box.left + box.width / 2) * scale;
      const cy = position.y + (box.top + box.height / 2) * scale;
      avatarView.lookAt((cursor.x - cx) / (GAZE_RANGE_PX * scale), (cursor.y - cy) / (GAZE_RANGE_PX * scale));
    } catch {
      // the pointer could not be read this time
    } finally {
      gazeBusy = false;
    }
  }
  if (inTauri) {
    setInterval(() => void trackPointer(), 50);
  } else {
    // in a plain browser (development) the pointer is only known while it is over the page
    document.addEventListener("pointermove", (event) => {
      if (gazeMode === "never" || (gazeMode === "open" && island.dataset.mode !== "home")) return;
      const box = perch.getBoundingClientRect();
      avatarView?.lookAt(
        (event.clientX - (box.left + box.width / 2)) / GAZE_RANGE_PX,
        (event.clientY - (box.top + box.height / 2)) / GAZE_RANGE_PX,
      );
    });
  }

  // ---- pills -------------------------------------------------------------------------------
  const pillHost: PillHost = {
    reportTone(id, tone) {
      const before = tones.get(id);
      tones.set(id, tone);
      // a pill that newly turns red opens the island by itself, and it stays until you act
      if (tone === "danger" && before !== "danger") {
        alertOpen = true;
        avatarView?.react("anticipate");
        sound.play("alert");
      }
      refresh();
    },
    reportSources(count) {
      // a second app starts playing: it looks from one side to the other
      if (count > playingSources && count > 1) {
        avatarView?.glance(-0.9, 0, 500);
        setTimeout(() => avatarView?.glance(0.9, 0, 500), 550);
      }
      playingSources = count;
    },
    reportMusic(playing) {
      if (playing && !musicPlaying) {
        avatarView?.react("perk");
        sound.play("start");
      }
      musicPlaying = playing;
      refresh();
    },
    reportChip(id, chip) {
      // a new track: perk up and glance at the card
      const previous = chips.get(id);
      if (chip && previous && previous.text !== chip.text && config.pills.find((p) => p.id === id)?.kind === "now-playing") {
        avatarView?.react("perk");
        avatarView?.glance(0.8, -0.2, 900);
        sound.play("track");
      }
      if (chip) chips.set(id, chip);
      else chips.delete(id);
      refresh();
    },
    async requestHostApproval(hostKey) {
      const names = config.pills.filter((p) => hostOf(p) === hostKey).map((p) => p.name);
      modalOpen = true;
      refresh();
      const allowed = await confirmDialog(islandBody, {
        title: `Allow access to ${hostKey}?`,
        lines: [
          `${names.length > 0 ? names.join(", ") : "A pill"} will be able to send requests to ${hostKey}.`,
          "Perch only contacts hosts you have approved. You can revoke this in the Library.",
        ],
        confirmLabel: "Allow",
        cancelLabel: "Not now",
      });
      modalOpen = false;
      refresh();
      if (!allowed) return false;
      try {
        await ipc.approveHost(hostKey);
        return true;
      } catch {
        return false;
      }
    },
  };

  function createPillView(manifest: PillManifest): PillView {
    return manifest.kind === "rest" ? createRestPill(manifest, pillHost) : createNowPlayingPill(manifest, pillHost);
  }

  function stopPills(): void {
    for (const pill of pillViews) pill.stop();
    pillViews = [];
    tones.clear();
    chips.clear();
    musicPlaying = false;
  }

  function showPills(): void {
    view = "pills";
    stopPills();
    clear(body);
    clear(settingsBtn);
    settingsBtn.append(icon("settings"));
    settingsBtn.title = "Library";
    settingsBtn.setAttribute("aria-label", "Library");

    const disabled = getDisabledPills();
    const active = config.pills.filter((p) => !disabled.has(p.id));
    if (active.length === 0) {
      body.append(h("p", { class: "muted pad", text: "All pills are hidden. Open the Library to turn some on." }));
    }
    pillViews = active.map(createPillView);
    for (const pill of pillViews) body.append(pill.el);
    for (const pill of pillViews) pill.start();
    refresh();
  }

  function showSettings(): void {
    view = "settings";
    stopPills();
    clear(body);
    clear(settingsBtn);
    settingsBtn.append(icon("back"));
    settingsBtn.title = "Back";
    settingsBtn.setAttribute("aria-label", "Back");
    body.append(
      renderSettings({
        config,
        avatarFile: getAvatarFile(),
        onAvatarChange(file) {
          setAvatarFile(file);
          renderAvatar();
        },
        onPillToggle: setPillEnabled,
        onChipToggle(id, shown) {
          setChipShown(id, shown);
          refresh();
        },
        hideWhenQuiet,
        onHideWhenQuietChange(value) {
          hideWhenQuiet = value;
          setHideWhenQuiet(value);
        },
        gazeMode,
        onGazeModeChange(mode) {
          gazeMode = mode;
          setGazeMode(mode);
        },
        soundMode,
        onSoundModeChange(mode) {
          soundMode = mode;
          setSoundMode(mode);
        },
        soundVolume,
        onSoundVolumeChange(volume) {
          soundVolume = volume;
          setSoundVolume(volume);
        },
        onSoundTest: () => sound.play("alert", true),
        peeks: peeksOn,
        onPeeksChange(value) {
          peeksOn = value;
          setPeeks(value);
          if (value) schedulePeek();
          else {
            clearTimeout(peekSchedule);
            cancelPeek();
          }
        },
        openDelayMs: openDelay,
        onOpenDelayChange(ms) {
          openDelay = ms;
          setOpenDelay(ms);
        },
        onResetPosition() {
          setPlacement(null);
          lastSize = "";
          void fitWindow();
        },
        async onReload() {
          config = await loadConfig();
          renderAvatar();
          showSettings();
        },
        onAccessChanged() {
          // pills restart when the user goes back, so they pick up new secrets / approvals
        },
      }),
    );
    refresh();
  }

  // ---- opening: rest the pointer on it for a moment (a ring shows the wait), or click ---------
  let dwellTimer: ReturnType<typeof setTimeout> | undefined;
  function stopDwell(): void {
    clearTimeout(dwellTimer);
    dwellTimer = undefined;
    island.dataset.dwell = "off";
    ring.hidden = true;
  }
  function openNow(): void {
    if (island.dataset.mode !== "home") sound.play("open");
    stopDwell();
    clearTimeout(leaveTimer);
    hovering = true;
    wake();
    refresh();
  }
  function moveRing(event: PointerEvent): void {
    const box = island.getBoundingClientRect();
    // sits just below and right of the pointer, kept inside the window
    const size = 22;
    const x = Math.min(Math.max(event.clientX - box.left + 12, 0), Math.max(0, box.width - size));
    const y = Math.min(Math.max(event.clientY - box.top + 10, 0), Math.max(0, box.height - size));
    ring.style.transform = `translate(${x}px, ${y}px)`;
  }

  island.addEventListener("pointerenter", (event) => {
    clearTimeout(leaveTimer);
    if (dragging) return;
    // already open (pinned, alert, or the pointer only stepped off for a moment): stay open
    if (island.dataset.mode === "home" || hovering || openDelay === 0) return openNow();
    island.style.setProperty("--dwell", `${openDelay}ms`);
    island.dataset.dwell = "on";
    ring.hidden = false;
    moveRing(event);
    clearTimeout(dwellTimer);
    dwellTimer = setTimeout(openNow, openDelay);
  });
  island.addEventListener("pointermove", (event) => {
    if (dwellTimer !== undefined) moveRing(event);
  });
  island.addEventListener("pointerleave", () => {
    stopDwell();
    if (dragging) return;
    clearTimeout(leaveTimer);
    leaveTimer = setTimeout(() => {
      hovering = false;
      // an alert that opened the island has been seen once the pointer has come and gone
      if (alertOpen) alertOpen = false;
      refresh();
    }, LEAVE_DELAY_MS);
  });
  island.addEventListener("pointerdown", () => {
    stopDwell();
    wake();
  });

  // ---- moving: drag the avatar; the island slides along the top edge of the screen under the pointer
  let dragFrom: { x: number; y: number; grab: number; boxes: MonitorBox[] } | null = null;
  let dragBusy = false;
  let justDragged = false;

  perch.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || !inTauri) return;
    perch.setPointerCapture(event.pointerId);
    dragFrom = { x: event.clientX, y: event.clientY, grab: 0, boxes: [] };
  });

  async function beginDrag(): Promise<void> {
    if (!dragFrom) return;
    const win = getCurrentWindow();
    const [cursor, position, size, boxes] = await Promise.all([cursorPosition(), win.outerPosition(), win.outerSize(), monitorBoxes()]);
    dragFrom.boxes = boxes;
    // keep the island under the pointer exactly where it was grabbed
    dragFrom.grab = cursor.x - (position.x + size.width / 2);
    dragging = true;
    island.dataset.dragging = "on";
    avatarView?.react("startle");
    sound.play("grab");
    clearTimeout(leaveTimer);
  }

  async function dragStep(): Promise<void> {
    if (!dragFrom || dragBusy) return;
    dragBusy = true;
    try {
      const win = getCurrentWindow();
      const [cursor, size] = await Promise.all([cursorPosition(), win.outerSize()]);
      const monitor = monitorAt(dragFrom.boxes, cursor.x, cursor.y);
      if (!monitor) return;
      const xFrac = fracForCentre(monitor, cursor.x - dragFrom.grab);
      const origin = windowOrigin(monitor, xFrac, size.width);
      await win.setPosition(new PhysicalPosition(origin.x, origin.y));
      setPlacement({ monitor: monitor.key, xFrac });
    } catch {
      // a missed frame; the next pointer move tries again
    } finally {
      dragBusy = false;
    }
  }

  perch.addEventListener("pointermove", (event) => {
    if (!dragFrom) return;
    if (!dragging) {
      if (Math.hypot(event.clientX - dragFrom.x, event.clientY - dragFrom.y) < DRAG_THRESHOLD_PX) return;
      void beginDrag().then(dragStep);
      return;
    }
    void dragStep();
  });

  function endDrag(event: PointerEvent): void {
    if (perch.hasPointerCapture(event.pointerId)) perch.releasePointerCapture(event.pointerId);
    const wasDragging = dragging;
    dragFrom = null;
    if (!wasDragging) return;
    justDragged = true; // swallow the click that follows a drag
    avatarView?.react("squash");
    sound.play("drop");
    setTimeout(() => (justDragged = false), 0);
    void dragStep().finally(() => {
      dragging = false;
      island.dataset.dragging = "off";
      lastSize = "";
      refresh();
    });
  }
  perch.addEventListener("pointerup", endDrag);
  perch.addEventListener("pointercancel", endDrag);

  perch.addEventListener("click", () => {
    if (justDragged) return;
    pinned = !pinned;
    refresh();
  });
  collapseBtn.addEventListener("click", () => {
    pinned = false;
    alertOpen = false;
    hovering = false;
    if (view === "settings") showPills();
    else refresh();
  });
  settingsBtn.addEventListener("click", () => (view === "pills" ? showSettings() : showPills()));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && view === "settings" && !document.querySelector(".modal-backdrop")) showPills();
  });

  renderAvatar();
  showPills();
  schedulePeek();
}
