// Reader for the ".avatar.json" files exported by Bible Strong Avatar Lab (schema
// "bible-strong/avatar-definition", version 1). Perch only reads that data format: the checks
// and the player in this folder are Perch's own code, written from the published format, and
// none of the Studio's or its packages' code is used. Like Perch's own avatars, the file is
// data: every value is range-checked here and nothing from it is ever turned into markup.

import {
  type Errs,
  type Result,
  fail,
  hexColor,
  isRecord,
  noUnknownKeys,
  num,
  ok,
  oneOf,
  str,
} from "../../lib/validate";

export const BS_SCHEMA = "bible-strong/avatar-definition";

export const SURFACE_TYPES = ["sphere", "mickey", "cursor", "cube", "capsule", "cylinder", "cone", "diamond"] as const;
export const NODE_SURFACE_TYPES = ["sphere", "cube", "capsule", "cylinder", "cone", "diamond"] as const;
export type SurfaceType = (typeof SURFACE_TYPES)[number];
export const EYE_MOTIONS = ["none", "microSaccades", "shake"] as const;
export const BODY_MOTIONS = ["none", "slowDrift", "shake"] as const;
export const PLAYBACK_MODES = ["loop", "once", "pingPong"] as const;
export const TRANSITIONS = ["spring", "smooth", "snappy"] as const;

export interface BsSurface {
  type: SurfaceType;
  width: number;
  height: number;
  roundness: number;
}
export interface BsEye {
  width: number;
  height: number;
  x: number;
  y: number;
  angle: number;
}
export interface BsExpression {
  head: { x: number; y: number; z: number };
  eyes: { left: BsEye; right: BsEye; spacing: number };
  perspective: number;
  motion: { eyes: (typeof EYE_MOTIONS)[number]; body: (typeof BODY_MOTIONS)[number] };
  colors?: { body?: string; eyes?: string };
}
export interface BsStep {
  expression: string;
  holdMs: number;
  transitionMs: number;
  transition: (typeof TRANSITIONS)[number];
}
export interface BsBlink {
  enabled: boolean;
  initialDelayMs: number;
  minIntervalMs: number;
  maxIntervalMs: number;
  durationMs: number;
}
export interface BsAnimation {
  playbackMode: (typeof PLAYBACK_MODES)[number];
  steps: BsStep[];
  blink: BsBlink;
}
export interface BsNode {
  surface: BsSurface;
  position: [number, number, number];
  rotation: [number, number, number];
}
export interface BsAvatar {
  name: string;
  body: { primary: BsSurface; nodes: BsNode[] };
  colors: { body: string; eyes: string };
  expressions: Record<string, BsExpression>;
  animations: Record<string, BsAnimation>;
  animationOrder: string[];
}

const KEY = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const BOUND = { min: -10000, max: 10000 };

function key(v: unknown, path: string, errs: Errs): string | undefined {
  return str(v, path, errs, { min: 1, max: 64, pattern: KEY, hint: "must be a lower-case-with-dashes name" });
}

function surface(v: unknown, path: string, errs: Errs, allowed: readonly SurfaceType[]): BsSurface | undefined {
  if (!isRecord(v)) {
    errs.push(`${path}: must be an object`);
    return undefined;
  }
  noUnknownKeys(v, ["type", "width", "height", "depth", "roundness", "morphRoundness", "tipRoundness", "baseRoundness"], path, errs);
  const type = oneOf(v.type, `${path}.type`, errs, allowed);
  const width = num(v.width, `${path}.width`, errs, { min: 0.001, max: 10000 });
  const height = num(v.height, `${path}.height`, errs, { min: 0.001, max: 10000 });
  num(v.depth, `${path}.depth`, errs, { min: 0.001, max: 10000 });
  const roundness = num(v.roundness, `${path}.roundness`, errs, { min: 0, max: 2 });
  for (const extra of ["morphRoundness", "tipRoundness", "baseRoundness"]) {
    if (v[extra] !== undefined) num(v[extra], `${path}.${extra}`, errs, { min: 0, max: 2 });
  }
  if (type === undefined || width === undefined || height === undefined || roundness === undefined) return undefined;
  return { type, width, height, roundness };
}

