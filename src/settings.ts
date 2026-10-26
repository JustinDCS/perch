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

const HIDE_QUIET_KEY = "perch.hideWhenQuiet";

/** Should the island shrink to a sliver when nothing is happening? On unless the user turned it off. */
export function getHideWhenQuiet(): boolean {
  try {
    return localStorage.getItem(HIDE_QUIET_KEY) !== "0";
  } catch {
    return true;
  }
}

export function setHideWhenQuiet(value: boolean): void {
  try {
    localStorage.setItem(HIDE_QUIET_KEY, value ? "1" : "0");
  } catch {
    // ignore
  }
}
