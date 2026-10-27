import { describe, expect, it } from "vitest";
import { validateAnyAvatar } from "../any";
import { ease, locate, mixColor, pickAnimation } from "./pose";
import { type BsAnimation, validateBibleStrongAvatar } from "./schema";

const eye = { width: 20, height: 50, x: 0, y: 0, angle: 0 };
const expr = (extra: object = {}) => ({
  head: { x: 0, y: 0, z: 0 },
  eyes: { left: eye, right: eye, spacing: 35 },
  perspective: 1,
  motion: { eyes: "none", body: "none" },
  ...extra,
});
const blink = { enabled: true, initialDelayMs: 1000, minIntervalMs: 2000, maxIntervalMs: 4000, durationMs: 200 };

function sample(): Record<string, unknown> {
  return {
    schema: "bible-strong/avatar-definition",
    schemaVersion: 1,
    name: "Test",
    body: { primary: { type: "sphere", width: 240, height: 240, depth: 240, roundness: 1 }, nodes: [] },
    colors: { body: "#5b7fe5", eyes: "#111316" },
    expressions: { neutral: expr(), glad: expr({ colors: { body: "#ba3636" } }) },
    expressionOrder: ["neutral", "glad"],
    animations: {
      idle: { playbackMode: "loop", steps: [{ expression: "neutral", holdMs: 1000, transitionMs: 500, transition: "smooth" }], blink },
      happy: {
        playbackMode: "loop",
        steps: [
          { expression: "neutral", holdMs: 1000, transitionMs: 500, transition: "smooth" },
          { expression: "glad", holdMs: 2000, transitionMs: 400, transition: "snappy" },
        ],
        blink,
      },
    },
    animationOrder: ["idle", "happy"],
  };
}

describe("Bible Strong avatar validation", () => {
  it("accepts a well-formed avatar", () => {
    const result = validateBibleStrongAvatar(sample());
    expect(result.ok ? [] : result.errors).toEqual([]);
  });

  it("is picked automatically by the schema marker", () => {
    const result = validateAnyAvatar(sample());
    expect(result.ok && result.value.kind).toBe("bible-strong");
  });

  it("rejects unknown fields, bad colours and bad ranges", () => {
    const bad = sample();
    (bad as any).colors.body = "red";
    (bad as any).surprise = true;
    (bad as any).body.primary.roundness = 9;
    const result = validateBibleStrongAvatar(bad);
    expect(result.ok).toBe(false);
    const text = result.ok ? "" : result.errors.join("\n");
    expect(text).toContain("colors.body");
    expect(text).toContain("surprise: unknown field");
    expect(text).toContain("body.primary.roundness");
  });

  it("needs a neutral expression and known expressions in steps", () => {
    const noNeutral = sample();
    delete (noNeutral as any).expressions.neutral;
    expect(validateBibleStrongAvatar(noNeutral).ok).toBe(false);

    const dangling = sample();
    (dangling as any).animations.idle.steps[0].expression = "missing";
    const result = validateBibleStrongAvatar(dangling);
    expect(result.ok ? "" : result.errors.join("\n")).toContain("not defined in expressions");
  });

  it("rejects odd expression names such as __proto__", () => {
    const bad = sample();
    (bad as any).expressions = JSON.parse('{"neutral": ' + JSON.stringify(expr()) + ', "__proto__": {}}');
    expect(validateBibleStrongAvatar(bad).ok).toBe(false);
  });

  it("still validates Perch's own format", () => {
    const result = validateAnyAvatar({ nope: 1 });
    expect(result.ok).toBe(false);
  });
});

describe("playback maths", () => {
  const anim = (sample().animations as Record<string, BsAnimation>)["happy"]!;

  it("holds the first step, moves, holds the second, then loops back", () => {
    expect(locate(anim, 0)).toMatchObject({ from: "neutral", to: "neutral", t: 1 });
    expect(locate(anim, 1000 + 200)).toMatchObject({ from: "neutral", to: "glad" });
    expect(locate(anim, 1000 + 200).t).toBeCloseTo(0.5);
    expect(locate(anim, 1000 + 400 + 500)).toMatchObject({ from: "glad", to: "glad", t: 1 });
    // after the first pass (3400ms) the loop moves back into the first step
    expect(locate(anim, 3400 + 100)).toMatchObject({ from: "glad", to: "neutral" });
    expect(locate(anim, 3400 + 500 + 100)).toMatchObject({ from: "neutral", to: "neutral" });
  });

  it("'once' animations stay on the last step", () => {
    const once = { ...anim, playbackMode: "once" as const };
    expect(locate(once, 999999)).toMatchObject({ from: "glad", to: "glad", t: 1 });
  });

  it("easing starts at 0 and settles at 1", () => {
    for (const kind of ["smooth", "snappy", "spring"] as const) {
      expect(ease(kind, 0)).toBeCloseTo(0);
      expect(ease(kind, 1)).toBeCloseTo(1);
    }
  });

  it("mixes colours", () => {
    expect(mixColor("#000000", "#ffffff", 0.5)).toBe("#808080");
  });

  it("maps Perch states to the avatar's animations, with a fallback", () => {
    const animations = sample().animations as Record<string, BsAnimation>;
    expect(pickAnimation(animations, ["idle", "happy"], "idle")).toBe("idle");
    expect(pickAnimation(animations, ["idle", "happy"], "music")).toBe("happy");
    expect(pickAnimation(animations, ["idle", "happy"], "attention")).toBe("idle");
  });
});

import { DEFAULT_AVATAR_DEFINITION, DEFAULT_BS_AVATAR } from "./defaultAvatar";
import { pickAnimations } from "./pose";

describe("built-in avatar", () => {
  it("is a valid Bible Strong definition with an animation for every Perch state", () => {
    const result = validateBibleStrongAvatar(JSON.parse(JSON.stringify(DEFAULT_AVATAR_DEFINITION)));
    expect(result.ok ? [] : result.errors).toEqual([]);
    for (const state of ["idle", "music", "attention", "asleep"] as const) {
      expect(pickAnimation(DEFAULT_BS_AVATAR.animations, DEFAULT_BS_AVATAR.animationOrder, state)).toBeDefined();
    }
    expect(pickAnimation(DEFAULT_BS_AVATAR.animations, DEFAULT_BS_AVATAR.animationOrder, "asleep")).toBe("sleeping");
  });

  it("has several different dances for music, each using expressions that exist", () => {
    const dances = pickAnimations(DEFAULT_BS_AVATAR.animations, DEFAULT_BS_AVATAR.animationOrder, "music");
    expect(dances.length).toBeGreaterThanOrEqual(4);
    for (const name of dances) {
      for (const step of DEFAULT_BS_AVATAR.animations[name]!.steps) expect(DEFAULT_BS_AVATAR.expressions).toHaveProperty(step.expression);
    }
  });

  it("falls back to the first animation for avatars without dances", () => {
    const animations = sample().animations as Record<string, BsAnimation>;
    expect(pickAnimations(animations, ["idle", "happy"], "music")).toEqual(["happy"]);
    expect(pickAnimations({}, [], "music")).toEqual([]);
  });
});
