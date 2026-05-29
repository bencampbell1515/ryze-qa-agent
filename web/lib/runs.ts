"use client";

import {
  addDoc,
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { ref, getDownloadURL } from "firebase/storage";
import { useEffect, useState } from "react";
import { db, storage } from "./firebase";
import type { Finding, HygieneFinding, Run, RunEvent } from "./schema";
import { cropDownloadPath, parseJsonl } from "./findings-parse";

export function useRuns(max: number = 50): { runs: Run[]; loading: boolean } {
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(collection(db, "runs"), orderBy("requestedAt", "desc"), limit(max));
    const unsub = onSnapshot(q, (snap) => {
      setRuns(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Run, "id">) })));
      setLoading(false);
    });
    return () => unsub();
  }, [max]);

  return { runs, loading };
}

export function useRun(runId: string | null): { run: Run | null; loading: boolean } {
  const [run, setRun] = useState<Run | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!runId) {
      setRun(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const unsub = onSnapshot(doc(db, "runs", runId), (snap) => {
      if (snap.exists()) {
        setRun({ id: snap.id, ...(snap.data() as Omit<Run, "id">) });
      } else {
        setRun(null);
      }
      setLoading(false);
    });
    return () => unsub();
  }, [runId]);

  return { run, loading };
}

export function useRunEvents(runId: string | null): RunEvent[] {
  const [events, setEvents] = useState<RunEvent[]>([]);

  useEffect(() => {
    if (!runId) {
      setEvents([]);
      return;
    }
    const q = query(
      collection(db, "runs", runId, "events"),
      orderBy("ts", "asc"),
      limit(500),
    );
    const unsub = onSnapshot(q, (snap) => {
      setEvents(
        snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<RunEvent, "id">) })),
      );
    });
    return () => unsub();
  }, [runId]);

  return events;
}

import type { ScanConfig } from "./scan-config";

export async function startRun(
  email: string,
  scanConfig?: ScanConfig,
  note?: string,
): Promise<string> {
  const docRef = await addDoc(collection(db, "runs"), {
    status: "requested",
    requestedBy: email,
    requestedAt: serverTimestamp(),
    ...(note ? { note } : {}),
    ...(scanConfig ? { scanConfig } : {}),
  });
  return docRef.id;
}

export async function cancelRun(runId: string): Promise<void> {
  await updateDoc(doc(db, "runs", runId), { status: "cancel-requested" });
}

export async function getArtifactDownloadUrl(gsPath: string): Promise<string> {
  return getDownloadURL(ref(storage, gsPath));
}

// ---------------------------------------------------------------------------
// v2 Finding stream — Storage JSONL fetch + per-finding crop URLs.
//
// There is no pre-existing client-side Storage-fetch pattern (DiffView routes
// through the daemon + Firestore, not Storage). These build directly on the
// `getArtifactDownloadUrl` primitive: resolve a token-signed URL, fetch the
// JSONL, parse line-by-line. Absent/404 artifacts resolve to an empty list so
// callers (and legacy runs without these fields) render cleanly.
// ---------------------------------------------------------------------------

async function fetchJsonlArtifact<T>(gsPath: string | undefined): Promise<T[]> {
  if (!gsPath) return [];
  try {
    const url = await getDownloadURL(ref(storage, gsPath));
    const res = await fetch(url);
    if (!res.ok) return [];
    return parseJsonl<T>(await res.text());
  } catch {
    // Missing object (404), storage permission hiccup, or network error:
    // degrade to an empty list rather than crashing the run detail page.
    return [];
  }
}

export function fetchFindings(gsPath: string | undefined): Promise<Finding[]> {
  return fetchJsonlArtifact<Finding>(gsPath);
}

export function fetchHygiene(gsPath: string | undefined): Promise<HygieneFinding[]> {
  return fetchJsonlArtifact<HygieneFinding>(gsPath);
}

// Session-long cache of resolved crop download URLs, keyed by the full gs://
// path. Caching the *Promise* (not just the resolved string) also dedupes
// concurrent in-flight `getDownloadURL` calls when many cards mount at once.
const cropUrlCache = new Map<string, Promise<string>>();

function resolveCropUrl(gsPath: string): Promise<string> {
  let p = cropUrlCache.get(gsPath);
  if (!p) {
    p = getDownloadURL(ref(storage, gsPath)).catch((e) => {
      // Don't poison the cache with a rejected promise — a transient failure
      // shouldn't permanently blank this crop for the rest of the session.
      cropUrlCache.delete(gsPath);
      throw e;
    });
    cropUrlCache.set(gsPath, p);
  }
  return p;
}

/**
 * Resolve the token-signed download URL for a finding's crop image.
 * `cropsPrefix` comes from the run doc; `cropPath` from `finding.crop.path`.
 * Returns `{ url: null }` (no loading, no error) when there's no crop to show.
 */
export function useCropUrl(
  cropsPrefix: string | undefined,
  cropPath: string | undefined,
): { url: string | null; loading: boolean; error?: Error } {
  const gsPath = cropDownloadPath(cropsPrefix, cropPath);
  // Initialize from gsPath; cards are keyed by finding id so gsPath is stable
  // across a card's lifetime and we never need a synchronous in-effect reset.
  const [state, setState] = useState<{ url: string | null; loading: boolean; error?: Error }>(
    () => ({ url: null, loading: !!gsPath }),
  );

  useEffect(() => {
    if (!gsPath) return;
    let cancelled = false;
    resolveCropUrl(gsPath)
      .then((url) => {
        if (!cancelled) setState({ url, loading: false });
      })
      .catch((error: Error) => {
        if (!cancelled) setState({ url: null, loading: false, error });
      });
    return () => {
      cancelled = true;
    };
  }, [gsPath]);

  return state;
}
