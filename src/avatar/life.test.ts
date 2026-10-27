import { describe, expect, it } from "vitest";
import { BlinkPlanner, Gaze, POINTER_INTEREST_MS, breath, interestFor, noise } from "./life";

function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("noise", () => {
  it("is deterministic and bounded", () => {
    for (let t = -50; t < 50; t += 0.37) {
      expect(noise(t, 3)).toBe(noise(t, 3));
      expect(Math.abs(noise(t, 3))).toBeLessThanOrEqual(1);
    }
  });
  it("is continuous", () => {
    let prev = noise(0, 1);
    for (let t = 0.01; t < 20; t += 0.01) {
      const v = noise(t, 1);
      expect(Math.abs(v - prev)).toBeLessThan(0.1);
      prev = v;
    }
  });
});

describe("breath", () => {
  it("stays within a couple of percent and never flips", () => {
    for (let s = 0; s < 60; s += 0.1) {
      const b = breath(s);
      expect(b.sy).toBeGreaterThanOrEqual(1);
      expect(b.sy).toBeLessThan(1.03);
      expect(b.sx).toBeLessThanOrEqual(1);
      expect(b.sx).toBeGreaterThan(0.98);
    }
  });
  it("is deeper when calm", () => {
    const max = (calm: boolean) => Math.max(...Array.from({ length: 600 }, (_, i) => breath(i / 10, calm).sy));
    expect(max(true)).toBeGreaterThan(max(false));
  });
});

describe("BlinkPlanner", () => {
  const cfg = { minIntervalMs: 2000, maxIntervalMs: 6000, durationMs: 140, initialDelayMs: 1000 };
  it("keeps normal blinks inside the avatar's own interval", () => {
    const planner = new BlinkPlanner(seeded(1));
    let now = 0;
    let normal = 0;
    for (let i = 0; i < 400; i++) {
      const plan = planner.next(now, cfg, false);
      const wait = plan.at - now;
      if (wait >= 2000) {
        expect(wait).toBeLessThanOrEqual(6000);
        normal++;
      } else {
        // a quick second blink of a double
        expect(wait).toBeGreaterThanOrEqual(130);
        expect(wait).toBeLessThan(260);
      }
      now = plan.at + plan.durationMs;
    }
    expect(normal).toBeGreaterThan(250);
  });
  it("sometimes double-blinks and sometimes blinks slowly, but not usually", () => {
    const planner = new BlinkPlanner(seeded(7));
    let now = 0;
    let doubles = 0;
    let slow = 0;
    for (let i = 0; i < 1000; i++) {
      const plan = planner.next(now, cfg, false);
      if (plan.at - now < 300) doubles++;
      if (plan.durationMs > cfg.durationMs * 1.5) slow++;
      now = plan.at + plan.durationMs;
    }
    expect(doubles).toBeGreaterThan(60);
    expect(doubles).toBeLessThan(260);
    expect(slow).toBeGreaterThan(20);
    expect(slow).toBeLessThan(160);
  });
  it("varies the delay of the first blink", () => {
    const delays = new Set(Array.from({ length: 20 }, (_, i) => new BlinkPlanner(seeded(i)).next(0, cfg, true).at));
    expect(delays.size).toBeGreaterThan(10);
  });
});

