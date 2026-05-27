/**
 * Runner daemon — watches Firestore for requested runs and executes the full-audit
 * pipeline on this machine, streaming progress + log tail back to Firestore.
 *
 * Run with:  npm run daemon
 * Stop with: Ctrl-C (graceful: marks any in-flight run as 'failed' with reason)
 */
import "dotenv/config";
import { initializeApp, cert, type App } from "firebase-admin/app";
import { getFirestore, FieldValue, type DocumentSnapshot, type Firestore, Timestamp } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { spawn, type ChildProcess } from "node:child_process";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import Anthropic from "@anthropic-ai/sdk";

const REPO_ROOT = resolve(import.meta.dirname, "..");
const PROJECT_ID = "live-qa-agent";
const STORAGE_BUCKET = "live-qa-agent.firebasestorage.app";
const SA_PATH = process.env.GOOGLE_APPLICATION_CREDENTIALS
  ?? join(homedir(), ".config", "ryze-qa", "service-account.json");
const LOG_TAIL_MAX = 200;
const LOG_FLUSH_MS = 750;
// Cap how many runs can be queued behind the currently-executing one. Any Ryze
// user can create runs/{id} docs; without a cap, an account compromise (or a
// runaway script in the UI) can pile up days of audit work.
const MAX_QUEUE_LENGTH = 10;

// ---------------------------------------------------------------------------
// Input validation — Admin SDK bypasses Firestore rules, so the daemon must
// independently validate any field that hits the filesystem or shell.
// ---------------------------------------------------------------------------

const RUN_ID_RE = /^[A-Za-z0-9_-]{6,64}$/;

function isValidRunId(id: unknown): id is string {
  return typeof id === "string" && RUN_ID_RE.test(id);
}

/** Allowlist of hosts the bot is ever permitted to crawl. */
const ALLOWED_CRAWL_HOSTS = new Set([
  "www.ryzesuperfoods.com",
  "shop.ryzesuperfoods.com",
  "ryzesuperfoods.com",
]);

function isAllowedCrawlUrl(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try {
    const u = new URL(value);
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    return ALLOWED_CRAWL_HOSTS.has(u.host);
  } catch {
    return false;
  }
}

/**
 * Schema-validate the scanConfig blob before writing it to disk. Returns the
 * sanitized config (drops unknown keys) or throws on hostile input.
 *
 * Keep this list in sync with what audit scripts are actually allowed to read.
 * Adding a new field requires explicit validation here.
 */
// Keep this list in sync with web/lib/scan-config.ts ScanConfig type. Adding
// a new field here without adding it there (or vice versa) silently drops
// the value before audit scripts can read it.
const SCAN_CONFIG_ALLOWED_KEYS = new Set([
  "sites", "checks", "personas", "viewports",
  "maxUrls", "maxDurationMin", "concurrency", "urlExcludes",
  "presetName", // reserved for future preset support in UI
]);
const MAX_STRING_LEN = 500;
const MAX_ARRAY_LEN = 100;

function validateScanConfig(raw: unknown): Record<string, unknown> | null {
  if (raw == null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("scanConfig must be a JSON object");
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!SCAN_CONFIG_ALLOWED_KEYS.has(key)) {
      console.warn(`[daemon] dropping unknown scanConfig key: ${key}`);
      continue;
    }
    // Generic shape checks — depth-limited, no functions, no buffers
    const validated = sanitizeJson(value, key, 0);
    if (validated !== undefined) out[key] = validated;
  }
  return out;
}

