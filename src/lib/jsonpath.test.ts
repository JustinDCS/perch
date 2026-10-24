import { describe, expect, it } from "vitest";
import { formatValue, getPath, isValidPath, parsePath, toNumber } from "./jsonpath";

describe("parsePath", () => {
  it("parses names, nesting and indexes", () => {
    expect(parsePath("count")).toEqual(["count"]);
    expect(parsePath("data.items[0].id")).toEqual(["data", "items", 0, "id"]);
    expect(parsePath("a[1][2]")).toEqual(["a", 1, 2]);
  });

  it("rejects empty, malformed and prototype-reaching paths", () => {
    for (const bad of ["", "...", "a[", "a[x]", "a[-1]", "__proto__", "a.constructor", "a.prototype.b"]) {
      expect(parsePath(bad), bad).toBeNull();
      expect(isValidPath(bad), bad).toBe(false);
    }
  });
});

describe("getPath", () => {
  const data = { count: 7, nested: { list: [{ id: "a" }, { id: "b" }] }, name: "x" };

  it("reads values", () => {
    expect(getPath(data, "count")).toBe(7);
    expect(getPath(data, "nested.list[1].id")).toBe("b");
    expect(getPath(data, "nested.list.length")).toBe(2);
  });

  it("returns undefined for anything missing or unsafe", () => {
    expect(getPath(data, "missing")).toBeUndefined();
    expect(getPath(data, "count.deeper")).toBeUndefined();
    expect(getPath(data, "nested.list[9]")).toBeUndefined();
    expect(getPath(data, "name.length")).toBeUndefined(); // length only on arrays
    expect(getPath(data, "toString")).toBeUndefined(); // inherited, not own
    expect(getPath(data, "__proto__")).toBeUndefined();
    expect(getPath(null, "a")).toBeUndefined();
  });
});

describe("value helpers", () => {
  it("toNumber accepts numbers and numeric strings only", () => {
    expect(toNumber(5)).toBe(5);
    expect(toNumber("12.5")).toBe(12.5);
    expect(toNumber("")).toBeUndefined();
    expect(toNumber("abc")).toBeUndefined();
    expect(toNumber(NaN)).toBeUndefined();
    expect(toNumber(null)).toBeUndefined();
  });

  it("formatValue never dumps objects into the UI", () => {
    expect(formatValue("hi")).toBe("hi");
    expect(formatValue(3)).toBe("3");
    expect(formatValue(true)).toBe("true");
    expect(formatValue({ a: 1 })).toBe("—");
    expect(formatValue([1])).toBe("—");
    expect(formatValue(undefined)).toBe("—");
    expect(formatValue(null)).toBe("—");
  });
});
