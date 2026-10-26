// Questions from programs on this PC (the local inbox). They show as one card at the top of the
// pills, with the asker's buttons. Nothing is ever answered for the user: a question just waits,
// and goes away if the program that asked gives up.

import { errorText, ipc, type InboxAsk } from "../ipc";
import { clear, h } from "./dom";

type State = { kind: "waiting" } | { kind: "sending" } | { kind: "done"; label: string } | { kind: "failed"; text: string };

export interface InboxCallbacks {
  /** how many questions are waiting (counted in "N need you") */
  onNeeds(count: number): void;
  /** a new question arrived */
  onArrival(): void;
}

export interface InboxView {
  el: HTMLElement;
  /** Put the card at the top of `parent` (call again after the parent was cleared). */
  attach(parent: HTMLElement): void;
  stop(): void;
}

const DONE_SHOW_MS = 3000;

export function createInbox(callbacks: InboxCallbacks): InboxView {
  const el = h("section", { class: "pill pill-inbox", hidden: true, data: { kind: "inbox", tone: "warn" } });
  const asks = new Map<number, { ask: InboxAsk; state: State }>();

  function waiting(): number {
    return [...asks.values()].filter((a) => a.state.kind !== "done").length;
  }

  function paint(): void {
    clear(el);
    el.hidden = asks.size === 0;
    callbacks.onNeeds(waiting());
    if (asks.size === 0) return;
    el.append(h("div", { class: "pill-head" }, h("span", { class: "pill-icon", text: "📥" }), h("span", { class: "pill-name", text: "Asks from this PC" })));
    const list = h("div", { class: "approvals" });
    for (const [id, { ask, state }] of asks) {
      if (state.kind === "done") {
        list.append(h("div", { class: "approval approval-done", attrs: { role: "status" } }, h("span", { class: "approval-check", text: "✓" }), h("span", { text: `${state.label} · ${ask.title}` })));
        continue;
      }
      const card = h("div", { class: `approval${state.kind === "failed" ? " approval-failed" : ""}` });
      if (ask.source) card.append(h("div", { class: "approval-source", text: ask.source }));
      card.append(h("div", { class: "approval-title", text: ask.title }));
      if (ask.detail) card.append(h("div", { class: "approval-detail", text: ask.detail }));
      if (state.kind === "failed") card.append(h("div", { class: "approval-detail", text: `${state.text}. Nothing was sent.` }));
      const row = h("div", { class: "approval-actions" });
      if (state.kind === "sending") row.append(h("button", { class: "approval-btn neutral", text: "Sending…", attrs: { disabled: "" } }));
      else {
        ask.buttons.forEach((label, index) =>
          row.append(h("button", { class: `approval-btn ${index === 0 ? "good" : "neutral"}`, text: label, on: { click: () => void answer(id, label) } })),
        );
        row.append(h("button", { class: "approval-btn neutral approval-dismiss", text: "Dismiss", attrs: { "aria-label": `Dismiss: ${ask.title}` }, on: { click: () => void answer(id, null) } }));
      }
      card.append(row);
      list.append(card);
    }
    el.append(list);
  }

  async function answer(id: number, label: string | null): Promise<void> {
    const entry = asks.get(id);
    if (!entry) return;
    entry.state = { kind: "sending" };
    paint();
    try {
      await ipc.inboxAnswer(id, label);
      if (label === null) asks.delete(id);
      else {
        entry.state = { kind: "done", label };
        setTimeout(() => {
          asks.delete(id);
          paint();
        }, DONE_SHOW_MS);
      }
    } catch (err) {
      const text = errorText(err);
      // the program gave up while the card was open: nothing left to answer
      if (text.includes("no longer waiting") || text.includes("gone away")) asks.delete(id);
      else entry.state = { kind: "failed", text };
    }
    paint();
  }

  const stopListening = ipc.onInbox({
    ask(ask) {
      asks.set(ask.id, { ask, state: { kind: "waiting" } });
      paint();
      callbacks.onArrival();
    },
    cancel(id) {
      asks.delete(id);
      paint();
    },
  });

  return {
    el,
    attach(parent) {
      parent.prepend(el);
      paint();
    },
    stop: stopListening,
  };
}
