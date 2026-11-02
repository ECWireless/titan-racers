import { auth } from "@/lib/auth";
import { assertSessionEnvironment } from "@/lib/server-environment";

// Resolves the signed-in racer, or the response to send. Leaderboard runs
// also need the username a racer claims in onboarding.
export async function sessionUserIdOrResponse(
  request: Request,
  { requireUsername = false } = {},
): Promise<string | Response> {
  try {
    assertSessionEnvironment();
  } catch {
    return Response.json(
      { error: "Authentication is not configured." },
      { status: 503 },
    );
  }
  const user = (await auth.api.getSession({ headers: request.headers }))?.user;
  if (!user) {
    return Response.json({ error: "Authentication required." }, { status: 401 });
  }
  if (requireUsername && !user.username) {
    return Response.json(
      { error: "Racer account setup required." },
      { status: 428 },
    );
  }
  return user.id;
}
