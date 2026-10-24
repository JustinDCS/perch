import { isValidPath } from "../lib/jsonpath";
import {
  type Errs,
  type Result,
  fail,
  has,
  isRecord,
  noUnknownKeys,
  num,
  ok,
  oneOf,
  str,
} from "../lib/validate";
import type {
  AuthSpec,
  ListDisplay,
  PillManifest,
  RestRequest,
  StatDisplay,
  Threshold,
  Tone,
} from "./types";

const ID = /^[a-z0-9][a-z0-9-]{0,47}$/;
const SECRET = /^[A-Za-z0-9._-]{1,64}$/;
const HEADER = /^[A-Za-z0-9-]{1,64}$/;
const FORBIDDEN_HEADERS = new Set([
  "host",
  "content-length",
  "transfer-encoding",
  "connection",
  "cookie",
  "set-cookie",
  "proxy-authorization",
]);
const TONES = ["neutral", "good", "warn", "danger"] as const;
const MAX_BODY_CHARS = 4000;

/**
 * Host key shown in approval prompts and checked by the Rust side
 * (`host` or `host:port`, lower case, default ports left out).
 * The Rust `check_url` is the authority; this only gives early, friendly errors.
 */
export function hostKeyOf(rawUrl: string): { host: string } | { error: string } {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { error: "is not a valid URL" };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { error: "must be an http(s) URL" };
  }
  if (url.username || url.password) {
    return { error: "must not contain a username or password" };
  }
  return { host: url.host.toLowerCase() };
}

function validatePath(v: unknown, path: string, errs: Errs): string | undefined {
  const s = str(v, path, errs, { max: 120 });
  if (s !== undefined && !isValidPath(s)) {
    errs.push(`${path}: not a valid path (use names, dots and [0] indexes)`);
    return undefined;
  }
  return s;
}

function validateAuth(raw: unknown, path: string, errs: Errs): AuthSpec | undefined {
  if (!isRecord(raw)) {
    errs.push(`${path}: must be an object`);
    return undefined;
  }
  const type = oneOf(raw.type, `${path}.type`, errs, ["bearer", "header", "basic"] as const);
  const secretOpts = { max: 64, pattern: SECRET, hint: "use letters, digits, '.', '_' or '-'" };

  if (type === "bearer") {
    noUnknownKeys(raw, ["type", "secret"], path, errs);
    const secret = str(raw.secret, `${path}.secret`, errs, secretOpts);
    return secret ? { type, secret } : undefined;
  }
  if (type === "header") {
    noUnknownKeys(raw, ["type", "name", "secret"], path, errs);
    const name = str(raw.name, `${path}.name`, errs, {
      max: 64,
      pattern: HEADER,
      hint: "not a valid header name",
    });
    if (name && FORBIDDEN_HEADERS.has(name.toLowerCase())) {
      errs.push(`${path}.name: header "${name}" is not allowed`);
      return undefined;
    }
    const secret = str(raw.secret, `${path}.secret`, errs, secretOpts);
    return name && secret ? { type, name, secret } : undefined;
  }
  if (type === "basic") {
    noUnknownKeys(raw, ["type", "user", "secret"], path, errs);
    const user = str(raw.user, `${path}.user`, errs, { max: 200 });
    const secret = str(raw.secret, `${path}.secret`, errs, secretOpts);
    return user && secret ? { type, user, secret } : undefined;
  }
  return undefined;
}

function validateRequest(raw: unknown, errs: Errs): RestRequest | undefined {
  if (!isRecord(raw)) {
    errs.push("request: must be an object");
    return undefined;
  }
  noUnknownKeys(raw, ["url", "method", "auth", "body"], "request", errs);

  const url = str(raw.url, "request.url", errs, { max: 2000 });
  if (url) {
    const checked = hostKeyOf(url);
    if ("error" in checked) {
      errs.push(`request.url: ${checked.error}`);
      return undefined;
    }
  }

  const method = has(raw, "method")
    ? oneOf(raw.method, "request.method", errs, ["GET", "POST"] as const)
    : "GET";
  const auth = has(raw, "auth") ? validateAuth(raw.auth, "request.auth", errs) : undefined;

  let body: unknown;
  if (has(raw, "body")) {
    if (method !== "POST") errs.push("request.body: only allowed when method is POST");
    else if (JSON.stringify(raw.body).length > MAX_BODY_CHARS) {
      errs.push(`request.body: must be smaller than ${MAX_BODY_CHARS} characters`);
    } else body = raw.body;
  }

  if (!url || !method) return undefined;
  if (has(raw, "auth") && !auth) return undefined;
  const request: RestRequest = { url, method };
  if (auth) request.auth = auth;
  if (body !== undefined) request.body = body;
  return request;
}