describe("Gaze", () => {
  function run(gaze: Gaze, from: number, ms: number, amount = 1): void {
    for (let t = from; t < from + ms; t += 16) gaze.step(t, 16, { amount });
  }
  it("turns towards the pointer and settles there", () => {
    const gaze = new Gaze(seeded(2));
    gaze.look(0.9, -0.5, 0);
    run(gaze, 0, 1000);
    expect(gaze.x).toBeGreaterThan(0.85);
    expect(gaze.y).toBeLessThan(-0.45);
  });
  it("never leaves [-1, 1] and clamps wild input", () => {
    const gaze = new Gaze(seeded(3));
    gaze.look(50, -50, 0);
    run(gaze, 0, 2000);
    expect(Math.abs(gaze.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(gaze.y)).toBeLessThanOrEqual(1);
  });
  it("loses interest in a pointer that stopped moving, then wanders", () => {
    const gaze = new Gaze(seeded(4));
    gaze.look(1, 0, 0);
    run(gaze, 0, POINTER_INTEREST_MS - 100);
    expect(gaze.x).toBeGreaterThan(0.9);
    run(gaze, POINTER_INTEREST_MS, 30000);
    const seen = new Set<number>();
    for (let t = 40000; t < 70000; t += 16) {
      gaze.step(t, 16, { amount: 1 });
      seen.add(Math.round(gaze.x * 4));
    }
    expect(seen.size).toBeGreaterThan(3);
  });
  it("keeps the eyes centred when amount is zero (asleep)", () => {
    const gaze = new Gaze(seeded(5));
    gaze.look(1, 1, 0);
    run(gaze, 0, 2000, 0);
    expect(gaze.x).toBeCloseTo(0, 2);
    expect(gaze.y).toBeCloseTo(0, 2);
  });
  it("lets go when told the pointer is away", () => {
    const gaze = new Gaze(seeded(6));
    gaze.look(1, 0, 0);
    gaze.away();
    run(gaze, 0, 20000);
    expect(Math.abs(gaze.x)).toBeLessThanOrEqual(0.7 + 1e-6);
  });
});

describe("interestFor", () => {
  it("ignores the pointer when asleep", () => {
    expect(interestFor("asleep")).toBe(0);
    expect(interestFor("idle")).toBe(1);
  });
});

import { NEUTRAL_IMPULSE, Reactions, nextPeekDelay, spring } from "./life";

describe("spring", () => {
  it("starts at 1 and dies away", () => {
    expect(spring(0, 3, 6)).toBe(1);
    expect(Math.abs(spring(2, 3, 6))).toBeLessThan(0.001);
  });
});

describe("Reactions", () => {
  it("is neutral when nothing is playing", () => {
    expect(new Reactions().sample(1000)).toEqual(NEUTRAL_IMPULSE);
  });
  it.each(["startle", "squash", "perk", "anticipate", "wink"] as const)("%s finishes and returns to neutral", (kind) => {
    const r = new Reactions();
    r.start(kind, 0);
    expect(r.busy).toBe(true);
    expect(r.sample(5000)).toEqual(NEUTRAL_IMPULSE);
    expect(r.busy).toBe(false);
  });
  it.each(["startle", "squash", "perk", "anticipate", "wink"] as const)("%s stays within sane bounds the whole way", (kind) => {
    const r = new Reactions();
    r.start(kind, 0);
    for (let t = 0; t < 1100; t += 8) {
      const i = r.sample(t);
      expect(i.sy).toBeGreaterThan(0.8);
      expect(i.sy).toBeLessThan(1.25);
      expect(i.sx).toBeGreaterThan(0.85);
      expect(i.sx).toBeLessThan(1.2);
      expect(i.eyeScale).toBeGreaterThanOrEqual(1);
      expect(i.eyeScale).toBeLessThan(1.4);
      expect(i.openLeft).toBeGreaterThan(0);
      expect(i.openRight).toBeGreaterThan(0);
      expect(Math.abs(i.dy)).toBeLessThanOrEqual(4.01);
      expect(Math.abs(i.roll)).toBeLessThanOrEqual(6.01);
    }
  });
  it("squash starts flat and stretch starts tall", () => {
    const a = new Reactions();
    a.start("squash", 0);
    expect(a.sample(1).sy).toBeLessThan(0.9);
    const b = new Reactions();
    b.start("startle", 0);
    expect(b.sample(1).sy).toBeGreaterThan(1.1);
  });
  it("a wink shuts one eye and leaves the other open", () => {
    const r = new Reactions();
    r.start("wink", 0);
    const i = r.sample(200);
    expect(i.openRight).toBeLessThan(0.2);
    expect(i.openLeft).toBeGreaterThanOrEqual(1);
  });
  it("restarting a reaction does not stack it", () => {
    const r = new Reactions();
    r.start("squash", 0);
    r.start("squash", 400);
    const i = r.sample(401);
    expect(i.sy).toBeGreaterThan(0.8);
  });
  it("combines different reactions", () => {
    const r = new Reactions();
    r.start("wink", 0);
    r.start("perk", 0);
    const i = r.sample(200);
    expect(i.openRight).toBeLessThan(0.2);
    expect(i.eyeScale).toBeGreaterThanOrEqual(1);
  });
});

describe("Gaze.glance", () => {
  it("looks where told for a moment, over the pointer, then lets go", () => {
    const gaze = new Gaze(seeded(9));
    gaze.look(-1, 0, 0);
    gaze.glance(1, 0, 800, 0);
    for (let t = 0; t < 700; t += 16) gaze.step(t, 16, { amount: 1 });
    expect(gaze.x).toBeGreaterThan(0.8);
    for (let t = 800; t < 2500; t += 16) gaze.step(t, 16, { amount: 1 });
    expect(gaze.x).toBeLessThan(-0.8); // back to the pointer
  });
  it("is ignored while asleep", () => {
    const gaze = new Gaze(seeded(10));
    gaze.glance(1, 0, 800, 0);
    for (let t = 0; t < 700; t += 16) gaze.step(t, 16, { amount: 0 });
    expect(gaze.x).toBeCloseTo(0, 2);
  });
});

describe("nextPeekDelay", () => {
  it("is between 40 and 110 seconds", () => {
    expect(nextPeekDelay(() => 0)).toBe(40_000);
    expect(nextPeekDelay(() => 0.999999)).toBeLessThan(110_000);
  });
});

import { groove, nextDanceDelay, pickNext } from "./life";

describe("groove", () => {
  it("stays small and bounded, and keeps moving", () => {
    let lowest = 0;
    let highest = -9;
    for (let s = 0; s < 120; s += 0.05) {
      const g = groove(s);
      expect(g.dy).toBeLessThanOrEqual(0);
      expect(g.dy).toBeGreaterThanOrEqual(-1.61);
      expect(Math.abs(g.roll)).toBeLessThanOrEqual(3.21);
      expect(g.sy).toBeGreaterThanOrEqual(1);
      expect(g.sy).toBeLessThanOrEqual(1.026);
      expect(g.sx).toBeLessThanOrEqual(1);
      lowest = Math.min(lowest, g.dy);
      highest = Math.max(highest, g.roll);
    }
    expect(lowest).toBeLessThan(-1.4);
    expect(highest).toBeGreaterThan(2);
  });
});

describe("pickNext", () => {
  it("never repeats the current dance when there is another", () => {
    const rand = seeded(11);
    let current: string | undefined = "a";
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const next = pickNext(["a", "b", "c", "d"], current, rand);
      expect(next).not.toBe(current);
      seen.add(next!);
      current = next;
    }
    expect(seen.size).toBe(4);
  });
  it("copes with a pool of one and an empty pool", () => {
    expect(pickNext(["a"], "a")).toBe("a");
    expect(pickNext([], undefined)).toBeUndefined();
  });
});

describe("nextDanceDelay", () => {
  it("is between 7 and 16 seconds", () => {
    expect(nextDanceDelay(() => 0)).toBe(7000);
    expect(nextDanceDelay(() => 0.9999)).toBeLessThan(16000);
  });
});
