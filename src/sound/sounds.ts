// Perch's sounds are tiny synthesised blips described as data, so there are no audio files to
// license, ship or load. This file is pure: it describes the sounds, which ones each mode lets
// through, and how often one may repeat. The player that makes noise is in player.ts.

export type SoundName = "alert" | "open" | "track" | "start" | "grab" | "drop" | "peek" | "wink" | "sleep" | "wake" | "pop" | "boo" | "kiss" | "munch";

export type SoundMode = "off" | "alerts" | "all";

export const SOUND_MODES: { mode: SoundMode; label: string }[] = [
  { mode: "all", label: "All sounds" },
  { mode: "alerts", label: "Alerts only" },
  { mode: "off", label: "Off" },
];

export interface Note {
  wave: "sine" | "triangle" | "square";
  /** Hz at the start, and Hz at the end if it glides */
  freq: number;
  freqEnd?: number;
  /** seconds after the sound begins */
  at: number;
  /** seconds */
  length: number;
  /** 0..1 before volume is applied */
  gain: number;
}

const note = (wave: Note["wave"], freq: number, at: number, length: number, gain: number, freqEnd?: number): Note => ({
  wave,
  freq,
  at,
  length,
  gain,
  ...(freqEnd === undefined ? {} : { freqEnd }),
});

export const SOUNDS: Record<SoundName, Note[]> = {
  // two quick chirps, higher the second time: "hey"
  alert: [note("triangle", 784, 0, 0.09, 0.7), note("triangle", 988, 0.1, 0.09, 0.7), note("triangle", 784, 0.3, 0.09, 0.7), note("triangle", 988, 0.4, 0.14, 0.7)],
  open: [note("sine", 660, 0, 0.09, 0.4, 880)],
  track: [note("sine", 523, 0, 0.12, 0.45, 784), note("sine", 1047, 0.09, 0.08, 0.2)],
  start: [note("sine", 392, 0, 0.08, 0.4), note("sine", 523, 0.07, 0.08, 0.4), note("sine", 659, 0.14, 0.14, 0.4)],
  grab: [note("sine", 600, 0, 0.07, 0.3, 900)],
  drop: [note("sine", 220, 0, 0.14, 0.6, 110)],
  peek: [note("sine", 440, 0, 0.11, 0.35, 587)],
  wink: [note("sine", 1319, 0, 0.05, 0.28), note("sine", 1760, 0.05, 0.08, 0.28)],
  sleep: [note("sine", 440, 0, 0.7, 0.28, 220)],
  wake: [note("sine", 330, 0, 0.16, 0.35, 494)],
  // seasonal: a pop, a spooky "boo", a little smooch, two munches
  pop: [note("triangle", 200, 0, 0.05, 0.5, 900), note("sine", 1200, 0.05, 0.12, 0.25, 1800)],
  boo: [note("triangle", 330, 0, 0.18, 0.4, 165), note("sine", 220, 0.18, 0.2, 0.3, 110)],
  kiss: [note("sine", 900, 0, 0.05, 0.3, 1300), note("sine", 1500, 0.07, 0.07, 0.25, 1100)],
  munch: [note("square", 180, 0, 0.05, 0.2, 120), note("square", 170, 0.15, 0.05, 0.2, 110)],
};

/** Smallest gap between two plays of the same sound, so nothing ever machine-guns. */
export const COOLDOWN_MS: Record<SoundName, number> = {
  alert: 4000,
  open: 1500,
  track: 2500,
  start: 4000,
  grab: 800,
  drop: 800,
  peek: 8000,
  wink: 8000,
  sleep: 30000,
  wake: 5000,
  pop: 8000,
  boo: 8000,
  kiss: 8000,
  munch: 8000,
};

export function allowedIn(mode: SoundMode, name: SoundName): boolean {
  return mode === "all" || (mode === "alerts" && name === "alert");
}

/** Remembers when each sound last played. */
export class Cooldowns {
  private last = new Map<SoundName, number>();
  /** True (and records the play) if the sound may play now. */
  take(name: SoundName, now: number): boolean {
    const before = this.last.get(name);
    if (before !== undefined && now - before < COOLDOWN_MS[name]) return false;
    this.last.set(name, now);
    return true;
  }
}

/** Volume in [0, 1] -> loudness. Squared so the slider feels even, and capped for headroom. */
export function loudness(volume: number): number {
  const v = Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : 0;
  return v * v * 0.5;
}

export interface PlannedNote extends Note {
  /** gain after volume */
  level: number;
}

export function plan(name: SoundName, volume: number): PlannedNote[] {
  const scale = loudness(volume);
  return SOUNDS[name].map((n) => ({ ...n, level: n.gain * scale }));
}
