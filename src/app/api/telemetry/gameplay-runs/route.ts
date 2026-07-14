import { z } from "zod";

import { gameplayRunEventSchema } from "@/game/telemetry/gameplay-run-events";
import { recordGameplayRunEvent } from "@/server/gameplay-telemetry-repository";
import { protectedJsonMutationError } from "@/server/request-guards";

const MAX_BODY_BYTES = 4_096;

async function readBoundedBody(request: Request) {
  if (!request.body) {
    return { body: "", tooLarge: false } as const;
  }

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let body = "";
  let receivedBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      body += decoder.decode();
      return { body, tooLarge: false } as const;
    }

    receivedBytes += value.byteLength;
    if (receivedBytes > MAX_BODY_BYTES) {
      await reader.cancel();
      return { body: "", tooLarge: true } as const;
    }
    body += decoder.decode(value, { stream: true });
  }
}

export async function postGameplayRun(
  request: Request,
  record: typeof recordGameplayRunEvent = recordGameplayRunEvent,
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
    const { body, tooLarge } = await readBoundedBody(request);
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

  const result = await record(event);
  return new Response(null, { status: result === "created" ? 201 : 202 });
}

export async function POST(request: Request) {
  return postGameplayRun(request);
}
