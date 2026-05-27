"use client";

import { useEffect, useState } from "react";
import {
  CHECK_LABELS,
  DEFAULT_CONFIG,
  PERSONA_INFO,
  PERSONA_NAMES,
  type PersonaName,
  type ScanConfig,
} from "@/lib/scan-config";
import { Numeral } from "./Numeral";

export function ScanConfigModal({
  open,
  onClose,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (config: ScanConfig) => Promise<void> | void;
}) {
  const [config, setConfig] = useState<ScanConfig>(DEFAULT_CONFIG);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) {
      setConfig(DEFAULT_CONFIG);
      setBusy(false);
    }
  }, [open]);

  if (!open) return null;

  const handleConfirm = async () => {
    setBusy(true);
    try { await onConfirm(config); } finally { setBusy(false); }
  };

  const summary = {
    sites: [config.sites.www && "www", config.sites.shop && "shop"].filter(Boolean).length,
    personas: PERSONA_NAMES.filter((n) => config.personas[n]).length,
    checks:
      Object.values(config.checks).reduce(
        (sum, c) => sum + (c.enabled ? Object.values(c.sub).filter(Boolean).length : 0),
        0,
      ),
    excludes: config.urlExcludes.length,
  };

  return (
    <div className="fixed inset-0 z-50 flex" role="dialog" aria-modal="true">
      {/* Backdrop */}
      <button
        aria-label="Close"
        onClick={onClose}
        className="flex-1 bg-[var(--color-base-0)]/70 backdrop-blur-sm transition"
      />

      {/* Panel */}
      <aside className="flex h-full w-full max-w-[560px] flex-col border-l border-[var(--color-rule)] bg-[var(--color-base-1)] shadow-[-30px_0_60px_-30px_rgba(0,0,0,0.6)]">
        {/* Header */}
        <header className="flex items-center justify-between border-b border-[var(--color-rule)] px-7 py-5">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--color-ink-3)]">
              § 00 · pre-flight
            </div>
            <h2 className="mt-1 font-display text-3xl italic leading-none">
              Configure scan<span className="text-[var(--color-amber)]">.</span>
            </h2>
          </div>
          <button
            onClick={onClose}
            className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--color-ink-3)] hover:text-[var(--color-amber)]"
          >
            [ Close ]
          </button>
        </header>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-7 py-6">
          {/* Sites */}
          <Group title="Site scope" badge={`${summary.sites}/2`}>
            <Row>
              <Toggle
                checked={config.sites.www}
                onChange={(v) => setConfig({ ...config, sites: { ...config.sites, www: v } })}
                label="ryzesuperfoods.com"
                aux="storefront"
              />
            </Row>
            <Row>
              <Toggle
                checked={config.sites.shop}
                onChange={(v) => setConfig({ ...config, sites: { ...config.sites, shop: v } })}
                label="shop.ryzesuperfoods.com"
                aux="headless shopify (hydrogen)"
              />
            </Row>
          </Group>

          {/* Check categories */}
          <Group title="Check categories" badge={`${summary.checks} checks on`}>
            {Object.entries(config.checks).map(([key, cat]) => (
              <CheckCategory
                key={key}
                name={key}
                category={cat}
                onUpdate={(updated) =>
                  setConfig({ ...config, checks: { ...config.checks, [key]: updated } })
                }
              />
            ))}
          </Group>

          {/* Personas */}
          <Group title="Agentic personas" badge={`${summary.personas}/5`}>
            {PERSONA_NAMES.map((name) => (
              <Row key={name}>
                <Toggle
                  checked={config.personas[name]}
                  onChange={(v) =>
                    setConfig({
                      ...config,
                      personas: { ...config.personas, [name]: v } as Record<PersonaName, boolean>,
                    })
                  }
                  label={PERSONA_INFO[name].label}
                  aux={PERSONA_INFO[name].blurb}
                />
              </Row>
            ))}
          </Group>

          {/* Viewports */}
          <Group title="Viewports" badge={`${Object.values(config.viewports).filter(Boolean).length}/3`}>
            {(["mobile", "tablet", "desktop"] as const).map((vp) => (
              <Row key={vp}>
                <Toggle
                  checked={config.viewports[vp]}
                  onChange={(v) => setConfig({ ...config, viewports: { ...config.viewports, [vp]: v } })}
                  label={vp.charAt(0).toUpperCase() + vp.slice(1)}
                  aux={vp === "mobile" ? "375 × 667" : vp === "tablet" ? "768 × 1024" : "1280 × 800"}
                />
              </Row>
            ))}
          </Group>

          {/* Limits */}
          <Group title="Limits & throttle">
            <NumberField
              label="Max URLs"
              hint="empty = unlimited"
              value={config.maxUrls ?? ""}
              onChange={(v) => setConfig({ ...config, maxUrls: v === "" ? null : Math.max(1, Number(v)) })}
              suffix="URLs"
              placeholder="∞"
            />
            <NumberField
              label="Max duration"
              hint="default 240"
              value={config.maxDurationMin}
              onChange={(v) => setConfig({ ...config, maxDurationMin: Math.max(15, Number(v) || 240) })}
              suffix="min"
            />
            <SliderField
              label="Concurrency"
              hint="browser contexts"
              value={config.concurrency}
              min={1}
              max={4}
              onChange={(v) => setConfig({ ...config, concurrency: v })}
            />
          </Group>

          {/* URL excludes */}
          <Group title="URL excludes" badge={summary.excludes ? `${summary.excludes} pattern(s)` : undefined}>
            <UrlExcludeInput
              patterns={config.urlExcludes}
              onChange={(patterns) => setConfig({ ...config, urlExcludes: patterns })}
            />
          </Group>

          {/* Preset stub */}
          <Group title="Presets" badge="coming soon">
            <p className="font-mono text-[11px] leading-relaxed text-[var(--color-ink-3)]">
              Saved presets land in a future build. For now the config travels with each scan.
            </p>
          </Group>
        </div>

        {/* Footer */}
        <footer className="flex items-center justify-between border-t border-[var(--color-rule)] bg-[var(--color-base-0)] px-7 py-5">
          <div className="flex items-baseline gap-3">
            <Numeral value={summary.checks} size="md" tone="amber" />
            <div className="font-mono text-[10.5px] uppercase tracking-[0.22em] text-[var(--color-ink-3)]">
              checks armed
              <br />
              <span className="text-[var(--color-ink-4)]">
                {summary.personas} personas · {summary.sites} site(s) · {summary.excludes} excludes
              </span>
            </div>
          </div>
          <button
            onClick={handleConfirm}
            disabled={busy}
            className="group flex items-center gap-3 border border-[var(--color-amber)]/70 bg-[var(--color-amber)]/[0.06] px-6 py-3 transition hover:bg-[var(--color-amber)]/[0.14] disabled:opacity-50"
            style={{ boxShadow: "0 0 24px -8px var(--color-amber-glow)" }}
          >
            <span className="diode diode--amber diode--pulse" />
            <span className="font-mono text-[12px] uppercase tracking-[0.24em] text-[var(--color-amber)]">
              {busy ? "Initiating…" : "Initiate"}
            </span>
            <span className="font-mono text-[var(--color-amber)] transition group-hover:translate-x-1">▸</span>
          </button>
        </footer>
      </aside>
    </div>
  );
}

