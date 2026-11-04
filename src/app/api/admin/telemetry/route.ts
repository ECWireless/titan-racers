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
    return Response.json({ error: "Invalid range or time zone." }, { status: 400 });
  }

  const dashboard = gameplayDashboardSchema.safeParse(
    await load(parsedRange.data, timeZone),
  );
  if (!dashboard.success) {
    return Response.json(
      { error: "Telemetry dashboard data is invalid." },
      { status: 500 },
    );
  }

  return Response.json(dashboard.data);
}

export async function GET(request: Request) {
  return getTelemetryDashboard(request);
}
