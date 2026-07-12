import { toNextJsHandler } from "better-auth/next-js";

import { auth } from "@/lib/auth";
import { assertAuthEnvironment } from "@/lib/server-environment";

const handlers = toNextJsHandler(auth);

function unavailableResponse() {
  return Response.json(
    { error: "Authentication is not configured." },
    { status: 503 },
  );
}

export async function GET(request: Request) {
  try {
    assertAuthEnvironment();
  } catch {
    return unavailableResponse();
  }

  return handlers.GET(request);
}

export async function POST(request: Request) {
  try {
    assertAuthEnvironment();
  } catch {
    return unavailableResponse();
  }

  return handlers.POST(request);
}