// -- Group + Row primitives --

function Group({ title, badge, children }: { title: string; badge?: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <div className="mb-3 flex items-baseline justify-between border-b border-[var(--color-rule)] pb-2">
        <span className="font-mono text-[10.5px] uppercase tracking-[0.24em] text-[var(--color-ink-2)]">
          {title}
        </span>
        {badge && (
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-ink-3)]">
            {badge}
          </span>
        )}
      </div>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="border-b border-[var(--color-rule)]/60 pb-2 last:border-b-0">{children}</div>;
}

function Toggle({
  checked,
  onChange,
  label,
  aux,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  aux?: string;
}) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className="group flex w-full items-center justify-between gap-3 py-1.5 text-left"
    >
      <span>
        <span className={`block font-mono text-[12.5px] tracking-wide ${checked ? "text-[var(--color-ink-1)]" : "text-[var(--color-ink-3)]"}`}>
          {label}
        </span>
        {aux && (
          <span className="block font-mono text-[10.5px] text-[var(--color-ink-3)] group-hover:text-[var(--color-ink-2)]">
            {aux}
          </span>
        )}
      </span>
      <span
        className={`relative inline-flex h-5 w-9 shrink-0 items-center transition ${
          checked ? "bg-[var(--color-amber)]/30" : "bg-[var(--color-base-3)]"
        } border ${checked ? "border-[var(--color-amber)]/70" : "border-[var(--color-rule)]"}`}
      >
        <span
          className={`inline-block h-3 w-3 transition-transform ${
            checked ? "translate-x-5 bg-[var(--color-amber)]" : "translate-x-1 bg-[var(--color-ink-3)]"
          }`}
          style={checked ? { boxShadow: "0 0 8px var(--color-amber-glow)" } : undefined}
        />
      </span>
    </button>
  );
}

