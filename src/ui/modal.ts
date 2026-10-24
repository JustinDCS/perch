import { h } from "./dom";

export interface ConfirmOptions {
  title: string;
  lines: string[];
  confirmLabel: string;
  cancelLabel: string;
}

/** An in-window confirmation dialog. Resolves true on confirm, false on cancel / Escape. */
export function confirmDialog(parent: HTMLElement, options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const finish = (answer: boolean) => {
      document.removeEventListener("keydown", onKey, true);
      backdrop.remove();
      parent.classList.remove("has-modal");
      resolve(answer);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        finish(false);
      }
    };

    const confirm = h("button", { class: "btn btn-primary", text: options.confirmLabel, on: { click: () => finish(true) } });
    const cancel = h("button", { class: "btn", text: options.cancelLabel, on: { click: () => finish(false) } });

    const backdrop = h(
      "div",
      { class: "modal-backdrop" },
      h(
        "div",
        { class: "modal", attrs: { role: "dialog", "aria-modal": "true", "aria-label": options.title } },
        h("h2", { class: "modal-title", text: options.title }),
        ...options.lines.map((line) => h("p", { class: "modal-line", text: line })),
        h("div", { class: "modal-actions" }, cancel, confirm),
      ),
    );

    document.addEventListener("keydown", onKey, true);
    // the window is only as tall as the card, so make sure the dialog has room to show
    parent.classList.add("has-modal");
    parent.append(backdrop);
    cancel.focus(); // the safe option is focused by default
  });
}
