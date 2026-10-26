import { describe, expect, it } from "vitest";
import { formatValue, getPath, isValidPath, missingHoles, parsePath, toNumber } from "./jsonpath";

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

import { isTemplate, isValidTemplate, renderTemplate, textOf } from "./jsonpath";

describe("templates", () => {
  const issue = { key: "DD-107", fields: { summary: "Perch companion", status: { name: "In Progress" }, votes: 3 } };

  it("tells templates from plain paths", () => {
    expect(isTemplate("{key}")).toBe(true);
    expect(isTemplate("fields.summary")).toBe(false);
  });
  it("fills the holes", () => {
    expect(renderTemplate("{key} {fields.summary}", issue)).toBe("DD-107 Perch companion");
    expect(renderTemplate("https://x.test/browse/{key}", issue)).toBe("https://x.test/browse/DD-107");
    expect(renderTemplate("{fields.votes} votes", issue)).toBe("3 votes");
  });
  it("shows a dash for missing values, never undefined or [object Object]", () => {
    expect(renderTemplate("{nope} / {fields.status}", issue)).toBe("— / —");
  });
  it("textOf handles both forms", () => {
    expect(textOf(issue, "fields.summary")).toBe("Perch companion");
    expect(textOf(issue, "{key}: {fields.status.name}")).toBe("DD-107: In Progress");
  });
  it("validates braces and paths", () => {
    expect(isValidTemplate("{key} - {fields.summary}")).toBe(true);
    expect(isValidTemplate("no holes at all")).toBe(true);
    expect(isValidTemplate("{key")).toBe(false);
    expect(isValidTemplate("key}")).toBe(false);
    expect(isValidTemplate("{ke{y}}")).toBe(false);
    expect(isValidTemplate("{__proto__}")).toBe(false);
    expect(isValidTemplate("{}")).toBe(false);
  });
  it("cannot reach inherited or blocked properties through a template", () => {
    expect(renderTemplate("{constructor.name}", issue)).toBe("—");
    expect(renderTemplate("{toString}", issue)).toBe("—");
  });
});

import { previewJson } from "./jsonpath";

describe("previewJson", () => {
  it("shows small responses whole", () => {
    expect(previewJson({ count: 0 })).toBe('{"count":0}');
  });
  it("cuts long ones and says how long they were", () => {
    const text = previewJson({ list: "x".repeat(1000) }, 50);
    expect(text.startsWith('{"list":"xxxx')).toBe(true);
    expect(text).toContain("characters)");
    expect(text.length).toBeLessThan(120);
  });
  it("copes with values JSON cannot show", () => {
    expect(previewJson(undefined)).toBe("undefined");
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(previewJson(circular)).toBe("(could not show the response)");
  });
});

describe("template encoding and missing values", () => {
  it("encodes filled values when asked", () => {
    expect(renderTemplate("/r/{id}/x", { id: "a b/c" }, encodeURIComponent)).toBe("/r/a%20b%2Fc/x");
  });

  it("lists holes with no value", () => {
    expect(missingHoles("/r/{id}/{n.x}", { id: "1" })).toEqual(["n.x"]);
    expect(missingHoles("/r/{id}", { id: 5 })).toEqual([]);
  });
});
