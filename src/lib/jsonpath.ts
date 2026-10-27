// A deliberately tiny path language for mapping API responses onto pill fields:
//   "count"            top-level property
//   "data.items[0].id" nested properties and array indexes ([-1] is the last one)
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
      if (!/^-?\d{1,6}$/.test(inner)) return null;
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
      // a negative index counts from the end: [-1] is the last item
      current = current[segment < 0 ? current.length + segment : segment];
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

// ---- templates: text with {path} holes, e.g. "{key} {fields.summary}" -----------------------

/** Does this string use {path} holes? Plain paths are not templates. */
export function isTemplate(text: string): boolean {
  return text.includes("{");
}

/** Every {…} must hold a valid path, and braces must pair up. */
export function isValidTemplate(text: string): boolean {
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === "}") return false;
    if (c === "{") {
      const end = text.indexOf("}", i);
      if (end < 0) return false;
      const inner = text.slice(i + 1, end);
      if (inner.includes("{") || !isValidPath(inner)) return false;
      i = end + 1;
      continue;
    }
    i++;
  }
  return true;
}

/** Fill the holes from `data`. Missing values show as an em dash, never as "undefined". */
export function renderTemplate(text: string, data: unknown, encode?: (value: string) => string): string {
  return text.replace(/\{([^{}]*)\}/g, (_, path: string) => {
    const text = formatValue(getPath(data, path));
    return encode && text !== "—" ? encode(text) : text;
  });
}

/** Holes of a template whose value is missing (not a string, number or boolean). */
export function missingHoles(text: string, data: unknown): string[] {
  return [...text.matchAll(/\{([^{}]*)\}/g)]
    .map((m) => m[1]!)
    .filter((path) => formatValue(getPath(data, path)) === "—");
}

/** A display field is either a plain path or a template. */
export function textOf(data: unknown, spec: string): string {
  return isTemplate(spec) ? renderTemplate(spec, data) : formatValue(getPath(data, spec));
}

/** A short, single-line look at a response, for the pill's details view. */
export function previewJson(value: unknown, max = 300): string {
  let text: string;
  try {
    text = JSON.stringify(value) ?? String(value);
  } catch {
    return "(could not show the response)";
  }
  return text.length > max ? `${text.slice(0, max)}… (${text.length} characters)` : text;
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
