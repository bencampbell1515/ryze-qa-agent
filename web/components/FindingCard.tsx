"use client";

import { useState } from "react";
import { useCropUrl } from "@/lib/runs";
import type { Finding, FindingSeverity } from "@/lib/schema";

const SEV_TOKEN: Record<FindingSeverity, string> = {
  critical: "var(--color-sev-critical)",
  high: "var(--color-sev-high)",
  medium: "var(--color-sev-medium)",
  low: "var(--color-sev-low)",
};

function confidenceToken(confidence: number): string {
  if (confidence >= 0.8) return "var(--color-conf-high)";
  if (confidence >= 0.5) return "var(--color-conf-med)";
  return "var(--color-conf-low)";
}

const DESCRIPTION_CLAMP = 240;

export function FindingCard({
  finding,
  cropsPrefix,
}: {
  finding: Finding;
  cropsPrefix?: string;
}) {
  const [showFullDescription, setShowFullDescription] = useState(false);
  const sevColor = SEV_TOKEN[finding.severity] ?? "var(--color-ink-3)";
  const confColor = confidenceToken(finding.confidence);
  const longDescription = finding.description.length > DESCRIPTION_CLAMP;
  const description =
    longDescription && !showFullDescription
      ? `${finding.description.slice(0, DESCRIPTION_CLAMP).trimEnd()}…`
      : finding.description;

  return (
    <article className="border border-[var(--color-rule)] bg-[var(--color-base-1)] p-5">
      {/* Header row: severity + confidence + ruleId */}
      <div className="flex flex-wrap items-center gap-2">
        <Badge color={sevColor} solid>
          {finding.severity}
        </Badge>
        <Badge color={confColor}>
          conf {Math.round(finding.confidence * 100)}%
        </Badge>
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--color-ink-3)]">
          {finding.source}
        </span>
        <span className="ml-auto rounded-sm bg-[var(--color-base-3)] px-2 py-0.5 font-mono text-[10px] text-[var(--color-ink-2)]">
          {finding.ruleId}
        </span>
      </div>

      {/* Title */}
      <h4 className="mt-3 font-display text-[22px] italic leading-tight text-[var(--color-ink-1)]">
        {finding.title}
      </h4>

      {/* URL */}
      <a
        href={finding.url}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-1 block truncate font-mono text-[11px] text-[var(--color-ink-3)] transition hover:text-[var(--color-amber)]"
        title={finding.url}
      >
        {finding.url}
      </a>

      {/* Inline crop */}
      {finding.crop?.path && (
        <CropImage cropsPrefix={cropsPrefix} cropPath={finding.crop.path} title={finding.title} />
      )}

      {/* Description */}
      <p className="mt-3 font-mono text-[12px] leading-relaxed text-[var(--color-ink-2)]">
        {description}
      </p>
      {longDescription && (
        <button
          onClick={() => setShowFullDescription((v) => !v)}
          className="mt-1 font-mono text-[10.5px] uppercase tracking-[0.18em] text-[var(--color-ink-3)] hover:text-[var(--color-amber)]"
        >
          {showFullDescription ? "▾ Less" : "▸ More"}
        </button>
      )}

      {/* Remediation */}
      {finding.remediation && (
        <p className="mt-3 border-l-2 border-[var(--color-teal)]/40 pl-3 font-mono text-[11.5px] leading-relaxed text-[var(--color-ink-2)]">
          <span className="text-[var(--color-teal)]">fix · </span>
          {finding.remediation}
        </p>
      )}

      {/* Two-judge / visual-gate reasoning */}
      {finding.visualGate && (
        <Expandable summary={`Judge reasoning · ${finding.visualGate.verdict}`}>
          <p className="font-mono text-[11.5px] leading-relaxed text-[var(--color-ink-2)]">
            {finding.visualGate.reason}
          </p>
          <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--color-ink-3)]">
            judge: {finding.visualGate.judgeModel}
          </p>
        </Expandable>
      )}

      {/* Rubric verdicts */}
      {finding.rubricVerdicts && finding.rubricVerdicts.length > 0 && (
        <Expandable summary={`Rubric verdicts · ${finding.rubricVerdicts.length}`}>
          <ul className="space-y-2">
            {finding.rubricVerdicts.map((rv, i) => (
              <li key={i} className="border-l-2 border-[var(--color-rule)] pl-3">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="font-mono text-[11px] text-[var(--color-ink-1)]">{rv.dimension}</span>
                  <span
                    className="font-mono text-[10px] uppercase tracking-[0.16em]"
                    style={{
                      color:
                        rv.verdict === "fail"
                          ? "var(--color-sev-high)"
                          : rv.verdict === "pass"
                            ? "var(--color-conf-high)"
                            : "var(--color-ink-3)",
                    }}
                  >
                    {rv.verdict}
                  </span>
                  <span className="font-mono text-[10px] text-[var(--color-ink-3)]">
                    {Math.round(rv.confidence * 100)}%
                  </span>
                  <span className="ml-auto font-mono text-[9.5px] uppercase tracking-[0.14em] text-[var(--color-ink-4)]">
                    {rv.rubricId}
                  </span>
                </div>
                {rv.discrepancy && (
                  <p className="mt-1 font-mono text-[11px] leading-relaxed text-[var(--color-ink-2)]">
                    {rv.discrepancy}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </Expandable>
      )}
    </article>
  );
}

// -------------------------------------------------------------------

function CropImage({
  cropsPrefix,
  cropPath,
  title,
}: {
  cropsPrefix?: string;
  cropPath: string;
  title: string;
}) {
  const { url, loading, error } = useCropUrl(cropsPrefix, cropPath);

  if (loading) {
    return (
      <div className="mt-3 h-32 w-full max-w-[480px] animate-pulse border border-[var(--color-rule)] bg-[var(--color-base-2)]" />
    );
  }
  if (error || !url) {
    return (
      <div className="mt-3 inline-block border border-dashed border-[var(--color-rule)] px-3 py-2 font-mono text-[10.5px] text-[var(--color-ink-3)]">
        crop unavailable
      </div>
    );
  }
  return (
    <figure className="mt-3">
      {/* eslint-disable-next-line @next/next/no-img-element -- static export, images.unoptimized; crop URLs are token-signed Storage URLs not known at build time */}
      <img
        src={url}
        alt={`Flagged element crop · ${title}`}
        loading="lazy"
        className="block h-auto w-full max-w-[480px] border border-[var(--color-rule)]"
        style={{ objectFit: "contain" }}
      />
    </figure>
  );
}

function Badge({
  color,
  solid,
  children,
}: {
  color: string;
  solid?: boolean;
  children: React.ReactNode;
}) {
  return (
    <span
      className="inline-block rounded-sm px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.16em]"
      style={
        solid
          ? { backgroundColor: color, color: "var(--color-base-0)" }
          : { color, border: `1px solid color-mix(in srgb, ${color} 45%, transparent)` }
      }
    >
      {children}
    </span>
  );
}

function Expandable({
  summary,
  children,
}: {
  summary: string;
  children: React.ReactNode;
}) {
  return (
    <details className="mt-3 border-t border-[var(--color-rule)] pt-3">
      <summary className="cursor-pointer list-none font-mono text-[10.5px] uppercase tracking-[0.18em] text-[var(--color-ink-3)] transition hover:text-[var(--color-amber)]">
        ▸ {summary}
      </summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}