function sanitizeJson(value: unknown, path: string, depth: number): unknown {
  if (depth > 4) throw new Error(`scanConfig.${path} nested too deep`);
  if (value === null) return null;
  if (typeof value === "string") {
    if (value.length > MAX_STRING_LEN) throw new Error(`scanConfig.${path} string too long`);
    // Any string that LOOKS like a URL must be on the crawl allowlist. This
    // is the SSRF backstop: even if a future audit script reads scanConfig
    // and feeds a value to curl/page.goto, hostile hosts are rejected here.
    if (/^https?:\/\//i.test(value) || /^file:|^gopher:|^ftp:/i.test(value)) {
      if (!isAllowedCrawlUrl(value)) {
        throw new Error(`scanConfig.${path} contains disallowed URL: ${value.slice(0, 80)}`);
      }
    }
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    if (value.length > MAX_ARRAY_LEN) throw new Error(`scanConfig.${path} array too long`);
    return value.map((v, i) => sanitizeJson(v, `${path}[${i}]`, depth + 1));
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      // Reject keys that look like path-traversal vectors
      if (k.includes("/") || k.includes("..") || k.startsWith("__")) {
        throw new Error(`scanConfig.${path}.${k} has unsafe key`);
      }
      const sub = sanitizeJson(v, `${path}.${k}`, depth + 1);
      if (sub !== undefined) out[k] = sub;
    }
    return out;
  }
  return undefined; // drop functions, undefined, symbols
}

