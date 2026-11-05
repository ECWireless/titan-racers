import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { RoomPlay } from "@/components/room-play";
import { isRoomCode } from "@/game/room/room-protocol";

export const metadata: Metadata = {
  title: "Race Friends · Titan Racers",
  // A room's link is its invitation; keep it out of search.
  robots: { index: false, follow: false },
};

type PageProps = { params: Promise<{ code: string }> };

export default async function RoomPage({ params }: PageProps) {
  const { code } = await params;
  if (!isRoomCode(code)) notFound();
  return <RoomPlay code={code} />;
}
