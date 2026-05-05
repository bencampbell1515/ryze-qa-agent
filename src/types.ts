export type Viewport = 'desktop' | 'tablet' | 'mobile';

export type Severity = 'critical' | 'high' | 'medium' | 'low';

export type BugClass =
  | 'a11y'
  | 'console'
  | 'network'
  | 'visual'
  | 'seo'
  | 'revenue'
  | 'content'
  | 'lighthouse';

export type BugSource = 'playwright' | 'claude-discovery';

export type VerificationStatus =
  | 'confirmed'
  | 'could-not-reproduce'
  | 'inconclusive'
  | 'unverified';

export interface BugInstance {
  ruleId: string;
  severity: Severity;
  bugClass: BugClass;
  message: string;
  url: string;
  viewport: Viewport;
  /** Full CSS selector path to offending element */
  selector?: string;
  /** Array of ancestor descriptors up to section anchor */
  selectorAncestry?: string[];
  /** First 256 chars of element's outerHTML */
  outerHTMLSnippet?: string;
  /** Absolute path to cropped element screenshot PNG */
  elementScreenshot?: string;
  /** Absolute path to full-page screenshot PNG */
  pageScreenshot?: string;
  /** axe helpUrl for a11y violations */
  helpUrl?: string;
  /** Raw axe violation nodes for a11y bugs */
  axeNodes?: string[];
  timestamp: string;
  /** Perceptual dHash binary string (64 chars of '0'/'1') from sharp-phash */
  dHash?: string;
  /** Shopify section anchor for dedup grouping */
  sectionAnchor?: string;
  /** Set by validation pass */
  validated?: boolean;
  /** Confidence 0-1 set by validation pass; defaults to 1.0 for raw Playwright findings */
  confidence?: number;
}

/** A finding submitted by a Claude discovery persona agent. */
export interface DiscoveryFinding {
  url: string;
  screenshot: string;
  quotedElement: string;
  claim: string;
  persona: string;
  severity: Severity;
  bugClass: BugClass;
  ruleId: string;
  timestamp: string;
}

export interface BugRecord {
  fingerprint: string;
  ruleId: string;
  severity: Severity;
  bugClass: BugClass;
  title: string;
  description: string;
  urls: string[];
  viewports: Viewport[];
  elementShot?: string;
  annotatedPageShot?: string;
  selector?: string;
  outerHTMLSnippet?: string;
  helpUrl?: string;
  instanceCount: number;
}

/** A scored finding ready for the report. Extends BugRecord with scoring fields. */
export interface ScoredBug extends BugRecord {
  score: number;
  source: BugSource;
  validated?: boolean;
  confidence: number;
  verificationStatus?: VerificationStatus;
  consensusCount: number;
  discoveryPersona?: string;
}

export interface UrlList {
  home: string[];
  product: string[];
  collection: string[];
  page: string[];
  blog: string[];
  cart: string[];
  policy: string[];
}

/** One entry in data/dismissed.jsonl */
export interface DismissedEntry {
  fingerprint: string;
  reason: string;
  dismissedAt: string;
}

/** One entry in data/report-history.jsonl — fingerprints from a completed run */
export interface ReportHistoryEntry {
  runDate: string;
  fingerprints: string[];
}
