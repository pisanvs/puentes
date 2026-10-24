// Spaced-repetition warmth decay — the "cold/warm" curve over TIME. Pure math, no DB, client-safe.
//
// Every warm-up (a logged contact, an engagement, a love-tap, the first connection) is an impulse:
//   • Attack  — instant: temperature jumps UP toward 1 ("pumped up"), by a fraction of the gap left.
//   • Release — exponential decay back toward 0 (cold), with a time-constant ("stability").
// Each successive warm-up pumps higher AND lengthens the release — stability grows geometrically,
// exactly like memory stability in spaced repetition (the forgetting curve flattens the more you
// revisit). So a well-tended relationship cools ever more slowly; a neglected one falls off fast.

import { DAY } from "./util";

const S_BASE = 9; // days — first release time-constant
const S_GROWTH = 1.7; // each warm-up multiplies stability (spacing effect)
const S_MAX = 200; // days — cap on how slow decay can get
const GAIN = 0.6; // attack: fraction of the remaining gap to 1 taken per warm-up
export const COLD = 0.3; // temperature at or below which they've gone cold

type Impulse = { t: number; temp: number; stabilityMs: number };

/** Build the impulse schedule: for each warm-up, the temperature right after it and its decay rate. */
function schedule(reinforcements: number[]): Impulse[] {
  const days = [...new Set(reinforcements.map((ms) => Math.floor(ms / DAY) * DAY))].sort((a, b) => a - b);
  const impulses: Impulse[] = [];
  let temp = 0;
  days.forEach((t, i) => {
    // Decay from the previous impulse down to this moment, then pump up.
    if (i > 0) temp = decay(impulses[i - 1], t);
    temp = temp + GAIN * (1 - temp); // attack toward 1
    impulses.push({ t, temp, stabilityMs: Math.min(S_BASE * S_GROWTH ** i, S_MAX) * DAY });
  });
  return impulses;
}

const decay = (imp: Impulse, t: number) => imp.temp * Math.exp(-(t - imp.t) / imp.stabilityMs);

/** Temperature (0..1) at time t given the impulse schedule. 0 before the first warm-up. */
function tempAt(impulses: Impulse[], t: number): number {
  if (!impulses.length || t < impulses[0].t) return 0;
  let last = impulses[0];
  for (const imp of impulses) {
    if (imp.t <= t) last = imp;
    else break;
  }
  return decay(last, t);
}

export type CurvePoint = { t: number; v: number };
export type WarmthDecay = {
  points: CurvePoint[];
  impulses: CurvePoint[]; // temperature at each warm-up (for dots)
  now: number;
  nowTemp: number;
  coldAt: number | null; // when temperature crosses COLD, forward or past; null if none
  stabilityDays: number; // current release length
  cold: number;
};

/**
 * Sample the warm/cold curve for one person's reinforcement history, from their first warm-up to a
 * bit past either "now" or the projected cold date — whichever is later — so the graph always shows
 * where they're headed.
 */
export function warmthDecayCurve(reinforcements: number[], now = Date.now(), samples = 90): WarmthDecay {
  const impulses = schedule(reinforcements);
  if (!impulses.length) {
    return { points: [], impulses: [], now, nowTemp: 0, coldAt: null, stabilityDays: S_BASE, cold: COLD };
  }

  const last = impulses[impulses.length - 1];
  const nowTemp = tempAt(impulses, now);
  // Solve decay(last, t) = COLD for t: the projected cold-crossing after the last warm-up.
  const coldAt = last.temp > COLD ? last.t + last.stabilityMs * Math.log(last.temp / COLD) : last.t;

  const start = impulses[0].t;
  const end = Math.max(now + 10 * DAY, coldAt + 5 * DAY);
  const points: CurvePoint[] = [];
  for (let i = 0; i <= samples; i++) {
    const t = start + ((end - start) * i) / samples;
    points.push({ t, v: tempAt(impulses, t) });
  }

  return {
    points,
    impulses: impulses.map((imp) => ({ t: imp.t, v: imp.temp })),
    now,
    nowTemp,
    coldAt,
    stabilityDays: Math.round(last.stabilityMs / DAY),
    cold: COLD,
  };
}
