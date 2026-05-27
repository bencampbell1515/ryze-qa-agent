"use client";

import { useEffect, useRef, useState } from "react";

export function LogStream({ lines, active = false }: { lines: string[]; active?: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  useEffect(() => {
    if (!autoScroll) return;
    const el = containerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines, autoScroll]);

  const onScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
    setAutoScroll(atBottom);
  };

  return (
    <div className="relative overflow-hidden border border-[var(--color-rule)] bg-[var(--color-base-0)]">
      {/* Title rail */}
      <div className={`flex items-center justify-between border-b border-[var(--color-rule)] bg-[var(--color-base-1)] px-4 py-2.5 ${active ? "scanline" : ""}`}>
        <div className="flex items-center gap-3">
          <span className={`diode ${active ? "diode--amber diode--pulse" : "diode--off"}`} />
          <span className="font-mono text-[10.5px] uppercase tracking-[0.24em] text-[var(--color-ink-2)]">
            stdout · runner-daemon
          </span>
        </div>
        <div className="flex items-center gap-4 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-3)]">
          <span>{lines.length.toString().padStart(4, "0")} lines</span>
          {!autoScroll && (
            <button
              onClick={() => {
                setAutoScroll(true);
                const el = containerRef.current;
                if (el) el.scrollTop = el.scrollHeight;
              }}
              className="text-[var(--color-amber)] hover:underline"
            >
              ▾ Jump to latest
            </button>
          )}
        </div>
      </div>

      {/* Log body */}
      <div
        ref={containerRef}
        onScroll={onScroll}
        className="relative h-[480px] overflow-y-auto px-4 py-4 font-mono text-[11.5px] leading-[1.65] text-[var(--color-ink-2)]"
      >
        {lines.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--color-ink-4)]">
              {active ? "awaiting first byte…" : "no output recorded"}
            </span>
          </div>
        ) : (
          lines.map((l, i) => (
            <LogLine key={i} index={i + 1} line={l} />
          ))
        )}
      </div>
    </div>
  );
}

function LogLine({ index, line }: { index: number; line: string }) {
  const trimmed = line.trim();
  const isPersona  = /^\[persona\]/.test(trimmed);
  const isPlaywright = /^\[playwright\]/.test(trimmed);
  const isDaemonHeader = /^> /.test(trimmed) || /^[a-z-]+@/.test(trimmed);
  const isError = /\b(error|fail|exit|✘|✗)\b/i.test(trimmed);
  const isSuccess = /\b(complete|success|✓|✔|passed)\b/i.test(trimmed);
  const isSession = /Session \d+:/.test(trimmed);

  const color =
    isError         ? "text-[var(--color-coral)]" :
    isSuccess       ? "text-[var(--color-teal)]" :
    isPersona       ? "text-[var(--color-amber)]/85" :
    isPlaywright    ? "text-[var(--color-lavender)]/80" :
    isDaemonHeader  ? "text-[var(--color-ink-3)]" :
    isSession       ? "text-[var(--color-ink-1)]" :
                      "text-[var(--color-ink-2)]";

  return (
    <div className="flex whitespace-pre-wrap break-words">
      <span className="mr-4 inline-block w-10 shrink-0 select-none text-right text-[var(--color-ink-4)]">
        {index.toString().padStart(4, " ")}
      </span>
      <span className={color}>{line}</span>
    </div>
  );
}
