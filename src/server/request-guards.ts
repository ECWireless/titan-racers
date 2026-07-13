function jsonError(error: string, status: number) {
  return Response.json({ error }, { status });
}

function allowedMutationOrigins(request: Request) {
  const origins = new Set([new URL(request.url).origin]);
  for (const value of [
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.BETTER_AUTH_URL,
  ]) {
    if (!value) {
      continue;
    }
    try {
      origins.add(new URL(value).origin);
    } catch {
      // Environment validation reports malformed canonical URLs separately.
    }
  }
  return origins;
}

export function protectedJsonMutationError(request: Request) {
  const mediaType = request.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (mediaType !== "application/json") {
    return jsonError("Content-Type must be application/json.", 415);
  }

  const origin = request.headers.get("origin");
  let normalizedOrigin: string;
  try {
    normalizedOrigin = origin ? new URL(origin).origin : "";
  } catch {
    return jsonError("Mutation origin is not allowed.", 403);
  }
  if (
    !normalizedOrigin ||
    !allowedMutationOrigins(request).has(normalizedOrigin)
  ) {
    return jsonError("Mutation origin is not allowed.", 403);
  }

  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin") {
    return jsonError("Mutation origin is not allowed.", 403);
  }

  return null;
}
