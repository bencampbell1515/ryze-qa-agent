"use client";

import { Numeral } from "./Numeral";

export function PlaceholderPage({
  title,
  blurb,
  glyph = "∅",
  comingSoon,
}: {
  title: string;
  blurb: string;
  glyph?: string;
  comingSoon: string[];
}) {
  return (
    <div className="dot-grid min-h-[calc(100vh-3.5rem)]">
      <div className="mx-auto max-w-[1280px] px-6 pb-24 pt-12">
        <div className="flex items-baseline gap-4 border-b border-[var(--color-rule)] pb-3">
          <span className="font-mono text-[10.5px] uppercase tracking-[0.28em] text-[var(--color-ink-3)]">§ 01</span>
          <span className="h-px flex-1 bg-[var(--color-rule)]" />
          <span className="font-mono text-[10.5px] uppercase tracking-[0.28em] text-[var(--color-ink-2)]">Planned</span>
        </div>

        <div className="mt-10 grid grid-cols-1 gap-12 md:grid-cols-[1fr_auto] rise-in">
          <div>
            <h1 className="font-display text-[88px] leading-[0.85] italic tracking-[-0.02em]">
              {title}<span className="text-[var(--color-amber)]">.</span>
            </h1>
            <p className="mt-4 max-w-md font-mono text-[12px] leading-relaxed tracking-wide text-[var(--color-ink-2)]">
              {blurb}
            </p>
          </div>
          <Numeral value={glyph} size="xl" tone="muted" />
        </div>

        <div className="mt-16 rise-in rise-delay-1">
          <div className="flex items-baseline gap-4 border-b border-[var(--color-rule)] pb-3">
            <span className="font-mono text-[10.5px] uppercase tracking-[0.28em] text-[var(--color-ink-3)]">§ 02</span>
            <span className="h-px flex-1 bg-[var(--color-rule)]" />
            <span className="font-mono text-[10.5px] uppercase tracking-[0.28em] text-[var(--color-ink-2)]">Roadmap</span>
          </div>
          <ul className="mt-6 grid grid-cols-1 gap-px overflow-hidden border border-[var(--color-rule)] bg-[var(--color-rule)] sm:grid-cols-2">
            {comingSoon.map((item, i) => (
              <li key={i} className="flex items-start gap-3 bg-[var(--color-base-1)] px-5 py-4">
                <span className="diode diode--off mt-1.5" />
                <span className="font-mono text-[12px] leading-relaxed text-[var(--color-ink-2)]">
                  {item}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