function triple(v: unknown, path: string, errs: Errs, min: number, max: number): [number, number, number] | undefined {
  if (!Array.isArray(v) || v.length !== 3) {
    errs.push(`${path}: must be a list of 3 numbers`);
    return undefined;
  }
  const out = v.map((n, i) => num(n, `${path}[${i}]`, errs, { min, max }));
  return out.every((n) => n !== undefined) ? (out as [number, number, number]) : undefined;
}

function eye(v: unknown, path: string, errs: Errs): BsEye | undefined {
  if (!isRecord(v)) {
    errs.push(`${path}: must be an object`);
    return undefined;
  }
  noUnknownKeys(v, ["width", "height", "x", "y", "angle"], path, errs);
  const width = num(v.width, `${path}.width`, errs, BOUND);
  const height = num(v.height, `${path}.height`, errs, BOUND);
  const x = num(v.x, `${path}.x`, errs, BOUND);
  const y = num(v.y, `${path}.y`, errs, BOUND);
  const angle = num(v.angle, `${path}.angle`, errs, BOUND);
  if ([width, height, x, y, angle].some((n) => n === undefined)) return undefined;
  return { width: width!, height: height!, x: x!, y: y!, angle: angle! };
}

function expression(v: unknown, path: string, errs: Errs): BsExpression | undefined {
  if (!isRecord(v)) {
    errs.push(`${path}: must be an object`);
    return undefined;
  }
  noUnknownKeys(v, ["head", "eyes", "perspective", "motion", "colors"], path, errs);

  let head: BsExpression["head"] | undefined;
  if (isRecord(v.head)) {
    noUnknownKeys(v.head, ["x", "y", "z"], `${path}.head`, errs);
    const x = num(v.head.x, `${path}.head.x`, errs, BOUND);
    const y = num(v.head.y, `${path}.head.y`, errs, BOUND);
    const z = num(v.head.z, `${path}.head.z`, errs, BOUND);
    if (x !== undefined && y !== undefined && z !== undefined) head = { x, y, z };
  } else errs.push(`${path}.head: must be an object`);

  let eyes: BsExpression["eyes"] | undefined;
  if (isRecord(v.eyes)) {
    noUnknownKeys(v.eyes, ["left", "right", "spacing"], `${path}.eyes`, errs);
    const left = eye(v.eyes.left, `${path}.eyes.left`, errs);
    const right = eye(v.eyes.right, `${path}.eyes.right`, errs);
    const spacing = num(v.eyes.spacing, `${path}.eyes.spacing`, errs, BOUND);
    if (left && right && spacing !== undefined) eyes = { left, right, spacing };
  } else errs.push(`${path}.eyes: must be an object`);

  const perspective = num(v.perspective, `${path}.perspective`, errs, { min: 0.1, max: 10 });

  let motion: BsExpression["motion"] | undefined;
  if (isRecord(v.motion)) {
    noUnknownKeys(v.motion, ["eyes", "body"], `${path}.motion`, errs);
    const e = oneOf(v.motion.eyes, `${path}.motion.eyes`, errs, EYE_MOTIONS);
    const b = oneOf(v.motion.body, `${path}.motion.body`, errs, BODY_MOTIONS);
    if (e && b) motion = { eyes: e, body: b };
  } else errs.push(`${path}.motion: must be an object`);

  let colors: BsExpression["colors"];
  if (v.colors !== undefined) {
    if (isRecord(v.colors)) {
      noUnknownKeys(v.colors, ["body", "eyes"], `${path}.colors`, errs);
      colors = {};
      if (v.colors.body !== undefined) colors.body = hexColor(v.colors.body, `${path}.colors.body`, errs);
      if (v.colors.eyes !== undefined) colors.eyes = hexColor(v.colors.eyes, `${path}.colors.eyes`, errs);
    } else errs.push(`${path}.colors: must be an object`);
  }

  if (!head || !eyes || perspective === undefined || !motion) return undefined;
  return { head, eyes, perspective, motion, ...(colors ? { colors } : {}) };
}

