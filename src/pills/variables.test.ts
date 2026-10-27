import { describe, expect, it } from "vitest";
import { validatePill, hostOf } from "./manifest";
import type { PillVariable } from "./types";
import { fillBody, fillText, fillUrl, missingVars, normalise, resolveValues, storeKey, varsIn } from "./variables";

const site: PillVariable = { key: "site", label: "Site", type: "host", group: "jira" };
const jql: PillVariable = { key: "jql", label: "Search", default: "a = b" };

describe("variables", () => {
  it("finds the names used in text", () => {
    expect(varsIn("https://{var.site}/x?q={var.jql}&r={var.site}")).toEqual(["site", "jql"]);
  });

  it("shares by group, otherwise keeps values per pill", () => {
    expect(storeKey("one", site)).toBe("@jira.site");
    expect(storeKey("one", jql)).toBe("one.jql");
  });

  it("tidies a pasted address for host fields only", () => {
    expect(normalise(site, " https://DynComp.Atlassian.net/browse/DD ")).toBe("dyncomp.atlassian.net");
    expect(normalise(jql, "a {b} c")).toBe("a b c");
  });

  it("uses defaults and reports what is missing", () => {
    const values = resolveValues("p", [site, jql], {});
    expect(values).toEqual({ site: "", jql: "a = b" });
    expect(missingVars([site, jql], values).map((v) => v.key)).toEqual(["site"]);
    expect(resolveValues("p", [site], { "@jira.site": "x.example.com" })).toEqual({ site: "x.example.com" });
  });

  it("fills urls: raw host, encoded elsewhere", () => {
    const url = fillUrl("https://{var.site}/search?jql={var.jql}", { site: "X.Example.com", jql: "a = b & c" }, [site, jql]);
    expect(url).toBe("https://x.example.com/search?jql=a%20%3D%20b%20%26%20c");
  });

  it("refuses a host value that could change the destination", () => {
    expect(() => fillUrl("https://{var.site}/", { site: "evil.com/x?" }, [site])).toThrow(/valid host/);
    expect(() => fillUrl("https://{var.site}/", { site: "a@evil.com" }, [site])).toThrow(/valid host/);
    expect(() => fillUrl("https://{var.site}/", {}, [site])).toThrow(/not set/);
  });

  it("fills text and bodies once, without re-expanding values", () => {
    expect(fillText("{var.a}", { a: "{var.b}", b: "x" })).toBe("{var.b}");
    expect(fillBody({ q: ["id = {var.a}"], n: 1 }, { a: "5" })).toEqual({ q: ["id = 5"], n: 1 });
  });
});

describe("variables in manifests", () => {
  const manifest = (over: Record<string, unknown> = {}) => ({
    perch: 1,
    id: "p",
    name: "P",
    kind: "rest",
    variables: [{ key: "site", label: "Site", type: "host" }],
    request: { url: "https://{var.site}/count" },
    display: { layout: "stat", value: "count" },
    ...over,
  });

  it("accepts declared variables and resolves the host", () => {
    const result = validatePill(manifest());
    if (!result.ok) throw new Error(result.errors.join());
    expect(hostOf(result.value, { site: "a.example.com" })).toBe("a.example.com");
    expect(hostOf(result.value, {})).toBeNull();
  });

  it("rejects a variable that is not declared", () => {
    const result = validatePill(manifest({ request: { url: "https://{var.nope}/count" } }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join()).toContain('"nope" is not listed in variables');
  });

  it("rejects duplicate keys and bad key names", () => {
    const dup = validatePill(manifest({ variables: [{ key: "a", label: "A" }, { key: "a", label: "B" }] }));
    expect(dup.ok).toBe(false);
    const bad = validatePill(manifest({ variables: [{ key: "Site", label: "A" }] }));
    expect(bad.ok).toBe(false);
  });

  it("needs a literal scheme, so a variable cannot pick the protocol", () => {
    const result = validatePill(manifest({ request: { url: "{var.site}/count" } }));
    expect(result.ok).toBe(false);
  });
});

describe("approvals display", () => {
  const approvals = (actions: unknown, extra: Record<string, unknown> = {}) => ({
    perch: 1,
    id: "gate",
    name: "Gate",
    kind: "rest",
    variables: [{ key: "site", label: "Site", type: "host" }],
    request: { url: "https://{var.site}/pending" },
    display: { layout: "approvals", items: "requests", title: "{title}", actions, ...extra },
  });
  const good = [{ label: "Approve", tone: "good", post: "https://{var.site}/r/{id}/approve" }];

  it("accepts buttons that post to the same service", () => {
    const result = validatePill(approvals(good, { detail: "{summary}" }));
    if (!result.ok) throw new Error(result.errors.join());
    expect(result.value.kind === "rest" && result.value.display.layout).toBe("approvals");
  });

  it("needs one to three buttons", () => {
    expect(validatePill(approvals([])).ok).toBe(false);
    const four = Array.from({ length: 4 }, (_, i) => ({ label: `B${i}`, post: "https://x.example.com/a" }));
    expect(validatePill(approvals(four)).ok).toBe(false);
  });

  it("does not let the response choose where a button posts", () => {
    for (const post of ["https://{host}/approve", "https://api.example.com{path}", "{url}/approve", "/relative"]) {
      expect(validatePill(approvals([{ label: "Go", post }])).ok).toBe(false);
    }
  });

  it("checks variables used by buttons are declared", () => {
    const result = validatePill(approvals([{ label: "Go", post: "https://{var.other}/a" }]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join()).toContain('"other" is not listed in variables');
  });

  it("rejects unknown button fields", () => {
    expect(validatePill(approvals([{ label: "Go", post: "https://x.example.com/a", method: "DELETE" }])).ok).toBe(false);
  });
});

describe("chart layout", () => {
  const chart = (display: unknown) =>
    validatePill({ perch: 1, id: "c", name: "C", kind: "rest", refreshSeconds: 60, request: { url: "https://api.example.com/x" }, display });

  it("accepts one path or several and keeps them in order", () => {
    const one = chart({ layout: "chart", values: "a.b" });
    expect(one.ok && one.value.kind === "rest" && one.value.display.layout === "chart" && one.value.display.values).toEqual(["a.b"]);
    const two = chart({ layout: "chart", values: ["[50].days", "[51].days"], unit: "commits" });
    expect(two.ok).toBe(true);
  });

  it("refuses no paths, too many, bad paths and unknown keys", () => {
    expect(chart({ layout: "chart", values: [] }).ok).toBe(false);
    expect(chart({ layout: "chart", values: ["a", "b", "c", "d", "e"] }).ok).toBe(false);
    expect(chart({ layout: "chart", values: ["a.__proto__"] }).ok).toBe(false);
    expect(chart({ layout: "chart", values: "a", colour: "red" }).ok).toBe(false);
  });
});
