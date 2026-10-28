import { describe, expect, it } from "vitest";
import { MOVES, SEASONS, seasonOn, useSeasonMove } from "./seasons";

const on = (y: number, m: number, d: number) => seasonOn(new Date(y, m - 1, d));

describe("seasonOn", () => {
  it("finds each season and its edges", () => {
    expect(on(2026, 12, 31)).toBe("newyear");
    expect(on(2027, 1, 1)).toBe("newyear");
    expect(on(2027, 1, 2)).toBe("newyear");
    expect(on(2027, 1, 3)).toBeUndefined();
    expect(on(2026, 10, 23)).toBeUndefined();
    expect(on(2026, 10, 24)).toBe("halloween");
    expect(on(2026, 11, 1)).toBe("halloween");
    expect(on(2026, 11, 2)).toBeUndefined();
    expect(on(2027, 2, 11)).toBeUndefined();
    expect(on(2027, 2, 12)).toBe("valentines");
    expect(on(2027, 2, 14)).toBe("valentines");
    expect(on(2027, 2, 15)).toBeUndefined();
    expect(on(2026, 12, 14)).toBeUndefined();
    expect(on(2026, 12, 15)).toBe("christmas");
    expect(on(2026, 12, 26)).toBe("christmas");
    expect(on(2026, 12, 27)).toBeUndefined();
  });
  it("is quiet for the rest of the year", () => {
    expect(on(2026, 7, 4)).toBeUndefined();
  });
});

describe("moves", () => {
  it("has a move for every season, in order, within its own length", () => {
    for (const s of SEASONS) {
      const m = MOVES[s.id];
      expect(m.ms).toBeGreaterThan(1000);
      for (const [, from, to] of m.parts) {
        expect(from).toBeGreaterThanOrEqual(0);
        expect(to).toBeLessThanOrEqual(1);
        expect(to).toBeGreaterThan(from);
      }
      const times = m.body.map(([t]) => t);
      expect([...times].sort((a, b) => a - b)).toEqual(times);
    }
  });
  it("plays on about one peek in three", () => {
    expect(useSeasonMove(() => 0.1)).toBe(true);
    expect(useSeasonMove(() => 0.4)).toBe(false);
  });
});
