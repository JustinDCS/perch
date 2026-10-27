import { describe, expect, it } from "vitest";
import { hostKeyOf, hostOf, secretsOf, validatePill } from "./manifest";
import { toneFor } from "./tone";

const rest = (overrides: Record<string, unknown> = {}) => ({
  perch: 1,
  id: "tickets",
  name: "Tickets",
  kind: "rest",
  request: { url: "https://api.example.com/count" },
  display: { layout: "stat", value: "count" },
  ...overrides,
});

function errorsOf(raw: unknown): string[] {
  const result = validatePill(raw);
  if (result.ok) throw new Error("expected validation to fail");
  return result.errors;
}

describe("validatePill: now-playing", () => {
  it("accepts a minimal now-playing pill", () => {
    const result = validatePill({ perch: 1, id: "music", name: "Music", kind: "now-playing" });
    expect(result).toEqual({ ok: true, value: { perch: 1, id: "music", name: "Music", kind: "now-playing" } });
  });

  it("rejects unknown fields", () => {
    expect(errorsOf({ perch: 1, id: "m", name: "M", kind: "now-playing", script: "alert(1)" })).toContain("script: unknown field");
  });
});

describe("validatePill: rest", () => {
  it("applies defaults", () => {
    const result = validatePill(rest());
    expect(result.ok).toBe(true);
    if (result.ok && result.value.kind === "rest") {
      expect(result.value.refreshSeconds).toBe(60);
      expect(result.value.request.method).toBe("GET");
      expect(result.value.display).toEqual({ layout: "stat", value: "count", thresholds: [] });
    }
  });

  it("rejects non-objects, wrong version and bad ids", () => {
    expect(errorsOf("nope")).toEqual(["manifest must be a JSON object"]);
    expect(errorsOf(rest({ perch: 2 })).join()).toContain("perch:");
    expect(errorsOf(rest({ id: "Has Spaces" })).join()).toContain("id:");
    expect(errorsOf(rest({ kind: "shell" })).join()).toContain("kind:");
  });

  it("rejects unsafe or malformed URLs", () => {
    for (const url of ["javascript:alert(1)", "file:///etc/passwd", "ftp://x.test", "https://user:pw@x.test/", "not a url"]) {
      const errs = errorsOf(rest({ request: { url } }));
      expect(errs.join(), url).toContain("request.url");
    }
  });

  it("refresh interval is bounded", () => {
    expect(errorsOf(rest({ refreshSeconds: 1 })).join()).toContain("refreshSeconds");
    expect(errorsOf(rest({ refreshSeconds: 999999 })).join()).toContain("refreshSeconds");
    expect(errorsOf(rest({ refreshSeconds: 10.5 })).join()).toContain("refreshSeconds");
  });

  it("validates auth variants and keeps secrets as names only", () => {
    const bearer = validatePill(rest({ request: { url: "https://a.test/x", auth: { type: "bearer", secret: "tok" } } }));
    expect(bearer.ok && bearer.value.kind === "rest" && bearer.value.request.auth).toEqual({ type: "bearer", secret: "tok" });

    expect(errorsOf(rest({ request: { url: "https://a.test/x", auth: { type: "bearer" } } })).join()).toContain("secret");
    expect(errorsOf(rest({ request: { url: "https://a.test/x", auth: { type: "bearer", secret: "has space" } } })).join()).toContain("secret");
    expect(errorsOf(rest({ request: { url: "https://a.test/x", auth: { type: "bearer", secret: "t", token: "raw" } } })).join()).toContain("token: unknown field");
    expect(errorsOf(rest({ request: { url: "https://a.test/x", auth: { type: "oauth", secret: "t" } } })).join()).toContain("auth.type");
  });

  it("blocks dangerous custom header names", () => {
    for (const name of ["Host", "cookie", "Content-Length"]) {
      const errs = errorsOf(rest({ request: { url: "https://a.test/x", auth: { type: "header", name, secret: "k" } } }));
      expect(errs.join(), name).toContain("not allowed");
    }
    const okResult = validatePill(rest({ request: { url: "https://a.test/x", auth: { type: "header", name: "X-Api-Key", secret: "k" } } }));
    expect(okResult.ok).toBe(true);
  });

  it("only allows a body on POST requests and caps its size", () => {
    expect(errorsOf(rest({ request: { url: "https://a.test/x", body: { a: 1 } } })).join()).toContain("only allowed when method is POST");
    expect(validatePill(rest({ request: { url: "https://a.test/x", method: "POST", body: { a: 1 } } })).ok).toBe(true);
    expect(errorsOf(rest({ request: { url: "https://a.test/x", method: "POST", body: { a: "x".repeat(5000) } } })).join()).toContain("smaller than");
    expect(errorsOf(rest({ request: { url: "https://a.test/x", method: "DELETE" } })).join()).toContain("request.method");
  });

  it("validates paths in display mappings", () => {
    expect(errorsOf(rest({ display: { layout: "stat", value: "a.__proto__" } })).join()).toContain("not a valid path");
    expect(errorsOf(rest({ display: { layout: "gauge", value: "a" } })).join()).toContain("display.layout");
  });

  it("validates list displays", () => {
    const result = validatePill(rest({ display: { layout: "list", items: "issues", title: "fields.summary", subtitle: "key" } }));
    expect(result.ok && result.value.kind === "rest" && result.value.display).toEqual({
      layout: "list",
      items: "issues",
      title: "fields.summary",
      subtitle: "key",
      limit: 5,
    });
    expect(errorsOf(rest({ display: { layout: "list", items: "a", title: "b", limit: 99 } })).join()).toContain("display.limit");
  });

  it("validates thresholds", () => {
    const good = validatePill(rest({ display: { layout: "stat", value: "n", thresholds: [{ gte: 10, tone: "danger" }, { equals: "down", tone: "warn" }] } }));
    expect(good.ok).toBe(true);
    expect(errorsOf(rest({ display: { layout: "stat", value: "n", thresholds: [{ tone: "danger" }] } })).join()).toContain("needs at least one");
    expect(errorsOf(rest({ display: { layout: "stat", value: "n", thresholds: [{ gte: 1, tone: "purple" }] } })).join()).toContain("tone");
  });
});