function CheckCategory({
  name,
  category,
  onUpdate,
}: {
  name: string;
  category: { enabled: boolean; sub: Record<string, boolean> };
  onUpdate: (next: { enabled: boolean; sub: Record<string, boolean> }) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const onCount = Object.values(category.sub).filter(Boolean).length;
  const total = Object.keys(category.sub).length;
  return (
    <div className="border-b border-[var(--color-rule)]/60 pb-2 last:border-b-0">
      <div className="flex items-center gap-3">
        <Toggle
          checked={category.enabled}
          onChange={(v) => onUpdate({ ...category, enabled: v })}
          label={name.charAt(0).toUpperCase() + name.slice(1)}
          aux={`${category.enabled ? onCount : 0} / ${total} sub-checks active`}
        />
        <button
          onClick={() => setExpanded((e) => !e)}
          className="font-mono text-[10.5px] uppercase tracking-[0.2em] text-[var(--color-ink-3)] transition hover:text-[var(--color-amber)]"
        >
          {expanded ? "▾" : "▸"}
        </button>
      </div>
      {expanded && (
        <div className="ml-3 mt-2 space-y-1 border-l border-[var(--color-rule)] pl-4">
          {Object.entries(category.sub).map(([ruleId, enabled]) => (
            <Toggle
              key={ruleId}
              checked={enabled && category.enabled}
              onChange={(v) =>
                onUpdate({
                  ...category,
                  sub: { ...category.sub, [ruleId]: v },
                })
              }
              label={CHECK_LABELS[ruleId] ?? ruleId}
              aux={ruleId}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function NumberField({
  label,
  hint,
  value,
  onChange,
  suffix,
  placeholder,
}: {
  label: string;
  hint?: string;
  value: number | string;
  onChange: (v: string) => void;
  suffix?: string;
  placeholder?: string;
}) {
  return (
    <div className="flex items-center justify-between border-b border-[var(--color-rule)]/60 py-2.5 last:border-b-0">
      <div>
        <div className="font-mono text-[12px] text-[var(--color-ink-1)]">{label}</div>
        {hint && (
          <div className="mt-0.5 font-mono text-[10.5px] text-[var(--color-ink-3)]">{hint}</div>
        )}
      </div>
      <div className="flex items-center gap-2">
        <input
          type="number"
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className="w-24 border border-[var(--color-rule)] bg-[var(--color-base-0)] px-3 py-1.5 text-right font-mono text-[12px] tabular-nums text-[var(--color-ink-1)] focus:border-[var(--color-amber)] focus:outline-none"
        />
        {suffix && (
          <span className="font-mono text-[10.5px] uppercase tracking-[0.2em] text-[var(--color-ink-3)]">
            {suffix}
          </span>
        )}
      </div>
    </div>
  );
}

function SliderField({
  label,
  hint,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="border-b border-[var(--color-rule)]/60 py-2.5 last:border-b-0">
      <div className="flex items-center justify-between">
        <div>
          <div className="font-mono text-[12px] text-[var(--color-ink-1)]">{label}</div>
          {hint && (
            <div className="mt-0.5 font-mono text-[10.5px] text-[var(--color-ink-3)]">{hint}</div>
          )}
        </div>
        <span className="font-mono text-[14px] tabular-nums text-[var(--color-amber)]">{value}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-2 w-full accent-[var(--color-amber)]"
      />
    </div>
  );
}

function UrlExcludeInput({
  patterns,
  onChange,
}: {
  patterns: string[];
  onChange: (next: string[]) => void;
}) {
  const [value, setValue] = useState("");
  const add = () => {
    const v = value.trim();
    if (!v || patterns.includes(v)) return;
    onChange([...patterns, v]);
    setValue("");
  };
  return (
    <div>
      <p className="mb-2 font-mono text-[10.5px] leading-relaxed text-[var(--color-ink-3)]">
        Substring match. Any URL containing one of these will be skipped during crawl.
      </p>
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={value}
          placeholder="e.g. /admin or .myshopify"
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
          className="flex-1 border border-[var(--color-rule)] bg-[var(--color-base-0)] px-3 py-2 font-mono text-[12px] text-[var(--color-ink-1)] focus:border-[var(--color-amber)] focus:outline-none"
        />
        <button
          onClick={add}
          className="border border-[var(--color-rule)] bg-[var(--color-base-2)] px-3 py-2 font-mono text-[10.5px] uppercase tracking-[0.18em] text-[var(--color-ink-2)] hover:border-[var(--color-amber)] hover:text-[var(--color-amber)]"
        >
          Add
        </button>
      </div>
      {patterns.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {patterns.map((p) => (
            <span
              key={p}
              className="inline-flex items-center gap-1.5 border border-[var(--color-rule)] bg-[var(--color-base-0)] px-2 py-1 font-mono text-[11px] text-[var(--color-ink-2)]"
            >
              <span>{p}</span>
              <button
                onClick={() => onChange(patterns.filter((x) => x !== p))}
                className="text-[var(--color-ink-4)] hover:text-[var(--color-coral)]"
                aria-label={`Remove ${p}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
