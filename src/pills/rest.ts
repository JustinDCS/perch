// REST/JSON pill. The manifest says where to fetch, how to authenticate (by secret *name*),
// and which fields of the response to show. The request itself is made by Rust.

import { formatValue, getPath, previewJson, renderTemplate, textOf } from "../lib/jsonpath";
import { errorText, ipc } from "../ipc";
import { clear, h } from "../ui/dom";
import { hostOf } from "./manifest";
import { toneFor } from "./tone";
import type { ListDisplay, PillHost, PillView, RestPill, StatDisplay, Tone } from "./types";

export function createRestPill(manifest: RestPill, host: PillHost): PillView {
  const content = h("div", { class: "pill-content" });
  const notice = h("div", { class: "pill-notice", hidden: true });

  // "Details": what was asked, and what came back last time, to see why a value looks wrong
  const details = h("pre", { class: "pill-details", hidden: true });
  const infoBtn = h("button", {
    class: "pill-info",
    text: "details",
    title: "Show the last request and response",
    on: { click: () => (details.hidden = !details.hidden) },
  });
  const target = (() => {
    try {
      const u = new URL(manifest.request.url);
      return `${u.origin}${u.pathname}`; // never the query string, which can carry a token
    } catch {
      return manifest.request.url;
    }
  })();
  function recordResult(outcome: string): void {
    const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    details.textContent = `${manifest.request.method} ${target}\n${time}\n${outcome}`;
  }

  const root = h(
    "section",
    { class: "pill pill-rest", data: { kind: "rest", tone: "neutral" } },
    h(
      "div",
      { class: "pill-head" },
      manifest.icon ? h("span", { class: "pill-icon", text: manifest.icon }) : null,
      h("span", { class: "pill-name", text: manifest.name }),
      infoBtn,
    ),
    content,
    notice,
    details,
  );
  recordResult("waiting for the first response…");

  if (manifest.accent) root.style.setProperty("--pill-accent", manifest.accent);

  let timer: ReturnType<typeof setInterval> | undefined;
  let busy = false;
  let hasData = false;

  function setTone(tone: Tone): void {
    root.dataset.tone = tone;
    host.reportTone(manifest.id, tone);
  }

  function showNotice(...children: (Node | string)[]): void {
    clear(notice);
    notice.append(...children);
    notice.hidden = false;
  }

  function renderStat(display: StatDisplay, data: unknown): void {
    const raw = getPath(data, display.value);
    const value = h("div", { class: "stat-value" }, formatValue(raw));
    if (display.unit) value.append(h("span", { class: "stat-unit", text: ` ${display.unit}` }));
    clear(content);
    content.append(value);
    if (display.label) content.append(h("div", { class: "stat-label", text: display.label }));
    setTone(toneFor(raw, display.thresholds));
    host.reportChip(manifest.id, { icon: manifest.icon, text: `${formatValue(raw)}${display.unit ? ` ${display.unit}` : ""}` });
  }

  function renderList(display: ListDisplay, data: unknown): void {
    clear(content);
    const items = getPath(data, display.items);
    if (!Array.isArray(items) || items.length === 0) {
      content.append(h("div", { class: "list-empty", text: "No items" }));
      setTone("neutral");
      host.reportChip(manifest.id, { icon: manifest.icon, text: "0" });
      return;
    }
    const list = h("ul", { class: "list" });
    for (const item of items.slice(0, display.limit)) {
      const row = h("li", { class: "list-row" }, h("span", { class: "list-title", text: textOf(item, display.title) }));
      if (display.subtitle) {
        row.append(h("span", { class: "list-subtitle", text: textOf(item, display.subtitle) }));
      }
      if (display.link) {
        const target = renderTemplate(display.link, item);
        row.classList.add("link");
        row.setAttribute("role", "link");
        row.tabIndex = 0;
        row.title = target;
        const open = () => void ipc.openUrl(target).catch(handleError);
        row.addEventListener("click", open);
        row.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            open();
          }
        });
      }
      list.append(row);
    }
    content.append(list);
    setTone("neutral");
    host.reportChip(manifest.id, { icon: manifest.icon, text: String(items.length) });
  }

  function handleError(err: unknown): void {
    const message = errorText(err);
    recordResult(`failed: ${message}`);
    // keep showing the last good value if there is one; otherwise drop the "Loading…" text
    if (!hasData) clear(content);

    if (message.startsWith("HOST_NOT_APPROVED:")) {
      const target = message.slice("HOST_NOT_APPROVED:".length);
      showNotice(
        `Perch needs your permission to contact ${target}. `,
        h("button", {
          class: "link-btn",
          text: "Review",
          on: {
            click: () => {
              void host.requestHostApproval(target).then((approved) => {
                if (approved) void refresh();
              });
            },
          },
        }),
      );
    } else if (message.startsWith("SECRET_MISSING:")) {
      showNotice(`Add the secret "${message.slice("SECRET_MISSING:".length)}" in Settings → Secrets.`);
    } else {
      showNotice(message);
    }
    setTone("neutral");
  }

  async function refresh(): Promise<void> {
    if (busy) return;
    busy = true;
    try {
      const data = await ipc.fetchJson({
        url: manifest.request.url,
        method: manifest.request.method,
        auth: manifest.request.auth,
        body: manifest.request.body,
      });
      notice.hidden = true;
      hasData = true;
      recordResult(`OK: ${previewJson(data)}`);
      if (manifest.display.layout === "stat") renderStat(manifest.display, data);
      else renderList(manifest.display, data);
    } catch (err) {
      handleError(err);
    } finally {
      busy = false;
    }
  }

  // shown until the first response arrives
  content.append(h("div", { class: "list-empty", text: `Loading from ${hostOf(manifest) ?? "…"}` }));

  return {
    id: manifest.id,
    el: root,
    start() {
      void refresh();
      timer = setInterval(() => void refresh(), manifest.refreshSeconds * 1000);
    },
    stop() {
      if (timer) clearInterval(timer);
      host.reportChip(manifest.id, null);
    },
  };
}
