// Builds the avatar as SVG with DOM calls (createElementNS / setAttribute). Every value has
// already been range- and format-checked by validateAvatar, and nothing is ever concatenated
// into markup, so an avatar file cannot inject script or foreign elements.

import type { Avatar, AvatarStateName } from "./schema";

const SVG_NS = "http://www.w3.org/2000/svg";

type Attrs = Record<string, string | number>;

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Attrs = {}): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
  return el;
}

export interface AvatarView {
  el: SVGSVGElement;
  setState(name: AvatarStateName): void;
  destroy(): void;
}

export function mouthPath(width: number, y: number, curve: number): string {
  const x1 = 50 - width / 2;
  const x2 = 50 + width / 2;
  const control = y + curve * 9;
  return `M ${x1} ${y} Q 50 ${control} ${x2} ${y}`;
}

export function createAvatarView(avatar: Avatar): AvatarView {
  const svg = svgEl("svg", {
    viewBox: "0 0 100 100",
    class: "avatar",
    role: "img",
    "aria-label": avatar.name,
  });
  const character = svgEl("g", { class: "character" });

  const { shape, width, height, color } = avatar.body;
  const x = (100 - width) / 2;
  const y = (100 - height) / 2;
  const body =
    shape === "circle"
      ? svgEl("ellipse", { cx: 50, cy: 50, rx: width / 2, ry: height / 2, fill: color })
      : svgEl("rect", {
          x,
          y,
          width,
          height,
          rx: shape === "pill" ? Math.min(width, height) / 2 : Math.min(width, height) * 0.38,
          fill: color,
        });

  // outer group carries the offset, inner group the blink, so the two transforms never fight
  const eyesOuter = svgEl("g");
  const eyesInner = svgEl("g", { class: "eyes" });
  const eyeRx = avatar.eyes.size / 2;
  const left = svgEl("ellipse", { cx: 50 - avatar.eyes.spacing / 2, cy: avatar.eyes.y, rx: eyeRx, ry: eyeRx, fill: avatar.eyes.color });
  const right = svgEl("ellipse", { cx: 50 + avatar.eyes.spacing / 2, cy: avatar.eyes.y, rx: eyeRx, ry: eyeRx, fill: avatar.eyes.color });
  eyesInner.append(left, right);
  eyesOuter.append(eyesInner);

  const mouth = svgEl("path", {
    fill: "none",
    stroke: avatar.mouth.color,
    "stroke-width": 3,
    "stroke-linecap": "round",
  });

  character.append(body, eyesOuter, mouth);
  svg.append(character);

  let blinkTimer: ReturnType<typeof setTimeout> | undefined;
  let blinkReset: ReturnType<typeof setTimeout> | undefined;

  const scheduleBlink = () => {
    const [lo, hi] = avatar.eyes.blinkSeconds;
    const delay = (lo + Math.random() * (hi - lo)) * 1000;
    blinkTimer = setTimeout(() => {
      eyesInner.classList.add("blink");
      blinkReset = setTimeout(() => eyesInner.classList.remove("blink"), 130);
      scheduleBlink();
    }, delay);
  };
  scheduleBlink();

  function setState(name: AvatarStateName): void {
    const state = avatar.states[name];
    body.setAttribute("fill", state.bodyColor ?? avatar.body.color);
    for (const eye of [left, right]) eye.setAttribute("ry", String(Math.max(0.6, eyeRx * state.eyeOpen)));
    eyesOuter.setAttribute("transform", `translate(${state.eyeOffsetX} ${state.eyeOffsetY})`);
    mouth.setAttribute("d", mouthPath(avatar.mouth.width, avatar.mouth.y, state.mouth));
    character.setAttribute("data-anim", state.animation);
    svg.style.setProperty("--speed", String(state.speed));
    svg.dataset.state = name;
  }

  setState("idle");

  return {
    el: svg,
    setState,
    destroy() {
      if (blinkTimer) clearTimeout(blinkTimer);
      if (blinkReset) clearTimeout(blinkReset);
    },
  };
}
