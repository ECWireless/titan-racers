"use client";

import { useEffect, useState } from "react";

import { sendHeldRun } from "@/game/race/held-run";
import {
  type ScoreBoardResponse,
  scoreBoardResponseSchema,
} from "@/game/race/scores";

/** The score board as it stands, or null when it cannot be loaded. */
export async function fetchScores(): Promise<ScoreBoardResponse | null> {
  try {
    const response = await fetch("/api/scores", { cache: "no-store" });
    if (!response.ok) return null;
    return scoreBoardResponseSchema.parse(await response.json());
  } catch {
    return null;
  }
}

/**
 * The scores, loaded once for a screen that only adds them to what it
 * shows: null until they arrive, and if they cannot be loaded. A run kept
 * from before signing in is sent first, so they count it.
 */
export function useScores() {
  const [scores, setScores] = useState<ScoreBoardResponse | null>(null);
  useEffect(() => {
    let active = true;
    void sendHeldRun()
      .catch(() => null)
      .then(fetchScores)
      .then((next) => {
        if (active) setScores(next);
      });
    return () => {
      active = false;
    };
  }, []);
  return scores;
}
