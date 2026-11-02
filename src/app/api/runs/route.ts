import { z } from "zod";

import { MAX_RUN_SAMPLES } from "@/game/race/race-verification";
import { checkSubmittedRun, recordRunSubmission } from "@/server/race-results";
import {
  protectedJsonMutationError,
  readBoundedBody,
} from "@/server/request-guards";
import { readRunTicket } from "@/server/run-tickets";
import { sessionUserIdOrResponse } from "@/server/session-user";

const NO_STORE_HEADERS = { "cache-control": "no-store" };
// Base64 of the largest recording a race within the time cap can make.
const MAX_RECORDING_LENGTH = 4 * Math.ceil((8 + 24 * MAX_RUN_SAMPLES) / 3);
const MAX_BODY_BYTES = MAX_RECORDING_LENGTH + 4_096;

const submissionSchema = z.strictObject({
  recording: z.string().min(1).max(MAX_RECORDING_LENGTH),
  ticket: z.string().min(1).max(2_048),
});

function jsonError(error: string, status: number) {
  return Response.json({ error }, { headers: NO_STORE_HEADERS, status });
}

/**
 * Checks a finished run against its ticket and recording and stores the
 * result. The response is the server's own time and standing.
 */
export async function POST(request: Request) {
  const mutationError = protectedJsonMutationError(request);
  if (mutationError) return mutationError;
  const userId = await sessionUserIdOrResponse(request);
  if (userId instanceof Response) return userId;

  const { body, tooLarge } = await readBoundedBody(request, MAX_BODY_BYTES);
  if (tooLarge) return jsonError("Run submission is too large.", 413);
  let submission;
  try {
    submission = submissionSchema.parse(JSON.parse(body));
  } catch {
    return jsonError("Invalid run submission.", 400);
  }

  const ticket = readRunTicket(submission.ticket);
  if (!ticket) return jsonError("This run ticket is invalid or expired.", 400);
  if (ticket.userId !== userId) {
    return jsonError("This run ticket belongs to another racer.", 403);
  }
  const run = await checkSubmittedRun(ticket, submission.recording);
  if (!run) return jsonError("This run's course revision is unavailable.", 422);

  const result = await recordRunSubmission(ticket, run);
  if (result === "duplicate") {
    return jsonError("This run was already submitted.", 409);
  }
  return Response.json(result, { headers: NO_STORE_HEADERS });
}
