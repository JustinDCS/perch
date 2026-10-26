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
