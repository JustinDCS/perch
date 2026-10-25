// Draws and animates a Bible Strong avatar as flat SVG, built with DOM calls only. This is a
// 2D approximation: the Studio draws a lit 3D shape, here the head turn is shown by sliding
// and squeezing the face across the body, which reads well at 48 pixels.

import type { AvatarView } from "../renderer";
import type { AvatarStateName } from "../schema";
import { ease, locate, mixPose, pickAnimation, poseOf, type Pose } from "./pose";
import type { BsAnimation, BsAvatar, BsSurface } from "./schema";

const SVG_NS = "http://www.w3.org/2000/svg";
type Attrs = Record<string, string | number>;

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Attrs = {}): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

const rad = (deg: number) => (deg * Math.PI) / 180;
const num = (n: number) => (Math.round(n * 100) / 100).toString();

/** Shapes are drawn around (0,0); the caller places them. `s` converts avatar units to SVG units. */
function surfaceShape(surface: BsSurface, s: number, fill: string): SVGElement {
  const w = surface.width * s;
  const h = surface.height * s;
  const small = Math.min(w, h);
  const soft = Math.max(0, Math.min(2, surface.roundness));
  switch (surface.type) {
    case "sphere":
      return svgEl("ellipse", { cx: 0, cy: 0, rx: w / 2, ry: h / 2, fill });
    case "capsule":
      return svgEl("rect", { x: -w / 2, y: -h / 2, width: w, height: h, rx: small / 2, fill });
    case "cube":
      return svgEl("rect", { x: -w / 2, y: -h / 2, width: w, height: h, rx: Math.min(small / 2, small * 0.22 * soft), fill });
    case "cylinder":
      return svgEl("rect", { x: -w / 2, y: -h / 2, width: w, height: h, rx: Math.min(small / 2, small * 0.1 * soft + 1), fill });
    case "diamond":
      return svgEl("polygon", {
        points: `0,${num(-h / 2)} ${num(w / 2)},0 0,${num(h / 2)} ${num(-w / 2)},0`,
        fill,
        stroke: fill,
        "stroke-width": num(small * 0.12 * soft),
        "stroke-linejoin": "round",
      });
    case "cone":
      return svgEl("polygon", {
        points: `0,${num(-h / 2)} ${num(w / 2)},${num(h / 2)} ${num(-w / 2)},${num(h / 2)}`,
        fill,
        stroke: fill,
        "stroke-width": num(small * 0.12 * soft),
        "stroke-linejoin": "round",
      });
    case "mickey": {
      const g = svgEl("g", { fill });
      const ear = small * 0.3;
      g.append(
        svgEl("ellipse", { cx: 0, cy: 0, rx: w / 2, ry: h / 2 }),
        svgEl("circle", { cx: -w * 0.38, cy: -h * 0.42, r: ear }),
        svgEl("circle", { cx: w * 0.38, cy: -h * 0.42, r: ear }),
      );
      return g;
    }
    case "cursor":
      return svgEl("polygon", {
        points: [
          [-0.45, -0.5],
          [0.5, 0.15],
          [0.1, 0.2],
          [0.28, 0.5],
          [0.08, 0.5],
          [-0.1, 0.24],
          [-0.45, 0.4],
        ]
          .map(([x, y]) => `${num(x! * w)},${num(y! * h)}`)
          .join(" "),
        fill,
      });
  }
}

