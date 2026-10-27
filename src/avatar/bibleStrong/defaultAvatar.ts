// Perch's built-in avatar. It is written in the same file format as avatars made in Bible Strong
// Avatar Lab (round body, two pill-shaped eyes, no mouth), so it is played by the same code as
// any imported avatar and users can use it as a starting point. The design is Perch's own.

import { type BsAvatar, validateBibleStrongAvatar } from "./schema";

const eye = (width: number, height: number, y: number, angle = 0) => ({ width, height, x: 0, y, angle });
const motion = { eyes: "none", body: "none" };

function expression(opts: {
  left: ReturnType<typeof eye>;
  right?: ReturnType<typeof eye>;
  spacing: number;
  head?: { x: number; y: number; z: number };
  colors?: { body: string; eyes: string };
  motion?: { eyes: string; body: string };
}) {
  return {
    head: opts.head ?? { x: 0, y: 0, z: 0 },
    eyes: { left: opts.left, right: opts.right ?? opts.left, spacing: opts.spacing },
    perspective: 1,
    motion: opts.motion ?? motion,
    ...(opts.colors ? { colors: opts.colors } : {}),
  };
}

const step = (expression: string, holdMs: number, transitionMs: number, transition: "smooth" | "snappy" | "spring") => ({
  expression,
  holdMs,
  transitionMs,
  transition,
});

const slowBlink = { enabled: true, initialDelayMs: 2200, minIntervalMs: 3200, maxIntervalMs: 6000, durationMs: 220 };
const noBlink = { enabled: false, initialDelayMs: 0, minIntervalMs: 2000, maxIntervalMs: 4000, durationMs: 200 };

const MINT = { body: "#6fd9b8", eyes: "#10241d" };
const CORAL = { body: "#f58a7e", eyes: "#2a1512" };
const SLATE = { body: "#8a93ad", eyes: "#161a24" };

