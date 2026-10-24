// Perch's own avatar format. It is a small, declarative description of a face:
// a body shape, eyes and a mouth, plus how they look in each state. There is no code,
// no SVG markup and no external reference in it, so loading an avatar file cannot run anything.

import {
  type Errs,
  type Result,
  fail,
  has,
  hexColor,
  isRecord,
  noUnknownKeys,
  num,
  ok,
  oneOf,
  str,
} from "../lib/validate";

export const STATE_NAMES = ["idle", "attention", "music"] as const;
export type AvatarStateName = (typeof STATE_NAMES)[number];

export const ANIMATIONS = ["none", "breathe", "bounce", "wiggle", "pulse"] as const;
export type AnimationName = (typeof ANIMATIONS)[number];

export const SHAPES = ["squircle", "circle", "pill"] as const;
export type BodyShape = (typeof SHAPES)[number];

export interface AvatarState {
  /** 0 = closed, 1 = normal, up to 1.4 = wide open */
  eyeOpen: number;
  eyeOffsetX: number;
  eyeOffsetY: number;
  /** -1 = frown, 0 = flat, 1 = big smile */
  mouth: number;
  bodyColor?: string;
  animation: AnimationName;
  /** animation speed multiplier */
  speed: number;
}

export interface Avatar {
  perchAvatar: 1;
  name: string;
  body: { shape: BodyShape; width: number; height: number; color: string };
  eyes: { color: string; size: number; spacing: number; y: number; blinkSeconds: [number, number] };
  mouth: { color: string; width: number; y: number };
  states: Record<AvatarStateName, AvatarState>;
}

const STATE_KEYS = ["eyeOpen", "eyeOffsetX", "eyeOffsetY", "mouth", "bodyColor", "animation", "speed"];

function validateState(raw: unknown, path: string, errs: Errs, base: AvatarState): AvatarState {
  if (!isRecord(raw)) {
    errs.push(`${path}: must be an object`);
    return base;
  }
  noUnknownKeys(raw, STATE_KEYS, path, errs);
  const state: AvatarState = { ...base };
  if (has(raw, "eyeOpen")) state.eyeOpen = num(raw.eyeOpen, `${path}.eyeOpen`, errs, { min: 0, max: 1.4 }) ?? base.eyeOpen;
  if (has(raw, "eyeOffsetX")) state.eyeOffsetX = num(raw.eyeOffsetX, `${path}.eyeOffsetX`, errs, { min: -6, max: 6 }) ?? base.eyeOffsetX;
  if (has(raw, "eyeOffsetY")) state.eyeOffsetY = num(raw.eyeOffsetY, `${path}.eyeOffsetY`, errs, { min: -6, max: 6 }) ?? base.eyeOffsetY;
  if (has(raw, "mouth")) state.mouth = num(raw.mouth, `${path}.mouth`, errs, { min: -1, max: 1 }) ?? base.mouth;
  if (has(raw, "bodyColor")) state.bodyColor = hexColor(raw.bodyColor, `${path}.bodyColor`, errs);
  if (has(raw, "animation")) state.animation = oneOf(raw.animation, `${path}.animation`, errs, ANIMATIONS) ?? base.animation;
  if (has(raw, "speed")) state.speed = num(raw.speed, `${path}.speed`, errs, { min: 0.25, max: 4 }) ?? base.speed;
  return state;
}

const NEUTRAL_STATE: AvatarState = {
  eyeOpen: 1,
  eyeOffsetX: 0,
  eyeOffsetY: 0,
  mouth: 0.2,
  animation: "none",
  speed: 1,
};