function blink(v: unknown, path: string, errs: Errs): BsBlink | undefined {
  if (!isRecord(v)) {
    errs.push(`${path}: must be an object`);
    return undefined;
  }
  noUnknownKeys(v, ["enabled", "initialDelayMs", "minIntervalMs", "maxIntervalMs", "durationMs"], path, errs);
  if (typeof v.enabled !== "boolean") errs.push(`${path}.enabled: must be true or false`);
  const initialDelayMs = num(v.initialDelayMs, `${path}.initialDelayMs`, errs, { min: 0, max: 60000 });
  const minIntervalMs = num(v.minIntervalMs, `${path}.minIntervalMs`, errs, { min: 250, max: 120000 });
  const maxIntervalMs = num(v.maxIntervalMs, `${path}.maxIntervalMs`, errs, { min: 250, max: 120000 });
  const durationMs = num(v.durationMs, `${path}.durationMs`, errs, { min: 50, max: 2000 });
  if (typeof v.enabled !== "boolean" || initialDelayMs === undefined || minIntervalMs === undefined || maxIntervalMs === undefined || durationMs === undefined) return undefined;
  return { enabled: v.enabled, initialDelayMs, minIntervalMs, maxIntervalMs, durationMs };
}

function animation(v: unknown, path: string, errs: Errs, known: ReadonlySet<string>): BsAnimation | undefined {
  if (!isRecord(v)) {
    errs.push(`${path}: must be an object`);
    return undefined;
  }
  noUnknownKeys(v, ["playbackMode", "steps", "blink", "metadata"], path, errs);
  const playbackMode = oneOf(v.playbackMode, `${path}.playbackMode`, errs, PLAYBACK_MODES);
  const steps: BsStep[] = [];
  if (!Array.isArray(v.steps) || v.steps.length < 1 || v.steps.length > 128) {
    errs.push(`${path}.steps: must be a list of 1 to 128 steps`);
  } else {
    v.steps.forEach((raw, i) => {
      const p = `${path}.steps[${i}]`;
      if (!isRecord(raw)) {
        errs.push(`${p}: must be an object`);
        return;
      }
      noUnknownKeys(raw, ["expression", "holdMs", "transitionMs", "transition"], p, errs);
      const expr = key(raw.expression, `${p}.expression`, errs);
      if (expr !== undefined && !known.has(expr)) errs.push(`${p}.expression: "${expr}" is not defined in expressions`);
      const holdMs = num(raw.holdMs, `${p}.holdMs`, errs, { min: 100, max: 60000 });
      const transitionMs = num(raw.transitionMs, `${p}.transitionMs`, errs, { min: 0, max: 5000 });
      const transition = oneOf(raw.transition, `${p}.transition`, errs, TRANSITIONS);
      if (expr !== undefined && known.has(expr) && holdMs !== undefined && transitionMs !== undefined && transition) {
        steps.push({ expression: expr, holdMs, transitionMs, transition });
      }
    });
  }
  const blinkValue = blink(v.blink, `${path}.blink`, errs);
  if (!playbackMode || !blinkValue || steps.length === 0) return undefined;
  return { playbackMode, steps, blink: blinkValue };
}

/** True when the JSON claims to be a Bible Strong avatar (used to pick the right validator). */
export function looksLikeBibleStrong(raw: unknown): boolean {
  return isRecord(raw) && raw.schema === BS_SCHEMA;
}

