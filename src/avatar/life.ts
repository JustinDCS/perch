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
  constructor(private readonly rand: Rand = Math.random) {}

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
    if (this.pointer && now - this.pointerAt < POINTER_INTEREST_MS) {
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
