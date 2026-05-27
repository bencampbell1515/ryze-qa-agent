export const PERSONA_NAMES = [
  "revenue-hawk",
  "skeptical-first-timer",
  "brand-purist",
  "forensic-technician",
  "dr-marcus-chen",
] as const;
export type PersonaName = typeof PERSONA_NAMES[number];

export const PERSONA_INFO: Record<PersonaName, { label: string; blurb: string }> = {
  "revenue-hawk":            { label: "Revenue hawk",         blurb: "Pricing math, discount lies, deceptive urgency" },
  "skeptical-first-timer":   { label: "Skeptical first-timer", blurb: "Trust signals, hidden friction, confusing CTAs" },
  "brand-purist":            { label: "Brand purist",         blurb: "Voice, tone, on-brand visuals" },
  "forensic-technician":     { label: "Forensic technician",  blurb: "Console errors, network failures, slow LCP" },
  "dr-marcus-chen":          { label: "Dr. Marcus Chen",      blurb: "Health-claim scrutiny, FDA-adjacent copy" },
};

export type ScanConfig = {
  sites: { www: boolean; shop: boolean };
  checks: {
    network:     { enabled: boolean; sub: Record<string, boolean> };
    content:     { enabled: boolean; sub: Record<string, boolean> };
    performance: { enabled: boolean; sub: Record<string, boolean> };
    revenue:     { enabled: boolean; sub: Record<string, boolean> };
  };
  personas: Record<PersonaName, boolean>;
  viewports: { mobile: boolean; tablet: boolean; desktop: boolean };
  maxUrls: number | null;       // null = unlimited
  maxDurationMin: number;       // minutes
  concurrency: number;          // browser contexts
  urlExcludes: string[];        // substring patterns to skip
};

export const DEFAULT_CONFIG: ScanConfig = {
  sites: { www: true, shop: true },
  checks: {
    network: {
      enabled: true,
      sub: { "network:404": true, "network:4xx": true, "network:failed": false },
    },
    content: {
      enabled: true,
      sub: { "content:broken-image": true, "content:empty-image-src": true, "content:broken-picture-template": true, "content:tap-target-small": true },
    },
    performance: {
      enabled: false,
      sub: { "perf:lighthouse": false, "perf:cls": false },
    },
    revenue: {
      enabled: true,
      sub: { "revenue:price-mismatch": true, "revenue:cart-broken": true },
    },
  },
  personas: {
    "revenue-hawk": true,
    "skeptical-first-timer": true,
    "brand-purist": true,
    "forensic-technician": true,
    "dr-marcus-chen": true,
  },
  viewports: { mobile: true, tablet: true, desktop: true },
  maxUrls: null,
  maxDurationMin: 240,
  concurrency: 2,
  urlExcludes: [],
};

export const CHECK_LABELS: Record<string, string> = {
  // network
  "network:404":     "HTTP 404 (missing resources)",
  "network:4xx":     "HTTP 4xx (client errors)",
  "network:failed":  "Connection failed (noisy: bot drops)",
  // content
  "content:broken-image":            "Broken <img> (404 src)",
  "content:empty-image-src":         "Empty src attribute",
  "content:broken-picture-template": "Replo template render gap",
  "content:tap-target-small":        "Tap targets < 32×32 (mobile)",
  // performance
  "perf:lighthouse":  "Lighthouse audit",
  "perf:cls":         "Cumulative Layout Shift > 0.25",
  // revenue
  "revenue:price-mismatch": "Displayed price ≠ DOM price",
  "revenue:cart-broken":    "Add-to-Cart fails or stalls",
};
