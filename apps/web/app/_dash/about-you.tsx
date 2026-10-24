"use client";

import type { Owner } from "@agent/lib/me";
import { Check, Eye, MapPin, Plane, X } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { forgetFact, saveAboutMe } from "./actions";

/**
 * Who bridgr works for. Objectives say what you want this month; this says who you are — and it's
 * what triage, ranking and every draft read before judging what matters to you.
 */
export function AboutYou({ initial, card }: { initial: Owner; card: string }) {
  const [me, setMe] = useState(initial);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  const set = (patch: Partial<Owner>) => {
    setSaved(false);
    setMe((m) => ({ ...m, ...patch }));
  };
  const trip = me.trip ?? { place: "" };

  const save = () =>
    start(async () => {
      await saveAboutMe({
        name: me.name,
        headline: me.headline,
        homeBase: me.homeBase,
        about: me.about,
        trip: trip.place.trim() ? { place: trip.place.trim(), from: trip.from || undefined, to: trip.to || undefined } : null,
      });
      setSaved(true);
    });

  return (
    <section className="mb-8 rounded-xl border bg-card p-4 shadow-sm md:p-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name">
          <Input value={me.name} onChange={(e) => set({ name: e.target.value })} placeholder="Your name" />
        </Field>
        <Field label="What you do">
          <Input value={me.headline} onChange={(e) => set({ headline: e.target.value })} placeholder="Your role, in a line" />
        </Field>
        <Field label="Home base" icon={<MapPin className="size-3" />}>
          <Input value={me.homeBase} onChange={(e) => set({ homeBase: e.target.value })} placeholder="City you live in" />
        </Field>
        <Field label="Current trip" icon={<Plane className="size-3" />} className="sm:col-span-2">
          <div className="flex flex-wrap gap-1.5">
            <Input value={trip.place} onChange={(e) => set({ trip: { ...trip, place: e.target.value } })} placeholder="City you're visiting" className="min-w-40 flex-1" />
            <Input type="date" value={trip.from ?? ""} onChange={(e) => set({ trip: { ...trip, from: e.target.value } })} aria-label="Trip start" className="w-[9rem]" />
            <Input type="date" value={trip.to ?? ""} onChange={(e) => set({ trip: { ...trip, to: e.target.value } })} aria-label="Trip end" className="w-[9rem]" />
          </div>
        </Field>
      </div>
      <Field label="About you — what you're building, what you care about, who you want to meet" className="mt-3">
        <Textarea
          value={me.about}
          onChange={(e) => set({ about: e.target.value })}
          rows={3}
          placeholder="What you're working on, the themes you care about, the kind of people you want to meet."
          className="resize-none text-sm"
        />
      </Field>

      {me.facts.length > 0 && (
        <div className="mt-3">
          <p className="mb-1.5 text-xs text-muted-foreground">Things you've told bridgr</p>
          <div className="flex flex-wrap gap-1.5">
            {me.facts.map((f) => (
              <span key={f} className="inline-flex items-center gap-1 rounded-full border bg-muted/50 py-0.5 pr-1 pl-2.5 text-xs">
                {f}
                <button
                  type="button"
                  aria-label={`Forget "${f}"`}
                  className="rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                  onClick={() => {
                    setMe((m) => ({ ...m, facts: m.facts.filter((x) => x !== f) }));
                    start(() => forgetFact(f));
                  }}
                >
                  <X className="size-3" />
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-3">
        <p className="flex min-w-0 flex-1 items-start gap-1.5 text-xs text-muted-foreground">
          <Eye className="mt-0.5 size-3 shrink-0" />
          <span>
            <span className="font-medium text-foreground">What bridgr reads about you: </span>
            {card || "nothing yet — fill this in so it can judge what matters to you."}
          </span>
        </p>
        <Button size="sm" disabled={pending} onClick={save} className="bg-brand text-white hover:bg-brand/90 dark:text-black">
          {saved ? <Check /> : null}
          {pending ? "Saving…" : saved ? "Saved" : "Save"}
        </Button>
      </div>
    </section>
  );
}

function Field({ label, icon, className, children }: { label: string; icon?: React.ReactNode; className?: string; children: React.ReactNode }) {
  return (
    <label className={`block ${className ?? ""}`}>
      <span className="mb-1 flex items-center gap-1 text-xs text-muted-foreground">
        {icon}
        {label}
      </span>
      {children}
    </label>
  );
}
