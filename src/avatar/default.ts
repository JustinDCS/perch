import type { Avatar } from "./schema";

/** The avatar used when the user has not picked one. Same format as an uploaded avatar file. */
export const DEFAULT_AVATAR: Avatar = {
  perchAvatar: 1,
  name: "Perch",
  body: { shape: "squircle", width: 76, height: 68, color: "#f2b94b" },
  eyes: { color: "#1d1d24", size: 10, spacing: 26, y: 46, blinkSeconds: [3, 6] },
  mouth: { color: "#1d1d24", width: 12, y: 63 },
  states: {
    idle: { eyeOpen: 1, eyeOffsetX: 0, eyeOffsetY: 0, mouth: 0.3, animation: "breathe", speed: 1 },
    attention: {
      eyeOpen: 1.3,
      eyeOffsetX: 0,
      eyeOffsetY: -1,
      mouth: -0.25,
      bodyColor: "#f0784b",
      animation: "wiggle",
      speed: 2.5,
    },
    music: {
      eyeOpen: 0.55,
      eyeOffsetX: 0,
      eyeOffsetY: 1,
      mouth: 0.9,
      bodyColor: "#7dd3c0",
      animation: "bounce",
      speed: 1.6,
    },
  },
};
