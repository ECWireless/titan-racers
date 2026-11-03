import { z } from "zod";

import {
  encodeGhostTrace,
  type GhostSample,
  ghostTraceToBase64,
} from "../ghost/ghost-trace";
import { CURRENT_PHYSICS_VERSION } from "../physics/physics-version";
import type { GameplayRaceIdentity } from "../telemetry/gameplay-run-events";
import { RUN_REJECTIONS } from "./race-verification";

/**
 * A run that can count asks for a signed ticket when it starts and, on
 * finish, sends the ticket and its recording. The server checks both and
 * answers with the run's standing; the client never claims a time or rank.
 * A guest's ticket, or an unnamed racer's, names no racer: the run waits on
 * the device until they sign in and choose a username (`held-run.ts`).
 */

/** How long a ticket naming no racer lasts after its run starts. */
export const UNNAMED_RUN_TICKET_LIFETIME_MS = 30 * 60 * 1_000;

/** What an unnamed ticket waits for: signing in, or choosing a username. */
const UNNAMED_REASONS = ["login", "username"] as const;
export type UnnamedTicketReason = (typeof UNNAMED_REASONS)[number];

const ticketResponseSchema = z.union([
  z.strictObject({ ticket: z.string().min(1) }),
  z.strictObject({
    reason: z.enum(UNNAMED_REASONS),
    ticket: z.string().min(1),
  }),
  z.strictObject({ reason: z.literal("not-eligible"), ticket: z.null() }),
]);

const microsecondsSchema = z.number().int().positive();
const runSubmissionResponseSchema = z.discriminatedUnion("status", [
  z.strictObject({
    entries: z.number().int().positive(),
    personalBest: z.strictObject({
      improved: z.boolean(),
      timeMicroseconds: microsecondsSchema,
    }),
    rank: z.number().int().positive(),
    status: z.literal("verified"),
  }),
  z.strictObject({
    reason: z.enum(RUN_REJECTIONS),
    status: z.literal("rejected"),
  }),
]);
export type RunSubmissionResponse = z.infer<typeof runSubmissionResponseSchema>;

function postJson(path: string, body: unknown, timeoutMs: number) {
  return fetch(path, {
    body: JSON.stringify(body),
    cache: "no-store",
    headers: { "content-type": "application/json" },
    method: "POST",
    signal: AbortSignal.timeout(timeoutMs),
  });
}

export type RunTicketOutcome =
  | { ticket: string }
  | {
      /** When the server stops accepting it, by this device's clock. */
      expiresAt: number;
      reason: UnnamedTicketReason;
      ticket: string;
    };

/**
 * A ticket for a race that can count; null for a race that cannot, a
 * bundled race, or when the request fails.
 */
export async function requestRunTicket(
  identity: GameplayRaceIdentity,
): Promise<RunTicketOutcome | null> {
  const { courseId, courseRevision, kartId, kartRevision } = identity;
  if (courseRevision === null || kartRevision === null) return null;
  const requestedAt = Date.now();
  try {
    const response = await postJson(
      "/api/runs/tickets",
      {
        courseId,
        courseRevision,
        kartId,
        kartRevision,
        physicsVersion: CURRENT_PHYSICS_VERSION,
      },
      5_000,
    );
    if (!response.ok) return null;
    const parsed = ticketResponseSchema.parse(await response.json());
    if (parsed.ticket === null) return null;
    return "reason" in parsed
      ? {
          expiresAt: requestedAt + UNNAMED_RUN_TICKET_LIFETIME_MS,
          reason: parsed.reason,
          ticket: parsed.ticket,
        }
      : { ticket: parsed.ticket };
  } catch {
    return null;
  }
}

export function encodeRunRecording(samples: readonly GhostSample[]) {
  return ghostTraceToBase64(encodeGhostTrace(samples));
}

/** A run's standing, or the HTTP status that refused it (0 if unsent). */
export async function sendRunRecording(
  ticket: string,
  recording: string,
): Promise<RunSubmissionResponse | { httpStatus: number }> {
  try {
    const response = await postJson(
      "/api/runs",
      { recording, ticket },
      15_000,
    );
    if (!response.ok) return { httpStatus: response.status };
    return runSubmissionResponseSchema.parse(await response.json());
  } catch {
    return { httpStatus: 0 };
  }
}

export async function submitRun(
  ticket: string,
  samples: readonly GhostSample[],
): Promise<RunSubmissionResponse | null> {
  const sent = await sendRunRecording(ticket, encodeRunRecording(samples));
  return "status" in sent ? sent : null;
}
