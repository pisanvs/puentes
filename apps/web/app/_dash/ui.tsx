import { Briefcase, MapPin, Newspaper, Repeat2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

/** Visual language for triage categories: one color + icon each, used on dots, pills and rails. */
export const CATEGORY_META = {
  life_update: { label: "Life update", Icon: Sparkles, dot: "bg-rose-500", chip: "bg-rose-500/10 text-rose-600 dark:text-rose-400" },
  location: { label: "Whereabouts", Icon: MapPin, dot: "bg-sky-500", chip: "bg-sky-500/10 text-sky-600 dark:text-sky-400" },
  professional: { label: "Work", Icon: Briefcase, dot: "bg-amber-500", chip: "bg-amber-500/10 text-amber-700 dark:text-amber-400" },
  interest: { label: "Interest", Icon: Repeat2, dot: "bg-violet-500", chip: "bg-violet-500/10 text-violet-600 dark:text-violet-400" },
  other: { label: "Update", Icon: Newspaper, dot: "bg-muted-foreground", chip: "bg-muted text-muted-foreground" },
} as const;

/** Life events show as life updates whatever triage said; otherwise the category picks the look. */
export function categoryMeta(category: string | null | undefined, type?: string) {
  if (type && ["job_change", "move", "launch", "milestone"].includes(type)) return CATEGORY_META.life_update;
  return CATEGORY_META[(category ?? "other") as keyof typeof CATEGORY_META] ?? CATEGORY_META.other;
}

export function CategoryPill({ category, type, className }: { category: string | null | undefined; type?: string; className?: string }) {
  const m = categoryMeta(category, type);
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider", m.chip, className)}>
      <m.Icon className="size-3" />
      {m.label}
    </span>
  );
}

const PLATFORM_LABEL: Record<string, string> = { bluesky: "Bluesky", x: "X", linkedin: "LinkedIn", instagram: "Instagram" };
export const platformLabel = (p: string | null | undefined) => (p ? (PLATFORM_LABEL[p] ?? p) : null);

const TYPE_LABEL: Record<string, string> = {
  job_change: "New role",
  move: "Moved",
  launch: "Launch",
  travel: "Travel",
  milestone: "Milestone",
  ask: "Asking for help",
  event: "Event",
  opinion: "Post",
  other: "Update",
};
export const typeLabel = (t: string) => TYPE_LABEL[t] ?? "Update";

/** Newspaper desks, in print order. */
export const SECTIONS = [
  { id: "moves", label: "Moves & Launches" },
  { id: "asks", label: "Asking Around" },
  { id: "out", label: "Out & About" },
  { id: "milestones", label: "Milestones" },
  { id: "work", label: "At Work" },
  { id: "minds", label: "On Their Minds" },
] as const;

/**
 * Which desk a story runs under. Whereabouts win (that's who you could meet), then life updates by
 * event type, then the triage category for everything else.
 */
export function sectionFor(type: string, category?: string | null): (typeof SECTIONS)[number]["id"] {
  if (category === "location" || type === "travel") return "out";
  if (["job_change", "move", "launch"].includes(type)) return "moves";
  if (type === "ask") return "asks";
  if (type === "milestone") return "milestones";
  if (category === "professional") return "work";
  if (type === "event") return "out";
  return "minds";
}

/** "2026-10-22" → "2d ago" */
export function relDay(isoDate: string) {
  const days = Math.round((Date.now() - Date.parse(isoDate)) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  return `${Math.round(days / 30)}mo ago`;
}

export function contactLabel(days: number | null) {
  if (days === null) return "No contact logged";
  if (days === 0) return "Talked today";
  return `Last talked ${days}d ago`;
}

function hue(name: string) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}



export function Avatar({ name, size = "md", className }: { name: string; size?: "sm" | "md"; className?: string }) {
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-medium text-white ring-2 ring-card",
        size === "md" ? "size-10 text-sm" : "size-8 text-xs",
        className,
      )}
      style={{ background: `oklch(0.6 0.12 ${hue(name)})` }}
    >
      {initials}
    </span>
  );
}

export function PageHeader({ title, subtitle, children }: { title: string; subtitle?: string; children?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-dashed bg-card/50 px-6 py-16 text-center">
      <p className="font-medium">{title}</p>
      <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">{body}</p>
    </div>
  );
}