export function validateBibleStrongAvatar(raw: unknown): Result<BsAvatar> {
  if (!isRecord(raw)) return fail("avatar: must be a JSON object");
  const errs: Errs = [];
  noUnknownKeys(
    raw,
    ["schema", "schemaVersion", "name", "body", "colors", "expressions", "expressionOrder", "animations", "animationOrder", "standardAnimationSet"],
    "",
    errs,
  );
  if (raw.schema !== BS_SCHEMA) errs.push(`schema: must be "${BS_SCHEMA}"`);
  if (raw.schemaVersion !== 1) errs.push("schemaVersion: only version 1 is supported");
  const name = raw.name === undefined ? "Avatar" : str(raw.name, "name", errs, { min: 1, max: 120 });

  // body
  let primary: BsSurface | undefined;
  const nodes: BsNode[] = [];
  if (isRecord(raw.body)) {
    noUnknownKeys(raw.body, ["primary", "nodes"], "body", errs);
    primary = surface(raw.body.primary, "body.primary", errs, SURFACE_TYPES);
    if (!Array.isArray(raw.body.nodes) || raw.body.nodes.length > 16) {
      errs.push("body.nodes: must be a list of at most 16 shapes");
    } else {
      raw.body.nodes.forEach((n, i) => {
        const p = `body.nodes[${i}]`;
        if (!isRecord(n)) {
          errs.push(`${p}: must be an object`);
          return;
        }
        noUnknownKeys(n, ["surface", "position", "rotation"], p, errs);
        const s = surface(n.surface, `${p}.surface`, errs, NODE_SURFACE_TYPES);
        const position = triple(n.position, `${p}.position`, errs, BOUND.min, BOUND.max);
        const rotation = triple(n.rotation, `${p}.rotation`, errs, -360, 360);
        if (s && position && rotation) nodes.push({ surface: s, position, rotation });
      });
    }
  } else errs.push("body: must be an object");

  // colours
  let colors: BsAvatar["colors"] | undefined;
  if (isRecord(raw.colors)) {
    noUnknownKeys(raw.colors, ["body", "eyes"], "colors", errs);
    const body = hexColor(raw.colors.body, "colors.body", errs);
    const eyes = hexColor(raw.colors.eyes, "colors.eyes", errs);
    if (body && eyes) colors = { body, eyes };
  } else errs.push("colors: must be an object");

  // expressions
  const expressions: Record<string, BsExpression> = Object.create(null);
  if (isRecord(raw.expressions)) {
    const names = Object.keys(raw.expressions);
    if (names.length < 1 || names.length > 128) errs.push("expressions: must have 1 to 128 entries");
    if (!names.includes("neutral")) errs.push('expressions: a "neutral" expression is required');
    for (const n of names.slice(0, 128)) {
      if (key(n, `expressions.${n.slice(0, 30)}`, errs) === undefined) continue;
      const e = expression(raw.expressions[n], `expressions.${n}`, errs);
      if (e) expressions[n] = e;
    }
  } else errs.push("expressions: must be an object");

  // animations
  const animations: Record<string, BsAnimation> = Object.create(null);
  const known = new Set(Object.keys(expressions));
  if (isRecord(raw.animations)) {
    const names = Object.keys(raw.animations);
    if (names.length > 64) errs.push("animations: at most 64 entries");
    for (const n of names.slice(0, 64)) {
      if (key(n, `animations.${n.slice(0, 30)}`, errs) === undefined) continue;
      const a = animation(raw.animations[n], `animations.${n}`, errs, known);
      if (a) animations[n] = a;
    }
  } else errs.push("animations: must be an object");

  const animationOrder: string[] = [];
  if (Array.isArray(raw.animationOrder) && raw.animationOrder.length <= 64) {
    for (const [i, n] of raw.animationOrder.entries()) {
      const k = key(n, `animationOrder[${i}]`, errs);
      if (k !== undefined && k in animations) animationOrder.push(k);
    }
  } else errs.push("animationOrder: must be a list of at most 64 names");
  if (!Array.isArray(raw.expressionOrder) || raw.expressionOrder.length > 128) {
    errs.push("expressionOrder: must be a list of at most 128 names");
  }

  if (errs.length > 0 || !primary || !colors || !("neutral" in expressions)) {
    return fail(...(errs.length > 0 ? errs : ["avatar: could not be read"]));
  }
  return ok({ name: name ?? "Avatar", body: { primary, nodes }, colors, expressions, animations, animationOrder });
}
