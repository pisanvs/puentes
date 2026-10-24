// Pure warmth math + color, no DB — safe to import from the client and the server.
//
// Raw warmth (measured signals + manual "love taps") accumulates linearly and is unbounded.
// What we SHOW and color by is a logistic (sigmoid) squash of raw into (0,1): gains near the top
// shrink, so pushing from 0.95 → 0.99 takes far more than 0 → 0.5. Inner-circle membership is a
// cutoff on this normalized value, so warming someone up is how they join your inner circle.

const R0 = 35; // raw that maps to norm 0.5 (the inner-circle line)
const S = 12; // spread; larger = gentler curve

/** raw (0..∞) → normalized warmth (0..1). */
export function warmthNorm(raw: number | null | undefined): number {
  if (raw == null) return 0;
  return 1 / (1 + Math.exp(-(raw - R0) / S));
}

/** Inverse: the raw value needed to reach a given normalized warmth. */
export function rawForNorm(norm: number): number {
  const n = Math.min(0.999, Math.max(0.001, norm));
  return R0 + S * Math.log(n / (1 - n));
}

export const INNER_CIRCLE_CUTOFF = 0.5; // norm ≥ this ⇒ inner circle
export const isInnerCircle = (raw: number | null | undefined) => warmthNorm(raw) >= INNER_CIRCLE_CUTOFF;

export function warmthLabel(norm: number): string {
  if (norm >= 0.8) return "Hot";
  if (norm >= 0.5) return "Warm";
  if (norm >= 0.25) return "Cool";
  return "Cold";
}

// Continuous color ramp in OKLCH along the normalized value: slate → blue → amber → red-hot.
type Stop = { t: number; L: number; C: number; H: number };
const STOPS: Stop[] = [
  { t: 0.0, L: 0.58, C: 0.03, H: 255 },
  { t: 0.3, L: 0.64, C: 0.13, H: 235 },
  { t: 0.55, L: 0.7, C: 0.16, H: 70 },
  { t: 0.78, L: 0.67, C: 0.2, H: 40 },
  { t: 1.0, L: 0.63, C: 0.24, H: 22 },
];

export function warmthColor(norm: number): string {
  const n = Math.min(1, Math.max(0, norm));
  let a = STOPS[0];
  let b = STOPS[STOPS.length - 1];
  for (let i = 0; i < STOPS.length - 1; i++) {
    if (n >= STOPS[i].t && n <= STOPS[i + 1].t) {
      a = STOPS[i];
      b = STOPS[i + 1];
      break;
    }
  }
  const f = b.t === a.t ? 0 : (n - a.t) / (b.t - a.t);
  const lerp = (x: number, y: number) => x + (y - x) * f;
  return `oklch(${lerp(a.L, b.L).toFixed(3)} ${lerp(a.C, b.C).toFixed(3)} ${lerp(a.H, b.H).toFixed(1)})`;
}

/** Tailwind tone for the label text, by band. */
export function warmthTone(norm: number): string {
  if (norm >= 0.8) return "text-red-500 dark:text-red-400";
  if (norm >= 0.5) return "text-orange-600 dark:text-orange-400";
  if (norm >= 0.25) return "text-sky-600 dark:text-sky-400";
  return "text-muted-foreground";
}
