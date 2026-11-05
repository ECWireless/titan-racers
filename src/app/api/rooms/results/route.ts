import { roomRaceReportSchema } from "@/game/room/room-protocol";
import {
  ROOM_REPORT_SIGNATURE_HEADER,
  verifyRoomReport,
} from "@/game/room/room-signing";
import { readBoundedBody } from "@/server/request-guards";
import {
  recordRoomRace,
  roomServerSecret,
  RoomsUnavailableError,
} from "@/server/room-races";

const NO_STORE_HEADERS = { "cache-control": "no-store" };
const MAX_BODY_BYTES = 8_192;

function json(body: unknown, status: number) {
  return Response.json(body, { headers: NO_STORE_HEADERS, status });
}

/**
 * Receives a finished room race from the room server, which signs each
 * report's exact body. A refusal here is final: the room server retries
 * only server errors, 408, and 429.
 */
export async function POST(request: Request) {
  let secret: string;
  try {
    secret = roomServerSecret();
  } catch (error) {
    if (error instanceof RoomsUnavailableError) {
      return json({ error: "Rooms are not configured." }, 503);
    }
    throw error;
  }
  const { body, tooLarge } = await readBoundedBody(request, MAX_BODY_BYTES);
  if (tooLarge) return json({ error: "Report is too large." }, 413);
  const signature = request.headers.get(ROOM_REPORT_SIGNATURE_HEADER);
  if (!(await verifyRoomReport(secret, signature, body))) {
    return json({ error: "Invalid report signature." }, 401);
  }
  let report;
  try {
    report = roomRaceReportSchema.parse(JSON.parse(body));
  } catch {
    return json({ error: "Invalid report." }, 400);
  }
  const outcome = await recordRoomRace(report);
  if (outcome.status === "invalid") {
    return json({ error: outcome.problem }, 422);
  }
  return json(outcome, outcome.status === "stored" ? 201 : 200);
}
