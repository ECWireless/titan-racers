import { parseReportingTimeZone } from "@/game/telemetry/admin-overview";
import {
  gameplayDashboardSchema,
  gameplayDashboardRangeSchema,
  type GameplayDashboardRange,
} from "@/game/telemetry/gameplay-dashboard";
import {
  authorizationErrorResponse,
  authorizeRole,
} from "@/server/authorization";
import { loadGameplayDashboard } from "@/server/gameplay-dashboard-repository";

const NO_STORE = { "cache-control": "no-store" };

type DashboardDependencies = {
  authorize?: typeof authorizeRole;
  load?: (range: GameplayDashboardRange, timeZone: string) => Promise<unknown>;
};

export async function getTelemetryDashboard(
  request: Request,
  dependencies: DashboardDependencies = {},
) {
  const authorize = dependencies.authorize ?? authorizeRole;
  const load = dependencies.load ?? loadGameplayDashboard;
  const authorization = await authorize(request, "admin");
  if (!authorization.authorized) {
    return authorizationErrorResponse(authorization.status);
  }

  const params = new URL(request.url).searchParams;
  const parsedRange = gameplayDashboardRangeSchema.safeParse(
    params.get("range") ?? "7d",
  );
  const timeZone = parseReportingTimeZone(params.get("tz") ?? "UTC");
  if (!parsedRange.success || !timeZone) {
    return Response.json(
      { error: "Invalid range or time zone." },
      { headers: NO_STORE, status: 400 },
    );
  }

  let loaded: unknown;
  try {
    loaded = await load(parsedRange.data, timeZone);
  } catch (error) {
    // Includes a zone this browser knows but the database does not.
    console.error("Telemetry dashboard could not be loaded.", error);
    loaded = null;
  }
  const dashboard = gameplayDashboardSchema.safeParse(loaded);
  if (!dashboard.success) {
    return Response.json(
      { error: "Telemetry dashboard data is invalid." },
      { headers: NO_STORE, status: 500 },
    );
  }

  return Response.json(dashboard.data, { headers: NO_STORE });
}

export async function GET(request: Request) {
  return getTelemetryDashboard(request);
}
