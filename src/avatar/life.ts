// The "alive" layer that sits on top of an avatar's scripted poses: breathing, a gaze that
// follows the pointer and wanders when nobody is there, blinks that are never quite regular,
// and a slowly varying clock so the scripted loops never repeat in lockstep. Pure maths with an
// injectable random source, so it can be tested without a browser.

export type Rand = () => number;

function hash(i: number, seed: number): number {
  let h = Math.imul(i | 0, 374761393) + Math.imul(seed | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

/** Smooth 1D noise in [-1, 1]: the same input always gives the same output, and it never jumps. */
export function noise(t: number, seed = 0): number {
  const i = Math.floor(t);
  const f = t - i;
  const u = f * f * (3 - 2 * f);
  const a = hash(i, seed) * 2 - 1;
  const b = hash(i + 1, seed) * 2 - 1;
  return a + (b - a) * u;
}

export interface Breath {
  sx: number;
  sy: number;
}

/** Slow rise and fall of the body; `calm` stretches and deepens it for sleep. */
export function breath(seconds: number, calm = false): Breath {
  const period = calm ? 5.6 : 3.8;
  const depth = calm ? 0.034 : 0.022;
  // the period itself wanders a little, so the rhythm is not a metronome
  const phase = (seconds / period) * Math.PI * 2 + noise(seconds * 0.07, 5) * 1.2;
  const wave = (Math.sin(phase) + 1) / 2;
  return { sy: 1 + depth * wave, sx: 1 - depth * 0.45 * wave };
}

export interface BlinkConfig {
  minIntervalMs: number;
  maxIntervalMs: number;
  durationMs: number;
  initialDelayMs: number;
}

export interface BlinkPlan {
  at: number;
  durationMs: number;
}

/** Plans blinks around the avatar's own settings, with the odd double blink and slow blink. */
export class BlinkPlanner {
  private doubleNext = false;
  constructor(private readonly rand: Rand = Math.random) {}

  next(now: number, cfg: BlinkConfig, first: boolean): BlinkPlan {
    const lo = Math.min(cfg.minIntervalMs, cfg.maxIntervalMs);
    const hi = Math.max(cfg.minIntervalMs, cfg.maxIntervalMs);
    let wait: number;
    if (this.doubleNext) {
      wait = 130 + this.rand() * 130;
      this.doubleNext = false;
    } else if (first) {
      wait = cfg.initialDelayMs * (0.6 + this.rand() * 0.8);
    } else {
      // short gaps are likelier than long ones, as in real blinking
      wait = lo + (hi - lo) * Math.pow(this.rand(), 1.6);
      this.doubleNext = this.rand() < 0.16;
    }
    const slow = this.rand() < 0.07 ? 2 : 1;
    const durationMs = cfg.durationMs * slow * (0.85 + this.rand() * 0.3);
    return { at: now + wait, durationMs };
  }
}

export interface GazeOptions {
  /** 0 = eyes stay centred (asleep), 1 = full range */
  amount: number;
}

const GAZE_HALF_LIFE_MS = 110;
/** the pointer stops being interesting after this long without moving */
export const POINTER_INTEREST_MS = 6000;

/** Where the avatar is looking, as x and y in [-1, 1] (right and down are positive). */
export class Gaze {
  x = 0;
  y = 0;
  private tx = 0;
  private ty = 0;
  private pointer: { x: number; y: number } | null = null;
  private pointerAt = -Infinity;
  private wanderUntil = 0;
  private glanceAt: { x: number; y: number; until: number } | null = null;
  constructor(private readonly rand: Rand = Math.random) {}

  /** Look somewhere on purpose for `ms`, whatever the pointer is doing. */
  glance(x: number, y: number, ms: number, now: number): void {
    this.glanceAt = { x: Math.max(-1, Math.min(1, x)), y: Math.max(-1, Math.min(1, y)), until: now + ms };
  }

  /** The pointer is at (x, y) relative to the avatar, each already clamped to [-1, 1]. */
  look(x: number, y: number, now: number): void {
    this.pointer = { x: Math.max(-1, Math.min(1, x)), y: Math.max(-1, Math.min(1, y)) };
    this.pointerAt = now;
  }

  away(): void {
    this.pointer = null;
  }

  step(now: number, dtMs: number, opts: GazeOptions): { x: number; y: number } {
    const amount = Math.max(0, Math.min(1, opts.amount));
    if (this.glanceAt && now < this.glanceAt.until) {
      this.tx = this.glanceAt.x * amount;
      this.ty = this.glanceAt.y * amount;
      this.wanderUntil = this.glanceAt.until;
    } else if (this.pointer && now - this.pointerAt < POINTER_INTEREST_MS) {
      this.tx = this.pointer.x * amount;
      this.ty = this.pointer.y * amount;
      this.wanderUntil = now;
    } else if (now >= this.wanderUntil) {
      // nobody is there: look around now and then, or settle back to the middle
      const settle = this.rand() < 0.4;
      this.tx = settle ? 0 : (this.rand() * 1.4 - 0.7) * amount;
      this.ty = settle ? 0 : (this.rand() * 0.8 - 0.4) * amount;
      this.wanderUntil = now + 1500 + this.rand() * 3500;
    }
    const k = 1 - Math.pow(0.5, dtMs / GAZE_HALF_LIFE_MS);
    this.x += (this.tx - this.x) * k;
    this.y += (this.ty - this.y) * k;
    return { x: this.x, y: this.y };
  }
}

/** How strongly each state follows the pointer. */
export function interestFor(state: string): number {
  switch (state) {
    case "asleep":
      return 0;
    case "music":
      return 0.8;
    default:
      return 1;
  }
}

// ---- reactions: short, springy responses to things that happen --------------------------------

export type ReactionKind = "startle" | "squash" | "perk" | "anticipate" | "wink";

/** What the reactions add to the avatar right now. Neutral is all 1s and 0s. */
export interface Impulse {
  /** body scale */
  sx: number;
  sy: number;
  /** body lift in avatar units (negative is up) */
  dy: number;
  /** eye size multiplier, and how open each eye is (0 shut, 1 normal) */
  eyeScale: number;
  openLeft: number;
  openRight: number;
  /** extra head tilt in degrees */
  roll: number;
}

export const NEUTRAL_IMPULSE: Impulse = { sx: 1, sy: 1, dy: 0, eyeScale: 1, openLeft: 1, openRight: 1, roll: 0 };

const DURATION_S: Record<ReactionKind, number> = { startle: 0.9, squash: 1.0, perk: 0.9, anticipate: 0.95, wink: 0.55 };

/** A damped wobble that starts at 1, swings through 0 and dies away. */
export function spring(seconds: number, hertz: number, damping: number): number {
  return Math.exp(-damping * seconds) * Math.cos(seconds * hertz * Math.PI * 2);
}

function one(kind: ReactionKind, t: number): Impulse {
  const out = { ...NEUTRAL_IMPULSE };
  switch (kind) {
    case "startle": {
      // grabbed: shoots up, eyes go wide, then wobbles back
      const a = spring(t, 3.2, 6);
      out.sy = 1 + 0.14 * a;
      out.sx = 1 - 0.08 * a;
      out.eyeScale = 1 + 0.3 * a;
      out.dy = -3 * Math.max(0, a);
      break;
    }
    case "squash": {
      // dropped: lands flat, then bounces back up
      const a = spring(t, 2.6, 5.5);
      out.sy = 1 - 0.16 * a;
      out.sx = 1 + 0.12 * a;
      break;
    }
    case "perk": {
      // something nice happened: a little hop
      const a = spring(t, 3, 6);
      out.sy = 1 + 0.08 * a;
      out.eyeScale = 1 + 0.15 * a;
      out.dy = -4 * Math.max(0, 1 - Math.abs(1 - 2 * Math.min(1, t / 0.35)));
      break;
    }
    case "anticipate": {
      // trouble ahead: lean back and widen the eyes, then pop up
      const lean = t < 0.3 ? -0.07 * (t / 0.3) : -0.07 * Math.exp(-(t - 0.3) * 10);
      const pop = t < 0.3 ? 0 : 0.12 * Math.exp(-6 * (t - 0.3)) * Math.sin((t - 0.3) * 2.8 * Math.PI * 2);
      out.sy = 1 + lean + pop;
      out.sx = 1 - 0.5 * (lean + pop);
      out.eyeScale = 1 + 0.25 * Math.min(1, t / 0.3) * Math.exp(-Math.max(0, t - 0.3) * 3);
      break;
    }
    case "wink": {
      const c = t < 0.12 ? t / 0.12 : t < 0.3 ? 1 : t < 0.45 ? 1 - (t - 0.3) / 0.15 : 0;
      out.openRight = 1 - 0.92 * c;
      out.openLeft = 1 + 0.08 * c;
      out.roll = 6 * c;
      out.dy = -1 * c;
      break;
    }
  }
  return out;
}

/** Keeps the reactions that are playing and adds them up. */
export class Reactions {
  private active: { kind: ReactionKind; start: number }[] = [];

  start(kind: ReactionKind, now: number): void {
    // the same reaction restarts rather than stacking
    this.active = this.active.filter((r) => r.kind !== kind);
    this.active.push({ kind, start: now });
  }

  get busy(): boolean {
    return this.active.length > 0;
  }

  sample(now: number): Impulse {
    this.active = this.active.filter((r) => (now - r.start) / 1000 < DURATION_S[r.kind]);
    const total = { ...NEUTRAL_IMPULSE };
    for (const r of this.active) {
      const i = one(r.kind, Math.max(0, (now - r.start) / 1000));
      total.sx *= i.sx;
      total.sy *= i.sy;
      total.dy += i.dy;
      total.eyeScale = Math.max(total.eyeScale, i.eyeScale);
      total.openLeft = Math.min(total.openLeft, i.openLeft);
      total.openRight = Math.min(total.openRight, i.openRight);
      total.roll += i.roll;
    }
    return total;
  }
}

/** Milliseconds until the avatar next pokes its head out while the island is hidden. */
export function nextPeekDelay(rand: Rand = Math.random): number {
  return 40_000 + rand() * 70_000;
}
