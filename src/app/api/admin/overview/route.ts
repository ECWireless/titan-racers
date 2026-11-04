import {
  adminOverviewSchema,
  parseReportingTimeZone,
} from "@/game/telemetry/admin-overview";
import {
  gameplayDashboardRangeSchema,
  type GameplayDashboardRange,
} from "@/game/telemetry/gameplay-dashboard";
import { loadAdminOverview } from "@/server/admin-overview-repository";
import {
  authorizationErrorResponse,
  authorizeRole,
} from "@/server/authorization";

type OverviewDependencies = {
  authorize?: typeof authorizeRole;
  load?: (range: GameplayDashboardRange, timeZone: string) => Promise<unknown>;
};

const NO_STORE = { "cache-control": "no-store" };

export async function getAdminOverview(
  request: Request,
  dependencies: OverviewDependencies = {},
) {
  const authorize = dependencies.authorize ?? authorizeRole;
  const load = dependencies.load ?? loadAdminOverview;
  const authorization = await authorize(request, "admin");
  if (!authorization.authorized) {
    return authorizationErrorResponse(authorization.status);
  }

  const params = new URL(request.url).searchParams;
  const range = gameplayDashboardRangeSchema.safeParse(params.get("range") ?? "7d");
  const timeZone = parseReportingTimeZone(params.get("tz") ?? "UTC");
  if (!range.success || !timeZone) {
    return Response.json(
      { error: "Invalid range or time zone." },
      { headers: NO_STORE, status: 400 },
    );
  }

  let loaded: unknown;
  try {
    loaded = await load(range.data, timeZone);
  } catch (error) {
    // Includes a zone this browser knows but the database does not.
    console.error("Admin overview could not be loaded.", error);
    loaded = null;
  }
  const overview = adminOverviewSchema.safeParse(loaded);
  if (!overview.success) {
    return Response.json(
      { error: "Admin overview data is invalid." },
      { headers: NO_STORE, status: 500 },
    );
  }
  return Response.json(overview.data, { headers: NO_STORE });
}

export async function GET(request: Request) {
  return getAdminOverview(request);
}
