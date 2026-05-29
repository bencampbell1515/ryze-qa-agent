// Pure, dependency-free helpers for the v2 Finding stream. Kept separate from
// `runs.ts` (which pulls in the Firebase SDK at import time) so they can be
// unit-tested in a plain Node environment without booting Firebase.

/**
 * Parse a JSONL (newline-delimited JSON) string into an array of T.
 * Blank/whitespace-only lines are ignored; malformed lines are skipped rather
 * than throwing, so one corrupt record never blanks the whole list.
 */
export function parseJsonl<T>(text: string): T[] {
  const out: T[] = [];
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    try {
      out.push(JSON.parse(line) as T);
    } catch {
      // Skip the malformed line; a single bad record shouldn't blank the list.
    }
  }
  return out;
}

/**
 * Build the gs:// path of a finding's crop image.
 *
 * `cropsPrefix` already includes the runId (`gs://.../reports/<runId>/crops/`),
 * while `crop.path` may be an absolute capture path, a `<runId>/<id>.png`
 * relative path, or a bare `<id>.png`. Joining the prefix with the *basename*
 * is robust across all three and avoids doubling the runId.
 *
 * Returns null when either input is missing or no filename can be derived.
 */
export function cropDownloadPath(
  cropsPrefix: string | undefined,
  cropPath: string | undefined,
): string | null {
  if (!cropsPrefix || !cropPath) return null;
  const base = cropPath.split(/[\\/]/).pop()?.trim() ?? "";
  if (!base) return null;
  const prefix = cropsPrefix.endsWith("/") ? cropsPrefix : `${cropsPrefix}/`;
  return `${prefix}${base}`;
}
