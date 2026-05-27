"use client";

import { doc, getDoc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { useEffect, useState } from "react";
import { db } from "./firebase";
import type { DiffRequest } from "./schema";

/** Stable, sorted ID so the same (A, B) pair always hits the same doc — built-in caching. */
export function diffIdFor(runIdA: string, runIdB: string): string {
  const sorted = [runIdA, runIdB].sort();
  return `${sorted[0]}--${sorted[1]}`;
}

/**
 * Ensures a diff request document exists for the (A, B) pair and subscribes to it.
 * If the doc already exists (cached), we just subscribe. Otherwise we create one and
 * the daemon will pick it up.
 */
export function useDiffRequest(
  runIdA: string | null,
  runIdB: string | null,
  requestedByEmail: string | null,
): { diff: DiffRequest | null; ensuring: boolean; error: string | null } {
  const [diff, setDiff] = useState<DiffRequest | null>(null);
  const [ensuring, setEnsuring] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!runIdA || !runIdB || !requestedByEmail) {
      setDiff(null);
      return;
    }
    if (runIdA === runIdB) {
      setDiff(null);
      setError("Pick two different scans to compare.");
      return;
    }

    const id = diffIdFor(runIdA, runIdB);
    const ref = doc(db, "diffRequests", id);

    let unsub: (() => void) | null = null;
    let cancelled = false;

    (async () => {
      setError(null);
      setEnsuring(true);
      try {
        const snap = await getDoc(ref);
        if (!snap.exists()) {
          await setDoc(ref, {
            runIdA,
            runIdB,
            status: "requested",
            requestedBy: requestedByEmail,
            requestedAt: serverTimestamp(),
          });
        }
        if (cancelled) return;
        unsub = onSnapshot(ref, (s) => {
          if (s.exists()) {
            setDiff({ id: s.id, ...(s.data() as Omit<DiffRequest, "id">) });
          } else {
            setDiff(null);
          }
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setEnsuring(false);
      }
    })();

    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [runIdA, runIdB, requestedByEmail]);

  return { diff, ensuring, error };
}
