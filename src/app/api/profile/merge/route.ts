import { auth, isOnlyInThisBrowser } from "@/lib/auth";
import { assertSessionEnvironment } from "@/lib/server-environment";
import { requestRacerMerge } from "@/server/racer-merges";
import { protectedJsonMutationError } from "@/server/request-guards";

function errorResponse(status: number, code: string, error: string) {
  return Response.json({ code, error }, { status });
}

/**
 * The racer kept in this browser asks to be brought into the racer it signs
 * in to next here. Its live session is its proof; the sign-in proves the
 * other racer and runs the merge.
 */
export async function POST(request: Request) {
  const mutationError = protectedJsonMutationError(request);
  if (mutationError) return mutationError;
  try {
    assertSessionEnvironment();
  } catch {
    return errorResponse(503, "UNAVAILABLE", "Authentication is not configured.");
  }
  const current = await auth.api.getSession({
    headers: request.headers,
    query: { disableRefresh: true },
  });
  if (!current) {
    return errorResponse(401, "UNAUTHENTICATED", "Authentication required.");
  }
  if (!(await isOnlyInThisBrowser(current.user.id))) {
    return errorResponse(
      409,
      "ALREADY_KEPT",
      "Only an account kept in this browser can be brought into another.",
    );
  }
  await requestRacerMerge(current.session.id, current.user.id);
  return new Response(null, { status: 204 });
}
