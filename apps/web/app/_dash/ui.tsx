import { cn } from "@/lib/utils";

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

/** Newspaper desks: event types grouped into front-page sections, in print order. */
export const SECTIONS = [
  { id: "moves", label: "Moves & Launches", types: ["job_change", "move", "launch"] },
  { id: "asks", label: "Asking Around", types: ["ask"] },
  { id: "out", label: "Out & About", types: ["travel", "event"] },
  { id: "milestones", label: "Milestones", types: ["milestone"] },
  { id: "minds", label: "On Their Minds", types: ["opinion", "other"] },
] as const;

/** Which desk a story runs under (defaults to the catch-all "On Their Minds"). */
export const sectionFor = (type: string) => SECTIONS.find((s) => (s.types as readonly string[]).includes(type))?.id ?? "minds";

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
