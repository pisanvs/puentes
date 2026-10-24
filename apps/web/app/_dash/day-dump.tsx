"use client";

import type { parseDump } from "@agent/lib/dump";
import { Check, MapPin, PenLine, Sparkles } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { dumpDay } from "./actions";

type Recorded = Awaited<ReturnType<typeof parseDump>>;

/**
 * The free-form end-of-day dump: brain-dump who you saw and what's new, in plain language, and it
 * becomes people / events / warmth. Captures the IRL truth scraping can't.
 */
export function DayDump() {
  const [text, setText] = useState("");
  const [recorded, setRecorded] = useState<Recorded | null>(null);
  const [pending, start] = useTransition();

  const save = () => {
    const t = text.trim();
    if (!t) return;
    start(async () => {
      const r = await dumpDay(t);
      setRecorded(r);
      setText("");
    });
  };

  return (
    <section className="mb-5 rounded-xl border bg-card p-4 shadow-sm">
      <p className="mb-2 flex items-center gap-1.5 text-sm font-medium">
        <PenLine className="size-4 text-brand" /> What happened today?
      </p>
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) save();
        }}
        rows={2}
        placeholder="Met Ana at the a16z dinner, she's raising a seed. Ran into Gadi — he's hiring iOS."
        className="resize-none bg-muted/50 text-sm"
      />
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">Who you saw, what's new — it files everyone for you.</span>
        <Button size="sm" disabled={pending || !text.trim()} onClick={save} className="bg-brand text-white hover:bg-brand/90 dark:text-black">
          {pending ? "Filing…" : "Log the day"}
        </Button>
      </div>

      {recorded && recorded.length > 0 && (
        <ul className="mt-3 space-y-1.5 border-t pt-3 text-sm">
          {recorded.map((r, i) => (
            <li key={i} className="flex items-start gap-2">
              <Check className="mt-0.5 size-3.5 shrink-0 text-brand" />
              <span>
                <span className="font-medium">{r.name}</span>
                {r.created && <span className="ml-1 rounded-full bg-brand-soft px-1.5 text-[11px] text-brand">new</span>}
                {r.met && (
                  <span className="ml-1 inline-flex items-center gap-0.5 text-xs text-muted-foreground">
                    <Sparkles className="size-3" /> warmed up
                    {r.where && (
                      <>
                        {" "}
                        <MapPin className="size-3" /> {r.where}
                      </>
                    )}
                  </span>
                )}
                <span className="block text-muted-foreground">{r.summary}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {recorded && recorded.length === 0 && <p className="mt-3 border-t pt-3 text-sm text-muted-foreground">Nothing to file from that — try naming who you saw.</p>}
    </section>
  );
}
