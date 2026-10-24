"use client";

import { Check, MessageSquareText, Plus } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { markContacted, saveNote, track } from "./actions";

export function PersonActions({ name, notes, mode }: { name: string; notes: string; mode: "contact" | "notes" }) {
  const [pending, startTransition] = useTransition();
  const [logged, setLogged] = useState(false);
  const [note, setNote] = useState("");

  if (mode === "contact")
    return (
      <Button
        size="sm"
        variant="secondary"
        disabled={pending || logged}
        onClick={() =>
          startTransition(async () => {
            await markContacted(name);
            setLogged(true);
          })
        }
      >
        {logged ? <Check /> : <MessageSquareText />}
        {logged ? "Logged" : "We talked today"}
      </Button>
    );

  return (
    <div className="space-y-3">
      {notes ? (
        <div className="whitespace-pre-line rounded-xl border bg-card px-4 py-3 text-sm leading-relaxed">{notes}</div>
      ) : (
        <p className="text-sm text-muted-foreground">No notes yet.</p>
      )}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!note.trim()) return;
          startTransition(async () => {
            await saveNote(name, note.trim());
            setNote("");
          });
        }}
      >
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={`Add a note about ${name.split(" ")[0]}, e.g. "kid due in March"`}
          rows={1}
          className="min-h-9 resize-none bg-card"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <Button type="submit" size="sm" className="h-9" disabled={pending || !note.trim()}>
          Add
        </Button>
      </form>
    </div>
  );
}

export function TrackToggle({ personId, tracked }: { personId: number; tracked: boolean }) {
  const [on, setOn] = useState(tracked);
  const [pending, startTransition] = useTransition();
  return (
    <Button
      size="sm"
      variant={on ? "ghost" : "default"}
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await track(personId, !on);
          setOn(!on);
        })
      }
    >
      {on ? <Check /> : <Plus />}
      {on ? "In inner circle" : "Add to inner circle"}
    </Button>
  );
}
