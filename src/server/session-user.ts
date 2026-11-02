import { auth } from "@/lib/auth";
import { assertSessionEnvironment } from "@/lib/server-environment";

// Resolves the signed-in racer for profile routes, or the response to send.
export async function sessionUserIdOrResponse(
  request: Request,
): Promise<string | Response> {
  try {
    assertSessionEnvironment();
  } catch {
    return Response.json(
      { error: "Authentication is not configured." },
      { status: 503 },
    );
  }
  const userId = (await auth.api.getSession({ headers: request.headers }))?.user
    .id;
  return (
    userId ??
    Response.json({ error: "Authentication required." }, { status: 401 })
  );
}
