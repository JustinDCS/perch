import { describe, expect, it } from "vitest";
import type { Chip, Tone } from "../pills/types";
import { visibleChips } from "./chips";

const chip = (text: string): Chip => ({ text });
const chips = new Map([
  ["music", chip("Song")],
  ["tickets", chip("12")],
]);
const order = ["music", "tickets", "missing"];

describe("visibleChips", () => {
  it("shows every chip, in pill order, when nothing is hidden", () => {
    expect(visibleChips(order, chips, new Map(), new Set()).map(([id]) => id)).toEqual(["music", "tickets"]);
  });
  it("leaves out a chip the user switched off", () => {
    expect(visibleChips(order, chips, new Map(), new Set(["tickets"])).map(([id]) => id)).toEqual(["music"]);
  });
  it("still shows a switched-off pill when it needs attention", () => {
    for (const tone of ["warn", "danger"] as Tone[]) {
      const ids = visibleChips(order, chips, new Map([["tickets", tone]]), new Set(["tickets"])).map(([id]) => id);
      expect(ids).toEqual(["music", "tickets"]);
    }
  });
  it("hides it again for good and neutral tones", () => {
    for (const tone of ["good", "neutral"] as Tone[]) {
      expect(visibleChips(order, chips, new Map([["tickets", tone]]), new Set(["tickets"]))).toHaveLength(1);
    }
  });
  it("ignores pills without a chip and hidden ids that do not exist", () => {
    expect(visibleChips(order, chips, new Map(), new Set(["nothing"]))).toHaveLength(2);
  });
});