async function failRun(runId: string, message: string) {
  try {
    await setRun(runId, {
      status: "failed",
      step: "done",
      progress: 100,
      completedAt: FieldValue.serverTimestamp(),
      errorMessage: message,
    });
    await appendEvent(runId, "error", message);
  } catch (e) {
    console.error(`[daemon] failRun(${runId}) errored:`, e);
  }
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

if (!existsSync(SA_PATH)) {
  console.error(`[fatal] service account not found at ${SA_PATH}`);
  process.exit(1);
}

const serviceAccount = JSON.parse(await readFile(SA_PATH, "utf-8"));
const app: App = initializeApp({
  credential: cert(serviceAccount),
  projectId: PROJECT_ID,
  storageBucket: STORAGE_BUCKET,
});
const db: Firestore = getFirestore(app);
const bucket = getStorage(app).bucket();

console.log(`[daemon] connected to ${PROJECT_ID} as ${serviceAccount.client_email}`);

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;
if (!anthropic) {
  console.log(`[daemon] ANTHROPIC_API_KEY not set — semantic diff will be skipped`);
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

type PersonaState = { initial: number; current: number };

type ActiveRun = {
  id: string;
  child: ChildProcess;
  logTail: string[];
  lastFlush: number;
  flushTimer: NodeJS.Timeout | null;
  cancelled: boolean;
  // progress tracking
  step: string;
  urlCount: number;
  personas: Map<string, PersonaState>;
  progressPercent: number;
  killEscalationTimers: NodeJS.Timeout[];
};

let activeRun: ActiveRun | null = null;
const queue: string[] = [];
let processing = false;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function setRun(runId: string, patch: Record<string, unknown>) {
  await db.collection("runs").doc(runId).set(patch, { merge: true });
}

async function appendEvent(
  runId: string,
  level: "info" | "warn" | "error",
  message: string
) {
  await db
    .collection("runs")
    .doc(runId)
    .collection("events")
    .add({ ts: Timestamp.now(), level, message });
}

function killProcessGroup(run: ActiveRun, signal: NodeJS.Signals) {
  const pid = run.child.pid;
  if (!pid) return;
  try {
    // Negative pid → signal the entire process group whose leader is `pid`
    process.kill(-pid, signal);
  } catch (e) {
    // ESRCH means the group is already dead; anything else worth logging
    const code = (e as NodeJS.ErrnoException).code;
    if (code !== "ESRCH") console.error(`[daemon] kill -${signal} -${pid} failed:`, e);
  }
}

function scheduleLogFlush(run: ActiveRun) {
  if (run.flushTimer) return;
  run.flushTimer = setTimeout(async () => {
    run.flushTimer = null;
    try {
      const urlsScanned = computeUrlsScanned(run);
      await setRun(run.id, {
        logTail: run.logTail.slice(-LOG_TAIL_MAX),
        progress: run.progressPercent,
        ...(run.urlCount ? { urlCount: run.urlCount } : {}),
        ...(urlsScanned !== null ? { urlsScanned } : {}),
        logUpdatedAt: FieldValue.serverTimestamp(),
      });
    } catch (e) {
      console.error(`[daemon] logTail flush failed:`, e);
    }
  }, LOG_FLUSH_MS);
}

function parseStep(line: string): { step: string; progress: number } | null {
  const stripped = line.replace(/\x1b\[[0-9;]*m/g, "");
  if (/> ryze-qa@.* clean$/.test(stripped))        return { step: "queued",      progress: 5  };
  if (/> ryze-qa@.* test:crawl$/.test(stripped))   return { step: "crawl",       progress: 10 };
  if (/> ryze-qa@.* test:audit$|playwright test/.test(stripped))
                                                   return { step: "audit",       progress: 30 };
  if (/> ryze-qa@.* orchestrate$/.test(stripped))  return { step: "orchestrate", progress: 90 };
  return null;
}

/**
 * Detect "Discovered N URLs" and per-persona "Session N: M URLs remaining" lines.
 * Updates run state in-place. Returns true if any signal advanced.
 */
function parseProgressSignals(run: ActiveRun, line: string): boolean {
  const stripped = line.replace(/\x1b\[[0-9;]*m/g, "");

  const discovered = stripped.match(/Discovered (\d+) URLs/);
  if (discovered) {
    run.urlCount = parseInt(discovered[1], 10);
    return true;
  }

  // `[persona-name] Session N: M URLs remaining` — bracket label from run-audit.ts
  const personaLine = stripped.match(/\[([\w-]+)\]\s+Session \d+:\s+(\d+) URLs remaining/);
  if (personaLine) {
    const name = personaLine[1];
    const remaining = parseInt(personaLine[2], 10);
    const existing = run.personas.get(name);
    if (!existing) {
      run.personas.set(name, { initial: remaining, current: remaining });
    } else {
      existing.current = remaining;
      // A new session may briefly show a fresh "remaining" count after a session ends —
      // grow the initial only when we see a value higher than before.
      if (remaining > existing.initial) existing.initial = remaining;
    }
    return true;
  }

  return false;
}

/** Sum of (initial − current) across all personas, or null if none yet. */
function computeUrlsScanned(run: ActiveRun): number | null {
  if (run.personas.size === 0) return null;
  let scanned = 0;
  for (const p of run.personas.values()) scanned += Math.max(0, p.initial - p.current);
  return scanned;
}

/** Compute the audit-phase percent based on persona progress. Maps to 30..85. */
function computeAuditPercent(run: ActiveRun): number {
  if (run.personas.size === 0) return 30;
  let totalInitial = 0;
  let totalCurrent = 0;
  for (const p of run.personas.values()) {
    totalInitial += p.initial;
    totalCurrent += p.current;
  }
  if (totalInitial === 0) return 30;
  const frac = Math.max(0, Math.min(1, (totalInitial - totalCurrent) / totalInitial));
  return Math.round(30 + frac * 55);
}

async function findLatestArtifact(extension: "html" | "pdf", since: Date): Promise<string | null> {
  const dir = join(REPO_ROOT, "output");
  const entries = await readdir(dir);
  const candidates = entries.filter((f) =>
    /^audit-report-\d{4}-\d{2}-\d{2}\.(html|pdf)$/.test(f) && f.endsWith(`.${extension}`),
  );
  let newest: { path: string; mtime: number } | null = null;
  for (const name of candidates) {
    const p = join(dir, name);
    const s = await stat(p);
    if (s.mtimeMs < since.getTime()) continue;
    if (!newest || s.mtimeMs > newest.mtime) newest = { path: p, mtime: s.mtimeMs };
  }
  return newest?.path ?? null;
}

async function uploadArtifact(runId: string, localPath: string, remoteName: string, contentType: string): Promise<string> {
  const destination = `reports/${runId}/${remoteName}`;
  await bucket.upload(localPath, {
    destination,
    contentType,
    metadata: { cacheControl: "public, max-age=31536000, immutable" },
  });
  return `gs://${STORAGE_BUCKET}/${destination}`;
}

async function readBugCount(): Promise<number | undefined> {
  const p = join(REPO_ROOT, "data", "scored-bugs.json");
  if (!existsSync(p)) return undefined;
  try {
    const json = JSON.parse(await readFile(p, "utf-8"));
    if (Array.isArray(json)) return json.length;
    if (Array.isArray(json.bugs)) return json.bugs.length;
  } catch {
    return undefined;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Pipeline execution
// ---------------------------------------------------------------------------

async function executeRun(runId: string) {
  // Defense-in-depth — Firestore rules already enforce this format, but the
  // Admin SDK bypasses rules and the daemon writes runId into a filesystem
  // path. Hard-fail before any I/O if the ID is hostile.
  if (!isValidRunId(runId)) {
    console.error(`[daemon] refusing invalid runId: ${runId}`);
    await failRun(runId, "Invalid runId format");
    return;
  }
  const startTs = new Date();
  console.log(`[daemon] starting run ${runId}`);

  // Read scanConfig from the run doc (set by UI) and persist it to disk so the
  // audit scripts can opt into reading it. Schema-validated to prevent SSRF /
  // path traversal as new audit scripts learn to read this file.
  const docSnap = await db.collection("runs").doc(runId).get();
  const rawConfig = docSnap.data()?.scanConfig;
  let scanConfig: Record<string, unknown> | null = null;
  try {
    scanConfig = validateScanConfig(rawConfig);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[daemon] rejecting run ${runId}: ${msg}`);
    await failRun(runId, `scanConfig validation failed: ${msg}`);
    return;
  }
  if (scanConfig) {
    const configPath = join(REPO_ROOT, "data", ".ryze-scan-config.json");
    await writeFile(configPath, JSON.stringify({ runId, ...scanConfig }, null, 2));
    console.log(`[daemon] wrote scan config → ${configPath}`);
  }

  await setRun(runId, {
    status: "running",
    step: "queued",
    progress: 0,
    startedAt: FieldValue.serverTimestamp(),
    logTail: [],
  });
  await appendEvent(runId, "info", "Run started on host machine");
  if (scanConfig) {
    await appendEvent(runId, "info", "Scan config attached · pre-flight written to data/.ryze-scan-config.json");
  }

  // `detached: true` puts the child in its own process group so we can SIGINT
  // the entire tree (npm → npx → tsx → playwright workers + persona subprocesses)
  // by signalling -pid. Without this, only the npm process dies.
  const child = spawn("npm", ["run", "full-audit"], {
    cwd: REPO_ROOT,
    env: { ...process.env, CI: "1" },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });

  const run: ActiveRun = {
    id: runId,
    child,
    logTail: [],
    lastFlush: Date.now(),
    flushTimer: null,
    cancelled: false,
    step: "queued",
    urlCount: 0,
    personas: new Map(),
    progressPercent: 0,
    killEscalationTimers: [],
  };
  activeRun = run;

  // Watch for cancel-requested → SIGINT process group, escalate to SIGTERM then SIGKILL
  const cancelUnsub = db
    .collection("runs")
    .doc(runId)
    .onSnapshot((snap: DocumentSnapshot) => {
      const data = snap.data();
      if (data?.status === "cancel-requested" && !run.cancelled) {
        run.cancelled = true;
        killProcessGroup(run, "SIGINT");
        console.log(`[daemon] cancel requested for ${runId}, SIGINT sent to process group`);
        // Escalate if the tree refuses to die
        run.killEscalationTimers.push(setTimeout(() => {
          if (child.exitCode === null) {
            console.log(`[daemon] cancel: escalating to SIGTERM`);
            killProcessGroup(run, "SIGTERM");
          }
        }, 8000));
        run.killEscalationTimers.push(setTimeout(() => {
          if (child.exitCode === null) {
            console.log(`[daemon] cancel: escalating to SIGKILL`);
            killProcessGroup(run, "SIGKILL");
          }
        }, 15000));
      }
    });

  const handleLine = (line: string, isStderr: boolean) => {
    if (!line.trim()) return;
    run.logTail.push(line);
    if (run.logTail.length > LOG_TAIL_MAX * 2) {
      run.logTail = run.logTail.slice(-LOG_TAIL_MAX);
    }

    // Step transition — write immediately so the UI updates within a tick
    const milestone = parseStep(line);
    if (milestone && milestone.step !== run.step) {
      run.step = milestone.step;
      run.progressPercent = Math.max(run.progressPercent, milestone.progress);
      void setRun(runId, { step: milestone.step, progress: run.progressPercent });
      void appendEvent(runId, "info", `Step → ${milestone.step}`);
    }

    // In-band progress signals (persona / crawl counts)
    parseProgressSignals(run, line);
    if (run.step === "audit") {
      const auditPct = computeAuditPercent(run);
      if (auditPct > run.progressPercent) run.progressPercent = auditPct;
    }

    scheduleLogFlush(run);

    if (isStderr && /error|fail/i.test(line)) {
      void appendEvent(runId, "warn", line.slice(0, 500));
    }
  };

  let stdoutBuf = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    stdoutBuf += chunk.toString();
    const lines = stdoutBuf.split("\n");
    stdoutBuf = lines.pop() ?? "";
    for (const l of lines) handleLine(l, false);
  });

  let stderrBuf = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    stderrBuf += chunk.toString();
    const lines = stderrBuf.split("\n");
    stderrBuf = lines.pop() ?? "";
    for (const l of lines) handleLine(l, true);
  });

  const exitCode: number | null = await new Promise((res) => {
    child.on("exit", (code) => res(code));
  });

  // Clear any pending escalation timers (the tree exited before we needed them)
  for (const t of run.killEscalationTimers) clearTimeout(t);
  run.killEscalationTimers = [];

  // Flush any remaining log lines
  if (run.flushTimer) {
    clearTimeout(run.flushTimer);
    run.flushTimer = null;
  }
  await setRun(runId, { logTail: run.logTail.slice(-LOG_TAIL_MAX) });
  cancelUnsub();

  if (run.cancelled) {
    await setRun(runId, {
      status: "cancelled",
      step: "done",
      progress: 100,
      completedAt: FieldValue.serverTimestamp(),
    });
    await appendEvent(runId, "warn", "Run cancelled by user");
    activeRun = null;
    return;
  }

  if (exitCode !== 0) {
    await setRun(runId, {
      status: "failed",
      step: "done",
      progress: 100,
      completedAt: FieldValue.serverTimestamp(),
      errorMessage: `Pipeline exited with code ${exitCode}`,
    });
    await appendEvent(runId, "error", `Pipeline failed (exit ${exitCode})`);
    activeRun = null;
    return;
  }

  // Success — upload artifacts
  await appendEvent(runId, "info", "Pipeline complete, uploading artifacts");

  const htmlPath = await findLatestArtifact("html", startTs);
  const pdfPath = await findLatestArtifact("pdf", startTs);
  const bugCount = await readBugCount();

  const updates: Record<string, unknown> = {
    status: "complete",
    step: "done",
    progress: 100,
    completedAt: FieldValue.serverTimestamp(),
    bugCount,
  };

  if (htmlPath) {
    updates.reportPath = await uploadArtifact(runId, htmlPath, "audit-report.html", "text/html");
  }
  if (pdfPath) {
    updates.pdfPath = await uploadArtifact(runId, pdfPath, "audit-report.pdf", "application/pdf");
  }

  // Upload scored-bugs.json so the diff view can compare bug fingerprints across runs
  const bugsJsonLocal = join(REPO_ROOT, "data", "scored-bugs.json");
  if (existsSync(bugsJsonLocal)) {
    updates.bugsJsonPath = await uploadArtifact(runId, bugsJsonLocal, "scored-bugs.json", "application/json");
  }

  // Suppressed report (visual-gate output) if present
  const dir = join(REPO_ROOT, "output");
  const suppressedEntries = (await readdir(dir)).filter(
    (f) => /^audit-report-\d{4}-\d{2}-\d{2}-suppressed\.html$/.test(f),
  );
  if (suppressedEntries.length > 0) {
    let newest: { path: string; mtime: number } | null = null;
    for (const name of suppressedEntries) {
      const p = join(dir, name);
      const s = await stat(p);
      if (s.mtimeMs < startTs.getTime()) continue;
      if (!newest || s.mtimeMs > newest.mtime) newest = { path: p, mtime: s.mtimeMs };
    }
    if (newest) {
      await uploadArtifact(runId, newest.path, "audit-report-suppressed.html", "text/html");
    }
  }

  await setRun(runId, updates);
  await appendEvent(
    runId,
    "info",
    `Complete — ${bugCount ?? "?"} bugs, report uploaded`,
  );
  console.log(`[daemon] finished run ${runId} (${bugCount ?? "?"} bugs)`);
  activeRun = null;
}

// ---------------------------------------------------------------------------
// Queue + listener
// ---------------------------------------------------------------------------

async function drainQueue() {
  if (processing) return;
  processing = true;
  while (queue.length > 0) {
    const runId = queue.shift()!;
    try {
      await executeRun(runId);
    } catch (e) {
      console.error(`[daemon] run ${runId} threw:`, e);
      try {
        await setRun(runId, {
          status: "failed",
          step: "done",
          progress: 100,
          completedAt: FieldValue.serverTimestamp(),
          errorMessage: e instanceof Error ? e.message : String(e),
        });
      } catch {}
    }
  }
  processing = false;
}

// Orphan recovery — any 'running' or 'cancel-requested' doc must be stale
// (no daemon was alive to process them). Mark them failed so they don't
// sit in the UI forever showing the wrong state.
{
  const orphanSnap = await db
    .collection("runs")
    .where("status", "in", ["running", "cancel-requested"])
    .get();
  if (!orphanSnap.empty) {
    console.log(`[daemon] recovering ${orphanSnap.size} orphan run(s) from prior session`);
    for (const doc of orphanSnap.docs) {
      await doc.ref.set(
        {
          status: "failed",
          step: "done",
          progress: 100,
          completedAt: FieldValue.serverTimestamp(),
          errorMessage: "Daemon was not running when this run was active",
        },
        { merge: true },
      );
    }
  }
}

db.collection("runs")
  .where("status", "==", "requested")
  .onSnapshot(
    (snap) => {
      for (const change of snap.docChanges()) {
        if (change.type !== "added") continue;
        const id = change.doc.id;
        if (queue.includes(id) || activeRun?.id === id) continue;
        if (!isValidRunId(id)) {
          console.warn(`[daemon] rejecting requested run with invalid id: ${id}`);
          void failRun(id, "Invalid runId format");
          continue;
        }
        if (queue.length >= MAX_QUEUE_LENGTH) {
          console.warn(`[daemon] queue full (${MAX_QUEUE_LENGTH}); rejecting ${id}`);
          void failRun(id, `Queue is full (limit ${MAX_QUEUE_LENGTH}). Try again later.`);
          continue;
        }
        console.log(`[daemon] queued run ${id}`);
        queue.push(id);
      }
      void drainQueue();
    },
    (err) => {
      console.error(`[daemon] listener error:`, err);
      process.exit(1);
    },
  );

// ---------------------------------------------------------------------------
// Diff request execution
// ---------------------------------------------------------------------------

type ScoredBug = {
  fingerprint?: string;
  ruleId?: string;
  severity?: string;
  description?: string;
  url?: string;
};

type BugSummary = {
  key: string;
  ruleId?: string;
  severity?: string;
  description?: string;
  url?: string;
};

function bugKey(b: ScoredBug): string {
  return b.fingerprint ?? `${b.ruleId}::${b.url ?? ""}::${(b.description ?? "").slice(0, 60)}`;
}

function summarize(b: ScoredBug): BugSummary {
  return {
    key: bugKey(b),
    ruleId: b.ruleId,
    severity: b.severity,
    description: b.description?.slice(0, 240),
    url: b.url,
  };
}

async function downloadBugsJson(gsPath: string): Promise<ScoredBug[]> {
  // Strict path shape — only files we wrote ourselves, namely
  // gs://<bucket>/reports/<runId>/scored-bugs.json. Belt-and-braces against
  // any future code path that lets a user influence bugsJsonPath.
  const expected = new RegExp(`^gs://${STORAGE_BUCKET.replace(/[.]/g, "\\.")}/reports/[A-Za-z0-9_-]{6,64}/scored-bugs\\.json$`);
  if (!expected.test(gsPath)) {
    throw new Error(`refusing to download untrusted path: ${gsPath}`);
  }
  const m = gsPath.match(/^gs:\/\/[^/]+\/(.+)$/);
  if (!m) throw new Error(`bad gs path: ${gsPath}`);
  const [content] = await bucket.file(m[1]).download();
  const parsed = JSON.parse(content.toString("utf-8"));
  if (Array.isArray(parsed)) return parsed as ScoredBug[];
  if (Array.isArray(parsed.bugs)) return parsed.bugs as ScoredBug[];
  return [];
}

async function semanticMatch(
  onlyA: BugSummary[],
  onlyB: BugSummary[],
): Promise<{ pairs: Array<{ keyA: string; keyB: string; confidence: number; reason: string }>; skipped?: string }> {
  if (!anthropic) {
    return { pairs: [], skipped: "no API key" };
  }
  if (onlyA.length === 0 || onlyB.length === 0) {
    return { pairs: [] };
  }
  // Cap list sizes — we have 200k tokens of headroom but no need to burn it.
  const capA = onlyA.slice(0, 80);
  const capB = onlyB.slice(0, 80);

  const promptItem = (b: BugSummary, idx: number) =>
    `[${idx}] (${b.severity ?? "?"}/${b.ruleId ?? "?"}) ${b.url ?? ""}\n      ${b.description ?? ""}`;

  const userMsg = `You are comparing bug findings from two QA scans of the same e-commerce website.

Each list contains findings that DID NOT match by exact fingerprint between the two scans. Many of them
are genuinely different bugs. But some are the same underlying issue worded differently by an LLM persona —
those are the ones we want to identify.

A pair is "the same issue" only if the defect, page/component, and direction of the problem all match.
Different URLs, different severities, or vague similarity (both about "navigation") are NOT matches.

LIST A — only in scan A:
${capA.map(promptItem).join("\n\n")}

LIST B — only in scan B:
${capB.map(promptItem).join("\n\n")}

Return JSON only, no prose. Format:
{"matches":[{"a":<indexA>,"b":<indexB>,"confidence":0..1,"reason":"<one short sentence>"}, ...]}

If no pairs match, return {"matches":[]}.`;

  const resp = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 4096,
    messages: [{ role: "user", content: userMsg }],
  });

  const text = resp.content
    .filter((c): c is Anthropic.TextBlock => c.type === "text")
    .map((c) => c.text)
    .join("");

  // Pull JSON out (model may wrap in fences)
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return { pairs: [], skipped: "no JSON in response" };

  let parsed: { matches?: Array<{ a: number; b: number; confidence?: number; reason?: string }> };
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    return { pairs: [], skipped: "JSON parse failed" };
  }
  if (!Array.isArray(parsed.matches)) return { pairs: [] };

  const pairs: Array<{ keyA: string; keyB: string; confidence: number; reason: string }> = [];
  for (const m of parsed.matches) {
    const a = capA[m.a];
    const b = capB[m.b];
    if (!a || !b) continue;
    pairs.push({
      keyA: a.key,
      keyB: b.key,
      confidence: typeof m.confidence === "number" ? Math.max(0, Math.min(1, m.confidence)) : 0.5,
      reason: m.reason ?? "matched",
    });
  }
  return { pairs };
}

async function executeDiff(diffId: string) {
  const diffRef = db.collection("diffRequests").doc(diffId);
  console.log(`[daemon] starting diff ${diffId}`);
  try {
    const snap = await diffRef.get();
    if (!snap.exists) return;
    const data = snap.data() as { runIdA: string; runIdB: string } | undefined;
    if (!data) return;
    const { runIdA, runIdB } = data;

    // Defense-in-depth: Firestore rules already enforce these, but Admin SDK
    // bypasses them and downstream code uses these IDs to fetch Storage paths.
    if (!isValidRunId(runIdA) || !isValidRunId(runIdB)) {
      await diffRef.set(
        { status: "failed", completedAt: FieldValue.serverTimestamp(), errorMessage: "Invalid runId(s)" },
        { merge: true },
      );
      return;
    }

    await diffRef.set({ status: "running-exact" }, { merge: true });

    const [runADoc, runBDoc] = await Promise.all([
      db.collection("runs").doc(runIdA).get(),
      db.collection("runs").doc(runIdB).get(),
    ]);
    const pathA = runADoc.data()?.bugsJsonPath as string | undefined;
    const pathB = runBDoc.data()?.bugsJsonPath as string | undefined;
    if (!pathA || !pathB) {
      await diffRef.set(
        {
          status: "failed",
          completedAt: FieldValue.serverTimestamp(),
          errorMessage: "One or both runs are missing scored-bugs.json (run was cancelled or completed before bug-JSON upload was added)",
        },
        { merge: true },
      );
      return;
    }

    const [bugsA, bugsB] = await Promise.all([downloadBugsJson(pathA), downloadBugsJson(pathB)]);

    const keyMapA = new Map<string, ScoredBug>();
    for (const b of bugsA) keyMapA.set(bugKey(b), b);
    const keyMapB = new Map<string, ScoredBug>();
    for (const b of bugsB) keyMapB.set(bugKey(b), b);

    const exactOnlyA: BugSummary[] = [];
    const exactOnlyB: BugSummary[] = [];
    const exactBoth: BugSummary[] = [];

    for (const [k, b] of keyMapA) {
      if (keyMapB.has(k)) exactBoth.push(summarize(b));
      else exactOnlyA.push(summarize(b));
    }
    for (const [k, b] of keyMapB) {
      if (!keyMapA.has(k)) exactOnlyB.push(summarize(b));
    }

    // Write exact pass immediately so the UI can render before semantic finishes
    await diffRef.set(
      {
        status: "running-semantic",
        exactOnlyA,
        exactOnlyB,
        exactBoth,
      },
      { merge: true },
    );

    // Semantic pass on the unmatched piles
    const { pairs, skipped } = await semanticMatch(exactOnlyA, exactOnlyB);

    const semanticPairs = pairs.map((p) => ({
      ...p,
      bugA: exactOnlyA.find((b) => b.key === p.keyA) ?? { key: p.keyA },
      bugB: exactOnlyB.find((b) => b.key === p.keyB) ?? { key: p.keyB },
    }));

    await diffRef.set(
      {
        status: "complete",
        completedAt: FieldValue.serverTimestamp(),
        semanticPairs,
        ...(skipped ? { semanticSkipped: skipped } : {}),
      },
      { merge: true },
    );

    console.log(
      `[daemon] diff ${diffId} done: ${exactBoth.length} exact-recurring, ` +
      `${exactOnlyA.length} only-A, ${exactOnlyB.length} only-B, ${semanticPairs.length} semantic-matches${skipped ? ` (semantic skipped: ${skipped})` : ""}`,
    );
  } catch (e) {
    console.error(`[daemon] diff ${diffId} threw:`, e);
    try {
      await diffRef.set(
        {
          status: "failed",
          completedAt: FieldValue.serverTimestamp(),
          errorMessage: e instanceof Error ? e.message : String(e),
        },
        { merge: true },
      );
    } catch {}
  }
}

const diffInflight = new Set<string>();
db.collection("diffRequests")
  .where("status", "==", "requested")
  .onSnapshot(
    (snap) => {
      for (const change of snap.docChanges()) {
        if (change.type !== "added") continue;
        const id = change.doc.id;
        if (diffInflight.has(id)) continue;
        diffInflight.add(id);
        void executeDiff(id).finally(() => diffInflight.delete(id));
      }
    },
    (err) => console.error(`[daemon] diff listener error:`, err),
  );

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

let shuttingDown = false;
const shutdown = async () => {
  if (shuttingDown) return; // a second Ctrl-C should not double-fire
  shuttingDown = true;
  console.log(`[daemon] shutdown signal received`);
  if (activeRun) {
    const run = activeRun;
    try {
      await setRun(run.id, {
        status: "failed",
        completedAt: FieldValue.serverTimestamp(),
        errorMessage: "Daemon shut down",
      });
    } catch {}
    // Escalation ladder: SIGTERM → 8s → SIGKILL → 7s → exit. Without this,
    // wedged Chrome/Playwright children survive the daemon and become zombies
    // (root CLAUDE.md mentions 27-day-old PID 90258 — same root cause).
    killProcessGroup(run, "SIGTERM");
    await new Promise((res) => setTimeout(res, 8000));
    if (run.child.exitCode === null) {
      console.log(`[daemon] shutdown: escalating to SIGKILL`);
      killProcessGroup(run, "SIGKILL");
      await new Promise((res) => setTimeout(res, 7000));
    }
  }
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

console.log(`[daemon] watching for runs (Ctrl-C to stop)`);
