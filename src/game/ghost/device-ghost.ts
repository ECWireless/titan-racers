import { z } from "zod";

import {
  type KartAssemblyDocument,
  kartAssemblyDocumentSchema,
} from "../kart/kart-assembly-document";
import { CURRENT_PHYSICS_VERSION } from "../physics/physics-version";
import {
  decodeGhostTrace,
  encodeGhostTrace,
  type GhostSample,
  ghostTraceFromBase64,
  ghostTraceToBase64,
} from "./ghost-trace";

/**
 * Your best race on one course revision under the current physics, kept in
 * this browser, as a board would rank it. It carries what drawing its kart
 * needs, since a later race may use another kart.
 */
export type DeviceGhost = {
  courseId: string;
  /** Null for a bundled seed. */
  courseRevision: number | null;
  kart: GhostKart;
  samples: GhostSample[];
  timeMicroseconds: number;
};

/** The ghost kart's look and the offsets its pose needs. */
export type GhostKart = {
  /** Centre of mass in assembly axes; the recorded root sits there. */
  centerOfMass: { x: number; y: number; z: number };
  document: KartAssemblyDocument;
  wheels: Array<{ id: string; radius: number; steered: boolean }>;
};

const GHOST_KEY_PREFIX = "titan-racers.ghost.v1:";
const GHOST_SWITCH_KEY = "titan-racers.ghost-switch.v1";

const vectorSchema = z.strictObject({
  x: z.number().finite(),
  y: z.number().finite(),
  z: z.number().finite(),
});
const storedGhostSchema = z.strictObject({
  courseId: z.string().min(1).max(80),
  courseRevision: z.number().int().positive().nullable(),
  kart: z.strictObject({
    centerOfMass: vectorSchema,
    document: kartAssemblyDocumentSchema,
    wheels: z
      .array(
        z.strictObject({
          id: z.string().min(1).max(80),
          radius: z.number().positive().max(10),
          steered: z.boolean(),
        }),
      )
      .max(16),
  }),
  timeMicroseconds: z.number().int().nonnegative(),
  trace: z.string().min(1),
});

function ghostKey(courseId: string, courseRevision: number | null) {
  return `${GHOST_KEY_PREFIX}${courseId}:${courseRevision ?? "seed"}:${CURRENT_PHYSICS_VERSION}`;
}

/**
 * Whether a stored key for this course is superseded by a new best: one
 * under other physics, or, for a published revision, the seed or an earlier
 * revision. A best on the seed (raced offline) never displaces a revision.
 */
function supersedes(key: string, courseRevision: number | null) {
  const [revision, physicsVersion] = key.split(":");
  if (physicsVersion !== CURRENT_PHYSICS_VERSION) return true;
  if (courseRevision === null) return false;
  return revision === "seed" || Number(revision) < courseRevision;
}

/** The stored best for this course revision, or null if none is usable. */
export function readDeviceGhost(
  courseId: string,
  courseRevision: number | null,
): DeviceGhost | null {
  try {
    const raw = window.localStorage.getItem(ghostKey(courseId, courseRevision));
    return raw ? parseGhostRecord(JSON.parse(raw), courseId, courseRevision) : null;
  } catch {
    return null;
  }
}

/**
 * A ghost from a stored or downloaded record for this course revision, or
 * null if it is for another, malformed, or in an older format.
 */
export function parseGhostRecord(
  value: unknown,
  courseId: string,
  courseRevision: number | null,
): DeviceGhost | null {
  try {
    const stored = storedGhostSchema.parse(value);
    if (
      stored.courseId !== courseId ||
      stored.courseRevision !== courseRevision
    ) {
      return null;
    }
    const samples = decodeGhostTrace(ghostTraceFromBase64(stored.trace));
    if (samples.at(-1)?.timeMicroseconds !== stored.timeMicroseconds) {
      return null;
    }
    return {
      courseId,
      courseRevision,
      kart: stored.kart as GhostKart,
      samples,
      timeMicroseconds: stored.timeMicroseconds,
    };
  } catch {
    // A malformed record or an older format.
    return null;
  }
}

/**
 * Keeps `ghost` if it beats the stored best for its course revision, and
 * drops this course's superseded ghosts. Returns whether it was kept.
 */
export function keepDeviceGhostIfBest(ghost: DeviceGhost) {
  const current = readDeviceGhost(ghost.courseId, ghost.courseRevision);
  if (current && current.timeMicroseconds <= ghost.timeMicroseconds) {
    return false;
  }
  try {
    const key = ghostKey(ghost.courseId, ghost.courseRevision);
    const coursePrefix = `${GHOST_KEY_PREFIX}${ghost.courseId}:`;
    for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
      const existing = window.localStorage.key(index);
      if (
        existing?.startsWith(coursePrefix) &&
        existing !== key &&
        supersedes(existing.slice(coursePrefix.length), ghost.courseRevision)
      ) {
        window.localStorage.removeItem(existing);
      }
    }
    window.localStorage.setItem(
      key,
      JSON.stringify({
        courseId: ghost.courseId,
        courseRevision: ghost.courseRevision,
        kart: ghost.kart,
        timeMicroseconds: ghost.timeMicroseconds,
        trace: ghostTraceToBase64(encodeGhostTrace(ghost.samples)),
      }),
    );
    return true;
  } catch {
    // Storage full or unavailable: the ghost lives only for this session.
    return false;
  }
}

/** Drops a stored best this build cannot use, so later bests can replace it. */
export function forgetDeviceGhost(
  courseId: string,
  courseRevision: number | null,
) {
  try {
    window.localStorage.removeItem(ghostKey(courseId, courseRevision));
  } catch {
    // Nothing to forget.
  }
}

/** Which ghost a solo race takes: the course best unless they chose their own. */
export type GhostChoice = "course_best" | "own_best";
const GHOST_CHOICE_KEY = "titan-racers.ghost-choice.v1";

/** A ghost from the board, and which of the two it is. */
export type BoardGhost = { ghost: DeviceGhost; kind: GhostChoice };

// Holds a choice for this session when storage refuses it.
let sessionGhostChoice: GhostChoice | null = null;

export function readGhostChoice(): GhostChoice {
  if (sessionGhostChoice) return sessionGhostChoice;
  try {
    return window.localStorage.getItem(GHOST_CHOICE_KEY) === "own_best"
      ? "own_best"
      : "course_best";
  } catch {
    return "course_best";
  }
}

const ghostChoiceListeners = new Set<() => void>();

/** For `useSyncExternalStore`: hears choices made in this tab. */
export function subscribeGhostChoice(listener: () => void) {
  ghostChoiceListeners.add(listener);
  return () => {
    ghostChoiceListeners.delete(listener);
  };
}

export function writeGhostChoice(choice: GhostChoice) {
  sessionGhostChoice = choice;
  try {
    window.localStorage.setItem(GHOST_CHOICE_KEY, choice);
  } catch {
    // Storage is unavailable; the choice holds for this session.
  }
  ghostChoiceListeners.forEach((listener) => listener());
}

/** The player's Ghost switch; on unless they turned it off. */
export function readGhostSwitch() {
  try {
    return window.localStorage.getItem(GHOST_SWITCH_KEY) !== "off";
  } catch {
    return true;
  }
}

export function writeGhostSwitch(on: boolean) {
  try {
    window.localStorage.setItem(GHOST_SWITCH_KEY, on ? "on" : "off");
  } catch {
    // The choice still holds for this session.
  }
}
