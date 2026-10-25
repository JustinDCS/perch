// Perch accepts two avatar file formats: its own small one and the ".avatar.json" files made
// by Bible Strong Avatar Lab. This module hides the difference from the rest of the app.

import { type Result, fail, ok } from "../lib/validate";
import { createBibleStrongView } from "./bibleStrong/render";
import { type BsAvatar, looksLikeBibleStrong, validateBibleStrongAvatar } from "./bibleStrong/schema";
import { type AvatarView, createAvatarView } from "./renderer";
import { type Avatar, validateAvatar } from "./schema";

export type AnyAvatar = { kind: "perch"; avatar: Avatar } | { kind: "bible-strong"; avatar: BsAvatar };

export function validateAnyAvatar(raw: unknown): Result<AnyAvatar> {
  if (looksLikeBibleStrong(raw)) {
    const result = validateBibleStrongAvatar(raw);
    return result.ok ? ok({ kind: "bible-strong", avatar: result.value }) : fail(...result.errors);
  }
  const result = validateAvatar(raw);
  return result.ok ? ok({ kind: "perch", avatar: result.value }) : fail(...result.errors);
}

export function avatarName(a: AnyAvatar): string {
  return a.avatar.name;
}

export function createView(a: AnyAvatar): AvatarView {
  return a.kind === "perch" ? createAvatarView(a.avatar) : createBibleStrongView(a.avatar);
}
