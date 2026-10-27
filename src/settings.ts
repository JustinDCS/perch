import { parseStore, type Store } from "./pills/variables";
import { SOUND_MODES, type SoundMode } from "./sound/sounds";
import { parsePlacement, type Placement } from "./ui/placement";

// Per-user UI preferences kept in localStorage. Everything is wrapped in try/catch because
// storage can be unavailable or cleared; the app must work with defaults in that case.

const DISABLED_KEY = "perch.disabledPills";
const AVATAR_KEY = "perch.avatarFile";

export function getDisabledPills(): Set<string> {
  try {
    const raw = localStorage.getItem(DISABLED_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : []);
  } catch {
    return new Set();
  }
}

export function setPillEnabled(id: string, enabled: boolean): void {
  const disabled = getDisabledPills();
  if (enabled) disabled.delete(id);
  else disabled.add(id);
  try {
    localStorage.setItem(DISABLED_KEY, JSON.stringify([...disabled]));
  } catch {
    // ignore: the change just will not persist
  }
}

/** File name of the chosen avatar, or null for the built-in one. */
export function getAvatarFile(): string | null {
  try {
    return localStorage.getItem(AVATAR_KEY) || null;
  } catch {
    return null;
  }
}

export function setAvatarFile(file: string | null): void {
  try {
    if (file) localStorage.setItem(AVATAR_KEY, file);
    else localStorage.removeItem(AVATAR_KEY);
  } catch {
    // ignore
  }
}

const STAY_VISIBLE_KEY = "perch.stayVisible";

/** Should Perch stay out on the ledge when nothing is happening? On unless the user turned it off
 *  (off: the old thin sliver at the top edge). */
export function getStayVisible(): boolean {
  try {
    return localStorage.getItem(STAY_VISIBLE_KEY) !== "0";
  } catch {
    return true;
  }
}

export function setStayVisible(value: boolean): void {
  try {
    localStorage.setItem(STAY_VISIBLE_KEY, value ? "1" : "0");
  } catch {
    // ignore
  }
}

// ---- where the island sits -----------------------------------------------------------------


const PLACEMENT_KEY = "perch.placement";

export function getPlacement(): Placement | null {
  try {
    const raw = localStorage.getItem(PLACEMENT_KEY);
    return raw ? parsePlacement(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

/** Save where the island sits, or with null forget it (back to centre of the current screen). */
export function setPlacement(placement: Placement | null): void {
  try {
    if (placement) localStorage.setItem(PLACEMENT_KEY, JSON.stringify(placement));
    else localStorage.removeItem(PLACEMENT_KEY);
  } catch {
    // ignore
  }
}

// ---- how long the pointer must rest on the island before it opens -----------------------------

const OPEN_DELAY_KEY = "perch.openDelayMs";
export const OPEN_DELAYS = [
  { ms: 0, label: "Instantly" },
  { ms: 500, label: "Half a second" },
  { ms: 900, label: "One second" },
  { ms: 1500, label: "Two seconds" },
] as const;
export const DEFAULT_OPEN_DELAY_MS = 900;

export function getOpenDelay(): number {
  try {
    const value = Number(localStorage.getItem(OPEN_DELAY_KEY));
    return localStorage.getItem(OPEN_DELAY_KEY) !== null && OPEN_DELAYS.some((d) => d.ms === value) ? value : DEFAULT_OPEN_DELAY_MS;
  } catch {
    return DEFAULT_OPEN_DELAY_MS;
  }
}

export function setOpenDelay(ms: number): void {
  try {
    localStorage.setItem(OPEN_DELAY_KEY, String(ms));
  } catch {
    // ignore
  }
}

// ---- when the avatar's eyes follow the pointer ------------------------------------------------

export type GazeMode = "open" | "always" | "never";
export const GAZE_MODES: { mode: GazeMode; label: string }[] = [
  { mode: "open", label: "Only when it is open" },
  { mode: "always", label: "Always" },
  { mode: "never", label: "Never" },
];
const GAZE_KEY = "perch.gazeMode";

export function getGazeMode(): GazeMode {
  try {
    const value = localStorage.getItem(GAZE_KEY);
    return GAZE_MODES.some((g) => g.mode === value) ? (value as GazeMode) : "open";
  } catch {
    return "open";
  }
}

export function setGazeMode(mode: GazeMode): void {
  try {
    localStorage.setItem(GAZE_KEY, mode);
  } catch {
    // ignore
  }
}

// ---- the avatar pokes its head out now and then while the island is hidden --------------------

const PEEK_KEY = "perch.peeks";

export function getPeeks(): boolean {
  try {
    return localStorage.getItem(PEEK_KEY) !== "0";
  } catch {
    return true;
  }
}

export function setPeeks(value: boolean): void {
  try {
    localStorage.setItem(PEEK_KEY, value ? "1" : "0");
  } catch {
    // ignore
  }
}

// ---- sounds ------------------------------------------------------------------------------------


const SOUND_MODE_KEY = "perch.soundMode";
const SOUND_VOLUME_KEY = "perch.soundVolume";
export const DEFAULT_SOUND_VOLUME = 0.35;

export function getSoundMode(): SoundMode {
  try {
    const value = localStorage.getItem(SOUND_MODE_KEY);
    return SOUND_MODES.some((m) => m.mode === value) ? (value as SoundMode) : "all";
  } catch {
    return "all";
  }
}

export function setSoundMode(mode: SoundMode): void {
  try {
    localStorage.setItem(SOUND_MODE_KEY, mode);
  } catch {
    // ignore
  }
}

export function getSoundVolume(): number {
  try {
    const raw = localStorage.getItem(SOUND_VOLUME_KEY);
    const value = raw === null ? NaN : Number(raw);
    return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : DEFAULT_SOUND_VOLUME;
  } catch {
    return DEFAULT_SOUND_VOLUME;
  }
}

export function setSoundVolume(volume: number): void {
  try {
    localStorage.setItem(SOUND_VOLUME_KEY, String(volume));
  } catch {
    // ignore
  }
}

// ---- which pills show a chip in the small view --------------------------------------------------

const HIDDEN_CHIPS_KEY = "perch.hiddenChips";

/** Pills the user does not want as a chip in the small view (they still show when open). */
export function getHiddenChips(): Set<string> {
  try {
    const raw = localStorage.getItem(HIDDEN_CHIPS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : []);
  } catch {
    return new Set();
  }
}

export function setChipShown(id: string, shown: boolean): void {
  const hidden = getHiddenChips();
  if (shown) hidden.delete(id);
  else hidden.add(id);
  try {
    localStorage.setItem(HIDDEN_CHIPS_KEY, JSON.stringify([...hidden]));
  } catch {
    // ignore
  }
}

// ---- pill variables (the blanks a pill leaves for the user) --------------------------------------

const PILL_VARS_KEY = "perch.pillVars";

export function getPillVarStore(): Store {
  try {
    const raw = localStorage.getItem(PILL_VARS_KEY);
    return raw ? parseStore(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

export function setPillVar(key: string, value: string): void {
  const store = getPillVarStore();
  if (value) store[key] = value;
  else delete store[key];
  try {
    localStorage.setItem(PILL_VARS_KEY, JSON.stringify(store));
  } catch {
    // ignore: the value just will not persist
  }
}
