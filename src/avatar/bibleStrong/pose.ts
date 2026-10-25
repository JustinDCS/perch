// Pure maths for playing a Bible Strong avatar: blending two expressions, easing, and working
// out where in an animation we are at a given time. No DOM here so it can be unit-tested.

import type { BsAnimation, BsEye, BsExpression, BsStep } from "./schema";

export interface Pose {
  headX: number;
  headY: number;
  headZ: number;
  spacing: number;
  left: BsEye;
  right: BsEye;
  bodyColor?: string;
  eyeColor?: string;
}

export function poseOf(e: BsExpression): Pose {
  return {
    headX: e.head.x,
    headY: e.head.y,
    headZ: e.head.z,
    spacing: e.eyes.spacing,
    left: { ...e.eyes.left },
    right: { ...e.eyes.right },
    bodyColor: e.colors?.body,
    eyeColor: e.colors?.eyes,
  };
}

const mix = (a: number, b: number, t: number) => a + (b - a) * t;

function mixEye(a: BsEye, b: BsEye, t: number): BsEye {
  return {
    width: mix(a.width, b.width, t),
    height: mix(a.height, b.height, t),
    x: mix(a.x, b.x, t),
    y: mix(a.y, b.y, t),
    angle: mix(a.angle, b.angle, t),
  };
}

const channel = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);

export function mixColor(a: string, b: string, t: number): string {
  let out = "#";
  for (let i = 0; i < 3; i++) out += Math.round(mix(channel(a, i), channel(b, i), t)).toString(16).padStart(2, "0");
  return out;
}

/** Blend two poses. `fallback` supplies the avatar's base colours for expressions with none. */
export function mixPose(a: Pose, b: Pose, t: number, base: { body: string; eyes: string }): Pose {
  return {
    headX: mix(a.headX, b.headX, t),
    headY: mix(a.headY, b.headY, t),
    headZ: mix(a.headZ, b.headZ, t),
    spacing: mix(a.spacing, b.spacing, t),
    left: mixEye(a.left, b.left, t),
    right: mixEye(a.right, b.right, t),
    bodyColor: mixColor(a.bodyColor ?? base.body, b.bodyColor ?? base.body, t),
    eyeColor: mixColor(a.eyeColor ?? base.eyes, b.eyeColor ?? base.eyes, t),
  };
}

export type EaseName = BsStep["transition"];

export function ease(kind: EaseName, t: number): number {
  const x = Math.min(1, Math.max(0, t));
  switch (kind) {
    case "smooth":
      return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
    case "snappy":
      return 1 - Math.pow(1 - x, 4);
    case "spring": {
      // a gentle overshoot that settles on 1
      const c = 1.4;
      return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2);
    }
  }
}

/** The order the steps are visited in, one full pass. */
export function legOrder(anim: BsAnimation): BsStep[] {
  const steps = anim.steps;
  if (anim.playbackMode === "pingPong" && steps.length > 2) {
    return [...steps, ...steps.slice(1, -1).reverse()];
  }
  return steps;
}

export interface Spot {
  from: string;
  to: string;
  /** 0..1 progress of the move from `from` to `to`; 1 while holding */
  t: number;
  kind: EaseName;
}

/**
 * Where is the animation `elapsed` ms after it started? Each step is "move into it, then hold".
 * The first step is entered instantly on the first pass; looping animations move back into it
 * from the last step on every later pass.
 */
export function locate(anim: BsAnimation, elapsed: number): Spot {
  const legs = legOrder(anim);
  const first = legs[0]!;
  if (legs.length === 1) return { from: first.expression, to: first.expression, t: 1, kind: first.transition };

  const firstPass = legs.reduce((sum, leg, i) => sum + leg.holdMs + (i === 0 ? 0 : leg.transitionMs), 0);
  const cycle = legs.reduce((sum, leg) => sum + leg.holdMs + leg.transitionMs, 0);

  let time = elapsed;
  let skipFirstMove = true;
  if (elapsed >= firstPass) {
    if (anim.playbackMode !== "loop" && anim.playbackMode !== "pingPong") {
      const last = legs[legs.length - 1]!;
      return { from: last.expression, to: last.expression, t: 1, kind: last.transition };
    }
    time = (elapsed - firstPass) % cycle;
    skipFirstMove = false;
  }

  let previous = skipFirstMove ? first.expression : legs[legs.length - 1]!.expression;
  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i]!;
    const move = skipFirstMove && i === 0 ? 0 : leg.transitionMs;
    if (time < move) return { from: previous, to: leg.expression, t: time / move, kind: leg.transition };
    time -= move;
    if (time < leg.holdMs) return { from: leg.expression, to: leg.expression, t: 1, kind: leg.transition };
    time -= leg.holdMs;
    previous = leg.expression;
  }
  const last = legs[legs.length - 1]!;
  return { from: last.expression, to: last.expression, t: 1, kind: last.transition };
}

/** Which of the avatar's animations to play for each of Perch's states, best match first. */
export const STATE_ANIMATIONS = {
  idle: ["idle", "listening", "bored"],
  music: ["happy", "excited", "playful", "celebrate", "laughing"],
  attention: ["surprised", "scared", "curious", "angry"],
  asleep: ["sleeping", "drowsy", "bored"],
} as const;

export function pickAnimation(
  animations: Record<string, BsAnimation>,
  order: readonly string[],
  state: keyof typeof STATE_ANIMATIONS,
): string | undefined {
  for (const name of STATE_ANIMATIONS[state]) if (name in animations) return name;
  // otherwise fall back to the avatar's own first animation, so every avatar shows something
  return order.find((n) => n in animations);
}
