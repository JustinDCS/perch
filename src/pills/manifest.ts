import { isTemplate, isValidPath, isValidTemplate } from "../lib/jsonpath";
import { VAR_KEY, fillUrl, stringsIn, varsIn } from "./variables";
import {
  type Errs,
  type Result,
  fail,
  has,
  hexColor,
  isRecord,
  noUnknownKeys,
  num,
  ok,
  oneOf,
  str,
} from "../lib/validate";
import type {
  ApprovalAction,
  ApprovalsDisplay,
  AuthSpec,
  ListDisplay,
  PillManifest,
  PillVariable,
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

/** A path ("fields.summary") or a template ("{key} {fields.summary}"). */
function validateText(v: unknown, path: string, errs: Errs): string | undefined {
  const s = str(v, path, errs, { max: 160 });
  if (s === undefined) return undefined;
  if (isTemplate(s) ? !isValidTemplate(s) : !isValidPath(s)) {
    errs.push(`${path}: not a valid path or template (use names, dots, [0] indexes and {holes})`);
    return undefined;
  }
  return s;
}

/** Always a template: literal text with optional {path} holes, such as "https://site/browse/{key}". */
function validateLink(v: unknown, path: string, errs: Errs): string | undefined {
  const s = str(v, path, errs, { max: 300 });
  if (s === undefined) return undefined;
  if (!/^https?:\/\//i.test(s) && !s.startsWith("{")) {
    errs.push(`${path}: must start with https:// or be a {path} to a link in the response`);
    return undefined;
  }
  if (!isValidTemplate(s)) {
    errs.push(`${path}: not a valid template (every {hole} must be a path)`);
    return undefined;
  }
  return s;
}

const VAR_HOLE = /\{var\.[a-z][a-z0-9_]*\}/g;

/** The address a button posts to: literal scheme and host, {path} holes only after the host. */
function validatePost(v: unknown, path: string, errs: Errs): string | undefined {
  const s = str(v, path, errs, { max: 400 });
  if (s === undefined) return undefined;
  const bare = s.replace(VAR_HOLE, "var");
  if (!/^https?:\/\//i.test(bare)) {
    errs.push(`${path}: must start with https:// (a literal scheme)`);
    return undefined;
  }
  const authority = bare.replace(/^https?:\/\//i, "").split(/[/?#]/)[0] ?? "";
  if (authority.includes("{") || authority.includes("}")) {
    errs.push(`${path}: the host part may use {var.name} but not {holes} from the response`);
    return undefined;
  }
  if (!isValidTemplate(bare)) {
    errs.push(`${path}: not a valid template (every {hole} must be a path)`);
    return undefined;
  }
  return s;
}

function validateActions(raw: unknown, errs: Errs): ApprovalAction[] {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 3) {
    errs.push("display.actions: must be a list of 1 to 3 buttons");
    return [];
  }
  const out: ApprovalAction[] = [];
  raw.forEach((item, i) => {
    const path = `display.actions[${i}]`;
    if (!isRecord(item)) {
      errs.push(`${path}: must be an object`);
      return;
    }
    noUnknownKeys(item, ["label", "tone", "confirm", "post", "body"], path, errs);
    const label = str(item.label, `${path}.label`, errs, { max: 24 });
    const tone = has(item, "tone") ? oneOf(item.tone, `${path}.tone`, errs, ["neutral", "good", "danger"] as const) : "neutral";
    let confirm: boolean | string | undefined;
    if (has(item, "confirm")) {
      if (typeof item.confirm === "boolean") confirm = item.confirm;
      else confirm = validateText(item.confirm, `${path}.confirm`, errs);
    }
    const post = validatePost(item.post, `${path}.post`, errs);
    let body: unknown;
    if (has(item, "body")) {
      if (JSON.stringify(item.body).length > MAX_BODY_CHARS) {
        errs.push(`${path}.body: must be smaller than ${MAX_BODY_CHARS} characters`);
      } else body = item.body;
    }
    if (!label || !tone || !post) return;
    const action: ApprovalAction = { label, tone, post };
    if (confirm) action.confirm = confirm;
    if (body !== undefined) action.body = body;
    out.push(action);
  });
  return out;
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
    // {var.x} blanks are filled in later; check the shape of the address with a stand-in
    const checked = hostKeyOf(url.replace(/\{var\.[a-z][a-z0-9_]*\}/g, "var"));
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

function validateVariables(raw: unknown, errs: Errs): PillVariable[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > 8) {
    errs.push("variables: must be a list of at most 8 variables");
    return [];
  }
  const out: PillVariable[] = [];
  const seen = new Set<string>();
  raw.forEach((item, i) => {
    const path = `variables[${i}]`;
    if (!isRecord(item)) {
      errs.push(`${path}: must be an object`);
      return;
    }
    noUnknownKeys(item, ["key", "label", "placeholder", "default", "type", "group"], path, errs);
    const keyHint = "use a lower-case name with letters, digits and '_'";
    const key = str(item.key, `${path}.key`, errs, { max: 24, pattern: VAR_KEY, hint: keyHint });
    const label = str(item.label, `${path}.label`, errs, { max: 40 });
    const placeholder = has(item, "placeholder") ? str(item.placeholder, `${path}.placeholder`, errs, { max: 80 }) : undefined;
    const def = has(item, "default") ? str(item.default, `${path}.default`, errs, { min: 0, max: 200 }) : undefined;
    const type = has(item, "type") ? oneOf(item.type, `${path}.type`, errs, ["text", "host"] as const) : undefined;
    const group = has(item, "group") ? str(item.group, `${path}.group`, errs, { max: 24, pattern: VAR_KEY, hint: keyHint }) : undefined;
    if (key && seen.has(key)) errs.push(`${path}.key: "${key}" is used twice`);
    if (!key || !label) return;
    seen.add(key);
    const variable: PillVariable = { key, label };
    if (placeholder) variable.placeholder = placeholder;
    if (def) variable.default = def;
    if (type) variable.type = type;
    if (group) variable.group = group;
    out.push(variable);
  });
  return out;
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

function validateDisplay(raw: unknown, errs: Errs): StatDisplay | ListDisplay | ApprovalsDisplay | undefined {
  if (!isRecord(raw)) {
    errs.push("display: must be an object");
    return undefined;
  }
  const layout = oneOf(raw.layout, "display.layout", errs, ["stat", "list", "approvals"] as const);

  if (layout === "approvals") {
    noUnknownKeys(raw, ["layout", "items", "title", "detail", "actions", "limit"], "display", errs);
    const items = validatePath(raw.items, "display.items", errs);
    const title = validateText(raw.title, "display.title", errs);
    const detail = has(raw, "detail") ? validateText(raw.detail, "display.detail", errs) : undefined;
    const actions = validateActions(raw.actions, errs);
    const limit = has(raw, "limit") ? num(raw.limit, "display.limit", errs, { min: 1, max: 10, int: true }) : 5;
    if (!items || !title || actions.length === 0 || limit === undefined) return undefined;
    const display: ApprovalsDisplay = { layout, items, title, actions, limit };
    if (detail) display.detail = detail;
    return display;
  }

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
    noUnknownKeys(raw, ["layout", "items", "title", "subtitle", "link", "limit"], "display", errs);
    const items = validatePath(raw.items, "display.items", errs);
    const title = validateText(raw.title, "display.title", errs);
    const subtitle = has(raw, "subtitle") ? validateText(raw.subtitle, "display.subtitle", errs) : undefined;
    const link = has(raw, "link") ? validateLink(raw.link, "display.link", errs) : undefined;
    const limit = has(raw, "limit")
      ? num(raw.limit, "display.limit", errs, { min: 1, max: 20, int: true })
      : 5;
    if (!items || !title || limit === undefined) return undefined;
    const display: ListDisplay = { layout, items, title, limit };
    if (subtitle) display.subtitle = subtitle;
    if (link) display.link = link;
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
  const accent = has(raw, "accent") ? hexColor(raw.accent, "accent", errs) : undefined;
  const kind = oneOf(raw.kind, "kind", errs, ["rest", "now-playing"] as const);

  if (kind === "now-playing") {
    noUnknownKeys(raw, ["perch", "id", "name", "kind", "icon", "accent"], "", errs);
    if (errs.length > 0 || !id || !name) return fail(...errs);
    const pill: PillManifest = { perch: 1, id, name, kind };
    if (icon) pill.icon = icon;
    if (accent) pill.accent = accent;
    return ok(pill);
  }

  if (kind === "rest") {
    noUnknownKeys(raw, ["perch", "id", "name", "kind", "icon", "accent", "refreshSeconds", "variables", "request", "display"], "", errs);
    const variables = validateVariables(raw.variables, errs);
    const refreshSeconds = has(raw, "refreshSeconds")
      ? num(raw.refreshSeconds, "refreshSeconds", errs, { min: 5, max: 86400, int: true })
      : 60;
    const request = validateRequest(raw.request, errs);
    const display = validateDisplay(raw.display, errs);
    if (errs.length > 0 || !id || !name || !request || !display || refreshSeconds === undefined) {
      return fail(...errs);
    }
    const declared = new Set(variables.map((v) => v.key));
    const uses: [string, string[]][] = [
      ["request.url", varsIn(request.url)],
      ["request.auth.user", request.auth?.type === "basic" ? varsIn(request.auth.user) : []],
      ["request.body", stringsIn(request.body).flatMap(varsIn)],
      ["display.link", display.layout === "list" && display.link ? varsIn(display.link) : []],
      ...(display.layout === "approvals"
        ? display.actions.map((a, i): [string, string[]] => [
            `display.actions[${i}]`,
            [...varsIn(a.post), ...stringsIn(a.body).flatMap(varsIn)],
          ])
        : []),
    ];
    for (const [where, keys] of uses) {
      for (const key of keys) {
        if (!declared.has(key)) errs.push(`${where}: uses {var.${key}} but "${key}" is not listed in variables`);
      }
    }
    if (errs.length > 0) return fail(...errs);
    const pill: PillManifest = { perch: 1, id, name, kind, refreshSeconds, request, display };
    if (variables.length > 0) pill.variables = variables;
    if (icon) pill.icon = icon;
    if (accent) pill.accent = accent;
    return ok(pill);
  }

  return fail(...errs);
}

/** Names of the secrets a pill needs from the credential store. */
export function secretsOf(pill: PillManifest): string[] {
  return pill.kind === "rest" && pill.request.auth ? [pill.request.auth.secret] : [];
}

/** The host a pill will contact, or null for pills that do not use the network. */
export function hostOf(pill: PillManifest, values: Record<string, string> = {}): string | null {
  if (pill.kind !== "rest") return null;
  let url: string;
  try {
    url = fillUrl(pill.request.url, values, pill.variables);
  } catch {
    return null; // a variable is not set yet
  }
  const checked = hostKeyOf(url);
  return "host" in checked ? checked.host : null;
}
