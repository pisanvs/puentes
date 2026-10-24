"use client";

import { Handshake, Hash, Inbox, Newspaper, PlugZap, Share2, Sparkles, UserRound, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ChatPanel } from "./chat-panel";
import { cn } from "@/lib/utils";
import type { PipelineStatus } from "./actions";
import { DesktopAlerts } from "./desktop-alerts";
import { RefreshButton } from "./refresh-button";

const NAV = [
  { href: "/today", label: "Today", icon: Newspaper },
  { href: "/", label: "Inbox", icon: Inbox, count: "nudges" },
  { href: "/intros", label: "Intros", icon: Handshake, count: "matches" },
  { href: "/people", label: "People", icon: Users },
  { href: "/topics", label: "Topics", icon: Hash },
  { href: "/network", label: "Network", icon: Share2 },
  { href: "/objectives", label: "You", icon: UserRound },
  { href: "/sources", label: "Sources", icon: PlugZap },
] as const;

export function Shell({
  counts,
  status,
  children,
}: {
  counts: { nudges: number; matches: number };
  status: PipelineStatus;
  children: ReactNode;
}) {
  const path = usePathname();
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));

  // The agent panel: mounted on first open (no agent connection until you want it), kept mounted after
  // so a streaming answer survives closing and navigating. ⌘K / Ctrl+K toggles, Esc closes.
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMounted, setChatMounted] = useState(false);
  const toggleChat = (next = !chatOpen) => {
    if (next) setChatMounted(true);
    setChatOpen(next);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setChatMounted(true);
        setChatOpen((o) => !o);
      } else if (e.key === "Escape") setChatOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[220px_1fr]">
      <aside className="sticky top-0 z-10 border-b bg-background/90 backdrop-blur md:h-dvh md:border-r md:border-b-0">
        <div className="flex items-center justify-between px-4 py-3 md:px-5 md:py-5">
          <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <span className="inline-flex size-7 items-center justify-center rounded-lg bg-brand text-sm text-white dark:text-black">
              b
            </span>
            bridgr
          </Link>
          <div className="flex items-center gap-1 md:hidden">
            <Button variant="ghost" size="icon-sm" onClick={() => toggleChat(true)} aria-label="Ask bridgr">
              <Sparkles />
            </Button>
            <DesktopAlerts />
            <RefreshButton initial={status} compact />
          </div>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-2 pb-2 md:flex-col md:px-3 md:pb-0">
          {NAV.map(({ href, label, icon: Icon, ...rest }) => {
            const count = "count" in rest ? counts[rest.count] : 0;
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
                  active(href) ? "bg-card font-medium shadow-sm ring-1 ring-border" : "text-muted-foreground hover:bg-card/60 hover:text-foreground",
                )}
              >
                <Icon className="size-4" />
                {label}
                {count > 0 && (
                  <span className="ml-auto rounded-full bg-brand-soft px-1.5 text-xs font-medium tabular-nums text-brand">{count}</span>
                )}
              </Link>
            );
          })}
        </nav>
        <div className="absolute inset-x-3 bottom-4 hidden flex-col gap-2 md:flex">
          <button
            type="button"
            onClick={() => toggleChat()}
            className="flex items-center gap-2 rounded-xl border bg-card px-3 py-2.5 text-sm font-medium shadow-sm transition-colors hover:border-brand/50"
          >
            <Sparkles className="size-4 text-brand" /> Ask bridgr
            <kbd className="ml-auto rounded border bg-muted px-1 font-mono text-[10px] text-muted-foreground">⌘K</kbd>
          </button>
          <RefreshButton initial={status} />
          <DesktopAlerts withLabel />
        </div>
      </aside>
      <main className="mx-auto w-full max-w-3xl px-4 py-6 md:px-8 md:py-10">{children}</main>
      {chatMounted && <ChatPanel open={chatOpen} onClose={() => setChatOpen(false)} />}
    </div>
  );
}
