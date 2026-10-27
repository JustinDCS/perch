// Tiny DOM helpers. Text always goes in through textContent / text nodes, never innerHTML,
// because pill data comes from remote APIs and must be treated as untrusted.

type Child = Node | string | null | undefined | false;

export interface ElProps {
  class?: string;
  text?: string;
  title?: string;
  type?: string;
  value?: string;
  placeholder?: string;
  disabled?: boolean;
  hidden?: boolean;
  data?: Record<string, string>;
  aria?: Record<string, string>;
  on?: { [K in keyof HTMLElementEventMap]?: (event: HTMLElementEventMap[K]) => void };
  attrs?: Record<string, string>;
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: ElProps = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props.class) el.className = props.class;
  if (props.text !== undefined) el.textContent = props.text;
  if (props.title) el.title = props.title;
  if (props.hidden) el.hidden = true;
  if (props.data) for (const [k, v] of Object.entries(props.data)) el.dataset[k] = v;
  if (props.aria) for (const [k, v] of Object.entries(props.aria)) el.setAttribute(`aria-${k}`, v);
  if (props.attrs) for (const [k, v] of Object.entries(props.attrs)) el.setAttribute(k, v);

  const input = el as unknown as HTMLInputElement;
  if (props.type) input.type = props.type;
  if (props.value !== undefined) input.value = props.value;
  if (props.placeholder) input.placeholder = props.placeholder;
  if (props.disabled) input.disabled = true;

  if (props.on) {
    for (const [name, handler] of Object.entries(props.on)) {
      el.addEventListener(name, handler as EventListener);
    }
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child);
  }
  return el;
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export function formatTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
