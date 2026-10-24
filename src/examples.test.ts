import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { validateAvatar } from "./avatar/schema";
import { validatePill } from "./pills/manifest";

const root = join(__dirname, "..", "examples");

function load(dir: string): { name: string; json: unknown }[] {
  return readdirSync(join(root, dir))
    .filter((f) => f.endsWith(".json"))
    .map((name) => ({ name, json: JSON.parse(readFileSync(join(root, dir, name), "utf8")) }));
}

describe("shipped examples stay valid", () => {
  const pips = load("pips");
  const avatars = load("avatars");

  it("has examples to check", () => {
    expect(pips.length).toBeGreaterThanOrEqual(3);
    expect(avatars.length).toBeGreaterThanOrEqual(1);
  });

  it.each(pips.map((p) => [p.name, p.json] as const))("pill %s", (_name, json) => {
    const result = validatePill(json);
    expect(result.ok ? [] : result.errors).toEqual([]);
  });

  it.each(avatars.map((a) => [a.name, a.json] as const))("avatar %s", (_name, json) => {
    const result = validateAvatar(json);
    expect(result.ok ? [] : result.errors).toEqual([]);
  });

  it("pill ids are unique across the examples", () => {
    const ids = pips.map((p) => (p.json as { id: string }).id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
