// A deliberately tiny path language for mapping API responses onto pill fields:
//   "count"            top-level property
//   "data.items[0].id" nested properties and array indexes
//   "issues.length"    length of an array
// Only own properties are read, and __proto__ / constructor / prototype are refused.

import { isRecord } from "./validate";

export type Segment = string | number;

const BLOCKED = new Set(["__proto__", "prototype", "constructor"]);

export function parsePath(path: string): Segment[] | null {
  const segments: Segment[] = [];
  let i = 0;
  while (i < path.length) {
    const c = path[i];
    if (c === ".") {
      i++;
      continue;
    }
    if (c === "[") {
      const end = path.indexOf("]", i);
      if (end < 0) return null;
      const inner = path.slice(i + 1, end);
      if (!/^\d{1,6}$/.test(inner)) return null;
      segments.push(Number(inner));
      i = end + 1;
      continue;
    }
    let j = i;
    while (j < path.length && path[j] !== "." && path[j] !== "[") j++;
    const name = path.slice(i, j);
    if (BLOCKED.has(name)) return null;
    segments.push(name);
    i = j;
  }
  return segments.length > 0 ? segments : null;
}

export function isValidPath(path: string): boolean {
  return parsePath(path) !== null;
}

export function getPath(data: unknown, path: string): unknown {
  const segments = parsePath(path);
  if (!segments) return undefined;

  let current: unknown = data;
  for (const segment of segments) {
    if (typeof segment === "number") {
      if (!Array.isArray(current)) return undefined;
      current = current[segment];
    } else if (Array.isArray(current) && segment === "length") {
      current = current.length;
    } else if (isRecord(current) && Object.hasOwn(current, segment)) {
      current = current[segment];
    } else {
      return undefined;
    }
  }
  return current;
}

export function toNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

/** Text for display. Objects and arrays are not dumped into the UI. */
export function formatValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "—";
}
