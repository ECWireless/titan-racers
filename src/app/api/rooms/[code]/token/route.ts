import { isRoomCode } from "@/game/room/room-protocol";
import {
  protectedJsonMutationError,
  readBoundedBody,
} from "@/server/request-guards";
import { issueRoomToken, RoomsUnavailableError } from "@/server/room-races";
import { signedInUserOrNull } from "@/server/session-user";

type RouteContext = { params: Promise<{ code: string }> };
const NO_STORE_HEADERS = { "cache-control": "no-store" };

function jsonError(error: string, status: number) {
  return Response.json({ error }, { headers: NO_STORE_HEADERS, status });
}

/**
 * Signs a short-lived join token for one room, as whoever is signed in or
 * as a guest. Joining never creates or changes an account.
 */
export async function POST(request: Request, context: RouteContext) {
  const mutationError = protectedJsonMutationError(request);
  if (mutationError) return mutationError;
  const { code } = await context.params;
  if (!isRoomCode(code)) return jsonError("Room not found.", 404);
  const { body, tooLarge } = await readBoundedBody(request, 64);
  if (tooLarge || body.trim() !== "{}") {
    return jsonError("Invalid room join request.", 400);
  }
  try {
    const token = await issueRoomToken(
      code,
      await signedInUserOrNull(request),
    );
    return Response.json({ token }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    if (error instanceof RoomsUnavailableError) {
      return jsonError("Rooms are unavailable right now.", 503);
    }
    throw error;
  }
}
