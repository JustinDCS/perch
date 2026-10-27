import { toNumber } from "../lib/jsonpath";
import type { Threshold, Tone } from "./types";

/** First matching rule wins. No match means "neutral". */
export function toneFor(value: unknown, thresholds: Threshold[]): Tone {
  const n = toNumber(value);
  for (const rule of thresholds) {
    if (rule.equals !== undefined) {
      if (String(value) === String(rule.equals)) return rule.tone;
      continue;
    }
    if (n === undefined) continue;
    if (rule.gte !== undefined && n < rule.gte) continue;
    if (rule.lte !== undefined && n > rule.lte) continue;
    return rule.tone;
  }
  return "neutral";
}
