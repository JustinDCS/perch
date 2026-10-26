// REST/JSON pill. The manifest says where to fetch, how to authenticate (by secret *name*),
// and which fields of the response to show. The request itself is made by Rust.

import { formatValue, getPath, missingHoles, previewJson, renderTemplate, textOf } from "../lib/jsonpath";
import { errorText, ipc } from "../ipc";
import { clear, h } from "../ui/dom";
import { hostOf } from "./manifest";
import { toneFor } from "./tone";
import { fillBody, fillText, fillUrl, missingVars } from "./variables";
import type { ApprovalAction, ApprovalsDisplay, ChartDisplay, ListDisplay, PillHost, PillView, RestPill, StatDisplay, Tone } from "./types";

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
  let target = manifest.request.url;
  const showTarget = (url: string) => {
    try {
      const u = new URL(url);
      target = `${u.origin}${u.pathname}`; // never the query string, which can carry a token
    } catch {
      target = url;
    }
  };
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

  function renderChart(display: ChartDisplay, data: unknown): void {
    const numbers: number[] = [];
    for (const path of display.values) {
      const found = getPath(data, path);
      if (Array.isArray(found)) for (const n of found) if (typeof n === "number" && Number.isFinite(n)) numbers.push(Math.max(0, n));
    }
    clear(content);
    setTone("neutral");
    if (numbers.length === 0) {
      // some APIs (GitHub's statistics) answer with nothing the first time while they work it out
      content.append(h("div", { class: "list-empty", text: "Collecting data, check back in a minute" }));
      host.reportChip(manifest.id, null);
      return;
    }
    const total = numbers.reduce((a, b) => a + b, 0);
    const max = Math.max(...numbers, 1);
    const head = h("div", { class: "stat-value" }, formatValue(total));
    if (display.unit) head.append(h("span", { class: "stat-unit", text: ` ${display.unit}` }));
    if (display.period) head.append(h("span", { class: "chart-period", text: ` ${display.period}` }));
    const bars = h("div", { class: "chart", attrs: { role: "img", "aria-label": `${display.label ?? "Chart"}: ${numbers.join(", ")}` } });
    numbers.forEach((n, i) => {
      const bar = h("span", { class: i === numbers.length - 1 ? "chart-bar now" : "chart-bar" });
      bar.style.height = `${Math.max(5, Math.round((n / max) * 100))}%`;
      bar.title = String(n);
      bars.append(bar);
    });
    content.append(head, bars);
    if (display.label) content.append(h("div", { class: "stat-label", text: display.label }));
    host.reportChip(manifest.id, { icon: manifest.icon, text: `${formatValue(total)}${display.unit ? ` ${display.unit}` : ""}` });
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
        const target = renderTemplate(fillText(display.link, host.variables(manifest.id)), item);
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


  // ---- approvals: questions waiting for the user, each with a few buttons ----------------------
  type Card =
    | { kind: "confirm"; index: number }
    | { kind: "sending"; index: number }
    | { kind: "done"; text: string }
    | { kind: "failed"; index: number; text: string };
  const cards = new Map<string, Card>();
  const answered = new Map<string, number>(); // key -> when it may show again if the service still lists it
  const announced = new Set<string>();
  let approvalData: { display: ApprovalsDisplay; items: unknown[] } | undefined;

  const ANSWERED_HIDE_MS = 120_000;
  const DONE_SHOW_MS = 4_000;

  /** The address for one button: {var.x} first (host checked, values encoded), then the item's {holes} encoded. */
  function actionUrl(action: ApprovalAction, item: unknown): string {
    const filled = fillUrl(action.post, host.variables(manifest.id), manifest.variables);
    const missing = missingHoles(filled, item);
    if (missing.length > 0) throw new Error(`this request has no value for {${missing[0]}}`);
    return renderTemplate(filled, item, encodeURIComponent);
  }

  /** Fill {holes} from the item in every string of a JSON body. */
  function withItem(value: unknown, item: unknown): unknown {
    if (typeof value === "string") return renderTemplate(value, item);
    if (Array.isArray(value)) return value.map((v) => withItem(v, item));
    if (typeof value === "object" && value !== null) {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, withItem(v, item)]));
    }
    return value;
  }

  function itemKey(display: ApprovalsDisplay, item: unknown): string {
    let where = "";
    try {
      where = actionUrl(display.actions[0]!, item);
    } catch {
      // an item without an id still gets a key from its title
    }
    return `${textOf(item, display.title)}\u0001${where}`;
  }

  function buttonFor(label: string, tone: "neutral" | "good" | "danger" | "warn", onClick: () => void, disabled = false): HTMLElement {
    return h("button", { class: `approval-btn ${tone}`, text: label, attrs: disabled ? { disabled: "" } : {}, on: { click: onClick } });
  }

  function paintApprovals(): void {
    if (!approvalData) return;
    const { display, items } = approvalData;
    clear(content);
    const now = Date.now();
    let waiting = 0;
    const list = h("div", { class: "approvals" });
    for (const item of items.slice(0, display.limit)) {
      const key = itemKey(display, item);
      const card = cards.get(key);
      const hiddenUntil = answered.get(key);
      if (hiddenUntil !== undefined && hiddenUntil > now && card?.kind !== "done") continue;
      const title = textOf(item, display.title);

      if (card?.kind === "done") {
        list.append(
          h("div", { class: "approval approval-done", attrs: { role: "status" } }, h("span", { class: "approval-check", text: "✓" }), h("span", { text: card.text })),
        );
        continue;
      }
      waiting += 1;

      const failed = card?.kind === "failed";
      const el = h("div", { class: `approval${failed ? " approval-failed" : ""}` });
      if (failed) {
        el.append(
          h("div", { class: "approval-title", text: "Couldn't do that" }),
          h("div", { class: "approval-detail", text: `${card.text}. Nothing was changed.` }),
        );
      } else if (card?.kind === "confirm") {
        const action = display.actions[card.index]!;
        const asked = typeof action.confirm === "string" ? renderTemplate(action.confirm, item) : `${action.label}: ${title}`;
        el.append(h("div", { class: "approval-title", text: asked }));
      } else {
        el.append(h("div", { class: "approval-title", text: title }));
        if (display.detail) el.append(h("div", { class: "approval-detail", text: textOf(item, display.detail) }));
      }

      const row = h("div", { class: "approval-actions" });
      if (card?.kind === "sending") {
        row.append(buttonFor("Working…", "neutral", () => undefined, true));
      } else if (failed) {
        row.append(
          buttonFor("Dismiss", "neutral", () => {
            cards.delete(key);
            paintApprovals();
          }),
          buttonFor("Try again", "warn", () => void runAction(key, item, card.index)),
        );
      } else if (card?.kind === "confirm") {
        const action = display.actions[card.index]!;
        row.append(
          buttonFor("Back", "neutral", () => {
            cards.delete(key);
            paintApprovals();
          }),
          buttonFor(`Yes, ${action.label.toLowerCase()}`, "warn", () => void runAction(key, item, card.index)),
        );
      } else {
        display.actions.forEach((action, index) => {
          row.append(
            buttonFor(action.label, action.tone, () => {
              if (action.confirm) {
                cards.set(key, { kind: "confirm", index });
                paintApprovals();
              } else void runAction(key, item, index);
            }),
          );
        });
      }
      el.append(row);
      list.append(el);
    }
    if (list.childElementCount === 0) content.append(h("div", { class: "list-empty", text: "Nothing waiting" }));
    else content.append(list);
    setTone(waiting > 0 ? "warn" : "neutral");
    host.reportChip(manifest.id, waiting > 0 ? { icon: manifest.icon, text: `${waiting} waiting` } : null);
    host.reportNeeds(manifest.id, waiting);
  }

  async function runAction(key: string, item: unknown, index: number, retried = false): Promise<void> {
    const display = approvalData?.display;
    const action = display?.actions[index];
    if (!display || !action) return;
    cards.set(key, { kind: "sending", index });
    paintApprovals();
    const title = textOf(item, display.title);
    try {
      const values = host.variables(manifest.id);
      const url = actionUrl(action, item);
      const auth = manifest.request.auth;
      const body =
        action.body === undefined
          ? undefined
          : withItem(fillBody(action.body, values), item);
      await ipc.fetchJson({
        url,
        method: "POST",
        auth: auth?.type === "basic" ? { ...auth, user: fillText(auth.user, values) } : auth,
        body,
      });
      recordResult(`"${action.label}" sent: OK`);
      cards.set(key, { kind: "done", text: `${action.label} · ${title}` });
      answered.set(key, Date.now() + ANSWERED_HIDE_MS);
      paintApprovals();
      setTimeout(() => {
        if (cards.get(key)?.kind === "done") {
          cards.delete(key);
          paintApprovals();
        }
      }, DONE_SHOW_MS);
      setTimeout(() => void refresh(), 1500);
    } catch (err) {
      const message = errorText(err instanceof Error ? err.message : err);
      if (message.startsWith("HOST_NOT_APPROVED:") && !retried) {
        const target = message.slice("HOST_NOT_APPROVED:".length);
        if (await host.requestHostApproval(target)) return runAction(key, item, index, true);
      }
      recordResult(`"${action.label}" failed: ${message}`);
      const text = message.startsWith("HOST_NOT_APPROVED:")
        ? `Perch is not allowed to contact ${message.slice("HOST_NOT_APPROVED:".length)}`
        : message.startsWith("SECRET_MISSING:")
          ? `The secret "${message.slice("SECRET_MISSING:".length)}" is not set (Settings → Secrets)`
          : message;
      cards.set(key, { kind: "failed", index, text });
      paintApprovals();
    }
  }

  function renderApprovals(display: ApprovalsDisplay, data: unknown): void {
    const found = getPath(data, display.items);
    const items = Array.isArray(found) ? found : [];
    const keys = new Set(items.map((item) => itemKey(display, item)));
    // forget what no longer applies: items the service stopped listing
    for (const key of [...answered.keys()]) if (!keys.has(key)) answered.delete(key);
    for (const key of [...cards.keys()]) if (!keys.has(key) && cards.get(key)?.kind !== "done") cards.delete(key);
    let arrived = false;
    for (const key of keys) {
      if (!announced.has(key) && !answered.has(key)) arrived = true;
    }
    for (const key of [...announced]) if (!keys.has(key)) announced.delete(key);
    for (const key of keys) if (!answered.has(key)) announced.add(key);
    approvalData = { display, items };
    paintApprovals();
    if (arrived) host.reportArrival(manifest.id);
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
      const values = host.variables(manifest.id);
      const unset = missingVars(manifest.variables, values);
      if (unset.length > 0) {
        recordResult(`needs setup: ${unset.map((v) => v.label).join(", ")}`);
        clear(content);
        showNotice(
          `Needs setup: ${unset.map((v) => v.label).join(", ")}. `,
          h("button", { class: "link-btn", text: "Set up", on: { click: () => host.openSettings() } }),
        );
        setTone("neutral");
        host.reportChip(manifest.id, null);
        return;
      }
      const url = fillUrl(manifest.request.url, values, manifest.variables);
      showTarget(url);
      const auth = manifest.request.auth;
      const data = await ipc.fetchJson({
        url,
        method: manifest.request.method,
        auth: auth?.type === "basic" ? { ...auth, user: fillText(auth.user, values) } : auth,
        body: fillBody(manifest.request.body, values),
      });
      notice.hidden = true;
      hasData = true;
      recordResult(`OK: ${previewJson(data)}`);
      if (manifest.display.layout === "stat") renderStat(manifest.display, data);
      else if (manifest.display.layout === "approvals") renderApprovals(manifest.display, data);
      else if (manifest.display.layout === "chart") renderChart(manifest.display, data);
      else renderList(manifest.display, data);
    } catch (err) {
      handleError(err instanceof Error ? err.message : err);
    } finally {
      busy = false;
    }
  }

  // shown until the first response arrives
  content.append(h("div", { class: "list-empty", text: `Loading from ${hostOf(manifest, host.variables(manifest.id)) ?? "…"}` }));

  return {
    id: manifest.id,
    el: root,
    start() {
      void refresh();
      timer = setInterval(() => void refresh(), manifest.refreshSeconds * 1000);
    },
    stop() {
      if (timer) clearInterval(timer);
      host.reportNeeds(manifest.id, 0);
      host.reportChip(manifest.id, null);
    },
  };
}
