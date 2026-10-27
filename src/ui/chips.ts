// Which chips the small view shows. Pure, so the rule is easy to test.

import type { Chip, Tone } from "../pills/types";

const NEEDS_ATTENTION: ReadonlySet<Tone> = new Set<Tone>(["warn", "danger"]);

/**
 * Chips in pill order. A chip the user switched off stays hidden, except that a pill which
 * needs attention (amber or red) always shows, so a problem is never silently tucked away.
 */
export function visibleChips(
  order: readonly string[],
  chips: ReadonlyMap<string, Chip>,
  tones: ReadonlyMap<string, Tone>,
  hidden: ReadonlySet<string>,
): [string, Chip][] {
  const out: [string, Chip][] = [];
  for (const id of order) {
    const chip = chips.get(id);
    if (!chip) continue;
    if (hidden.has(id) && !NEEDS_ATTENTION.has(tones.get(id) ?? "neutral")) continue;
    out.push([id, chip]);
  }
  return out;
}
