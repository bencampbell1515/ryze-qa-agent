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

export interface UrlList {
  home: string[];
  product: string[];
  collection: string[];
  page: string[];
  blog: string[];
  cart: string[];
  policy: string[];
}
