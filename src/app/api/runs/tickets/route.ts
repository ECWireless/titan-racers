import { z } from "zod";

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

/**
 * Signs a ticket when a race that can count starts. A named racer's ticket
 * submits on finish; a guest's, or an unnamed racer's, names no racer and
 * waits for them to sign in and choose a username. Another course's race
 * simply gets none.
 */
export async function postRunTicket(
  request: Request,
  eligibility?: Parameters<typeof isLeaderboardRace>[1],
) {
  // Real time is measured from the request, before any lookups.
  const issuedAt = Date.now();
  const mutationError = protectedJsonMutationError(request);
  if (mutationError) return mutationError;
  const viewer = await sessionUserIdOrResponse(request, {
    requireUsername: true,
  });
  let userId: string | null = null;
  let reason: "login" | "username" | null = null;
  if (typeof viewer === "string") userId = viewer;
  else if (viewer.status === 401) reason = "login";
  else if (viewer.status === 428) reason = "username";
  else return viewer;

  const { body, tooLarge } = await readBoundedBody(request, MAX_BODY_BYTES);
  if (tooLarge) return jsonError("Run ticket request is too large.", 413);
  let race;
  try {
    race = ticketRequestSchema.parse(JSON.parse(body));
  } catch {
    return jsonError("Invalid run ticket request.", 400);
  }
  if (!(await isLeaderboardRace(race, eligibility))) {
    return Response.json(
      { reason: "not-eligible", ticket: null },
      { headers: NO_STORE_HEADERS },
    );
  }

  const ticket = issueRunTicket({ ...race, userId }, issuedAt);
  return Response.json(reason ? { reason, ticket } : { ticket }, {
    headers: NO_STORE_HEADERS,
  });
}

export async function POST(request: Request) {
  return postRunTicket(request);
}
