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
import type { Run, RunEvent } from "./schema";

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
