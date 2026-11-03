import type { Metadata } from "next";
import Image from "next/image";

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
      <Image
        priority
        src="/images/titan-racers-training-bay.png"
        alt=""
        fill
        sizes="100vw"
        className="object-cover object-[62%_50%]"
      />
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(7,7,6,0.78)_0%,rgba(7,7,6,0.48)_48%,rgba(7,7,6,0.08)_86%),linear-gradient(0deg,rgba(7,7,6,0.82)_0%,rgba(7,7,6,0.18)_52%,rgba(7,7,6,0.52)_100%)]" />
      <PlayHome />
    </main>
  );
}
