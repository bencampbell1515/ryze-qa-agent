# Worktree N1: Daemon-Side Uploads of Rebuild Artifacts to Firebase

## Mission

Extend the audit daemon (`scripts/runner-daemon.ts`) to upload the
v2 Finding stream, the uncertain/suppressed/hygiene tiers, and the
per-finding element crops to Firebase Storage at the end of every
successful run. Add the corresponding `gs://` path fields to the
`runs/{runId}` Firestore document so the dashboard can find them.

This worktree closes the integration gap between the rebuilt audit
pipeline (A through L) and the deployed dashboard at
live-qa-agent.web.app. After N1 lands and a real audit runs, the new
artifacts will be visible in the Firebase console under
`reports/{runId}/` and the Firestore document will carry their paths.

N1 is daemon-only. The dashboard side (new components that render the
findings + crops) is worktree N2, written separately and shipped after
N1 merges.

## Why

The dashboard investigation surfaced that every rebuild output is
local-file-only today. The daemon uploads exactly 5 artifacts to
Storage (audit-report.html, audit-report.pdf, scored-bugs.json,
audit-report-suppressed.html, system-health.md) and writes a few
`gs://` path fields to Firestore. The new v2 streams
(`data/findings.jsonl`, `data/uncertain-findings.jsonl`,
`data/suppressed-findings.jsonl`, `data/hygiene.jsonl`) and the
per-finding crops (`output/crops/<runId>/*.png`) are completely
invisible to the dashboard.

The audit pipeline produces this data already (M1/M2 + H + I + J + K
+ A all write it locally). N1 just gets it to Firebase so the
dashboard can consume it. Pure plumbing.

## Files to modify

### `scripts/runner-daemon.ts`

The daemon already has an `uploadArtifact()` helper that uploads a
single local file to Storage with metadata + cache headers. Extend
the post-run upload flow:

**Add four new single-file uploads.** Mirror the existing 5 patterns.
For each, only upload if the local file exists; skip gracefully if
absent (e.g. uncertain-findings.jsonl won't exist when
RYZE_ENABLE_TWO_JUDGE is unset).

| Local file | Remote path | Content-type |
|---|---|---|
| `data/findings.jsonl` | `reports/{runId}/findings.jsonl` | application/x-ndjson |
| `data/uncertain-findings.jsonl` | `reports/{runId}/uncertain-findings.jsonl` | application/x-ndjson |
| `data/suppressed-findings.jsonl` | `reports/{runId}/suppressed-findings.jsonl` | application/x-ndjson |
| `data/hygiene.jsonl` | `reports/{runId}/hygiene.jsonl` | application/x-ndjson |

**Add a recursive directory upload** for the crops. The crops live at
`output/crops/<runId>/*.png`. Add a helper:

```typescript
async function uploadDirectoryRecursive(
  localDir: string,
  remotePrefix: string,
  options?: { contentTypeFor?: (file: string) => string; concurrency?: number }
): Promise<{ uploaded: string[]; skipped: string[] }>;
```

Behavior:
- If `localDir` doesn't exist, return `{ uploaded: [], skipped: [] }`
  without error.
- Walk the directory recursively. For each file, build the remote
  path as `${remotePrefix}/${relativePath}`.
- Upload in parallel with the given `concurrency` (default 8).
- Use the same Storage Admin SDK pattern as `uploadArtifact`.
- Return the lists for logging and Firestore.

Call it once for the crops dir:
```typescript
const cropsResult = await uploadDirectoryRecursive(
  `output/crops/${runId}`,
  `reports/${runId}/crops`,
  { contentTypeFor: () => 'image/png', concurrency: 8 }
);
```

**Add new Firestore field writes** to the existing post-run
`db.collection('runs').doc(runId).set(patch, { merge: true })` call.
Add these fields to the patch (only when the corresponding upload
succeeded — undefined/null fields are skipped):

