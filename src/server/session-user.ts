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
  // Only Better Auth's own responses renew a session, since they renew the
  // cookie with it.
  const user = (
    await auth.api.getSession({
      headers: request.headers,
      query: { disableRefresh: true },
    })
  )?.user;
  if (!user) {
    return Response.json({ error: "Authentication required." }, { status: 401 });
  }
  if (requireUsername && !user.username) {
    return Response.json(
      { error: "Account setup required." },
      { status: 428 },
    );
  }
  return user.id;
}

// The signed-in account, or null for a guest. Telemetry and rooms never
// fail or wait on login: any problem means guest.
export async function signedInUserOrNull(
  request: Request,
): Promise<{ id: string; username: string | null } | null> {
  try {
    assertSessionEnvironment();
    const user = (
      await auth.api.getSession({
        headers: request.headers,
        query: { disableRefresh: true },
      })
    )?.user;
    return user ? { id: user.id, username: user.username ?? null } : null;
  } catch {
    return null;
  }
}

// The signed-in racer a new gameplay run is attributed to, or null.
export async function signedInUserIdOrNull(request: Request) {
  return (await signedInUserOrNull(request))?.id ?? null;
}
