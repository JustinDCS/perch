import { avatarName, validateAnyAvatar } from "../avatar/any";
import { type Config } from "../config";
import { errorText, ipc } from "../ipc";
import { secretsOf } from "../pills/manifest";
import { GAZE_MODES, getDisabledPills, OPEN_DELAYS, type GazeMode } from "../settings";
import { clear, h } from "./dom";

const MAX_IMPORT_BYTES = 256 * 1024;

export interface SettingsContext {
  config: Config;
  avatarFile: string | null;
  onAvatarChange(file: string | null): void;
  onPillToggle(id: string, enabled: boolean): void;
  hideWhenQuiet: boolean;
  onHideWhenQuietChange(value: boolean): void;
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
  const quietBox = h("input", { type: "checkbox", attrs: { "aria-label": "Hide when nothing is happening" } });
  quietBox.checked = ctx.hideWhenQuiet;
  quietBox.addEventListener("change", () => ctx.onHideWhenQuietChange(quietBox.checked));

  const peekBox = h("input", { type: "checkbox", attrs: { "aria-label": "Peek out and wink now and then" } });
  peekBox.checked = ctx.peeks;
  peekBox.addEventListener("change", () => ctx.onPeeksChange(peekBox.checked));

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
  const pillRows = ctx.config.pills.map((pill) => {
    const box = h("input", { type: "checkbox", attrs: { "aria-label": `Show ${pill.name}` } });
    box.checked = !disabled.has(pill.id);
    box.addEventListener("change", () => ctx.onPillToggle(pill.id, box.checked));
    return h("label", { class: "row" }, box, h("span", { class: "row-main", text: pill.name }), h("span", { class: "row-meta", text: pill.kind }));
  });

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
    section(
      "Behaviour",
      h("label", { class: "row" }, quietBox, h("span", { class: "row-main", text: "Shrink to a sliver when nothing is happening" })),
      h("p", { class: "muted", text: "Rest the pointer on it to bring it back. Music and alerts always show." }),
      h("label", { class: "row" }, h("span", { class: "row-main", text: "Open after resting the pointer" }), delaySelect),
      h("label", { class: "row" }, peekBox, h("span", { class: "row-main", text: "Peek out and wink now and then while hidden" })),
      h("label", { class: "row" }, h("span", { class: "row-main", text: "Eyes follow the pointer" }), gazeSelect),
      h("p", { class: "muted", text: "Drag the avatar to move Perch along the top of any screen." }),
      h("div", { class: "row" }, h("button", { class: "btn", text: "Centre on this screen", on: { click: () => ctx.onResetPosition() } })),
    ),
    section("Pills", ...pillRows),
    section("Secrets", h("p", { class: "muted", text: "Stored in Windows Credential Manager. Perch never shows them again." }), secretsBody),
    section("Approved hosts", hostsBody),
    section(
      "Avatar",
      select,
      h("div", { class: "row" }, h("button", { class: "btn", text: "Import avatar JSON…", on: { click: () => fileInput.click() } }), fileInput),
      importErrors,
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
