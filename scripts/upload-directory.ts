/**
 * Recursive directory uploader for the runner daemon.
 *
 * Walks a local directory tree and uploads every file to Firebase Storage,
 * preserving the relative path structure under a remote prefix. Used by the
 * daemon to push per-finding element crops (`output/crops/<runId>/*.png`) to
 * `reports/<runId>/crops/` after a successful audit.
 *
 * The Storage bucket is injected (not imported) so the walk + concurrency
 * logic is unit-testable against a mock — see tests/unit/upload-directory.test.ts.
 */
import { readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import pLimit from 'p-limit';

/**
 * Minimal surface of firebase-admin's Storage Bucket that the uploader needs.
 * Mirrors the `bucket.upload()` call shape used by `uploadArtifact` in
 * runner-daemon.ts so production and tests share one contract.
 */
export interface UploadableBucket {
  upload(
    localPath: string,
    options: {
      destination: string;
      contentType?: string;
      metadata?: { cacheControl?: string };
    },
  ): Promise<unknown>;
}

export interface UploadDirectoryOptions {
  /** Returns the content-type for a given local file path. */
  contentTypeFor?: (localPath: string) => string;
  /** Max parallel uploads. Defaults to 8. */
  concurrency?: number;
}

export interface UploadDirectoryResult {
  /** Remote destinations that uploaded successfully. */
  uploaded: string[];
  /** Remote destinations whose upload threw (others still proceed). */
  skipped: string[];
}

const DEFAULT_CONCURRENCY = 8;
// Same immutable cache header uploadArtifact uses — crops are content-addressed
// by finding id, so they never change once written.
const CACHE_CONTROL = 'public, max-age=31536000, immutable';

/** Recursively collect every file (not directory) under `dir`. */
async function listFilesRecursive(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await listFilesRecursive(full)));
    } else if (entry.isFile()) {
      out.push(full);
    } else {
      // Symlinks / sockets / etc. — stat to resolve regular files, skip the rest.
      try {
        if ((await stat(full)).isFile()) out.push(full);
      } catch {
        // unreadable — ignore
      }
    }
  }
  return out;
}

/** Convert an OS-relative path to a forward-slash Storage path segment. */
function toRemoteSegment(rel: string): string {
  return sep === '/' ? rel : rel.split(sep).join('/');
}

/**
 * Upload every file under `localDir` to `${remotePrefix}/${relativePath}`.
 *
 * - Missing `localDir` → `{ uploaded: [], skipped: [] }`, no throw.
 * - Uploads run in parallel up to `concurrency` (default 8).
 * - A single file's upload failure does not abort the batch; it lands in
 *   `skipped` so the daemon's post-run flow degrades gracefully.
 */
export async function uploadDirectoryRecursive(
  bucket: UploadableBucket,
  localDir: string,
  remotePrefix: string,
  options?: UploadDirectoryOptions,
): Promise<UploadDirectoryResult> {
  if (!existsSync(localDir)) {
    return { uploaded: [], skipped: [] };
  }

  const files = await listFilesRecursive(localDir);
  if (files.length === 0) {
    return { uploaded: [], skipped: [] };
  }

  const concurrency = options?.concurrency ?? DEFAULT_CONCURRENCY;
  const limit = pLimit(concurrency);
  const uploaded: string[] = [];
  const skipped: string[] = [];

  await Promise.all(
    files.map((localPath) =>
      limit(async () => {
        const rel = toRemoteSegment(relative(localDir, localPath));
        const destination = `${remotePrefix}/${rel}`;
        try {
          await bucket.upload(localPath, {
            destination,
            ...(options?.contentTypeFor ? { contentType: options.contentTypeFor(localPath) } : {}),
            metadata: { cacheControl: CACHE_CONTROL },
          });
          uploaded.push(destination);
        } catch {
          skipped.push(destination);
        }
      }),
    ),
  );

  return { uploaded, skipped };
}
