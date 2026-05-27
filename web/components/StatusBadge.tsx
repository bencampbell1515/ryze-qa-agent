import type { RunStatus } from "@/lib/schema";

const STYLES: Record<RunStatus, { dot: string; text: string; ring: string; label: string }> = {
  requested:        { dot: "bg-zinc-400",     text: "text-zinc-300",    ring: "ring-zinc-700/50",    label: "Queued" },
  running:          { dot: "bg-sky-400",      text: "text-sky-300",     ring: "ring-sky-700/50",     label: "Running" },
  complete:         { dot: "bg-emerald-400",  text: "text-emerald-300", ring: "ring-emerald-700/50", label: "Complete" },
  failed:           { dot: "bg-red-400",      text: "text-red-300",     ring: "ring-red-700/50",     label: "Failed" },
  cancelled:        { dot: "bg-amber-400",    text: "text-amber-300",   ring: "ring-amber-700/50",   label: "Cancelled" },
  "cancel-requested": { dot: "bg-amber-400",  text: "text-amber-300",   ring: "ring-amber-700/50",   label: "Cancelling…" },
};

export function StatusBadge({ status, animated }: { status: RunStatus; animated?: boolean }) {
  const s = STYLES[status];
  const pulse = animated && (status === "running" || status === "requested" || status === "cancel-requested");
  return (
    <span className={`inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${s.text} ${s.ring} bg-zinc-900/40`}>
      <span className="relative flex size-1.5">
        {pulse && (
          <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${s.dot}`} />
        )}
        <span className={`relative inline-flex size-1.5 rounded-full ${s.dot}`} />
      </span>
      {s.label}
    </span>
  );
}
