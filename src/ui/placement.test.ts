import { describe, expect, it } from "vitest";
import { fracForCentre, monitorAt, monitorKey, parsePlacement, resolvePlacement, windowOrigin, type MonitorBox } from "./placement";

const box = (x: number, y: number, width: number, height: number, scale = 1): MonitorBox => ({ x, y, width, height, scale, key: monitorKey(x, y) });
const left = box(-1920, 0, 1920, 1080);
const main = box(0, 0, 2560, 1440, 1.5);

describe("windowOrigin", () => {
  it("centres on the fraction and sits on the monitor's top edge", () => {
    expect(windowOrigin(main, 0.5, 400)).toEqual({ x: 1080, y: 0 });
  });
  it("works on a monitor to the left of the main one", () => {
    expect(windowOrigin(left, 0.5, 400)).toEqual({ x: -1160, y: 0 });
  });
  it("never sticks out of either side", () => {
    expect(windowOrigin(main, 0, 400).x).toBe(0);
    expect(windowOrigin(main, 1, 400).x).toBe(2160);
  });
  it("uses a taskbar-adjusted top", () => {
    expect(windowOrigin(box(0, 48, 1000, 700), 0.5, 100).y).toBe(48);
  });
});

describe("fracForCentre", () => {
  it("round-trips with windowOrigin", () => {
    const frac = fracForCentre(left, -1000);
    expect(windowOrigin(left, frac, 200).x + 100).toBe(-1000);
  });
  it("clamps off-screen centres", () => {
    expect(fracForCentre(main, -50)).toBe(0);
    expect(fracForCentre(main, 99999)).toBe(1);
  });
});

describe("monitorAt", () => {
  it("finds the monitor that contains the point", () => {
    expect(monitorAt([left, main], -10, 500)).toBe(left);
    expect(monitorAt([left, main], 10, 500)).toBe(main);
  });
  it("picks the nearest one for a point outside every monitor", () => {
    expect(monitorAt([left, main], 3000, 500)).toBe(main);
    expect(monitorAt([left, main], -4000, -20)).toBe(left);
  });
  it("returns undefined with no monitors", () => {
    expect(monitorAt([], 0, 0)).toBeUndefined();
  });
});

describe("resolvePlacement", () => {
  it("uses the saved monitor and position when it is still connected", () => {
    expect(resolvePlacement({ monitor: left.key, xFrac: 0.2 }, [left, main], main)).toEqual({ monitor: left, xFrac: 0.2 });
  });
  it("falls back to the fallback monitor, centred, when the saved one is gone", () => {
    expect(resolvePlacement({ monitor: "5000,0", xFrac: 0.9 }, [left, main], main)).toEqual({ monitor: main, xFrac: 0.5 });
  });
  it("falls back when nothing was saved", () => {
    expect(resolvePlacement(null, [main], undefined)).toEqual({ monitor: main, xFrac: 0.5 });
    expect(resolvePlacement(null, [], undefined)).toBeNull();
  });
});

describe("parsePlacement", () => {
  it("accepts a good value and clamps the fraction", () => {
    expect(parsePlacement({ monitor: "-1920,0", xFrac: 1.4 })).toEqual({ monitor: "-1920,0", xFrac: 1 });
  });
  it.each([null, 3, "x", {}, { monitor: 3, xFrac: 0.5 }, { monitor: "a,b", xFrac: 0.5 }, { monitor: "0,0", xFrac: NaN }])("rejects %j", (raw) => {
    expect(parsePlacement(raw)).toBeNull();
  });
});
