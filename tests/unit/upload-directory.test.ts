import { test, expect } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  uploadDirectoryRecursive,
  type UploadableBucket,
} from '../../scripts/upload-directory.js';

/**
 * A mock that records every upload() call. Optionally delays each upload by
 * `delayMs` so concurrency can be observed, and can be told to reject for a
 * specific destination so the graceful-degradation path can be exercised.
 */
function makeMockBucket(opts?: {
  delayMs?: number;
  failDestinations?: Set<string>;
}) {
  const calls: Array<{
    localPath: string;
    destination: string;
    contentType?: string;
    cacheControl?: string;
  }> = [];
  let inFlight = 0;
  let maxInFlight = 0;

  const bucket: UploadableBucket = {
    async upload(localPath, options) {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      try {
        if (opts?.delayMs) {
          await new Promise((res) => setTimeout(res, opts.delayMs));
        }
        if (opts?.failDestinations?.has(options.destination)) {
          throw new Error(`mock upload failure for ${options.destination}`);
        }
        calls.push({
          localPath,
          destination: options.destination,
          contentType: options.contentType,
          cacheControl: options.metadata?.cacheControl,
        });
      } finally {
        inFlight--;
      }
    },
  };

  return { bucket, calls, getMaxInFlight: () => maxInFlight };
}

async function makeTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'upload-dir-test-'));
}

test('uploads 3 files at the root with correct remote paths', async () => {
  const dir = await makeTempDir();
  try {
    await writeFile(join(dir, 'a.png'), 'a');
    await writeFile(join(dir, 'b.png'), 'b');
    await writeFile(join(dir, 'c.png'), 'c');

    const { bucket, calls } = makeMockBucket();
    const result = await uploadDirectoryRecursive(bucket, dir, 'reports/run-abc/crops');

    expect(calls.length).toBe(3);
    const destinations = calls.map((c) => c.destination).sort();
    expect(destinations).toEqual([
      'reports/run-abc/crops/a.png',
      'reports/run-abc/crops/b.png',
      'reports/run-abc/crops/c.png',
    ]);
    expect(result.uploaded.sort()).toEqual([
      'reports/run-abc/crops/a.png',
      'reports/run-abc/crops/b.png',
      'reports/run-abc/crops/c.png',
    ]);
    expect(result.skipped).toEqual([]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('recurses into nested subdirectories preserving structure in remote paths', async () => {
  const dir = await makeTempDir();
  try {
    await writeFile(join(dir, 'top.png'), 'x');
    await mkdir(join(dir, 'sub', 'deep'), { recursive: true });
    await writeFile(join(dir, 'sub', 'mid.png'), 'y');
    await writeFile(join(dir, 'sub', 'deep', 'leaf.png'), 'z');

    const { bucket, calls } = makeMockBucket();
    const result = await uploadDirectoryRecursive(bucket, dir, 'reports/run-abc/crops');

    expect(calls.length).toBe(3);
    expect(result.uploaded.sort()).toEqual([
      'reports/run-abc/crops/sub/deep/leaf.png',
      'reports/run-abc/crops/sub/mid.png',
      'reports/run-abc/crops/top.png',
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('empty directory → no upload calls, empty arrays', async () => {
  const dir = await makeTempDir();
  try {
    const { bucket, calls } = makeMockBucket();
    const result = await uploadDirectoryRecursive(bucket, dir, 'reports/run-abc/crops');
    expect(calls.length).toBe(0);
    expect(result).toEqual({ uploaded: [], skipped: [] });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('missing directory → no calls, empty arrays, no throw', async () => {
  const { bucket, calls } = makeMockBucket();
  const result = await uploadDirectoryRecursive(
    bucket,
    join(tmpdir(), 'definitely-does-not-exist-xyz-12345'),
    'reports/run-abc/crops',
  );
  expect(calls.length).toBe(0);
  expect(result).toEqual({ uploaded: [], skipped: [] });
});

test('respects the concurrency limit', async () => {
  const dir = await makeTempDir();
  try {
    for (let i = 0; i < 12; i++) {
      await writeFile(join(dir, `f${i}.png`), String(i));
    }
    const { bucket, getMaxInFlight } = makeMockBucket({ delayMs: 25 });
    await uploadDirectoryRecursive(bucket, dir, 'reports/run-abc/crops', {
      concurrency: 3,
    });
    expect(getMaxInFlight()).toBeLessThanOrEqual(3);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('defaults to concurrency 8 when not specified', async () => {
  const dir = await makeTempDir();
  try {
    for (let i = 0; i < 20; i++) {
      await writeFile(join(dir, `f${i}.png`), String(i));
    }
    const { bucket, getMaxInFlight } = makeMockBucket({ delayMs: 25 });
    await uploadDirectoryRecursive(bucket, dir, 'reports/run-abc/crops');
    expect(getMaxInFlight()).toBeLessThanOrEqual(8);
    expect(getMaxInFlight()).toBeGreaterThan(1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('honors the contentTypeFor callback', async () => {
  const dir = await makeTempDir();
  try {
    await writeFile(join(dir, 'a.png'), 'a');
    await writeFile(join(dir, 'b.png'), 'b');

    const { bucket, calls } = makeMockBucket();
    await uploadDirectoryRecursive(bucket, dir, 'reports/run-abc/crops', {
      contentTypeFor: () => 'image/png',
    });
    expect(calls.every((c) => c.contentType === 'image/png')).toBe(true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('sets immutable cache-control metadata like uploadArtifact', async () => {
  const dir = await makeTempDir();
  try {
    await writeFile(join(dir, 'a.png'), 'a');
    const { bucket, calls } = makeMockBucket();
    await uploadDirectoryRecursive(bucket, dir, 'reports/run-abc/crops');
    expect(calls[0].cacheControl).toBe('public, max-age=31536000, immutable');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a single failed upload is collected in skipped; others still upload', async () => {
  const dir = await makeTempDir();
  try {
    await writeFile(join(dir, 'good1.png'), '1');
    await writeFile(join(dir, 'bad.png'), '2');
    await writeFile(join(dir, 'good2.png'), '3');

    const { bucket, calls } = makeMockBucket({
      failDestinations: new Set(['reports/run-abc/crops/bad.png']),
    });
    const result = await uploadDirectoryRecursive(bucket, dir, 'reports/run-abc/crops');

    expect(result.uploaded.sort()).toEqual([
      'reports/run-abc/crops/good1.png',
      'reports/run-abc/crops/good2.png',
    ]);
    expect(result.skipped).toEqual(['reports/run-abc/crops/bad.png']);
    // The two good files were still recorded by the bucket.
    expect(calls.length).toBe(2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
