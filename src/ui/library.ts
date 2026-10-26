// Adding pills to the Library: from a file the user picks, or from the examples that ship with Perch.

import { errorText, ipc } from "../ipc";
import { validatePill } from "../pills/manifest";
import type { PillManifest } from "../pills/types";
import { clear, h } from "./dom";

const MAX_IMPORT_BYTES = 256 * 1024;

// the examples folder is bundled into the app as text, so it works from an installed copy too
const bundled = import.meta.glob("../../examples/pips/*.json", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

export interface Example {
  file: string;
  manifest: PillManifest;
  text: string;
}

export function bundledExamples(): Example[] {
  const out: Example[] = [];
  for (const [path, text] of Object.entries(bundled)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      continue;
    }
    const result = validatePill(parsed);
    if (result.ok) out.push({ file: path.split("/").pop() ?? "pill.json", manifest: result.value, text });
  }
  return out.sort((a, b) => a.manifest.name.localeCompare(b.manifest.name));
}

function describe(pill: PillManifest): string {
  if (pill.kind === "now-playing") return "Media";
  switch (pill.display.layout) {
    case "stat":
      return "A number from a web service";
    case "list":
      return "A list from a web service";
    case "approvals":
      return "Questions to answer";
  }
}

function errorList(errors: string[]): HTMLElement {
  return h("ul", { class: "error-list" }, ...errors.map((e) => h("li", { text: e })));
}

/** Everything the Library needs to add a pill: a file picker and a list of examples. */
export function pillAdder(installedIds: Set<string>, onAdded: () => Promise<void>): { buttons: HTMLElement; panel: HTMLElement } {
  const messages = h("div");
  const examplesBody = h("div", { class: "examples", hidden: true });

  async function install(file: string, text: string): Promise<void> {
    clear(messages);
    try {
      await ipc.saveUserFile("pips", file, text);
      await onAdded();
    } catch (err) {
      messages.append(errorList([errorText(err)]));
    }
  }

  const fileInput = h("input", { type: "file", attrs: { accept: ".json,application/json", hidden: "" } });
  fileInput.addEventListener("change", async () => {
    clear(messages);
    const file = fileInput.files?.[0];
    fileInput.value = "";
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) {
      messages.append(errorList(["File is larger than 256 KB."]));
      return;
    }
    const text = await file.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      messages.append(errorList(["That file is not valid JSON."]));
      return;
    }
    const result = validatePill(parsed);
    if (!result.ok) {
      messages.append(errorList(result.errors));
      return;
    }
    if (installedIds.has(result.value.id)) {
      messages.append(errorList([`A pill with the id "${result.value.id}" is already in your Library.`]));
      return;
    }
    await install(file.name, text);
  });

  function paintExamples(): void {
    clear(examplesBody);
    for (const example of bundledExamples()) {
      const added = installedIds.has(example.manifest.id);
      examplesBody.append(
        h(
          "div",
          { class: "row example" },
          h("div", { class: "row-main" }, h("div", { class: "example-name", text: example.manifest.name }), h("div", { class: "muted", text: describe(example.manifest) })),
          h("button", {
            class: "btn",
            text: added ? "Added" : "Add",
            attrs: added ? { disabled: "" } : {},
            on: { click: () => void install(example.file, example.text) },
          }),
        ),
      );
    }
    if (examplesBody.childElementCount === 0) examplesBody.append(h("p", { class: "muted", text: "No examples are bundled with this build." }));
  }

  const buttons = h(
    "div",
    { class: "row add-row" },
    h("button", { class: "btn dashed", text: "+ Add from file", on: { click: () => fileInput.click() } }),
    h("button", {
      class: "btn dashed",
      text: "Browse examples",
      on: {
        click: () => {
          examplesBody.hidden = !examplesBody.hidden;
          if (!examplesBody.hidden) paintExamples();
        },
      },
    }),
    fileInput,
  );
  return { buttons, panel: h("div", {}, messages, examplesBody) };
}