export function createBibleStrongView(avatar: BsAvatar): AvatarView {
  const primary = avatar.body.primary;
  const s = 76 / Math.max(primary.width, primary.height);
  const faceRadius = (Math.min(primary.width, primary.height) * s) / 2;

  const svg = svgEl("svg", { viewBox: "0 0 100 100", class: "avatar", role: "img", "aria-label": avatar.name });
  const character = svgEl("g", { class: "bs-character" });
  const bodyGroup = svgEl("g", { transform: "translate(50 50)" });
  const faceGroup = svgEl("g", { transform: "translate(50 50)" });
  character.append(bodyGroup, faceGroup);
  svg.append(character);

  // body: extra shapes behind the main one (negative depth) and in front of it
  const bodyShapes: SVGElement[] = [];
  const addShape = (surface: BsSurface, x: number, y: number, rotate: number, host: SVGElement) => {
    const shape = svgEl("g", { transform: `translate(${num(x)} ${num(y)}) rotate(${num(rotate)})` });
    const drawn = surfaceShape(surface, s, avatar.colors.body);
    shape.append(drawn);
    host.append(shape);
    bodyShapes.push(drawn);
  };
  for (const node of avatar.body.nodes.filter((n) => n.position[2] < 0)) {
    addShape(node.surface, node.position[0] * s, node.position[1] * s, node.rotation[2], bodyGroup);
  }
  addShape(primary, 0, 0, 0, bodyGroup);
  for (const node of avatar.body.nodes.filter((n) => n.position[2] >= 0)) {
    addShape(node.surface, node.position[0] * s, node.position[1] * s, node.rotation[2], bodyGroup);
  }

  const mkEye = () => svgEl("rect", { fill: avatar.colors.eyes });
  const leftEye = mkEye();
  const rightEye = mkEye();
  faceGroup.append(leftEye, rightEye);

  const reduceMotion = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const base = avatar.colors;

  let animation: BsAnimation | undefined;
  let startedAt = performance.now();
  let blinkAt = Infinity;
  let blinkUntil = 0;
  let blinkStart = 0;
  let frame = 0;
  let destroyed = false;
  let lastKey = "";

  const nextBlink = (now: number, first: boolean) => {
    const b = animation?.blink;
    if (!b || !b.enabled || reduceMotion) {
      blinkAt = Infinity;
      return;
    }
    const lo = Math.min(b.minIntervalMs, b.maxIntervalMs);
    const hi = Math.max(b.minIntervalMs, b.maxIntervalMs);
    blinkAt = now + (first ? b.initialDelayMs : lo + Math.random() * (hi - lo));
  };

  function setEye(el: SVGRectElement, eye: Pose["left"], cx: number, cy: number, squash: number, closed: number) {
    const w = Math.max(0.4, Math.abs(eye.width) * s * squash);
    const h = Math.max(0.4, Math.abs(eye.height) * s * closed);
    el.setAttribute("x", num(-w / 2));
    el.setAttribute("y", num(-h / 2));
    el.setAttribute("width", num(w));
    el.setAttribute("height", num(h));
    el.setAttribute("rx", num(Math.min(w, h) / 2));
    el.setAttribute("transform", `translate(${num(cx)} ${num(cy)}) rotate(${num(eye.angle)})`);
  }

  function draw(now: number) {
    const expressionOf = (name: string) => avatar.expressions[name] ?? avatar.expressions["neutral"]!;
    let pose: Pose;
    let eyeMotion = "none";
    let bodyMotion = "none";
    if (animation && !reduceMotion) {
      const spot = locate(animation, now - startedAt);
      const from = expressionOf(spot.from);
      const to = expressionOf(spot.to);
      pose = mixPose(poseOf(from), poseOf(to), ease(spot.kind, spot.t), base);
      eyeMotion = (spot.t < 0.5 ? from : to).motion.eyes;
      bodyMotion = (spot.t < 0.5 ? from : to).motion.body;
    } else {
      const first = animation ? expressionOf(animation.steps[0]!.expression) : expressionOf("neutral");
      pose = mixPose(poseOf(first), poseOf(first), 0, base);
    }

    // blinking: close and reopen the eyes over `durationMs`
    let closed = 1;
    if (animation && now >= blinkAt) {
      blinkUntil = now + animation.blink.durationMs;
      nextBlink(blinkUntil, false);
      blinkAt = Math.max(blinkAt, blinkUntil);
      blinkStart = now;
    }
    if (now < blinkUntil && animation) {
      const p = (now - blinkStart) / animation.blink.durationMs;
      closed = Math.max(0.08, Math.abs(p * 2 - 1));
    }

    // small ambient movement
    const sec = now / 1000;
    let eyeJitterX = 0;
    let eyeJitterY = 0;
    if (!reduceMotion) {
      if (eyeMotion === "shake") eyeJitterX = Math.sin(sec * 90) * 0.9;
      if (eyeMotion === "microSaccades") {
        eyeJitterX = Math.sin(sec * 7.1) * Math.sin(sec * 1.3) * 0.7;
        eyeJitterY = Math.sin(sec * 5.3) * Math.sin(sec * 1.7) * 0.5;
      }
    }
    let bodyX = 0;
    let bodyY = 0;
    if (!reduceMotion) {
      if (bodyMotion === "shake") bodyX = Math.sin(sec * 80) * 1.1;
      if (bodyMotion === "slowDrift") {
        bodyX = Math.sin(sec * 0.9) * 1.2;
        bodyY = Math.sin(sec * 0.7 + 1) * 0.9;
      }
    }

    // the head turn: yaw slides the face sideways, pitch up or down, roll tilts it
    const yaw = Math.sin(rad(pose.headY));
    const pitch = Math.sin(rad(pose.headX));
    const faceX = yaw * faceRadius * 0.6 + eyeJitterX;
    const faceY = -pitch * faceRadius * 0.6 + eyeJitterY;
    const squash = Math.max(0.55, Math.cos(rad(pose.headY)));
    const half = (pose.spacing * s * squash) / 2;

    const key = [pose.bodyColor, pose.eyeColor, faceX, faceY, half, pose.headZ, closed, bodyX, bodyY, pose.left.height, pose.right.height, pose.left.angle, pose.right.angle]
      .map((v) => (typeof v === "number" ? v.toFixed(2) : v))
      .join("|");
    if (key === lastKey) return;
    lastKey = key;

    faceGroup.setAttribute("transform", `translate(${num(50 + bodyX)} ${num(50 + bodyY)}) rotate(${num(pose.headZ * 0.6)})`);
    bodyGroup.setAttribute("transform", `translate(${num(50 + bodyX)} ${num(50 + bodyY)})`);
    for (const shape of bodyShapes) {
      shape.setAttribute("fill", pose.bodyColor ?? base.body);
      if (shape.hasAttribute("stroke")) shape.setAttribute("stroke", pose.bodyColor ?? base.body);
    }
    leftEye.setAttribute("fill", pose.eyeColor ?? base.eyes);
    rightEye.setAttribute("fill", pose.eyeColor ?? base.eyes);
    setEye(leftEye, pose.left, faceX - half + pose.left.x * s * squash, faceY + pose.left.y * s, squash, closed);
    setEye(rightEye, pose.right, faceX + half + pose.right.x * s * squash, faceY + pose.right.y * s, squash, closed);
  }

  function loop(now: number) {
    if (destroyed) return;
    draw(now);
    frame = requestAnimationFrame(loop);
  }

  function setState(name: AvatarStateName): void {
    const picked = pickAnimation(avatar.animations, avatar.animationOrder, name);
    animation = picked ? avatar.animations[picked] : undefined;
    startedAt = performance.now();
    lastKey = "";
    nextBlink(startedAt, true);
    svg.dataset.state = name;
  }

  setState("idle");
  draw(performance.now());
  // when motion is reduced the avatar is a still picture, so no loop is needed
  if (!reduceMotion) frame = requestAnimationFrame(loop);

  return {
    el: svg,
    setState(name) {
      setState(name);
      if (reduceMotion) draw(performance.now());
    },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(frame);
    },
  };
}
