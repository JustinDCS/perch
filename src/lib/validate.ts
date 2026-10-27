// Small dependency-free validators. User-supplied JSON (pills, avatars) goes through these
// before anything renders it, and unknown fields are rejected so typos surface as errors.

export type Errs = string[];
export type Result<T> = { ok: true; value: T } | { ok: false; errors: string[] };

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const fail = (...errors: string[]): Result<never> => ({ ok: false, errors });

export const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export function has(obj: Record<string, unknown>, key: string): boolean {
  return Object.hasOwn(obj, key) && obj[key] !== undefined;
}

export function noUnknownKeys(
  obj: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
  errs: Errs,
): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) errs.push(`${join(path, key)}: unknown field`);
  }
}

export function join(path: string, key: string): string {
  return path ? `${path}.${key}` : key;
}

export interface StrOpts {
  min?: number;
  max?: number;
  pattern?: RegExp;
  hint?: string;
}

export function str(v: unknown, path: string, errs: Errs, o: StrOpts = {}): string | undefined {
  if (typeof v !== "string") {
    errs.push(`${path}: must be a string`);
    return undefined;
  }
  const min = o.min ?? 1;
  const max = o.max ?? 200;
  if (v.length < min || v.length > max) {
    errs.push(`${path}: length must be between ${min} and ${max}`);
    return undefined;
  }
  if (o.pattern && !o.pattern.test(v)) {
    errs.push(`${path}: ${o.hint ?? "has an invalid format"}`);
    return undefined;
  }
  return v;
}

export interface NumOpts {
  min: number;
  max: number;
  int?: boolean;
}

export function num(v: unknown, path: string, errs: Errs, o: NumOpts): number | undefined {
  if (typeof v !== "number" || !Number.isFinite(v)) {
    errs.push(`${path}: must be a number`);
    return undefined;
  }
  if (o.int && !Number.isInteger(v)) {
    errs.push(`${path}: must be a whole number`);
    return undefined;
  }
  if (v < o.min || v > o.max) {
    errs.push(`${path}: must be between ${o.min} and ${o.max}`);
    return undefined;
  }
  return v;
}

export function oneOf<T extends string>(
  v: unknown,
  path: string,
  errs: Errs,
  allowed: readonly T[],
): T | undefined {
  if (typeof v !== "string" || !allowed.includes(v as T)) {
    errs.push(`${path}: must be one of ${allowed.map((a) => `"${a}"`).join(", ")}`);
    return undefined;
  }
  return v as T;
}

export const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export function hexColor(v: unknown, path: string, errs: Errs): string | undefined {
  return str(v, path, errs, { min: 7, max: 7, pattern: HEX_COLOR, hint: "must be a #rrggbb color" });
}
