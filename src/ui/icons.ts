// Built-in icons as static SVG path data (our own constants, never user input).

const SVG_NS = "http://www.w3.org/2000/svg";

interface IconShape {
  tag: "path" | "circle";
  attrs: Record<string, string>;
}

interface IconDef {
  filled: boolean;
  shapes: IconShape[];
}

const path = (d: string): IconShape => ({ tag: "path", attrs: { d } });
const circle = (cx: string, cy: string, r: string): IconShape => ({ tag: "circle", attrs: { cx, cy, r } });

const ICONS = {
  play: { filled: true, shapes: [path("M8 5v14l11-7z")] },
  pause: { filled: true, shapes: [path("M6 5h4v14H6zM14 5h4v14h-4z")] },
  next: { filled: true, shapes: [path("M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z")] },
  previous: { filled: true, shapes: [path("M6 6h2v12H6zM9.5 12l8.5 6V6z")] },
  close: { filled: false, shapes: [path("M6 6l12 12M18 6L6 18")] },
  settings: {
    filled: false,
    shapes: [path("M4 8h9M17 8h3M4 16h3M11 16h9"), circle("15", "8", "2"), circle("9", "16", "2")],
  },
  up: { filled: false, shapes: [path("M5 15l7-7 7 7")] },
  back: { filled: false, shapes: [path("M15 5l-7 7 7 7")] },
  music: { filled: true, shapes: [path("M9 17V5l10-2v12"), circle("7", "17", "2.5"), circle("17", "15", "2.5")] },
} satisfies Record<string, IconDef>;

export type IconName = keyof typeof ICONS;

export function icon(name: IconName, size = 18): SVGSVGElement {
  const def: IconDef = ICONS[name];
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", "icon");
  if (!def.filled) {
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
  } else {
    svg.setAttribute("fill", "currentColor");
  }
  for (const shape of def.shapes) {
    const el = document.createElementNS(SVG_NS, shape.tag);
    for (const [k, v] of Object.entries(shape.attrs)) el.setAttribute(k, v);
    svg.append(el);
  }
  return svg;
}