function validateThresholds(raw: unknown, errs: Errs): Threshold[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > 10) {
    errs.push("display.thresholds: must be a list of at most 10 rules");
    return [];
  }
  const out: Threshold[] = [];
  raw.forEach((item, i) => {
    const path = `display.thresholds[${i}]`;
    if (!isRecord(item)) {
      errs.push(`${path}: must be an object`);
      return;
    }
    noUnknownKeys(item, ["gte", "lte", "equals", "tone"], path, errs);
    const tone = oneOf<Tone>(item.tone, `${path}.tone`, errs, TONES);
    const rule: Threshold = { tone: tone ?? "neutral" };
    if (has(item, "gte")) {
      const n = num(item.gte, `${path}.gte`, errs, { min: -1e12, max: 1e12 });
      if (n !== undefined) rule.gte = n;
    }
    if (has(item, "lte")) {
      const n = num(item.lte, `${path}.lte`, errs, { min: -1e12, max: 1e12 });
      if (n !== undefined) rule.lte = n;
    }
    if (has(item, "equals")) {
      if (typeof item.equals === "string" || typeof item.equals === "number") {
        rule.equals = item.equals;
      } else errs.push(`${path}.equals: must be a string or number`);
    }
    if (rule.gte === undefined && rule.lte === undefined && rule.equals === undefined) {
      errs.push(`${path}: needs at least one of gte, lte or equals`);
    }
    if (tone) out.push(rule);
  });
  return out;
}

function validateDisplay(raw: unknown, errs: Errs): StatDisplay | ListDisplay | undefined {
  if (!isRecord(raw)) {
    errs.push("display: must be an object");
    return undefined;
  }
  const layout = oneOf(raw.layout, "display.layout", errs, ["stat", "list"] as const);

  if (layout === "stat") {
    noUnknownKeys(raw, ["layout", "value", "label", "unit", "thresholds"], "display", errs);
    const value = validatePath(raw.value, "display.value", errs);
    const label = has(raw, "label") ? str(raw.label, "display.label", errs, { max: 60 }) : undefined;
    const unit = has(raw, "unit") ? str(raw.unit, "display.unit", errs, { min: 0, max: 12 }) : undefined;
    const thresholds = validateThresholds(raw.thresholds, errs);
    if (!value) return undefined;
    const display: StatDisplay = { layout, value, thresholds };
    if (label !== undefined) display.label = label;
    if (unit !== undefined) display.unit = unit;
    return display;
  }

  if (layout === "list") {
    noUnknownKeys(raw, ["layout", "items", "title", "subtitle", "limit"], "display", errs);
    const items = validatePath(raw.items, "display.items", errs);
    const title = validatePath(raw.title, "display.title", errs);
    const subtitle = has(raw, "subtitle") ? validatePath(raw.subtitle, "display.subtitle", errs) : undefined;
    const limit = has(raw, "limit")
      ? num(raw.limit, "display.limit", errs, { min: 1, max: 20, int: true })
      : 5;
    if (!items || !title || limit === undefined) return undefined;
    const display: ListDisplay = { layout, items, title, limit };
    if (subtitle) display.subtitle = subtitle;
    return display;
  }

  return undefined;
}

/** Validate a parsed pill manifest. Never throws. */
export function validatePill(raw: unknown): Result<PillManifest> {
  if (!isRecord(raw)) return fail("manifest must be a JSON object");
  const errs: Errs = [];

  if (raw.perch !== 1) errs.push('perch: must be 1 (the manifest format version)');
  const id = str(raw.id, "id", errs, {
    max: 48,
    pattern: ID,
    hint: "use lower-case letters, digits and '-', starting with a letter or digit",
  });
  const name = str(raw.name, "name", errs, { max: 40 });
  const icon = has(raw, "icon") ? str(raw.icon, "icon", errs, { max: 8 }) : undefined;
  const kind = oneOf(raw.kind, "kind", errs, ["rest", "now-playing"] as const);

  if (kind === "now-playing") {
    noUnknownKeys(raw, ["perch", "id", "name", "kind", "icon"], "", errs);
    if (errs.length > 0 || !id || !name) return fail(...errs);
    const pill: PillManifest = { perch: 1, id, name, kind };
    if (icon) pill.icon = icon;
    return ok(pill);
  }

  if (kind === "rest") {
    noUnknownKeys(raw, ["perch", "id", "name", "kind", "icon", "refreshSeconds", "request", "display"], "", errs);
    const refreshSeconds = has(raw, "refreshSeconds")
      ? num(raw.refreshSeconds, "refreshSeconds", errs, { min: 5, max: 86400, int: true })
      : 60;
    const request = validateRequest(raw.request, errs);
    const display = validateDisplay(raw.display, errs);
    if (errs.length > 0 || !id || !name || !request || !display || refreshSeconds === undefined) {
      return fail(...errs);
    }
    const pill: PillManifest = { perch: 1, id, name, kind, refreshSeconds, request, display };
    if (icon) pill.icon = icon;
    return ok(pill);
  }

  return fail(...errs);
}

/** Names of the secrets a pill needs from the credential store. */
export function secretsOf(pill: PillManifest): string[] {
  return pill.kind === "rest" && pill.request.auth ? [pill.request.auth.secret] : [];
}

/** The host a pill will contact, or null for pills that do not use the network. */
export function hostOf(pill: PillManifest): string | null {
  if (pill.kind !== "rest") return null;
  const checked = hostKeyOf(pill.request.url);
  return "host" in checked ? checked.host : null;
}
