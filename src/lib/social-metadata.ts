import type { Metadata } from "next";

import { formatRaceTime } from "@/game/race/race-presentation";

/** The size link previews draw a large picture at. */
export const SOCIAL_CARD_SIZE = { height: 630, width: 1200 } as const;

export const SITE_TITLE = "Titan Racers";
export const SITE_DESCRIPTION =
  "RC kart racing inside humanity's last space colony. Pick a kart, set a time on Falls View Park, and race the leaderboard's ghosts.";

/**
 * A page's title, description, and link preview picture, the same for
 * every app that draws a preview.
 */
export function socialMetadata({
  description,
  image,
  imageAlt,
  title,
}: {
  description: string;
  image: string;
  imageAlt: string;
  title: string;
}): Metadata {
  const images = [{ ...SOCIAL_CARD_SIZE, alt: imageAlt, url: image }];
  return {
    description,
    openGraph: {
      description,
      images,
      siteName: SITE_TITLE,
      title,
      type: "website",
    },
    title,
    twitter: { card: "summary_large_image", description, images, title },
  };
}

/** A racer's standing, as a ghost link's preview shows it. */
export type GhostLinkStanding = {
  courseName: string;
  entries: number;
  rank: number;
  timeMicroseconds: number;
  username: string;
};

/** A ghost link's preview: the racer's time to beat, rank, and course. */
export function ghostLinkMetadata(standing: GhostLinkStanding): Metadata {
  const { courseName, entries, rank, username } = standing;
  const time = formatRaceTime(standing.timeMicroseconds, 3);
  const image = new URLSearchParams({
    racer: username,
    // Whatever the card draws changes its address, past any cached copy.
    v: `${standing.timeMicroseconds}-${rank}-${entries}`,
  });
  return socialMetadata({
    description: `@${username} ran ${courseName} in ${time}, rank ${rank} of ${entries}. Race their ghost and beat it.`,
    image: `/social-card?${image}`,
    imageAlt: `Race @${username}'s ghost: ${time} on ${courseName}`,
    title: `Race @${username}'s ghost · ${SITE_TITLE}`,
  });
}
