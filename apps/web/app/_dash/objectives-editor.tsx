"use client";

import { Plus, Trash2 } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { deleteObjective, saveObjective, startRefresh } from "./actions";

type Objective = { id: number; text: string; weight: number };

const WEIGHTS = [
  { value: 0.5, label: "Low" },
  { value: 1, label: "Normal" },
  { value: 1.5, label: "High" },
  { value: 2, label: "Top" },
];
const nearest = (w: number) => WEIGHTS.reduce((a, b) => (Math.abs(b.value - w) < Math.abs(a.value - w) ? b : a)).value;

function WeightPicker({ value, onChange }: { value: number; onChange: (w: number) => void }) {
  return (
    <div role="radiogroup" aria-label="Priority" className="flex shrink-0 rounded-lg bg-muted p-0.5 text-xs">
      {WEIGHTS.map((w) => (
        <button
          key={w.value}
          type="button"
          role="radio"
          aria-checked={nearest(value) === w.value}
          onClick={() => onChange(w.value)}
          className={cn(
            "rounded-md px-2 py-1 transition-colors",
            nearest(value) === w.value ? "bg-card font-medium shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {w.label}
        </button>
      ))}
    </div>
  );
}

export function ObjectivesEditor({ initial }: { initial: Objective[] }) {
  const [items, setItems] = useState(initial);
  const [draft, setDraft] = useState({ text: "", weight: 1 });
  const [dirty, setDirty] = useState(false);
  const [pending, startTransition] = useTransition();
  useEffect(() => setItems(initial), [initial]);

  const persist = (o: Objective) => {
    setDirty(true);
    startTransition(() => saveObjective(o.text, o.weight, o.id));
  };

  return (
    <div className="space-y-4">
      <ul className="divide-y overflow-hidden rounded-xl border bg-card shadow-sm">
        {items.map((o) => (
          <li key={o.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
            <Input
              defaultValue={o.text}
              aria-label="Objective"
              className="border-transparent px-0 shadow-none focus-visible:border-input focus-visible:px-2"
              onBlur={(e) => {
                const text = e.target.value.trim();
                if (text && text !== o.text) persist({ ...o, text });
              }}
              onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            />
            <div className="flex items-center gap-1">
              <WeightPicker
                value={o.weight}
                onChange={(weight) => {
                  setItems((list) => list.map((x) => (x.id === o.id ? { ...x, weight } : x)));
                  persist({ ...o, weight });
                }}
              />
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`Delete "${o.text}"`}
                onClick={() => {
                  if (!confirm(`Delete "${o.text}"?`)) return;
                  setItems((list) => list.filter((x) => x.id !== o.id));
                  setDirty(true);
                  startTransition(() => deleteObjective(o.id));
                }}
              >
                <Trash2 />
              </Button>
            </div>
          </li>
        ))}
        {items.length === 0 && <li className="px-4 py-6 text-center text-sm text-muted-foreground">No objectives yet. Add one below.</li>}
      </ul>

      <form
        className="flex flex-col gap-2 rounded-xl border border-dashed p-3 sm:flex-row sm:items-center"
        onSubmit={(e) => {
          e.preventDefault();
          if (!draft.text.trim()) return;
          setDirty(true);
          startTransition(async () => {
            await saveObjective(draft.text.trim(), draft.weight);
            setDraft({ text: "", weight: 1 });
          });
        }}
      >
        <Input
          value={draft.text}
          onChange={(e) => setDraft({ ...draft, text: e.target.value })}
          placeholder="e.g. I'm in Mexico City Jan 10-15 and want to see people there"
          className="bg-card"
        />
        <div className="flex items-center gap-2">
          <WeightPicker value={draft.weight} onChange={(weight) => setDraft({ ...draft, weight })} />
          <Button type="submit" size="sm" disabled={!draft.text.trim() || pending}>
            <Plus /> Add
          </Button>
        </div>
      </form>

      {dirty && (
        <div className="flex items-center justify-between gap-3 rounded-xl bg-brand-soft px-4 py-3 text-sm text-brand">
          <span>Objectives changed. Re-rank to update your inbox.</span>
          <Button
            size="sm"
            className="bg-brand text-white hover:bg-brand/90 dark:text-black"
            onClick={async () => {
              await startRefresh(false);
              setDirty(false);
              window.location.href = "/";
            }}
          >
            Re-rank now
          </Button>
        </div>
      )}
    </div>
  );
}
