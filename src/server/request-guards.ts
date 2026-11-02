const NO_STORE_HEADERS = { "cache-control": "no-store" };

function jsonError(error: string, status: number) {
  return Response.json(
    { error },
    { headers: NO_STORE_HEADERS, status },
  );
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

/** Reads a request body as text, stopping once it passes `maxBytes`. */
export async function readBoundedBody(request: Request, maxBytes: number) {
  if (!request.body) {
    return { body: "", tooLarge: false } as const;
  }

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let body = "";
  let receivedBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      body += decoder.decode();
      return { body, tooLarge: false } as const;
    }

    receivedBytes += value.byteLength;
    if (receivedBytes > maxBytes) {
      await reader.cancel();
      return { body: "", tooLarge: true } as const;
    }
    body += decoder.decode(value, { stream: true });
  }
}
