import { eq } from "drizzle-orm";

import { db } from "@/db/client";
import { type ApplicationRole, userRoles } from "@/db/schema";
import { auth } from "@/lib/auth";
import { assertSessionEnvironment } from "@/lib/server-environment";

type SessionIdentity = { user: { id: string } } | null;
type SessionResolver = (headers: Headers) => Promise<SessionIdentity>;

export type AuthorizationResult =
  | { authorized: true; userId: string }
  | { authorized: false; status: 401 | 403 | 503 };

const resolveSession: SessionResolver = (headers) =>
  auth.api.getSession({ headers });

export async function authorizeRole(
  request: Request,
  requiredRole: ApplicationRole,
  getSession: SessionResolver = resolveSession,
): Promise<AuthorizationResult> {
  try {
    assertSessionEnvironment();
  } catch {
    return { authorized: false, status: 503 };
  }

  const session = await getSession(request.headers);

  if (!session) {
    return { authorized: false, status: 401 };
  }

  const roles = await db
    .select({ role: userRoles.role })
    .from(userRoles)
    .where(eq(userRoles.userId, session.user.id));

  if (!roles.some(({ role }) => role === requiredRole)) {
    return { authorized: false, status: 403 };
  }

  return { authorized: true, userId: session.user.id };
}

export function authorizationErrorResponse(status: 401 | 403 | 503) {
  const message =
    status === 401
      ? "Authentication required."
      : status === 403
        ? "Admin role required."
        : "Authentication is not configured.";

  return Response.json({ error: message }, { status });
}
