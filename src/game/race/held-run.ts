import { z } from "zod";

import {
  type RunSubmissionResponse,
  sendRunRecording,
} from "./run-submission";

/**
 * A guest's finished run, or an unnamed racer's, waits on this device with
 * its ticket and recording until they sign in and choose a username; then
 * it goes to the board as theirs. One run is held, the fastest, until its
 * ticket expires.
 */
const HELD_RUN_KEY = "titan-racers.held-run.v1";
// The outcome of sending it, for the leaderboard to show once.
const HELD_RUN_NOTE_KEY = "titan-racers.held-run-note.v1";

const heldRunSchema = z.strictObject({
  expiresAt: z.number().int().positive(),
  recording: z.string().min(1),
  ticket: z.string().min(1),
  timeMicroseconds: z.number().int().positive(),
});
type HeldRun = z.infer<typeof heldRunSchema>;

const microsecondsSchema = z.number().int().positive();
const heldRunNoteSchema = z.discriminatedUnion("status", [
  z.strictObject({
    entries: z.number().int().positive(),
    personalBest: z.strictObject({
      improved: z.boolean(),
      timeMicroseconds: microsecondsSchema,
    }),
    rank: z.number().int().positive(),
    status: z.literal("verified"),
    timeMicroseconds: microsecondsSchema,
  }),
  z.strictObject({
    status: z.enum(["expired", "rejected", "unavailable"]),
    timeMicroseconds: microsecondsSchema,
  }),
]);
/** What became of a held run once it was sent. */
export type HeldRunNote = z.infer<typeof heldRunNoteSchema>;

/** Why a held run is still waiting after an attempt to send it. */
export type HeldRunWait = {
  reason: "failed" | "login" | "username";
  timeMicroseconds: number;
};

// Storage is read inside each `try`: a browser blocking it throws on access.
function readJson<T>(
  storage: () => Storage,
  key: string,
  schema: z.ZodType<T>,
) {
  try {
    const raw = storage().getItem(key);
    if (raw === null) return null;
    const parsed = schema.safeParse(JSON.parse(raw));
    if (parsed.success) return parsed.data;
    storage().removeItem(key);
  } catch {
    // Storage may be unavailable or hold something this build cannot read.
  }
  return null;
}

function forgetHeldRun() {
  try {
    window.localStorage.removeItem(HELD_RUN_KEY);
  } catch {
    // Nothing more to do.
  }
}

function readHeldRun(now = Date.now()): HeldRun | null {
  const held = readJson(
    () => window.localStorage,
    HELD_RUN_KEY,
    heldRunSchema,
  );
  if (held && held.expiresAt <= now) {
    forgetHeldRun();
    return null;
  }
  return held;
}

/**
 * Holds a finished run unless a faster one is already waiting. Returns the
 * run now held, or null if none is: this one is too late, or this device
 * cannot keep it.
 */
export function holdRun(run: HeldRun, now = Date.now()): HeldRun | null {
  // A long pause can outlast the ticket, which dates from the run's start.
  if (run.expiresAt <= now) return null;
  const held = readHeldRun(now);
  if (held && held.timeMicroseconds <= run.timeMicroseconds) return held;
  try {
    window.localStorage.setItem(HELD_RUN_KEY, JSON.stringify(run));
    return run;
  } catch {
    return null;
  }
}

/** The outcome of the last held run sent, once. */
export function takeHeldRunNote(): HeldRunNote | null {
  const note = readJson(
    () => window.sessionStorage,
    HELD_RUN_NOTE_KEY,
    heldRunNoteSchema,
  );
  try {
    window.sessionStorage.removeItem(HELD_RUN_NOTE_KEY);
  } catch {
    // Nothing more to do.
  }
  return note;
}

function noteOutcome(
  run: HeldRun,
  sent: RunSubmissionResponse | { httpStatus: number },
): HeldRunNote | HeldRunWait | null {
  const { timeMicroseconds } = run;
  if ("status" in sent) {
    return sent.status === "verified"
      ? { ...sent, timeMicroseconds }
      : { status: "rejected", timeMicroseconds };
  }
  switch (sent.httpStatus) {
    case 401:
      return { reason: "login", timeMicroseconds };
    case 428:
      return { reason: "username", timeMicroseconds };
    case 400:
      return { status: "expired", timeMicroseconds };
    // Already on the board, from another tab.
    case 409:
      return null;
    case 422:
      return { status: "unavailable", timeMicroseconds };
    default:
      return { reason: "failed", timeMicroseconds };
  }
}

let sending: Promise<HeldRunWait | null> | null = null;

/**
 * Sends the held run, if any, for the signed-in racer. Once the server
 * settles it, the run is forgotten and its outcome noted for the
 * leaderboard; a run waiting on sign-in, a username, or the network stays
 * held, and that wait is returned. Concurrent calls share one request.
 */
export function sendHeldRun(): Promise<HeldRunWait | null> {
  sending ??= (async () => {
    const run = readHeldRun();
    if (!run) return null;
    const outcome = noteOutcome(
      run,
      await sendRunRecording(run.ticket, run.recording),
    );
    if (outcome && "reason" in outcome) return outcome;
    // A faster run held meanwhile, in another tab, stays.
    if (readHeldRun()?.ticket === run.ticket) forgetHeldRun();
    if (outcome) {
      try {
        window.sessionStorage.setItem(
          HELD_RUN_NOTE_KEY,
          JSON.stringify(outcome),
        );
      } catch {
        // The board still shows the run.
      }
    }
    return null;
  })().finally(() => {
    sending = null;
  });
  return sending;
}
