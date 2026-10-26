// Choosing between several apps that are all reporting media to Windows. Pure, so it can be tested.

export interface Source {
  id: string;
  playing: boolean;
}

/** Stable order, whatever order Windows lists them in, so cycling is predictable. */
export function ordered(sources: readonly Source[]): Source[] {
  return [...sources].sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Keep the user's pick only while it still makes sense: drop it when that app has gone, or when
 * it was playing, has paused, and something else is playing (then Windows' own choice is better).
 * A paused app the user just switched to on purpose is kept, so they can press play on it.
 */
export function validChoice(chosen: string | null, sources: readonly Source[], seenPlaying: boolean): string | null {
  if (chosen === null) return null;
  const found = sources.find((s) => s.id === chosen);
  if (!found) return null;
  if (seenPlaying && !found.playing && sources.some((s) => s.playing)) return null;
  return chosen;
}

/** The source after `current` in the list, wrapping round. Undefined if there is nothing else. */
export function nextSource(sources: readonly Source[], current: string): string | undefined {
  const list = ordered(sources);
  if (list.length < 2) return undefined;
  const at = list.findIndex((s) => s.id === current);
  return list[(at + 1) % list.length]!.id;
}

export interface SourceBadge {
  text: string;
  /** another app is playing right now, so this deserves attention */
  busy: boolean;
}

export function badge(sources: readonly Source[], currentId: string): SourceBadge | null {
  if (sources.length < 2) return null;
  const others = sources.filter((s) => s.playing && s.id !== currentId).length;
  return others > 0 ? { text: `+${others} playing`, busy: true } : { text: `${sources.length} sources`, busy: false };
}

export function playingCount(sources: readonly Source[]): number {
  return sources.filter((s) => s.playing).length;
}
