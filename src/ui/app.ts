import { currentMonitor, getCurrentWindow, LogicalPosition, LogicalSize } from "@tauri-apps/api/window";
import { createView } from "../avatar/any";
import type { AvatarView } from "../avatar/renderer";
import { loadConfig, resolveAvatar, type Config } from "../config";
import { inTauri, ipc } from "../ipc";
import { hostOf } from "../pills/manifest";
import { createNowPlayingPill } from "../pills/nowPlaying";
import { createRestPill } from "../pills/rest";
import type { Chip, PillHost, PillManifest, PillView, Tone } from "../pills/types";
import {
  getAvatarFile,
  getDisabledPills,
  getHideWhenQuiet,
  setAvatarFile,
  setHideWhenQuiet,
  setPillEnabled,
} from "../settings";
import { clear, h } from "./dom";
import { icon } from "./icons";
import { confirmDialog } from "./modal";
import { renderSettings } from "./settings";

type Mode = "hidden" | "small" | "home";

const LEAVE_DELAY_MS = 600;
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

  // ---- layout ------------------------------------------------------------------------------
  const avatarSlot = h("div", { class: "avatar-slot" });
  const perch = h("button", { class: "perch", title: "Keep open", aria: { label: "Keep open", pressed: "false" } }, avatarSlot);
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
  root.append(island);

  // ---- window sizing: the window always hugs the island, centred on the top edge -------------
  let lastSize = "";
  let fitting = false;
  async function fitWindow(): Promise<void> {
    if (!inTauri || fitting) return;
    const width = Math.ceil(island.offsetWidth);
    const height = Math.ceil(island.offsetHeight);
    const key = `${width}x${height}`;
    if (width < 40 || height < 8 || key === lastSize) return;
    lastSize = key;
    fitting = true;
    try {
      const win = getCurrentWindow();
      await win.setSize(new LogicalSize(width, height));
      const monitor = await currentMonitor();
      if (monitor) {
        const scale = monitor.scaleFactor;
        const x = monitor.position.x / scale + (monitor.size.width / scale - width) / 2;
        await win.setPosition(new LogicalPosition(Math.round(x), Math.round(monitor.position.y / scale)));
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
      refresh();
    }
  }

  function worstTone(): Tone {
    let worst: Tone = musicPlaying ? "good" : "neutral";
    for (const tone of tones.values()) if (TONE_RANK[tone] > TONE_RANK[worst]) worst = tone;
    return worst;
  }

  function currentMode(): Mode {
    if (view === "settings" || modalOpen || pinned || alertOpen || hovering) return "home";
    const worst = worstTone();
    const active = musicPlaying || TONE_RANK[worst] >= TONE_RANK.warn;
    if (hideWhenQuiet && !active) return "hidden";
    return chips.size > 0 ? "small" : hideWhenQuiet ? "hidden" : "small";
  }

  function paintChips(): void {
    clear(chipRow);
    const order = config.pills.map((p) => p.id);
    const accents = new Map(config.pills.map((p) => [p.id, p.accent] as const));
    const kinds = new Map(config.pills.map((p) => [p.id, p.kind] as const));
    for (const id of order) {
      const chip = chips.get(id);
      if (!chip) continue;
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
    if (chips.size === 0) chipRow.append(h("span", { class: "chip chip-quiet" }, h("span", { class: "chip-text", text: "All quiet" })));
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

  // ---- pills -------------------------------------------------------------------------------
  const pillHost: PillHost = {
    reportTone(id, tone) {
      const before = tones.get(id);
      tones.set(id, tone);
      // a pill that newly turns red opens the island by itself, and it stays until you act
      if (tone === "danger" && before !== "danger") alertOpen = true;
      refresh();
    },
    reportMusic(playing) {
      musicPlaying = playing;
      refresh();
    },
    reportChip(id, chip) {
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
        hideWhenQuiet,
        onHideWhenQuietChange(value) {
          hideWhenQuiet = value;
          setHideWhenQuiet(value);
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

  // ---- hover, pin and collapse ---------------------------------------------------------------
  island.addEventListener("pointerenter", () => {
    clearTimeout(leaveTimer);
    hovering = true;
    wake();
    refresh();
  });
  island.addEventListener("pointerleave", () => {
    clearTimeout(leaveTimer);
    leaveTimer = setTimeout(() => {
      hovering = false;
      // an alert that opened the island has been seen once the pointer has come and gone
      if (alertOpen) alertOpen = false;
      refresh();
    }, LEAVE_DELAY_MS);
  });
  island.addEventListener("pointerdown", wake);
  perch.addEventListener("click", () => {
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
}