| Firestore field | Value |
|---|---|
| `findingsJsonPath` | `gs://<bucket>/reports/{runId}/findings.jsonl` |
| `uncertainFindingsJsonPath` | `gs://<bucket>/reports/{runId}/uncertain-findings.jsonl` |
| `suppressedFindingsJsonPath` | `gs://<bucket>/reports/{runId}/suppressed-findings.jsonl` |
| `hygieneJsonPath` | `gs://<bucket>/reports/{runId}/hygiene.jsonl` |
| `cropsPrefix` | `gs://<bucket>/reports/{runId}/crops/` (if any crops uploaded) |
| `findingsCount` | line count of findings.jsonl, or 0 if absent |
| `uncertainCount` | line count of uncertain-findings.jsonl, or 0 |
| `suppressedCount` | line count of suppressed-findings.jsonl, or 0 |
| `hygieneCount` | line count of hygiene.jsonl, or 0 |
| `cropsCount` | number of crops uploaded (cropsResult.uploaded.length) |

The line-count fields make the dashboard render counts (in the
telemetry grid, in tab headers) without parsing the full JSONL files
client-side just to count.

## Files to create

### `scripts/upload-directory.ts` (or inline in runner-daemon.ts)

If the recursive uploader is more than ~40 lines, extract it into its
own file under scripts/. Otherwise keep inline in runner-daemon.ts.
Session's call.

## Tests

The daemon doesn't have extensive tests today (it's pragmatic
infrastructure code). Don't try to build a full test harness for it.
Do these targeted tests:

### `tests/unit/upload-directory.test.ts`

Test the recursive uploader against a temp directory + a mocked
Storage bucket. Mock the bucket's `.file().save()` method.

- positive: directory with 3 files at root → 3 upload calls with
  correct remote paths
- positive: directory with nested subdirectories → recursive traversal,
  flat remote paths preserve structure
- positive: empty directory → no calls, returns empty arrays
- positive: missing directory → no calls, returns empty arrays, no
  throw
- positive: concurrency limit respected (use a sleep-mock to verify)
- positive: contentTypeFor callback is honored

### Integration smoke test for the daemon upload flow

This is harder because the daemon is long-lived and CI-unfriendly.
Skip a full integration test. Instead:

- Manual verification in the PR: run the daemon locally with a small
  audit (env vars to enable rubrics + gate + two-judge if possible),
  let it complete, check the Firebase console for the new files and
  fields. Paste a screenshot of `reports/{runId}/` showing the new
  files + a screenshot of the Firestore doc showing the new fields.
- Alternatively: a `npm run smoke:daemon-uploads` script that uses
  the Admin SDK mock to assert the patch payload includes the new
  fields and the upload calls were made for any present local files.
  The session's call which it ships, based on what's quickest.

## Success criteria

- `npm run test:unit` passes (target ~1565, L landed at 1556, plus
  ~10 new tests for the directory uploader).
- `npx tsc --noEmit` clean.
- After a real audit run with all rebuild features enabled:
  - `reports/{runId}/` in Firebase Storage contains findings.jsonl,
    suppressed-findings.jsonl (if J was enabled), uncertain-findings.jsonl
    (if K was enabled), hygiene.jsonl, and a crops/ subdirectory
  - `runs/{runId}` in Firestore has the new path fields and count
    fields populated
  - The existing 5 artifacts are still uploaded unchanged
  - Existing dashboard pages (RunList, RunDetail, OutputsPage) still
    work exactly as before (the new fields are additive)
- For a run where features are NOT enabled (no rubrics, no gate, no
  two-judge): the missing JSONL files are skipped gracefully, the
  count fields are 0, the daemon doesn't error.

## Boundaries — do not

- Modify `src/`. The audit pipeline already writes these files; N1
  is upload-only.
- Modify Firestore rules. The Admin SDK bypasses rules, and we're
  not changing the dashboard's read permissions.
- Modify Storage rules. The existing `reports/{runId}/{allPaths=**}`
  wildcard already covers nested paths like `crops/`.
