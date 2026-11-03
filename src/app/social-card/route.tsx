import { findGhostLinkStanding } from "@/server/ghost-link-preview";

import { drawSocialCard } from "./card";

/**
 * The picture a shared link shows: a shot from the levee, and for a ghost
 * link (`?racer=<username>`), whose ghost it is and the time to beat.
 */
export async function GET(request: Request) {
  const racer = new URL(request.url).searchParams.get("racer");
  return drawSocialCard(await findGhostLinkStanding(racer), {
    // A racer's card follows their best (and a racer not found may be found
    // soon); the plain card rarely changes.
    "cache-control":
      racer !== null
        ? "public, max-age=300, s-maxage=300"
        : "public, max-age=3600, s-maxage=86400",
  });
}
