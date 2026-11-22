"use client";

import { useEffect, useRef, useState } from "react";

import type { KartAssemblyDocument } from "@/game/kart/kart-assembly-document";
import type { KartFitCheck } from "@/game/kart/kart-fit-check";

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
      const latest = latestRef.current;
      if (event.data.id !== latest.id) return;
      setChecked({ document: latest.document, result: event.data.result });
    };
    worker.onerror = () => setUnavailable(true);
    workerRef.current = worker;
    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const id = latestRef.current.id + 1;
    latestRef.current = { document, id };
    const timer = window.setTimeout(() => {
      try {
        if (!workerRef.current) throw new Error("No fit-check worker.");
        workerRef.current.postMessage({ document, id });
      } catch {
        setUnavailable(true);
      }
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
