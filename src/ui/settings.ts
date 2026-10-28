import { avatarName, validateAnyAvatar } from "../avatar/any";
import { type Config } from "../config";
import { errorText, ipc } from "../ipc";
import { secretsOf } from "../pills/manifest";
import type { PillVariable, RestPill } from "../pills/types";
import { storeKey, type Store } from "../pills/variables";
import type { UpdateResult } from "../updates";
import { SEASONS, type Season, type SeasonSetting } from "../seasons";
import { SOUND_MODES, type SoundMode } from "../sound/sounds";
import { GAZE_MODES, getDisabledPills, getHiddenChips, OPEN_DELAYS, type GazeMode } from "../settings";
import { clear, h } from "./dom";
import { inboxSection, pillAdder } from "./library";

const MAX_IMPORT_BYTES = 256 * 1024;

export interface SettingsContext {
  config: Config;
  avatarFile: string | null;
  onAvatarChange(file: string | null): void;
  onPillToggle(id: string, enabled: boolean): void;
  /** Show or hide this pill as a chip in the small view. */
  onChipToggle(id: string, shown: boolean): void;
  /** Everything the user has typed into pill variables, by storage key. */
  variableValues(): Store;
  /** Save a variable's value; returns the tidied text to show back. */
  onVariableChange(pill: RestPill, variable: PillVariable, value: string): string;
  stayVisible: boolean;
  onStayVisibleChange(value: boolean): void;
  appVersion: string;
  autoUpdate: boolean;
  onAutoUpdateChange(value: boolean): void;
  /** Look for a newer version; with `install`, install it and restart. */
  onCheckUpdate(install: boolean): Promise<UpdateResult>;
  soundMode: SoundMode;
  onSoundModeChange(mode: SoundMode): void;
  soundVolume: number;
  onSoundVolumeChange(volume: number): void;
  onSoundTest(): void;
  seasons: SeasonSetting;
  onSeasonsChange(value: SeasonSetting): void;
  /** Show a season for a minute, whatever the date. */
  onSeasonPreview(season: Season): void;
  peeks: boolean;
  onPeeksChange(value: boolean): void;
  gazeMode: GazeMode;
  onGazeModeChange(mode: GazeMode): void;
  openDelayMs: number;
  onOpenDelayChange(ms: number): void;
  /** Forget where the island was dragged to and centre it on the current screen. */
  onResetPosition(): void;
  /** Re-read the config folder and rebuild everything. */
  onReload(): Promise<void>;
  /** A secret or approval changed: pills should refresh. */
  onAccessChanged(): void;
}

function section(title: string, ...children: (Node | null)[]): HTMLElement {
  return h("section", { class: "settings-section" }, h("h3", { class: "settings-title", text: title }), ...children);
}

function errorList(errors: string[]): HTMLElement {
  return h("ul", { class: "error-list" }, ...errors.map((e) => h("li", { text: e })));
}

