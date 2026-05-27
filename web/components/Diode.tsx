import type { RunStatus } from "@/lib/schema";

const DIODE: Record<RunStatus, { color: string; label: string; pulse: boolean }> = {
  requested:          { color: "amber", label: "QUEUED",     pulse: true  },
  running:            { color: "amber", label: "ACTIVE",     pulse: true  },
  complete:           { color: "teal",  label: "COMPLETE",   pulse: false },
  failed:             { color: "coral", label: "FAILED",     pulse: false },
  cancelled:          { color: "lav",   label: "CANCELLED",  pulse: false },
  "cancel-requested": { color: "lav",   label: "STOPPING…",  pulse: true  },
};

export function Diode({
  status,
  size = "sm",
  withLabel = true,
}: {
  status: RunStatus;
  size?: "sm" | "lg";
  withLabel?: boolean;
}) {
  const cfg = DIODE[status];
  const cls = ["diode", `diode--${cfg.color}`, cfg.pulse && "diode--pulse"]
    .filter(Boolean)
    .join(" ");
  return (
    <span className="inline-flex items-center gap-2.5">
      <span className={cls} style={size === "lg" ? { width: 9, height: 9 } : undefined} />
      {withLabel && (
        <span className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-[var(--color-ink-2)]">
          {cfg.label}
        </span>
      )}
    </span>
  );
}

export function DotDiode({ tone = "off" }: { tone?: "off" | "amber" | "teal" | "coral" | "lav"; }) {
  return <span className={`diode diode--${tone}`} />;
}