/** Validate a parsed avatar file. `attention` and `music` fall back to `idle` when omitted. */
export function validateAvatar(raw: unknown): Result<Avatar> {
  if (!isRecord(raw)) return fail("avatar must be a JSON object");
  const errs: Errs = [];
  noUnknownKeys(raw, ["perchAvatar", "name", "body", "eyes", "mouth", "states"], "", errs);

  if (raw.perchAvatar !== 1) errs.push("perchAvatar: must be 1 (the avatar format version)");
  const name = str(raw.name, "name", errs, { max: 40 });

  // body
  let body: Avatar["body"] | undefined;
  if (!isRecord(raw.body)) errs.push("body: must be an object");
  else {
    noUnknownKeys(raw.body, ["shape", "width", "height", "color"], "body", errs);
    const shape = oneOf(raw.body.shape, "body.shape", errs, SHAPES);
    const width = num(raw.body.width, "body.width", errs, { min: 40, max: 92 });
    const height = num(raw.body.height, "body.height", errs, { min: 40, max: 92 });
    const color = hexColor(raw.body.color, "body.color", errs);
    if (shape && width !== undefined && height !== undefined && color) body = { shape, width, height, color };
  }

  // eyes
  let eyes: Avatar["eyes"] | undefined;
  if (!isRecord(raw.eyes)) errs.push("eyes: must be an object");
  else {
    noUnknownKeys(raw.eyes, ["color", "size", "spacing", "y", "blinkSeconds"], "eyes", errs);
    const color = hexColor(raw.eyes.color, "eyes.color", errs);
    const size = num(raw.eyes.size, "eyes.size", errs, { min: 4, max: 24 });
    const spacing = num(raw.eyes.spacing, "eyes.spacing", errs, { min: 8, max: 60 });
    const y = num(raw.eyes.y, "eyes.y", errs, { min: 20, max: 80 });
    let blink: [number, number] = [3, 6];
    if (has(raw.eyes, "blinkSeconds")) {
      const b = raw.eyes.blinkSeconds;
      if (Array.isArray(b) && b.length === 2) {
        const lo = num(b[0], "eyes.blinkSeconds[0]", errs, { min: 1, max: 30 });
        const hi = num(b[1], "eyes.blinkSeconds[1]", errs, { min: 1, max: 30 });
        if (lo !== undefined && hi !== undefined) {
          if (lo > hi) errs.push("eyes.blinkSeconds: first value must not be larger than the second");
          else blink = [lo, hi];
        }
      } else errs.push("eyes.blinkSeconds: must be [min, max] in seconds");
    }
    if (color && size !== undefined && spacing !== undefined && y !== undefined) {
      eyes = { color, size, spacing, y, blinkSeconds: blink };
    }
  }

  // mouth
  let mouth: Avatar["mouth"] | undefined;
  if (!isRecord(raw.mouth)) errs.push("mouth: must be an object");
  else {
    noUnknownKeys(raw.mouth, ["color", "width", "y"], "mouth", errs);
    const color = hexColor(raw.mouth.color, "mouth.color", errs);
    const width = num(raw.mouth.width, "mouth.width", errs, { min: 4, max: 30 });
    const y = num(raw.mouth.y, "mouth.y", errs, { min: 30, max: 90 });
    if (color && width !== undefined && y !== undefined) mouth = { color, width, y };
  }

  // states
  let states: Avatar["states"] | undefined;
  if (!isRecord(raw.states)) errs.push("states: must be an object with at least an idle state");
  else {
    noUnknownKeys(raw.states, STATE_NAMES, "states", errs);
    if (!has(raw.states, "idle")) errs.push("states.idle: is required");
    else {
      const idle = validateState(raw.states.idle, "states.idle", errs, NEUTRAL_STATE);
      states = {
        idle,
        attention: has(raw.states, "attention")
          ? validateState(raw.states.attention, "states.attention", errs, idle)
          : idle,
        music: has(raw.states, "music") ? validateState(raw.states.music, "states.music", errs, idle) : idle,
      };
    }
  }

  if (errs.length > 0 || !name || !body || !eyes || !mouth || !states) return fail(...errs);
  return ok({ perchAvatar: 1, name, body, eyes, mouth, states });
}
