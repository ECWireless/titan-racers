import type { Metadata } from "next";

import { PlayHome } from "@/components/play-home";
import { ghostLinkMetadata } from "@/lib/social-metadata";
import { findGhostLinkStanding } from "@/server/ghost-link-preview";

/**
 * A ghost link (`/?ghost=<username>`) previews as that racer's challenge,
 * with their current best; any other address keeps the app's own preview.
 */
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  const standing = await findGhostLinkStanding((await searchParams).ghost);
  return standing ? ghostLinkMetadata(standing) : {};
}

export default function Home() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-titan-black text-titan-ice">
      <PlayHome />
    </main>
  );
}
