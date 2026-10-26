// Where the island sits: always flush with the top edge of one monitor, at some horizontal
// position along it. All maths is in physical pixels so mixed-DPI screens behave.

export interface MonitorBox {
  /** top-left of the usable area (taskbar excluded) */
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
  /** stable id for the monitor, from its position on the desktop */
  key: string;
}

export interface Placement {
  monitor: string;
  /** where the island's centre is along the monitor's width, 0 (left) to 1 (right) */
  xFrac: number;
}

export const DEFAULT_X_FRAC = 0.5;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function monitorKey(x: number, y: number): string {
  return `${Math.round(x)},${Math.round(y)}`;
}

/** Top-left of a window of `widthPx` placed on `monitor` with its centre at `xFrac`. */
export function windowOrigin(monitor: MonitorBox, xFrac: number, widthPx: number): { x: number; y: number } {
  const centre = monitor.x + clamp(xFrac, 0, 1) * monitor.width;
  const left = clamp(centre - widthPx / 2, monitor.x, Math.max(monitor.x, monitor.x + monitor.width - widthPx));
  return { x: Math.round(left), y: Math.round(monitor.y) };
}

/** Horizontal fraction for a window centre at `centrePx` (desktop coordinates). */
export function fracForCentre(monitor: MonitorBox, centrePx: number): number {
  return monitor.width <= 0 ? DEFAULT_X_FRAC : clamp((centrePx - monitor.x) / monitor.width, 0, 1);
}

/** The monitor containing the point, or the nearest one when it is in a gap. */
export function monitorAt(monitors: MonitorBox[], px: number, py: number): MonitorBox | undefined {
  let best: MonitorBox | undefined;
  let bestDistance = Infinity;
  for (const m of monitors) {
    const dx = px < m.x ? m.x - px : px > m.x + m.width ? px - (m.x + m.width) : 0;
    const dy = py < m.y ? m.y - py : py > m.y + m.height ? py - (m.y + m.height) : 0;
    const distance = Math.hypot(dx, dy);
    if (distance < bestDistance) {
      best = m;
      bestDistance = distance;
    }
  }
  return best;
}

/** Saved placement -> the monitor it refers to, falling back to `fallback` if it was unplugged. */
export function resolvePlacement(
  saved: Placement | null,
  monitors: MonitorBox[],
  fallback: MonitorBox | undefined,
): { monitor: MonitorBox; xFrac: number } | null {
  const match = saved ? monitors.find((m) => m.key === saved.monitor) : undefined;
  if (saved && match) return { monitor: match, xFrac: saved.xFrac };
  const monitor = fallback ?? monitors[0];
  return monitor ? { monitor, xFrac: DEFAULT_X_FRAC } : null;
}

export function parsePlacement(raw: unknown): Placement | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { monitor, xFrac } = raw as Record<string, unknown>;
  if (typeof monitor !== "string" || !/^-?\d+,-?\d+$/.test(monitor)) return null;
  if (typeof xFrac !== "number" || !Number.isFinite(xFrac)) return null;
  return { monitor, xFrac: clamp(xFrac, 0, 1) };
}
