import {
  officialKartRosterSchema,
  type OfficialKartRoster,
} from "@/game/kart/official-kart-roster";

import type { HomeKart } from "./home-steps";

/** An official kart a player can race, as home and rooms show it. */
export type PlayableOfficialKart = HomeKart & {
  /** The published revision, or null for the bundled roster. */
  revision: number | null;
};

// Only published revisions count, so this waits out a page busy loading
// the race; a server that is down still fails at once.
const ROSTER_LOAD_TIMEOUT_MS = 10_000;

export async function loadOfficialKartRoster() {
  const response = await fetch("/api/karts/official", {
    cache: "no-store",
    signal: AbortSignal.timeout(ROSTER_LOAD_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error("Official kart roster unavailable.");
  return officialKartRosterSchema.parse(await response.json());
}

export function playableOfficialKarts(
  roster: OfficialKartRoster,
): PlayableOfficialKart[] {
  return roster.karts.map((entry) =>
    "runtime" in entry
      ? {
          assemblerCredit: entry.assemblerCredit,
          document: entry.runtime.document,
          resolvedSnapshot: entry.runtime.resolvedSnapshot,
          revision: entry.runtime.revision,
          thumbnailSource: entry.runtime.thumbnailAvailable
            ? `/api/karts/${entry.runtime.kartId}/thumbnail?revision=${entry.runtime.revision}`
            : null,
        }
      : {
          assemblerCredit: entry.assemblerCredit,
          document: entry.document,
          resolvedSnapshot: entry.resolvedSnapshot,
          revision: null,
          thumbnailSource: null,
        },
  );
}
