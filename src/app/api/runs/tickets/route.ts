import { z } from "zod";

import type { NoTicketReason } from "@/game/race/run-submission";
import { isLeaderboardRace } from "@/server/race-results";
import {
  protectedJsonMutationError,
  readBoundedBody,
} from "@/server/request-guards";
import { issueRunTicket } from "@/server/run-tickets";
import { sessionUserIdOrResponse } from "@/server/session-user";

const NO_STORE_HEADERS = { "cache-control": "no-store" };
const MAX_BODY_BYTES = 1_024;

const ticketRequestSchema = z.strictObject({
  courseId: z.string().min(1).max(80),
  courseRevision: z.number().int().positive(),
  kartId: z.string().min(1).max(80),
  kartRevision: z.number().int().positive(),
  physicsVersion: z.string().min(1).max(80),
});

function jsonError(error: string, status: number) {
  return Response.json({ error }, { headers: NO_STORE_HEADERS, status });
}

// A guest's, a new racer's, or another course's race simply does not count.
function noTicket(reason: NoTicketReason) {
  return Response.json(
    { reason, ticket: null },
    { headers: NO_STORE_HEADERS },
  );
}

/** Signs a ticket when a logged-in racer starts a race that can count. */
export async function postRunTicket(
  request: Request,
  eligibility?: Parameters<typeof isLeaderboardRace>[1],
) {
  // Real time is measured from the request, before any lookups.
  const issuedAt = Date.now();
  const mutationError = protectedJsonMutationError(request);
  if (mutationError) return mutationError;
  const userId = await sessionUserIdOrResponse(request, {
    requireUsername: true,
  });
  if (userId instanceof Response) {
    if (userId.status === 401) return noTicket("login");
    if (userId.status === 428) return noTicket("username");
    return userId;
  }

  const { body, tooLarge } = await readBoundedBody(request, MAX_BODY_BYTES);
  if (tooLarge) return jsonError("Run ticket request is too large.", 413);
  let race;
  try {
    race = ticketRequestSchema.parse(JSON.parse(body));
  } catch {
    return jsonError("Invalid run ticket request.", 400);
  }
  if (!(await isLeaderboardRace(race, eligibility))) {
    return noTicket("not-eligible");
  }

  return Response.json(
    { ticket: issueRunTicket({ ...race, userId }, issuedAt) },
    { headers: NO_STORE_HEADERS },
  );
}

export async function POST(request: Request) {
  return postRunTicket(request);
}
