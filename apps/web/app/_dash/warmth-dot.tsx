"use client";

import { warmthColor, warmthLabel, warmthNorm, warmthTone } from "@agent/lib/warmth-curve";
import { useEffect, useRef, useState } from "react";
import { bumpWarmth } from "./actions";

// Tuning for the "love tap". Spam-clicking builds a combo so each tap adds more RAW warmth; the
// sigmoid in warmth-curve.ts then squashes raw → 0..1, so gains shrink near the top on their own
// (0.95 → 0.99 is a grind). No separate diminishing clamp needed.
const BASE = 3; // raw points per tap at combo 0
const COMBO_WINDOW_MS = 350;
const COMBO_STEP = 0.3;
const COMBO_MAX = 18;
const FLUSH_MS = 600;

/**
 * Warmth indicator you can click to warm someone up. Fast repeated clicks ramp a combo multiplier
 * (the curve steepens the faster you go); the sigmoid makes the top asymptotic. Color, size and
 * label all run off the normalized value. Accumulated taps flush to the server debounced.
 */
export function WarmthDot({
  personId,
  warmth,
  withLabel,
  interactive = true,
}: {
  personId: number;
  warmth: number | null | undefined; // raw, uncapped
  withLabel?: boolean;
  interactive?: boolean;
}) {
  const [raw, setRaw] = useState(warmth ?? 0);
  const [pop, setPop] = useState(0);
  const [combo, setCombo] = useState(0);
  const lastClick = useRef(0);
  const comboRef = useRef(0);
  const pending = useRef(0);
  const flushTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const comboReset = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (pending.current === 0) setRaw(warmth ?? 0);
  }, [warmth]);
  useEffect(() => () => clearTimeout(flushTimer.current), []);

  const norm = warmthNorm(raw);
  const color = warmthColor(norm);

  const tap = (e: React.MouseEvent) => {
    if (!interactive) return;
    e.preventDefault();
    e.stopPropagation();

    const now = performance.now();
    const fast = now - lastClick.current < COMBO_WINDOW_MS;
    lastClick.current = now;
    comboRef.current = fast ? Math.min(comboRef.current + 1, COMBO_MAX) : 0;
    setCombo(comboRef.current);

    const delta = BASE * (1 + comboRef.current * COMBO_STEP); // steeper the faster you click
    setRaw((v) => v + delta);
    setPop((p) => p + 1);
    pending.current += delta;

    clearTimeout(comboReset.current);
    comboReset.current = setTimeout(() => {
      comboRef.current = 0;
      setCombo(0);
    }, COMBO_WINDOW_MS + 150);

    clearTimeout(flushTimer.current);
    flushTimer.current = setTimeout(() => {
      const amount = pending.current;
      pending.current = 0;
      if (amount > 0) bumpWarmth(personId, amount);
    }, FLUSH_MS);
  };

  const size = 12 + Math.round(norm * 8); // 12–20px; warmer = bigger

  return (
    <span
      className="inline-flex items-center gap-1.5"
      title={interactive ? "Click (and spam!) to warm them up" : `warmth ${Math.round(norm * 100)}/100`}
    >
      <button
        type="button"
        onClick={tap}
        disabled={!interactive}
        aria-label={`Warmth ${Math.round(norm * 100)} of 100${interactive ? ". Click to warm up." : ""}`}
        className={interactive ? "relative cursor-pointer rounded-full transition-transform hover:scale-125 active:scale-90" : "relative"}
        style={{ width: size, height: size, lineHeight: 0 }}
      >
        <span
          key={pop}
          className="block size-full rounded-full"
          style={{
            background: color,
            boxShadow: combo > 3 ? `0 0 ${Math.min(16, combo * 1.2)}px ${color}` : undefined,
            animation: pop ? "warmthPop 220ms ease-out" : undefined,
          }}
        />
        {combo > 2 && (
          <span className="pointer-events-none absolute -top-4 left-1/2 -translate-x-1/2 text-[10px] font-bold tabular-nums text-orange-500">
            ×{(1 + combo * COMBO_STEP).toFixed(1)}
          </span>
        )}
      </button>
      {withLabel && <span className={warmthTone(norm)}>{warmthLabel(norm)}</span>}
      <style>{`@keyframes warmthPop{0%{transform:scale(1)}40%{transform:scale(1.7)}100%{transform:scale(1)}}`}</style>
    </span>
  );
}
