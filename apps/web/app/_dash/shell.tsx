"use client";

import { Handshake, Inbox, Newspaper, PlugZap, Share2, Target, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { PipelineStatus } from "./actions";
import { DesktopAlerts } from "./desktop-alerts";
import { RefreshButton } from "./refresh-button";

const NAV = [
  { href: "/today", label: "Today", icon: Newspaper },
  { href: "/", label: "Inbox", icon: Inbox, count: "nudges" },
  { href: "/intros", label: "Intros", icon: Handshake, count: "matches" },
  { href: "/people", label: "People", icon: Users },
  { href: "/network", label: "Network", icon: Share2 },
  { href: "/objectives", label: "Objectives", icon: Target },
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

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[220px_1fr]">
      <aside className="sticky top-0 z-10 border-b bg-background/90 backdrop-blur md:h-dvh md:border-r md:border-b-0">
        <div className="flex items-center justify-between px-4 py-3 md:px-5 md:py-5">
          <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <span className="inline-flex size-7 items-center justify-center rounded-lg bg-brand text-sm text-white dark:text-black">
              P
            </span>
            Puentes
          </Link>
          <div className="flex items-center gap-1 md:hidden">
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
          <RefreshButton initial={status} />
          <DesktopAlerts withLabel />
        </div>
      </aside>
      <main className="mx-auto w-full max-w-3xl px-4 py-6 md:px-8 md:py-10">{children}</main>
    </div>
  );
}
