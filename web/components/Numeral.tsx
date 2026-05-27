/**
 * Editorial display numbers — Instrument Serif italic, characterful and large.
 * Use sparingly: the few moments where a number should feel monumental
 * (bug count, percent, URLs scanned).
 */
export function Numeral({
  value,
  size = "md",
  tone = "ink",
  className,
}: {
  value: string | number;
  size?: "sm" | "md" | "lg" | "xl";
  tone?: "ink" | "amber" | "teal" | "muted";
  className?: string;
}) {
  const sizeCls =
    size === "xl" ? "text-[88px] leading-[0.85]" :
    size === "lg" ? "text-6xl leading-[0.85]" :
    size === "md" ? "text-4xl leading-[0.9]"   :
                    "text-2xl leading-[0.9]";
  const toneCls =
    tone === "amber"  ? "text-[var(--color-amber)]" :
    tone === "teal"   ? "text-[var(--color-teal)]"  :
    tone === "muted"  ? "text-[var(--color-ink-3)]" :
                        "text-[var(--color-ink-1)]";
  return (
    <span className={`font-display ${sizeCls} ${toneCls} ${className ?? ""}`}>
      {value}
    </span>
  );
}