- Modify the dashboard at `web/`. That's N2.
- Modify the existing 5 artifact uploads or their Firestore field
  writes. Only add new ones.
- Change the daemon's lifecycle (queued → running → complete) or its
  log-line parsing.
- Add new env vars to gate the new uploads. The local files'
  presence is the natural gate; if findings.jsonl exists on disk,
  upload it; if not, skip.
- Try to retroactively upload artifacts from past runs. N1 only
  affects future runs from the moment it's deployed.

## Reference

- `scripts/runner-daemon.ts` — the only existing writer to Firebase
- `firebase.json` — Storage bucket config, CSP rules
- `storage.rules` — read permissions (already cover nested paths)
- `firestore.rules` — write rules don't apply to Admin SDK; reads
  require @ryzewith.com (unchanged)
- The Firebase dashboard investigation report — sections 3, 7, 8 are
  the most relevant
- `src/findings/collector.ts` (M1) — where findings.jsonl is produced
- `src/gate/batch.ts` (J, K) — where suppressed/uncertain files are
  produced
- `src/discovery/index.ts` (A) — where hygiene.jsonl is produced
- `src/crops/path.ts` (H) — where the crops directory layout is
  defined

## PR convention

Title: `worktree-N1: upload rebuild artifacts (findings, crops, hygiene) to Firebase`

Description must include:
- Files modified (`scripts/runner-daemon.ts`, possibly
  `scripts/upload-directory.ts`)
- Files added (tests, optional helper)
- For a real audit run, paste:
  - Firebase Storage console screenshot showing the new files under
    `reports/{runId}/`
  - Firestore console screenshot showing the new fields on the
    `runs/{runId}` document
- Test count delta
- Confirmation that the existing 5 uploads + existing fields are
  unchanged (diff of the existing `uploadArtifact` calls + the existing
  Firestore patch — they should be identical pre/post N1)

## Open assumptions to verify

1. **Bucket name.** The daemon's existing uploads use a specific
   bucket. Confirm it's the same one (`live-qa-agent.firebasestorage.app`
   per the investigation) and that the new uploads target it. The
   uploader should use the existing bucket reference, not introduce a
   new one.
2. **Run-ID propagation to the crops directory.** Worktree H writes
   crops to `output/crops/<runId>/`. Confirm the daemon has the runId
   in scope at the upload step and the crops directory uses the
   correct format. If the audit's crops dir uses a different runId
   format or location, the brief's path needs to adjust.
3. **Daemon concurrency.** The daemon may already be running other
   uploads or DB writes concurrently. Make sure the new
   `uploadDirectoryRecursive` call's parallelism (default 8) doesn't
   contend with the daemon's other work. If unclear, default to 4.
4. **Firestore rules read constraints.** The investigation says the
   dashboard reads are gated on `isRyzeUser()` only — no field-level
   restrictions. Confirm the new fields are readable by current
   dashboard code without changes.
5. **Existing test coverage of the daemon.** If `tests/` already has
   any daemon tests, follow that pattern. If not, the targeted
   uploader test under `tests/unit/` is the right scope.

## Notes for N2 (the dashboard worktree)

N2 will need:
- `Finding` type in `web/lib/schema.ts` mirroring `src/types/finding.ts`
- `HygieneFinding` type in `web/lib/schema.ts` mirroring A's shape
- New path fields on `Run` type: `findingsJsonPath`, `uncertainFindingsJsonPath`,
  `suppressedFindingsJsonPath`, `hygieneJsonPath`, `cropsPrefix`,
  `findingsCount`, `uncertainCount`, `suppressedCount`, `hygieneCount`,
  `cropsCount`
- A helper that fetches a Storage JSONL via `getDownloadURL` + fetch +
  parse (mirror how `useDiffRequest` fetches `scored-bugs.json`)
- New components to render findings + crops
- Integration into `RunDetail.tsx`

N2's brief will be written separately. N1's job is just to make sure
the data is there for N2 to read.
