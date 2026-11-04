import { z } from "zod";

import { gameplayRunEventSchema } from "@/game/telemetry/gameplay-run-events";
import { recordGameplayRunEvent } from "@/server/gameplay-telemetry-repository";
import {
  protectedJsonMutationError,
  readBoundedBody,
} from "@/server/request-guards";
import { signedInUserIdOrNull } from "@/server/session-user";

const MAX_BODY_BYTES = 4_096;

export async function postGameplayRun(
  request: Request,
  record: typeof recordGameplayRunEvent = recordGameplayRunEvent,
  signedInUserId: typeof signedInUserIdOrNull = signedInUserIdOrNull,
) {
  const mutationError = protectedJsonMutationError(request);
  if (mutationError) {
    return mutationError;
  }

  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return Response.json({ error: "Telemetry request is too large." }, { status: 413 });
  }

  let event;
  try {
    const { body, tooLarge } = await readBoundedBody(request, MAX_BODY_BYTES);
    if (tooLarge) {
      return Response.json(
        { error: "Telemetry request is too large." },
        { status: 413 },
      );
    }
    event = gameplayRunEventSchema.parse(JSON.parse(body));
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof z.ZodError) {
      return Response.json(
        { error: "Invalid gameplay telemetry request." },
        { status: 400 },
      );
    }

    throw error;
  }

  // Only a start is attributed, from the trusted session, never the client.
  const userId =
    event.type === "run_started" ? await signedInUserId(request) : null;
  const result = await record(event, new Date(), userId);
  return new Response(null, { status: result === "created" ? 201 : 202 });
}

export async function POST(request: Request) {
  return postGameplayRun(request);
}
