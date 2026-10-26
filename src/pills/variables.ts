// Pill variables: blanks a pill author leaves for the user ({var.site}) and the values the
// user typed in Settings. Everything here is pure so it can be tested without the app.

import type { PillVariable } from "./types";

export const VAR_KEY = /^[a-z][a-z0-9_]{0,23}$/;
const VAR_REF = /\{var\.([a-z][a-z0-9_]{0,23})\}/g;
const MAX_VALUE = 200;

/** Names of the variables a piece of text refers to, in order, without repeats. */
export function varsIn(text: string): string[] {
  return [...new Set([...text.matchAll(VAR_REF)].map((m) => m[1]!))];
}

/** Every string inside a JSON value (used to find variables in a request body). */
export function stringsIn(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(stringsIn);
  if (typeof value === "object" && value !== null) return Object.values(value).flatMap(stringsIn);
  return [];
}

/** Where a variable's value is kept: shared by group, or private to the pill. */
export function storeKey(pillId: string, variable: PillVariable): string {
  return variable.group ? `@${variable.group}.${variable.key}` : `${pillId}.${variable.key}`;
}

/** Tidy what the user typed. Host fields accept a pasted address ("https://site.example/path"). */
export function normalise(variable: PillVariable, raw: string): string {
  // eslint-disable-next-line no-control-regex
  let value = raw.replace(/[\u0000-\u001f\u007f{}]/g, "").trim();
  if (variable.type === "host") {
    value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").replace(/[/?#].*$/, "").toLowerCase();
  }
  return value.slice(0, MAX_VALUE);
}

export type Store = Record<string, string>;

export function parseStore(raw: unknown): Store {
  const out: Store = {};
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return out;
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

/** The value for each of a pill's variables: what the user saved, else the default, else "". */
export function resolveValues(
  pillId: string,
  variables: PillVariable[] | undefined,
  store: Store,
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const variable of variables ?? []) {
    const saved = normalise(variable, store[storeKey(pillId, variable)] ?? "");
    values[variable.key] = saved || normalise(variable, variable.default ?? "");
  }
  return values;
}

/** Variables that still have no value. */
export function missingVars(variables: PillVariable[] | undefined, values: Record<string, string>): PillVariable[] {
  return (variables ?? []).filter((v) => !values[v.key]);
}

const HOST_VALUE = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d{1,5})?$/i;

/**
 * Put values into a web address. A variable in the host part must look like a host name;
 * anywhere else the value is percent-encoded, so a JQL query or a project key is safe to use.
 */
export function fillUrl(template: string, values: Record<string, string>, variables?: PillVariable[]): string {
  const prefix = /^[a-z][a-z0-9+.-]*:\/\//i.exec(template)?.[0].length ?? 0;
  const authorityEnd = template.slice(prefix).search(/[/?#]/);
  const hostEnd = authorityEnd === -1 ? template.length : prefix + authorityEnd;
  return template.replace(VAR_REF, (_match, key: string, offset: number) => {
    const value = values[key];
    const label = variables?.find((v) => v.key === key)?.label ?? key;
    if (!value) throw new Error(`"${label}" is not set`);
    if (offset >= prefix && offset < hostEnd) {
      if (!HOST_VALUE.test(value)) throw new Error(`"${label}" is not a valid host name`);
      return value.toLowerCase();
    }
    return encodeURIComponent(value);
  });
}

/** Put values into plain text (a sign-in name, a link). Values are used as typed, once. */
export function fillText(template: string, values: Record<string, string>): string {
  return template.replace(VAR_REF, (_match, key: string) => values[key] ?? "");
}

/** Fill every string inside a JSON body. */
export function fillBody(body: unknown, values: Record<string, string>): unknown {
  if (typeof body === "string") return fillText(body, values);
  if (Array.isArray(body)) return body.map((item) => fillBody(item, values));
  if (typeof body === "object" && body !== null) {
    return Object.fromEntries(Object.entries(body).map(([k, v]) => [k, fillBody(v, values)]));
  }
  return body;
}
