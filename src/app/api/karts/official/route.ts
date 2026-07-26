import { loadOfficialKartRoster } from "@/server/official-kart-roster";

const NO_STORE_HEADERS = { "cache-control": "no-store" };

export async function createOfficialKartRosterResponse(
  loadRoster = loadOfficialKartRoster,
) {
  return Response.json(await loadRoster(), {
    headers: NO_STORE_HEADERS,
  });
}

export async function GET() {
  return createOfficialKartRosterResponse();
}
