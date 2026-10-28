// Seasonal looks: which season it is, and what Perch wears and does. The season logic is pure
// (dates in, season out) so it can be tested; the drawing is plain SVG strings.

export type Season = "newyear" | "halloween" | "valentines" | "christmas";

export const SEASONS: { id: Season; label: string; dates: string }[] = [
  { id: "newyear", label: "New Year", dates: "31 Dec – 2 Jan" },
  { id: "halloween", label: "Halloween", dates: "24 Oct – 1 Nov" },
  { id: "valentines", label: "Valentine's", dates: "12 – 14 Feb" },
  { id: "christmas", label: "Christmas", dates: "15 – 26 Dec" },
];

export type SeasonSetting = "auto" | "off";

/** The season a date falls in, or undefined. Months are 1-12. They never overlap. */
export function seasonOn(date: Date): Season | undefined {
  const m = date.getMonth() + 1;
  const d = date.getDate();
  if ((m === 12 && d === 31) || (m === 1 && d <= 2)) return "newyear";
  if ((m === 10 && d >= 24) || (m === 11 && d === 1)) return "halloween";
  if (m === 2 && d >= 12 && d <= 14) return "valentines";
  if (m === 12 && d >= 15 && d <= 26) return "christmas";
  return undefined;
}

/** Body colour a season paints the avatar with is not touched: only accessories are drawn, so any
 *  avatar works. These are drawn in a 80x58 box where the avatar's centre is (40, 31). */

const rect = (x: number, y: number, r: number, color: string) =>
  `<rect x="${x}" y="${y}" width="3" height="1.8" rx=".6" fill="${color}" transform="rotate(${r} ${x + 1.5} ${y + 0.9})"/>`;
const CONFETTI = ["#f2c14e", "#6fd9b8", "#f58aa8", "#8b6cf0"];
const confetti = (pts: [number, number, number][]) => pts.map(([x, y, r], i) => rect(x, y, r, CONFETTI[i % 4]!)).join("");
const bat = (x: number, y: number, s = 1) =>
  `<path transform="translate(${x} ${y}) scale(${s})" d="M0 0 Q3 -4 5 0 Q7 -4 10 0 Q8 1 7 4 Q5 2 5 2 Q5 2 3 4 Q2 1 0 0Z" fill="#8b6cf0"/>`;
const heart = (x: number, y: number, s = 1) =>
  `<path transform="translate(${x} ${y}) scale(${s})" d="M0 2 Q-3 -1 0 -3 Q2 -4 3 -2 Q4 -4 6 -3 Q9 -1 6 2 L3 6 Z" fill="#f2698f"/>`;

/** What sits on his head (moves with him when he hops or ducks). */
export const HATS: Record<Season, string> = {
  newyear:
    '<g transform="rotate(14 41 13)"><path d="M33 14 L41 -1 L49 14 Z" fill="#8b6cf0"/><path d="M36.2 9 L45.8 9 L47.4 12 L34.6 12 Z" fill="#f2c14e"/><circle cx="41" cy="-1" r="2.4" fill="#f2c14e"/></g>',
  halloween:
    '<g transform="rotate(-8 40 13)"><ellipse cx="40" cy="13.5" rx="15" ry="3" fill="#1b1620"/><path d="M32 13 Q35 8 37 5 Q39 2 44 -1 Q42 4 46 13 Z" fill="#241c30"/><path d="M33 11.2 L45.4 11.2 L45.9 13.4 L32.6 13.4 Z" fill="#8b6cf0"/></g>',
  valentines: '<circle cx="29" cy="38" r="3" fill="#f2698f" opacity=".55"/><circle cx="51" cy="38" r="3" fill="#f2698f" opacity=".55"/>',
  christmas:
    '<path d="M30 15 Q31 4 42 0 Q40 8 51 15 Z" fill="#d63a3a"/><rect x="28" y="13" width="24" height="4" rx="2" fill="#fff"/><circle cx="43" cy="0" r="2.6" fill="#fff"/>',
};

