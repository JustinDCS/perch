// Plays the sounds from sounds.ts with the Web Audio API. Nothing here touches the network or
// the file system. If audio is unavailable the calls quietly do nothing.

import { Cooldowns, allowedIn, plan, type SoundMode, type SoundName } from "./sounds";

export interface SoundSettings {
  mode: SoundMode;
  /** 0..1 */
  volume: number;
}

export function createSoundPlayer(read: () => SoundSettings): { play(name: SoundName, force?: boolean): void } {
  let context: AudioContext | null = null;
  const cooldowns = new Cooldowns();

  function audio(): AudioContext | null {
    if (context) return context;
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      context = new Ctor();
      return context;
    } catch {
      return null;
    }
  }

  // browsers keep audio suspended until the user has interacted; any click wakes it
  document.addEventListener("pointerdown", () => void context?.resume().catch(() => undefined), { passive: true });

  return {
    /** `force` skips the mode and cooldown, for the "Test" button. */
    play(name, force = false) {
      const { mode, volume } = read();
      if (!force && (!allowedIn(mode, name) || !cooldowns.take(name, performance.now()))) return;
      const ctx = audio();
      if (!ctx) return;
      void ctx.resume().catch(() => undefined);
      const start = ctx.currentTime + 0.02;
      for (const n of plan(name, volume)) {
        if (n.level <= 0) continue;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const from = start + n.at;
        const to = from + n.length;
        osc.type = n.wave;
        osc.frequency.setValueAtTime(n.freq, from);
        if (n.freqEnd !== undefined) osc.frequency.exponentialRampToValueAtTime(n.freqEnd, to);
        // a quick fade in and a smooth fade out, so there are no clicks
        gain.gain.setValueAtTime(0.0001, from);
        gain.gain.linearRampToValueAtTime(n.level, from + Math.min(0.01, n.length / 3));
        gain.gain.exponentialRampToValueAtTime(0.0001, to);
        osc.connect(gain).connect(ctx.destination);
        osc.start(from);
        osc.stop(to + 0.02);
      }
    },
  };
}
