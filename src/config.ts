// Loads pills and avatars from the user's config folder and validates them.
// Bad files never crash the app: they are reported as problems in Settings instead.

import { type AnyAvatar, DEFAULT_ANY_AVATAR, validateAnyAvatar } from "./avatar/any";
import { ipc, errorText } from "./ipc";
import { validatePill } from "./pills/manifest";
import type { PillManifest } from "./pills/types";

export interface Problem {
  kind: "pip" | "avatar";
  file: string;
  errors: string[];
}

export interface AvatarEntry {
  file: string;
  avatar: AnyAvatar;
}

export interface Config {
  pills: PillManifest[];
  avatars: AvatarEntry[];
  problems: Problem[];
}

export const BUILTIN_PILLS: PillManifest[] = [
  { perch: 1, id: "now-playing", name: "Now playing", kind: "now-playing" },
];

export const BUILTIN_AVATAR_FILE = "";

function parseJson(content: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(content) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "invalid JSON" };
  }
}

export async function loadConfig(): Promise<Config> {
  const pills: PillManifest[] = [...BUILTIN_PILLS];
  const avatars: AvatarEntry[] = [];
  const problems: Problem[] = [];
  const seen = new Set(pills.map((p) => p.id));

  const [pipFiles, avatarFiles] = await Promise.all([
    ipc.listUserFiles("pips").catch((err) => {
      problems.push({ kind: "pip", file: "(pips folder)", errors: [errorText(err)] });
      return [];
    }),
    ipc.listUserFiles("avatars").catch((err) => {
      problems.push({ kind: "avatar", file: "(avatars folder)", errors: [errorText(err)] });
      return [];
    }),
  ]);

  for (const file of pipFiles) {
    const parsed = parseJson(file.content);
    if (!parsed.ok) {
      problems.push({ kind: "pip", file: file.name, errors: [`not valid JSON: ${parsed.error}`] });
      continue;
    }
    const result = validatePill(parsed.value);
    if (!result.ok) {
      problems.push({ kind: "pip", file: file.name, errors: result.errors });
    } else if (seen.has(result.value.id)) {
      problems.push({ kind: "pip", file: file.name, errors: [`id "${result.value.id}" is already used by another pill`] });
    } else {
      seen.add(result.value.id);
      pills.push(result.value);
    }
  }

  for (const file of avatarFiles) {
    const parsed = parseJson(file.content);
    if (!parsed.ok) {
      problems.push({ kind: "avatar", file: file.name, errors: [`not valid JSON: ${parsed.error}`] });
      continue;
    }
    const result = validateAnyAvatar(parsed.value);
    if (result.ok) avatars.push({ file: file.name, avatar: result.value });
    else problems.push({ kind: "avatar", file: file.name, errors: result.errors });
  }

  return { pills, avatars, problems };
}

export function resolveAvatar(config: Config, file: string | null): AnyAvatar {
  if (file) {
    const entry = config.avatars.find((a) => a.file === file);
    if (entry) return entry.avatar;
  }
  return DEFAULT_ANY_AVATAR;
}
