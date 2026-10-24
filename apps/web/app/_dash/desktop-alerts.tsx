"use client";

import { Bell, BellOff } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { inboxPulse } from "./actions";
import { REFRESHED_EVENT } from "./refresh-button";

const SEEN_KEY = "puentes:seen-nudges";
const ON_KEY = "puentes:alerts";
const POLL_MS = 30_000;
const TOGGLED_EVENT = "puentes:alerts-toggled";

const read = <T,>(key: string, fallback: T): T => {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
};
const write = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // private window: alerts just won't remember what was seen
  }
};

/**
 * Desktop notifications for new nudges while the dashboard is open.
 * The first check only records what's already there, so you're never spammed with the backlog.
 */
export function DesktopAlerts({ withLabel }: { withLabel?: boolean }) {
  const [enabled, setEnabled] = useState(false);
  // Decided after mount so server and client render the same markup.
  const [supported, setSupported] = useState(false);

  useEffect(() => {
    const ok = "Notification" in window;
    setSupported(ok);
    setEnabled(ok && read(ON_KEY, false) && Notification.permission === "granted");
    // The shell renders one toggle for mobile and one for desktop; keep them in sync.
    const sync = () => setEnabled(ok && read(ON_KEY, false) && Notification.permission === "granted");
    window.addEventListener(TOGGLED_EVENT, sync);
    return () => window.removeEventListener(TOGGLED_EVENT, sync);
  }, []);

  const check = useCallback(async () => {
    const items = await inboxPulse();
    document.title = items.length ? `(${items.length}) Puentes` : "Puentes";
    const seen = read<number[] | null>(SEEN_KEY, null);
    if (seen && enabled) {
      for (const item of items.filter((i) => !seen.includes(i.id)).slice(0, 3)) {
        const n = new Notification(`Reach out to ${item.person}`, { body: item.reason, tag: `nudge-${item.id}` });
        n.onclick = () => {
          window.focus();
          n.close();
        };
      }
    }
    write(SEEN_KEY, [...new Set([...(seen ?? []), ...items.map((i) => i.id)])].slice(-500));
  }, [enabled]);

  useEffect(() => {
    check();
    const timer = setInterval(check, POLL_MS);
    window.addEventListener(REFRESHED_EVENT, check);
    return () => {
      clearInterval(timer);
      window.removeEventListener(REFRESHED_EVENT, check);
    };
  }, [check]);

  const toggle = async () => {
    if (enabled) {
      setEnabled(false);
      write(ON_KEY, false);
      window.dispatchEvent(new Event(TOGGLED_EVENT));
      return;
    }
    const permission = await Notification.requestPermission();
    const on = permission === "granted";
    setEnabled(on);
    write(ON_KEY, on);
    window.dispatchEvent(new Event(TOGGLED_EVENT));
    if (on) new Notification("Puentes alerts are on", { body: "You'll get a ping when someone's worth reaching out to." });
  };

  if (!supported) return null;
  const Icon = enabled ? Bell : BellOff;
  return withLabel ? (
    <Button variant="ghost" size="sm" className="justify-start text-muted-foreground" onClick={toggle}>
      <Icon />
      {enabled ? "Desktop alerts on" : "Turn on desktop alerts"}
    </Button>
  ) : (
    <Button variant="ghost" size="icon-sm" onClick={toggle} aria-label={enabled ? "Turn off desktop alerts" : "Turn on desktop alerts"}>
      <Icon />
    </Button>
  );
}
