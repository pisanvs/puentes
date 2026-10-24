"use client";

import { Pin, PinOff } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { togglePin } from "./actions";

/** Toggle "keep warm". Pinned people float to the top of People and get cooling reminders. */
export function PinButton({ personId, pinned: initial, compact }: { personId: number; pinned: boolean; compact?: boolean }) {
  const [pinned, setPinned] = useState(initial);
  const [, start] = useTransition();

  const toggle = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const next = !pinned;
    setPinned(next);
    start(() => togglePin(personId, next));
  };

  if (compact)
    return (
      <button
        type="button"
        onClick={toggle}
        aria-label={pinned ? "Unpin" : "Pin to keep warm"}
        className={cn("rounded-md p-1 transition-colors", pinned ? "text-brand" : "text-muted-foreground/40 hover:text-muted-foreground")}
      >
        <Pin className={cn("size-4", pinned && "fill-current")} />
      </button>
    );

  return (
    <Button variant={pinned ? "secondary" : "outline"} size="sm" onClick={toggle}>
      {pinned ? <Pin className="fill-current text-brand" /> : <PinOff />}
      {pinned ? "Pinned" : "Keep warm"}
    </Button>
  );
}
