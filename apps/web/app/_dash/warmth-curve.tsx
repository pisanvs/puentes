"use client";

import { warmthDecayCurve } from "@agent/lib/warmth-decay";
import { warmthColor, warmthLabel } from "@agent/lib/warmth-curve";

// Visualizes the spaced-repetition warm/cold curve: impulses (warm-ups) that pump temperature up and
// then release it on a lengthening exponential decay, plus the projected cold-crossing.
const W = 300;
const H = 86;
const PAD = { t: 10, r: 10, b: 16, l: 10 };

const shortDate = (ms: number) => new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" });

// `now` is passed from the server so server and client compute the identical curve (a bare Date.now()
// here would differ by a few ms between renders and trip a hydration mismatch).
export function WarmthCurve({ reinforcements, now }: { reinforcements: number[]; now: number }) {
  const curve = warmthDecayCurve(reinforcements, now);
  if (curve.points.length === 0) return null;

  const start = curve.points[0].t;
  const end = curve.points[curve.points.length - 1].t;
  const x = (t: number) => PAD.l + ((t - start) / (end - start || 1)) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + (1 - v) * (H - PAD.t - PAD.b);

  const line = curve.points.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)} ${y(p.v).toFixed(1)}`).join(" ");
  const area = `${line} L${x(end).toFixed(1)} ${y(0).toFixed(1)} L${x(start).toFixed(1)} ${y(0).toFixed(1)} Z`;
  const color = warmthColor(curve.nowTemp);
  const coldFuture = curve.coldAt != null && curve.coldAt > curve.now;

  return (
    <div className="rounded-xl border bg-card p-3">
      <div className="mb-1 flex items-baseline justify-between text-xs">
        <span className="font-medium" style={{ color }}>
          {warmthLabel(curve.nowTemp)} · {Math.round(curve.nowTemp * 100)}°
        </span>
        <span className="text-muted-foreground">
          {coldFuture
            ? `cools around ${shortDate(curve.coldAt!)} · release ~${curve.stabilityDays}d`
            : curve.coldAt != null
              ? `cold since ${shortDate(curve.coldAt)} — time to reconnect`
              : `release ~${curve.stabilityDays}d`}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="none" role="img" aria-label="Warmth over time">
        <defs>
          <linearGradient id="warmthFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.28" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Cold threshold */}
        <line x1={PAD.l} y1={y(curve.cold)} x2={W - PAD.r} y2={y(curve.cold)} stroke="currentColor" strokeOpacity="0.2" strokeWidth="1" strokeDasharray="3 3" />
        <text x={W - PAD.r} y={y(curve.cold) - 2} textAnchor="end" className="fill-muted-foreground" fontSize="8">
          cold
        </text>

        {/* Curve */}
        <path d={area} fill="url(#warmthFill)" />
        <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />

        {/* Warm-up impulses */}
        {curve.impulses.map((imp, i) => (
          <circle key={i} cx={x(imp.t)} cy={y(imp.v)} r="2.5" fill={warmthColor(imp.v)} stroke="var(--card)" strokeWidth="1" />
        ))}

        {/* Now marker */}
        <line x1={x(curve.now)} y1={PAD.t - 4} x2={x(curve.now)} y2={H - PAD.b} stroke="currentColor" strokeOpacity="0.45" strokeWidth="1" />
        <text x={x(curve.now)} y={H - 4} textAnchor="middle" className="fill-muted-foreground" fontSize="8">
          now
        </text>

        {/* Projected cold-crossing */}
        {coldFuture && (
          <>
            <circle cx={x(curve.coldAt!)} cy={y(curve.cold)} r="2.5" fill="none" stroke="currentColor" strokeOpacity="0.5" strokeWidth="1.5" />
            <text x={x(curve.coldAt!)} y={y(curve.cold) + 10} textAnchor="middle" className="fill-muted-foreground" fontSize="8">
              {shortDate(curve.coldAt!)}
            </text>
          </>
        )}
      </svg>
    </div>
  );
}
