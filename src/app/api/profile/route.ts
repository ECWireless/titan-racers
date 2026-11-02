import { z } from "zod";

import { racerUsernameSchema } from "@/lib/racer-username";
import { listLoginMethods } from "@/server/login-methods";
import { protectedJsonMutationError } from "@/server/request-guards";
import {
  claimRacerUsername,
  loadRacerIdentity,
  RacerIdentityNotFoundError,
  RacerUsernameAlreadyClaimedError,
  RacerUsernameTakenError,
} from "@/server/racer-identity";
import { sessionUserIdOrResponse } from "@/server/session-user";

const claimRequestSchema = z.strictObject({
  username: z.string(),
});

export async function GET(request: Request) {
  const userId = await sessionUserIdOrResponse(request);
  if (userId instanceof Response) return userId;

  try {
    const [identity, loginMethods] = await Promise.all([
      loadRacerIdentity(userId),
      listLoginMethods(userId),
    ]);
    return Response.json({ ...identity, loginMethods }, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    if (error instanceof RacerIdentityNotFoundError) {
      return Response.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }
}

export async function PUT(request: Request) {
  const mutationError = protectedJsonMutationError(request);
  if (mutationError) return mutationError;

  const userId = await sessionUserIdOrResponse(request);
  if (userId instanceof Response) return userId;

  let rawUsername: string;
  try {
    rawUsername = claimRequestSchema.parse(await request.json()).username;
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof z.ZodError) {
      return Response.json(
        { error: "Invalid username claim request." },
        { status: 400 },
      );
    }
    throw error;
  }

  const parsedUsername = racerUsernameSchema.safeParse(rawUsername);
  if (!parsedUsername.success) {
    return Response.json(
      {
        code: "INVALID_USERNAME",
        error:
          parsedUsername.error.issues[0]?.message ?? "Username is invalid.",
      },
      { status: 400 },
    );
  }

  try {
    const username = await claimRacerUsername(userId, parsedUsername.data);
    return Response.json({ status: "complete", username });
  } catch (error) {
    if (error instanceof RacerUsernameTakenError) {
      return Response.json(
        { code: "USERNAME_TAKEN", error: error.message },
        { status: 409 },
      );
    }
    if (error instanceof RacerUsernameAlreadyClaimedError) {
      return Response.json(
        { code: "USERNAME_ALREADY_CLAIMED", error: error.message },
        { status: 409 },
      );
    }
    if (error instanceof RacerIdentityNotFoundError) {
      return Response.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }
}