describe("helpers", () => {
  it("hostKeyOf mirrors the Rust host key", () => {
    expect(hostKeyOf("https://API.Example.com/a")).toEqual({ host: "api.example.com" });
    expect(hostKeyOf("https://example.com:8443/a")).toEqual({ host: "example.com:8443" });
    expect(hostKeyOf("https://example.com:443/a")).toEqual({ host: "example.com" });
    expect(hostKeyOf("http://localhost:3000")).toEqual({ host: "localhost:3000" });
    expect(hostKeyOf("http://[::1]:9000/")).toEqual({ host: "[::1]:9000" });
    expect("error" in hostKeyOf("mailto:a@b.c")).toBe(true);
  });

  it("secretsOf and hostOf describe what a pill needs", () => {
    const pill = validatePill(rest({ request: { url: "https://jira.example.com/x", auth: { type: "basic", user: "me@x.test", secret: "jira-token" } } }));
    if (!pill.ok) throw new Error("fixture invalid");
    expect(secretsOf(pill.value)).toEqual(["jira-token"]);
    expect(hostOf(pill.value)).toBe("jira.example.com");

    const media = validatePill({ perch: 1, id: "m", name: "M", kind: "now-playing" });
    if (!media.ok) throw new Error("fixture invalid");
    expect(secretsOf(media.value)).toEqual([]);
    expect(hostOf(media.value)).toBeNull();
  });
});

describe("toneFor", () => {
  const rules = [
    { gte: 25, tone: "danger" as const },
    { gte: 10, tone: "warn" as const },
    { equals: "down", tone: "danger" as const },
  ];

  it("picks the first matching rule", () => {
    expect(toneFor(30, rules)).toBe("danger");
    expect(toneFor(12, rules)).toBe("warn");
    expect(toneFor("12", rules)).toBe("warn");
    expect(toneFor(3, rules)).toBe("neutral");
    expect(toneFor("down", rules)).toBe("danger");
  });

  it("ignores numeric rules for non-numeric values and supports ranges", () => {
    expect(toneFor("n/a", rules)).toBe("neutral");
    expect(toneFor(undefined, rules)).toBe("neutral");
    expect(toneFor(5, [{ gte: 1, lte: 9, tone: "good" }])).toBe("good");
    expect(toneFor(15, [{ gte: 1, lte: 9, tone: "good" }])).toBe("neutral");
  });
});

describe("pill accent colour", () => {
  const base = { perch: 1, id: "tint", name: "Tint", kind: "now-playing" };
  it("accepts a #rrggbb accent and keeps it", () => {
    const result = validatePill({ ...base, accent: "#6fd9b8" });
    expect(result.ok && result.value.accent).toBe("#6fd9b8");
  });
  it("rejects anything that is not a #rrggbb colour", () => {
    expect(validatePill({ ...base, accent: "red" }).ok).toBe(false);
    expect(validatePill({ ...base, accent: "url(javascript:1)" }).ok).toBe(false);
  });
});

describe("list rows: templates and links", () => {
  const list = (display: Record<string, unknown>) => rest({ display: { layout: "list", items: "issues", title: "key", ...display } });

  it("accepts templates for title and subtitle", () => {
    const result = validatePill(list({ title: "{key} {fields.summary}", subtitle: "{fields.status.name}" }));
    expect(result.ok).toBe(true);
    if (result.ok && result.value.kind === "rest" && result.value.display.layout === "list") {
      expect(result.value.display.title).toBe("{key} {fields.summary}");
    }
  });
  it("accepts a link template", () => {
    const result = validatePill(list({ link: "https://example.atlassian.net/browse/{key}" }));
    expect(result.ok && result.value.kind === "rest" && result.value.display.layout === "list" ? result.value.display.link : null).toBe(
      "https://example.atlassian.net/browse/{key}",
    );
  });
  it("accepts a link that comes straight from the response", () => {
    expect(validatePill(list({ link: "{html_url}" })).ok).toBe(true);
  });
  it("rejects bad templates and links", () => {
    expect(errorsOf(list({ title: "{key" })).join()).toContain("display.title");
    expect(errorsOf(list({ subtitle: "{__proto__}" })).join()).toContain("display.subtitle");
    expect(errorsOf(list({ link: "javascript:alert(1)" })).join()).toContain("display.link");
    expect(errorsOf(list({ link: "ftp://example.com/{key}" })).join()).toContain("display.link");
    expect(errorsOf(list({ link: "https://example.com/{" })).join()).toContain("display.link");
  });
});
