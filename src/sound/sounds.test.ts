import { describe, expect, it } from "vitest";
import { COOLDOWN_MS, Cooldowns, SOUNDS, allowedIn, loudness, plan, type SoundName } from "./sounds";

const names = Object.keys(SOUNDS) as SoundName[];

describe("sound definitions", () => {
  it.each(names)("%s is short, audible and gentle", (name) => {
    const notes = SOUNDS[name];
    expect(notes.length).toBeGreaterThan(0);
    const end = Math.max(...notes.map((n) => n.at + n.length));
    expect(end).toBeLessThan(1);
    for (const n of notes) {
      expect(n.freq).toBeGreaterThanOrEqual(80);
      expect(n.freq).toBeLessThanOrEqual(4000);
      if (n.freqEnd !== undefined) {
        expect(n.freqEnd).toBeGreaterThanOrEqual(80);
        expect(n.freqEnd).toBeLessThanOrEqual(4000);
      }
      expect(n.length).toBeGreaterThan(0.02);
      expect(n.at).toBeGreaterThanOrEqual(0);
      expect(n.gain).toBeGreaterThan(0);
      expect(n.gain).toBeLessThanOrEqual(1);
    }
  });
  it("every sound has a cooldown", () => {
    for (const name of names) expect(COOLDOWN_MS[name]).toBeGreaterThan(0);
  });
});

describe("modes", () => {
  it("off lets nothing through", () => {
    for (const name of names) expect(allowedIn("off", name)).toBe(false);
  });
  it("alerts-only lets only the alert through", () => {
    expect(names.filter((n) => allowedIn("alerts", n))).toEqual(["alert"]);
  });
  it("all lets everything through", () => {
    for (const name of names) expect(allowedIn("all", name)).toBe(true);
  });
});

describe("Cooldowns", () => {
  it("blocks a repeat inside the gap and allows it after", () => {
    const c = new Cooldowns();
    expect(c.take("alert", 0)).toBe(true);
    expect(c.take("alert", 1000)).toBe(false);
    expect(c.take("alert", COOLDOWN_MS.alert)).toBe(true);
  });
  it("tracks each sound separately", () => {
    const c = new Cooldowns();
    expect(c.take("alert", 0)).toBe(true);
    expect(c.take("open", 10)).toBe(true);
  });
});

describe("loudness and plan", () => {
  it("is silent at 0, capped at full volume, and rises smoothly", () => {
    expect(loudness(0)).toBe(0);
    expect(loudness(1)).toBe(0.5);
    expect(loudness(5)).toBe(0.5);
    expect(loudness(-1)).toBe(0);
    expect(loudness(NaN)).toBe(0);
    expect(loudness(0.5)).toBeLessThan(loudness(0.8));
  });
  it("scales every note's level by the volume", () => {
    const quiet = plan("alert", 0.2);
    const loud = plan("alert", 0.9);
    quiet.forEach((n, i) => expect(n.level).toBeLessThan(loud[i]!.level));
    expect(plan("alert", 0).every((n) => n.level === 0)).toBe(true);
  });
});