/** Slow ambient bits around the tab (they drift gently, or sit still with reduced motion). */
export const AMBIENT: Record<Season, string> = {
  newyear: confetti([[8, 18, 20], [6, 46, 40], [66, 16, -20], [70, 30, 35], [62, 44, -40]]),
  halloween: bat(8, 14, 0.8) + bat(62, 10, 0.8),
  valentines: heart(56, 14, 0.9) + heart(10, 22, 0.7),
  christmas: [[10, 20], [16, 40], [64, 24], [70, 44], [58, 52], [6, 52]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1" fill="#fff" opacity=".85"/>`).join(""),
};

/** The season's move: short, replaces the wink on about one peek in three. */
export interface SeasonMove {
  /** how long it takes, ms */
  ms: number;
  sound: "pop" | "boo" | "kiss" | "munch";
  /** when the sound plays, as a fraction of the move */
  soundAt: number;
  /** pieces that appear for a slice of the move: [svg, from, to] as fractions of its length */
  parts: [string, number, number][];
  /** how the avatar moves: translateY in px at fractions of the move (0 = resting) */
  body: [number, number][];
  /** eyes: what to ask the avatar to do, at a fraction of the move */
  eyes: [number, "glance-left" | "glance-right" | "glance-down" | "wide" | "wink" | "centre"][];
}

const popper = '<path d="M60 54 L67 42 L71 48 Z" fill="#d63a3a"/>';
const flower =
  '<path d="M58 56 Q60 42 62 32" stroke="#4a9a5a" stroke-width="1.4" fill="none"/><g transform="translate(62 30)"><circle r="2.2" cx="0" cy="-3" fill="#e84a6f"/><circle r="2.2" cx="3" cy="0" fill="#e84a6f"/><circle r="2.2" cx="0" cy="3" fill="#e84a6f"/><circle r="2.2" cx="-3" cy="0" fill="#e84a6f"/><circle r="1.6" fill="#f2c14e"/></g>';
const lips = '<path transform="translate(40 40)" d="M-3 0 Q-1.5 -2 0 -.6 Q1.5 -2 3 0 Q1.5 2.5 0 2.5 Q-1.5 2.5 -3 0Z" fill="#e84a6f"/>';
const cookie = '<circle cx="40" cy="54" r="5.5" fill="#b9792f"/><circle cx="38" cy="52" r=".9" fill="#4a2a10"/><circle cx="42" cy="55" r=".9" fill="#4a2a10"/>';
const bitten = '<circle cx="40" cy="54" r="5.5" fill="#b9792f"/><circle cx="38" cy="52" r=".9" fill="#4a2a10"/><circle cx="44" cy="51" r="2.8" fill="#111216"/>';
const milk = '<rect x="58" y="44" width="9" height="12" rx="1.5" fill="#f4f6fb"/><rect x="58" y="44" width="9" height="3" fill="#cfd5e2"/>';
const crumbs = '<circle cx="28" cy="54" r=".8" fill="#b9792f"/><circle cx="33" cy="56" r=".8" fill="#b9792f"/><circle cx="52" cy="56" r=".8" fill="#b9792f"/>';
const stache = '<path d="M33 38 Q40 35 47 38 Q44 41 40 39.5 Q36 41 33 38Z" fill="#fff"/>';

export const MOVES: Record<Season, SeasonMove> = {
  newyear: {
    ms: 2400,
    sound: "pop",
    soundAt: 0.45,
    parts: [
      [popper, 0.2, 0.45],
      [confetti([[6, 10, 20], [12, 26, -30], [8, 40, 40], [68, 12, -20], [70, 28, 35], [64, 42, -40], [30, 2, 10], [52, 3, -15], [72, 48, 15], [4, 50, 30]]), 0.45, 1],
    ],
    body: [[0, 0], [0.4, 0], [0.5, -4], [0.62, 0], [1, 0]],
    eyes: [[0, "glance-right"], [0.4, "centre"], [0.45, "wide"]],
  },
  halloween: {
    ms: 2400,
    sound: "boo",
    soundAt: 0.55,
    parts: [
      [bat(6, 12) + bat(64, 16, 1.1) + bat(58, 6, 0.8) + '<text x="40" y="57" font-size="6" font-weight="700" fill="#f2b94b" text-anchor="middle">BOO!</text>', 0.55, 0.9],
    ],
    body: [[0, 0], [0.12, 0], [0.3, 26], [0.5, 26], [0.58, -4], [0.7, 0], [1, 0]],
    eyes: [[0, "glance-left"], [0.12, "centre"], [0.55, "wide"]],
  },
  valentines: {
    ms: 2600,
    sound: "kiss",
    soundAt: 0.55,
    parts: [
      [flower, 0.2, 0.55],
      [lips + heart(56, 26), 0.55, 0.78],
      [heart(54, 14, 1.3) + heart(60, 24, 0.8), 0.78, 1],
    ],
    body: [[0, 0]],
    eyes: [[0, "glance-right"], [0.2, "centre"], [0.55, "wink"]],
  },
  christmas: {
    ms: 2800,
    sound: "munch",
    soundAt: 0.4,
    parts: [
      [cookie + milk, 0.15, 0.4],
      [bitten + milk + crumbs, 0.4, 0.62],
      [stache + crumbs, 0.62, 0.92],
    ],
    body: [[0, 0]],
    eyes: [[0, "glance-down"], [0.15, "centre"], [0.4, "wink"]],
  },
};

/** One peek in three gets the season's move. `rand` is injectable for tests. */
export function useSeasonMove(rand: () => number = Math.random): boolean {
  return rand() < 1 / 3;
}

/** Wrap the pieces of art in an SVG covering the 80x58 resting tab. */
export function svgLayer(inner: string, className: string): string {
  return `<svg class="${className}" viewBox="0 0 80 58" width="80" height="58" aria-hidden="true" focusable="false">${inner}</svg>`;
}
