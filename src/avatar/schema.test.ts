import { describe, expect, it } from "vitest";
import { DEFAULT_AVATAR } from "./default";
import { mouthPath } from "./renderer";
import { validateAvatar } from "./schema";

const minimal = () => ({
  perchAvatar: 1,
  name: "Test",
  body: { shape: "circle", width: 60, height: 60, color: "#112233" },
  eyes: { color: "#ffffff", size: 8, spacing: 20, y: 45 },
  mouth: { color: "#ffffff", width: 10, y: 60 },
  states: { idle: { mouth: 0.5 } },
});

function errorsOf(raw: unknown): string[] {
  const result = validateAvatar(raw);
  if (result.ok) throw new Error("expected validation to fail");
  return result.errors;
}

describe("validateAvatar", () => {
  it("the built-in avatar passes its own validator unchanged", () => {
    const result = validateAvatar(JSON.parse(JSON.stringify(DEFAULT_AVATAR)));
    expect(result).toEqual({ ok: true, value: DEFAULT_AVATAR });
  });

  it("fills in missing states from idle", () => {
    const result = validateAvatar(minimal());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.states.attention).toEqual(result.value.states.idle);
      expect(result.value.states.music).toEqual(result.value.states.idle);
      expect(result.value.states.idle.mouth).toBe(0.5);
      expect(result.value.eyes.blinkSeconds).toEqual([3, 6]);
    }
  });

  it("requires an idle state", () => {
    const raw = minimal() as Record<string, unknown>;
    raw.states = {};
    expect(errorsOf(raw)).toContain("states.idle: is required");
  });

  it("only accepts #rrggbb colors, so nothing can smuggle in CSS or markup", () => {
    for (const color of ["red", "url(javascript:alert(1))", "#fff", "#12345g", '"><script>']) {
      const raw = minimal();
      raw.body.color = color;
      expect(errorsOf(raw).join(), color).toContain("body.color");
    }
  });

  it("rejects unknown fields and out-of-range numbers", () => {
    expect(errorsOf({ ...minimal(), onload: "x" })).toContain("onload: unknown field");

    const tooBig = minimal();
    tooBig.body.width = 500;
    expect(errorsOf(tooBig).join()).toContain("body.width");

    const badState = minimal() as Record<string, unknown>;
    badState.states = { idle: { mouth: 9, animation: "spin" } };
    const errs = errorsOf(badState).join();
    expect(errs).toContain("states.idle.mouth");
    expect(errs).toContain("states.idle.animation");
  });

  it("validates blinkSeconds", () => {
    const raw = minimal() as Record<string, unknown>;
    raw.eyes = { ...(raw.eyes as object), blinkSeconds: [8, 2] };
    expect(errorsOf(raw).join()).toContain("blinkSeconds");
    raw.eyes = { ...(raw.eyes as object), blinkSeconds: [1] };
    expect(errorsOf(raw).join()).toContain("blinkSeconds");
  });

  it("rejects non-objects", () => {
    expect(errorsOf(null)).toEqual(["avatar must be a JSON object"]);
    expect(errorsOf([])).toEqual(["avatar must be a JSON object"]);
  });
});

describe("mouthPath", () => {
  it("builds a quadratic curve: smile dips below the line, frown above", () => {
    expect(mouthPath(20, 60, 0)).toBe("M 40 60 Q 50 60 60 60");
    expect(mouthPath(20, 60, 1)).toBe("M 40 60 Q 50 69 60 60");
    expect(mouthPath(20, 60, -1)).toBe("M 40 60 Q 50 51 60 60");
  });
});