export function renderSettings(ctx: SettingsContext): HTMLElement {
  const root = h("div", { class: "settings" });

  // ---- behaviour ---------------------------------------------------------------------------
  const quietBox = h("input", { type: "checkbox", class: "switch", attrs: { "aria-label": "Stay visible when nothing is happening" } });
  quietBox.checked = ctx.stayVisible;
  quietBox.addEventListener("change", () => ctx.onStayVisibleChange(quietBox.checked));

  const autoBox = h("input", { type: "checkbox", class: "switch", attrs: { "aria-label": "Install updates automatically" } });
  autoBox.checked = ctx.autoUpdate;
  autoBox.addEventListener("change", () => ctx.onAutoUpdateChange(autoBox.checked));
  const updateStatus = h("p", { class: "muted", attrs: { role: "status" }, text: `Perch ${ctx.appVersion}` });
  const installBtn = h("button", { class: "btn", text: "Install and restart" });
  installBtn.hidden = true;
  const checkBtn = h("button", { class: "btn", text: "Check for updates" });
  async function runUpdate(install: boolean): Promise<void> {
    checkBtn.disabled = true;
    installBtn.disabled = true;
    updateStatus.textContent = install ? "Installing…" : "Checking…";
    const result = await ctx.onCheckUpdate(install);
    updateStatus.textContent = result.text;
    installBtn.hidden = result.state !== "available";
    checkBtn.disabled = false;
    installBtn.disabled = false;
  }
  checkBtn.addEventListener("click", () => void runUpdate(false));
  installBtn.addEventListener("click", () => void runUpdate(true));

  const soundSelect = h("select", { class: "input", attrs: { "aria-label": "Sounds" } });
  for (const m of SOUND_MODES) soundSelect.append(h("option", { text: m.label, value: m.mode }));
  soundSelect.value = ctx.soundMode;
  soundSelect.addEventListener("change", () => ctx.onSoundModeChange(soundSelect.value as SoundMode));
  const volume = h("input", { type: "range", class: "np-seek", attrs: { min: "0", max: "100", step: "5", "aria-label": "Volume" } });
  volume.value = String(Math.round(ctx.soundVolume * 100));
  volume.addEventListener("change", () => ctx.onSoundVolumeChange(Number(volume.value) / 100));

  const peekBox = h("input", { type: "checkbox", class: "switch", attrs: { "aria-label": "Look around and wink now and then when quiet" } });
  peekBox.checked = ctx.peeks;
  peekBox.addEventListener("change", () => ctx.onPeeksChange(peekBox.checked));

  const seasonSelect = h("select", { class: "input", attrs: { "aria-label": "Seasonal looks" } });
  seasonSelect.append(h("option", { text: "Auto (follow the dates)", value: "auto" }), h("option", { text: "Off", value: "off" }));
  seasonSelect.value = ctx.seasons;
  seasonSelect.addEventListener("change", () => ctx.onSeasonsChange(seasonSelect.value as SeasonSetting));
  const seasonPreview = h(
    "div",
    { class: "row sub season-preview" },
    h("span", { class: "row-main", text: "Preview for a minute" }),
    ...SEASONS.map((s) => {
      const b = h("button", { class: "btn", text: s.label, title: s.dates });
      b.addEventListener("click", () => ctx.onSeasonPreview(s.id));
      return b;
    }),
  );

  const gazeSelect = h("select", { class: "input", attrs: { "aria-label": "Eyes follow the pointer" } });
  for (const g of GAZE_MODES) gazeSelect.append(h("option", { text: g.label, value: g.mode }));
  gazeSelect.value = ctx.gazeMode;
  gazeSelect.addEventListener("change", () => ctx.onGazeModeChange(gazeSelect.value as GazeMode));

  const delaySelect = h("select", { class: "input", attrs: { "aria-label": "Open after resting the pointer" } });
  for (const d of OPEN_DELAYS) delaySelect.append(h("option", { text: d.label, value: String(d.ms) }));
  delaySelect.value = String(ctx.openDelayMs);
  delaySelect.addEventListener("change", () => ctx.onOpenDelayChange(Number(delaySelect.value)));

  // ---- pills -----------------------------------------------------------------------------
  const disabled = getDisabledPills();
  const hiddenChips = getHiddenChips();
  // inputs by storage key, so pills that share a value stay in step while the user types
  const varInputs = new Map<string, HTMLInputElement[]>();
  const variableFields = (pill: RestPill): HTMLElement[] =>
    (pill.variables ?? []).map((variable) => {
      const key = storeKey(pill.id, variable);
      const input = h("input", {
        class: "input",
        type: "text",
        placeholder: variable.placeholder ?? variable.default ?? "",
        attrs: { "aria-label": `${pill.name}: ${variable.label}`, autocomplete: "off", spellcheck: "false" },
      });
      input.value = ctx.variableValues()[key] ?? "";
      varInputs.set(key, [...(varInputs.get(key) ?? []), input]);
      input.addEventListener("change", () => {
        const clean = ctx.onVariableChange(pill, variable, input.value);
        for (const other of varInputs.get(key) ?? []) other.value = clean;
      });
      return h(
        "div",
        { class: "row sub var-row" },
        h("span", { class: "row-main", text: variable.label }),
        variable.group ? h("span", { class: "row-meta", text: "shared" }) : null,
        input,
      );
    });

  const pillRows = ctx.config.pills.map((pill) => {
    const box = h("input", { type: "checkbox", class: "switch", attrs: { "aria-label": `Show ${pill.name}` } });
    box.checked = !disabled.has(pill.id);
    box.addEventListener("change", () => ctx.onPillToggle(pill.id, box.checked));
    const chipBox = h("input", { type: "checkbox", class: "switch", attrs: { "aria-label": `Show ${pill.name} in the small view` } });
    chipBox.checked = !hiddenChips.has(pill.id);
    chipBox.addEventListener("change", () => ctx.onChipToggle(pill.id, chipBox.checked));
    const fields = pill.kind === "rest" ? variableFields(pill) : [];
    return h(
      "div",
      { class: "pill-setting" },
      h("label", { class: "row" }, h("span", { class: "row-main", text: pill.name }), h("span", { class: "row-meta", text: pill.kind === "rest" ? "web" : "media" }), box),
      h("label", { class: "row sub" }, h("span", { class: "row-main", text: "Show in the small view" }), chipBox),
      ...fields,
    );
  });

  const adder = pillAdder(new Set(ctx.config.pills.map((p) => p.id)), ctx.onReload);

  // ---- secrets ---------------------------------------------------------------------------
  const secretNames = [...new Set(ctx.config.pills.flatMap(secretsOf))];
  const secretsBody = h("div");
  const paintSecrets = async () => {
    clear(secretsBody);
    if (secretNames.length === 0) {
      secretsBody.append(h("p", { class: "muted", text: "None of your pills need a secret." }));
      return;
    }
    for (const name of secretNames) {
      let isSet = false;
      try {
        isSet = await ipc.secretExists(name);
      } catch {
        // shown as "not set"
      }
      const input = h("input", { class: "input", type: "password", placeholder: isSet ? "Replace…" : "Paste value…", attrs: { autocomplete: "off", "aria-label": `Value for ${name}` } });
      const save = h("button", {
        class: "btn",
        text: "Save",
        on: {
          click: async () => {
            if (!input.value) return;
            try {
              await ipc.secretSet(name, input.value);
              input.value = "";
              ctx.onAccessChanged();
              await paintSecrets();
            } catch (err) {
              input.value = "";
              input.placeholder = errorText(err);
            }
          },
        },
      });
      const remove = isSet
        ? h("button", {
            class: "btn",
            text: "Remove",
            on: {
              click: async () => {
                await ipc.secretDelete(name).catch(() => undefined);
                ctx.onAccessChanged();
                await paintSecrets();
              },
            },
          })
        : null;
      secretsBody.append(
        h(
          "div",
          { class: "secret" },
          h("div", { class: "row" }, h("span", { class: "row-main", text: name }), h("span", { class: `badge ${isSet ? "badge-good" : "badge-warn"}`, text: isSet ? "set" : "not set" })),
          h("div", { class: "row" }, input, save, remove),
        ),
      );
    }
  };
  void paintSecrets();

  // ---- approved hosts ----------------------------------------------------------------------
  const hostsBody = h("div");
  const paintHosts = async () => {
    clear(hostsBody);
    let hosts: string[] = [];
    try {
      hosts = await ipc.approvedHosts();
    } catch {
      // treated as empty
    }
    if (hosts.length === 0) {
      hostsBody.append(h("p", { class: "muted", text: "No hosts approved yet. Perch asks the first time a pill needs one." }));
      return;
    }
    for (const host of hosts) {
      hostsBody.append(
        h(
          "div",
          { class: "row" },
          h("span", { class: "row-main", text: host }),
          h("button", {
            class: "btn",
            text: "Revoke",
            on: {
              click: async () => {
                await ipc.revokeHost(host).catch(() => undefined);
                ctx.onAccessChanged();
                await paintHosts();
              },
            },
          }),
        ),
      );
    }
  };
  void paintHosts();

  // ---- avatar ------------------------------------------------------------------------------
  const select = h("select", { class: "input", attrs: { "aria-label": "Avatar" } });
  select.append(h("option", { text: "Perch (built-in)", value: "" }));
  for (const entry of ctx.config.avatars) {
    select.append(h("option", { text: `${avatarName(entry.avatar)} (${entry.file})`, value: entry.file }));
  }
  select.value = ctx.avatarFile ?? "";
  if (select.value !== (ctx.avatarFile ?? "")) select.value = "";
  select.addEventListener("change", () => ctx.onAvatarChange(select.value || null));

  const importErrors = h("div");
  const fileInput = h("input", { type: "file", attrs: { accept: ".json,application/json", hidden: "" } });
  fileInput.addEventListener("change", async () => {
    clear(importErrors);
    const file = fileInput.files?.[0];
    fileInput.value = "";
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) {
      importErrors.append(errorList(["File is larger than 256 KB."]));
      return;
    }
    const text = await file.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      importErrors.append(errorList(["That file is not valid JSON."]));
      return;
    }
    const result = validateAnyAvatar(parsed);
    if (!result.ok) {
      importErrors.append(errorList(result.errors));
      return;
    }
    try {
      const saved = await ipc.saveUserFile("avatars", file.name, text);
      // choose it first: the reload below re-renders this screen and reads the choice
      ctx.onAvatarChange(saved);
      await ctx.onReload();
    } catch (err) {
      importErrors.append(errorList([errorText(err)]));
    }
  });

  // ---- problems ----------------------------------------------------------------------------
  const problems =
    ctx.config.problems.length === 0
      ? null
      : section(
          "Files with problems",
          ...ctx.config.problems.map((p) =>
            h("div", { class: "problem" }, h("div", { class: "row-main", text: `${p.kind === "pip" ? "Pill" : "Avatar"}: ${p.file}` }), errorList(p.errors)),
          ),
        );

  root.append(
    section("Pills", ...pillRows, adder.buttons, adder.panel),
    section(
      "Avatar",
      select,
      h("div", { class: "row" }, h("button", { class: "btn", text: "Import avatar JSON…", on: { click: () => fileInput.click() } }), fileInput),
      importErrors,
    ),
    section(
      "Secrets and access",
      h("p", { class: "muted", text: "Secrets are stored in your system's credential store. Perch never shows them again." }),
      secretsBody,
      h("h4", { class: "settings-sub", text: "Approved hosts" }),
      hostsBody,
    ),
    section("Local inbox", ...inboxSection()),
    section(
      "Behaviour",
      h("label", { class: "row" }, h("span", { class: "row-main wrap", text: "Open after resting the pointer" }), delaySelect),
      h("label", { class: "row" }, h("span", { class: "row-main wrap", text: "Eyes follow the pointer" }), gazeSelect),
      h("label", { class: "row" }, h("span", { class: "row-main wrap", text: "Stay visible when nothing is happening (off: shrink to a sliver)" }), quietBox),
      h("label", { class: "row" }, h("span", { class: "row-main wrap", text: "Look around and wink now and then when quiet" }), peekBox),
      h("label", { class: "row" }, h("span", { class: "row-main wrap", text: "Seasonal looks" }), seasonSelect),
      seasonPreview,
      h("p", { class: "muted", text: "Drag the avatar to move Perch along the top of any screen." }),
      h("div", { class: "row" }, h("button", { class: "btn", text: "Centre on this screen", on: { click: () => ctx.onResetPosition() } })),
    ),
    section(
      "Updates",
      h("label", { class: "row" }, h("span", { class: "row-main wrap", text: "Install updates automatically" }), autoBox),
      updateStatus,
      h("div", { class: "row" }, checkBtn, installBtn),
    ),
    section(
      "Sounds",
      h("label", { class: "row" }, h("span", { class: "row-main", text: "Play sounds" }), soundSelect),
      h("label", { class: "row" }, h("span", { class: "row-main", text: "Volume" }), volume),
      h("div", { class: "row" }, h("button", { class: "btn", text: "Test the alert sound", on: { click: () => ctx.onSoundTest() } })),
      h("p", { class: "muted", text: "Small synthesised blips, quiet by default. Alerts only keeps just the \"hey\" chirp when a pill turns red." }),
    ),
    ...(problems ? [problems] : []),
    section(
      "Files",
      h(
        "div",
        { class: "row" },
        h("button", { class: "btn", text: "Open config folder", on: { click: () => void ipc.openConfigDir().catch(() => undefined) } }),
        h("button", { class: "btn", text: "Reload", on: { click: () => void ctx.onReload() } }),
      ),
    ),
  );
  return root;
}
