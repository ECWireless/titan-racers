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
  load?: (range: GameplayDashboardRange) => Promise<unknown>;
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

  const parsedRange = gameplayDashboardRangeSchema.safeParse(
    new URL(request.url).searchParams.get("range") ?? "7d",
  );
  if (!parsedRange.success) {
    return Response.json({ error: "Invalid telemetry range." }, { status: 400 });
  }

  const dashboard = gameplayDashboardSchema.safeParse(
    await load(parsedRange.data),
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