export const DEFAULT_AVATAR_DEFINITION = {
  schema: "bible-strong/avatar-definition",
  schemaVersion: 1,
  name: "Perch",
  body: { primary: { type: "sphere", width: 240, height: 240, depth: 240, roundness: 1 }, nodes: [] },
  colors: { body: "#f2b94b", eyes: "#1d1708" },
  expressions: {
    neutral: expression({ left: eye(25, 62, -9), spacing: 58 }),
    "glance-left": expression({ left: eye(25, 62, -9), spacing: 58, head: { x: 3, y: -16, z: 0 } }),
    "glance-right": expression({ left: eye(25, 62, -9), spacing: 58, head: { x: 3, y: 16, z: 0 } }),
    joyful: expression({ left: eye(31, 86, -12), spacing: 72, head: { x: 8, y: -10, z: -6 }, colors: MINT }),
    "joyful-bob": expression({ left: eye(33, 64, -4, -10), right: eye(33, 64, -4, 10), spacing: 78, head: { x: -4, y: 10, z: 6 }, colors: MINT, motion: { eyes: "none", body: "slowDrift" } }),
    // the dances: all mint, each with its own feel
    "bounce-up": expression({ left: eye(32, 100, -16), spacing: 74, head: { x: 14, y: 0, z: 0 }, colors: MINT }),
    "sway-left": expression({ left: eye(30, 70, -8, -8), right: eye(30, 70, -8, 8), spacing: 70, head: { x: 2, y: -16, z: -9 }, colors: MINT }),
    "sway-right": expression({ left: eye(30, 70, -8, -8), right: eye(30, 70, -8, 8), spacing: 70, head: { x: 2, y: 16, z: 9 }, colors: MINT }),
    cheer: expression({ left: eye(34, 96, -14), spacing: 80, head: { x: 16, y: 0, z: 0 }, colors: MINT }),
    "cheer-low": expression({ left: eye(36, 52, -2), spacing: 82, head: { x: -3, y: 0, z: 0 }, colors: MINT }),
    "laugh-a": expression({ left: eye(40, 30, -2, -16), right: eye(40, 30, -2, 16), spacing: 74, head: { x: 4, y: -4, z: -9 }, colors: MINT }),
    "laugh-b": expression({ left: eye(40, 28, 0, -16), right: eye(40, 28, 0, 16), spacing: 76, head: { x: -2, y: 4, z: 9 }, colors: MINT, motion: { eyes: "none", body: "slowDrift" } }),
    surprised: expression({ left: eye(53, 53, -4), spacing: 76, head: { x: 5, y: 0, z: 0 }, colors: CORAL, motion: { eyes: "microSaccades", body: "none" } }),
    "surprised-wide": expression({ left: eye(60, 60, -4), spacing: 82, head: { x: 8, y: 0, z: 0 }, colors: CORAL, motion: { eyes: "microSaccades", body: "none" } }),
    sleeping: expression({ left: eye(53, 18, 0), spacing: 78, head: { x: -10, y: 0, z: 0 }, colors: SLATE }),
    "sleeping-deep": expression({ left: eye(53, 16, 4), spacing: 78, head: { x: -16, y: 0, z: 0 }, colors: SLATE, motion: { eyes: "none", body: "slowDrift" } }),
  },
  expressionOrder: ["neutral", "glance-left", "glance-right", "joyful", "joyful-bob", "bounce-up", "sway-left", "sway-right", "cheer", "cheer-low", "laugh-a", "laugh-b", "surprised", "surprised-wide", "sleeping", "sleeping-deep"],
  animations: {
    idle: {
      playbackMode: "loop",
      steps: [step("neutral", 3200, 600, "smooth"), step("glance-left", 1800, 500, "smooth"), step("neutral", 2600, 600, "smooth"), step("glance-right", 1800, 500, "smooth")],
      blink: slowBlink,
    },
    happy: {
      playbackMode: "loop",
      steps: [step("joyful", 600, 450, "spring"), step("joyful-bob", 600, 450, "spring")],
      blink: { ...slowBlink, minIntervalMs: 2600, maxIntervalMs: 4600 },
    },
    excited: {
      playbackMode: "loop",
      steps: [step("bounce-up", 320, 240, "snappy"), step("joyful-bob", 320, 240, "snappy"), step("bounce-up", 320, 240, "snappy"), step("joyful", 380, 260, "spring")],
      blink: { ...slowBlink, minIntervalMs: 2800, maxIntervalMs: 5000 },
    },
    playful: {
      playbackMode: "pingPong",
      steps: [step("sway-left", 700, 650, "smooth"), step("joyful", 350, 400, "smooth"), step("sway-right", 700, 650, "smooth")],
      blink: { ...slowBlink, minIntervalMs: 2600, maxIntervalMs: 4800 },
    },
    celebrate: {
      playbackMode: "loop",
      steps: [step("cheer", 500, 320, "spring"), step("cheer-low", 260, 260, "snappy"), step("cheer", 500, 320, "spring"), step("joyful-bob", 500, 360, "spring")],
      blink: noBlink,
    },
    laughing: {
      playbackMode: "loop",
      steps: [step("laugh-a", 240, 170, "snappy"), step("laugh-b", 240, 170, "snappy"), step("laugh-a", 240, 170, "snappy"), step("laugh-b", 240, 170, "snappy"), step("joyful", 700, 420, "smooth")],
      blink: noBlink,
    },
    surprised: {
      playbackMode: "loop",
      steps: [step("surprised", 900, 250, "spring"), step("surprised-wide", 500, 250, "spring")],
      blink: noBlink,
    },
    sleeping: {
      playbackMode: "loop",
      steps: [step("sleeping", 3600, 800, "smooth"), step("sleeping-deep", 3600, 900, "smooth")],
      blink: noBlink,
    },
  },
  animationOrder: ["idle", "happy", "excited", "playful", "celebrate", "laughing", "surprised", "sleeping"],
};

function build(): BsAvatar {
  const result = validateBibleStrongAvatar(DEFAULT_AVATAR_DEFINITION);
  if (!result.ok) throw new Error(`built-in avatar is invalid: ${result.errors.join("; ")}`);
  return result.value;
}

export const DEFAULT_BS_AVATAR: BsAvatar = build();
