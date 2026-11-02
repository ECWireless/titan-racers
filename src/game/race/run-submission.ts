import { z } from "zod";

import {
  encodeGhostTrace,
  type GhostSample,
  ghostTraceToBase64,
} from "../ghost/ghost-trace";
import { CURRENT_PHYSICS_VERSION } from "../physics/physics-version";
import type { GameplayRaceIdentity } from "../telemetry/gameplay-run-events";
import { MEDAL_TIERS } from "./race-medals";
import { RUN_REJECTIONS } from "./race-verification";

/**
 * A logged-in racer's run asks for a signed ticket when it starts and, on
 * finish, sends the ticket and its recording. The server checks both and
 * answers with the run's standing; the client never claims a time or rank.
 */

/** Why a race got no ticket: a guest, no username yet, or it cannot count. */
const NO_TICKET_REASONS = ["login", "username", "not-eligible"] as const;
export type NoTicketReason = (typeof NO_TICKET_REASONS)[number];

const ticketResponseSchema = z.union([
  z.strictObject({ ticket: z.string().min(1) }),
  z.strictObject({ reason: z.enum(NO_TICKET_REASONS), ticket: z.null() }),
]);

const microsecondsSchema = z.number().int().positive();
const runSubmissionResponseSchema = z.discriminatedUnion("status", [
  z.strictObject({
    entries: z.number().int().positive(),
    medal: z.strictObject({
      newTiers: z.array(z.enum(MEDAL_TIERS)),
      tier: z.enum(MEDAL_TIERS),
    }),
    personalBest: z.strictObject({
      improved: z.boolean(),
      timeMicroseconds: microsecondsSchema,
    }),
    rank: z.number().int().positive(),
    status: z.literal("verified"),
    timeMicroseconds: microsecondsSchema,
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

/** A ticket for a race that can count, else null (a guest, a bundled race). */
export async function requestRunTicket(
  identity: GameplayRaceIdentity,
): Promise<string | null> {
  const { courseId, courseRevision, kartId, kartRevision } = identity;
  if (courseRevision === null || kartRevision === null) return null;
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
    return ticketResponseSchema.parse(await response.json()).ticket;
  } catch {
    return null;
  }
}

export async function submitRun(
  ticket: string,
  samples: readonly GhostSample[],
): Promise<RunSubmissionResponse | null> {
  try {
    const response = await postJson(
      "/api/runs",
      { recording: ghostTraceToBase64(encodeGhostTrace(samples)), ticket },
      15_000,
    );
    if (!response.ok) return null;
    return runSubmissionResponseSchema.parse(await response.json());
  } catch {
    return null;
  }
}
