import {
  authorizationErrorResponse,
  authorizeRole,
} from "@/server/authorization";

/**
 * Whether the signed-in viewer is an admin, so home's menu can offer the
 * dashboard. The dashboard checks the role again itself.
 */
export async function GET(request: Request) {
  const authorization = await authorizeRole(request, "admin");
  if (!authorization.authorized && authorization.status === 503) {
    return authorizationErrorResponse(503);
  }
  return Response.json(
    { admin: authorization.authorized },
    { headers: { "cache-control": "no-store" } },
  );
}
