"use client";

import { useEffect, useRef, useState } from "react";

import type { KartAssemblyDocument } from "@/game/kart/kart-assembly-document";
import type { KartFitCheck } from "@/game/kart/kart-assembly-fit";

/** How long edits must settle before the kart is checked again. */
const SETTLE_MS = 350;

export type KartFitCheckState =
  | { status: "checking"; last: KartFitCheck | null }
  | { status: "ready"; result: KartFitCheck }
  | { status: "unavailable" };

/**
 * Checks the kart for clashes and unsnapped parts in a worker once edits
 * settle, as the save gate will, so the builder shows the result as you edit.
 */
export function useKartFitCheck(
  document: KartAssemblyDocument,
): KartFitCheckState {
  const [checked, setChecked] = useState<{
    document: KartAssemblyDocument;
    result: KartFitCheck | null;
  } | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const workerRef = useRef<Worker | null>(null);
  const latestRef = useRef<{ document: KartAssemblyDocument; id: number }>({
    document,
    id: 0,
  });
  // One check at a time: edits made while one runs wait for it, and then
  // only the latest is checked.
  const inFlightRef = useRef<number | null>(null);
  const settledRef = useRef<number | null>(null);
  const postRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (typeof Worker === "undefined") return;
    let worker: Worker;
    try {
      worker = new Worker(new URL("./kart-fit.worker.ts", import.meta.url), {
        type: "module",
      });
    } catch {
      // Without a worker, the save gate still checks fit when saving.
      return;
    }
    worker.onmessage = (
      event: MessageEvent<{ id: number; result: KartFitCheck | null }>,
    ) => {
      inFlightRef.current = null;
      const latest = latestRef.current;
      if (event.data.id === latest.id) {
        setChecked({ document: latest.document, result: event.data.result });
      } else if (settledRef.current === latest.id) {
        postRef.current();
      }
    };
    worker.onerror = () => setUnavailable(true);
    workerRef.current = worker;
    return () => {
      worker.terminate();
      workerRef.current = null;
      // A terminated worker never replies.
      inFlightRef.current = null;
    };
  }, []);

  useEffect(() => {
    postRef.current = () => {
      const { document: latest, id } = latestRef.current;
      try {
        if (!workerRef.current) throw new Error("No fit-check worker.");
        workerRef.current.postMessage({ document: latest, id });
        inFlightRef.current = id;
      } catch {
        setUnavailable(true);
      }
    };
  }, []);

  useEffect(() => {
    const id = latestRef.current.id + 1;
    latestRef.current = { document, id };
    const timer = window.setTimeout(() => {
      settledRef.current = id;
      if (inFlightRef.current === null) postRef.current();
    }, SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [document]);

  if (unavailable) return { status: "unavailable" };
  if (checked?.document === document) {
    return checked.result
      ? { result: checked.result, status: "ready" }
      : { status: "unavailable" };
  }
  return { last: checked?.result ?? null, status: "checking" };
}
