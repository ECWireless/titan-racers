import { z } from "zod";

import { isRoomCode } from "@/game/room/room-protocol";
import { ROOM_SEAT_SECRET_PATTERN } from "@/game/room/room-signing";
import {
  protectedJsonMutationError,
  readBoundedBody,
} from "@/server/request-guards";
import { issueRoomToken, RoomsUnavailableError } from "@/server/room-races";
import { signedInUserOrNull } from "@/server/session-user";

type RouteContext = { params: Promise<{ code: string }> };
const joinRequestSchema = z.strictObject({
  seat: z.string().regex(ROOM_SEAT_SECRET_PATTERN).optional(),
});
const NO_STORE_HEADERS = { "cache-control": "no-store" };

function jsonError(error: string, status: number) {
  return Response.json({ error }, { headers: NO_STORE_HEADERS, status });
}

/**
 * Signs a short-lived join token for one room, as whoever is signed in or
 * as a guest, whose page may send a seat secret to retake its seat on a
 * reconnect. Joining never creates or changes an account.
 */
export async function POST(request: Request, context: RouteContext) {
  const mutationError = protectedJsonMutationError(request);
  if (mutationError) return mutationError;
  const { code } = await context.params;
  if (!isRoomCode(code)) return jsonError("Room not found.", 404);
  const { body, tooLarge } = await readBoundedBody(request, 128);
  let parsed;
  try {
    parsed = tooLarge ? null : joinRequestSchema.safeParse(JSON.parse(body));
  } catch {
    parsed = null;
  }
  if (!parsed?.success) {
    return jsonError("Invalid room join request.", 400);
  }
  try {
    const token = await issueRoomToken(
      code,
      await signedInUserOrNull(request),
      parsed.data.seat ?? null,
    );
    return Response.json({ token }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    if (error instanceof RoomsUnavailableError) {
      return jsonError("Rooms are unavailable right now.", 503);
    }
    throw error;
  }
}
