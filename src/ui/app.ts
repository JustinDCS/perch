import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import { createView } from "../avatar/any";
import type { AvatarView } from "../avatar/renderer";
import { loadConfig, resolveAvatar, type Config } from "../config";
import { inTauri, ipc } from "../ipc";
import { hostOf } from "../pills/manifest";
import { createNowPlayingPill } from "../pills/nowPlaying";
import { createRestPill } from "../pills/rest";
import type { PillHost, PillManifest, PillView, Tone } from "../pills/types";
import { getAvatarFile, getDisabledPills, setAvatarFile, setPillEnabled } from "../settings";
import { clear, h } from "./dom";
import { icon } from "./icons";
import { confirmDialog } from "./modal";
import { renderSettings } from "./settings";

const WINDOW_WIDTH = 380;
const DRAG = { "data-tauri-drag-region": "" };

export async function mountApp(root: HTMLElement): Promise<void> {
  let config: Config = await loadConfig();
  let view: "pills" | "settings" = "pills";
  let pillViews: PillView[] = [];
  let avatarView: AvatarView | null = null;
  let musicPlaying = false;
  const tones = new Map<string, Tone>();

  // ---- layout ------------------------------------------------------------------------------
  const avatarSlot = h("div", { class: "avatar-slot", attrs: DRAG });
  const status = h("div", { class: "status", attrs: DRAG });
  const title = h("div", { class: "app-title", text: "Perch", attrs: DRAG });
  const settingsBtn = h("button", { class: "icon-btn", title: "Settings", aria: { label: "Settings" } });
  const hideBtn = h("button", { class: "icon-btn", title: "Hide to tray", aria: { label: "Hide to tray" } }, icon("close"));
  const header = h(
    "header",
    { class: "header", attrs: DRAG },
    avatarSlot,
    h("div", { class: "header-text", attrs: DRAG }, title, status),
    settingsBtn,
    hideBtn,
  );
  const body = h("div", { class: "body" });
  const card = h("main", { class: "card" }, header, body);
  root.append(card);

  // ---- window sizing -----------------------------------------------------------------------
  let lastHeight = 0;
  const syncWindowSize = () => {
    if (!inTauri) return;
    const height = Math.ceil(card.getBoundingClientRect().height);
    if (height === lastHeight || height < 40) return;
    lastHeight = height;
    void getCurrentWindow().setSize(new LogicalSize(WINDOW_WIDTH, height));
  };
  new ResizeObserver(syncWindowSize).observe(card);

  // ---- avatar + status ---------------------------------------------------------------------
  // After a long quiet spell the avatar falls asleep. Anything happening (music, an alert) or the
  // pointer coming near wakes it.
  const SLEEP_AFTER_MS = 10 * 60 * 1000;
  let asleep = false;
  let sleepTimer: ReturnType<typeof setTimeout> | undefined;
  function wake(): void {
    clearTimeout(sleepTimer);
    sleepTimer = undefined;
    if (asleep) {
      asleep = false;
      updateAvatar();
    }
  }

  function updateAvatar(): void {
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
        updateAvatar();
      }, SLEEP_AFTER_MS);
    }
    const state = alerts > 0 ? "attention" : musicPlaying ? "music" : asleep ? "asleep" : "idle";
    avatarView?.setState(state);
    status.textContent =
      alerts > 0
        ? `${alerts} need${alerts === 1 ? "s" : ""} attention`
        : musicPlaying
          ? "Playing"
          : asleep
            ? "Resting"
            : "All quiet";
    status.dataset.state = state;
  }

  function renderAvatar(): void {
    avatarView?.destroy();
    clear(avatarSlot);
    avatarView = createView(resolveAvatar(config, getAvatarFile()));
    avatarSlot.append(avatarView.el);
    updateAvatar();
  }

  // ---- pills -------------------------------------------------------------------------------
  const pillHost: PillHost = {
    reportTone(id, tone) {
      tones.set(id, tone);
      updateAvatar();
    },
    reportMusic(playing) {
      musicPlaying = playing;
      updateAvatar();
    },
    async requestHostApproval(hostKey) {
      const names = config.pills.filter((p) => hostOf(p) === hostKey).map((p) => p.name);
      const allowed = await confirmDialog(card, {
        title: `Allow access to ${hostKey}?`,
        lines: [
          `${names.length > 0 ? names.join(", ") : "A pill"} will be able to send requests to ${hostKey}.`,
          "Perch only contacts hosts you have approved. You can revoke this in Settings.",
        ],
        confirmLabel: "Allow",
        cancelLabel: "Not now",
      });
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
    musicPlaying = false;
  }

  function showPills(): void {
    view = "pills";
    stopPills();
    clear(body);
    clear(settingsBtn);
    settingsBtn.append(icon("settings"));
    settingsBtn.title = "Settings";

    const disabled = getDisabledPills();
    const active = config.pills.filter((p) => !disabled.has(p.id));
    if (active.length === 0) {
      body.append(h("p", { class: "muted pad", text: "All pills are hidden. Open Settings to turn some on." }));
    }
    pillViews = active.map(createPillView);
    for (const pill of pillViews) body.append(pill.el);
    for (const pill of pillViews) pill.start();
    updateAvatar();
  }

  function showSettings(): void {
    view = "settings";
    stopPills();
    clear(body);
    clear(settingsBtn);
    settingsBtn.append(icon("back"));
    settingsBtn.title = "Back";
    body.append(
      renderSettings({
        config,
        avatarFile: getAvatarFile(),
        onAvatarChange(file) {
          setAvatarFile(file);
          renderAvatar();
        },
        onPillToggle: setPillEnabled,
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
    updateAvatar();
  }

  for (const type of ["pointerenter", "pointerdown"] as const) {
    card.addEventListener(type, () => {
      wake();
      updateAvatar(); // restarts the sleep timer
    });
  }
  settingsBtn.addEventListener("click", () => (view === "pills" ? showSettings() : showPills()));
  hideBtn.addEventListener("click", () => {
    if (inTauri) void getCurrentWindow().hide();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && view === "settings" && !document.querySelector(".modal-backdrop")) showPills();
  });

  renderAvatar();
  showPills();
}
