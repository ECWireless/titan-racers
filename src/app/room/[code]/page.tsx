import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { RoomPlay } from "@/components/room-play";
import { isRoomCode } from "@/game/room/room-protocol";

export const metadata: Metadata = {
  title: "Multiplayer · Titan Racers",
  // A room's link is its invitation; keep it out of search.
  robots: { index: false, follow: false },
};

type PageProps = {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ join?: string | string[] }>;
};

export default async function RoomPage({ params, searchParams }: PageProps) {
  const { code } = await params;
  if (!isRoomCode(code)) notFound();
  const { join } = await searchParams;
  return (
    <RoomPlay
      code={code}
      join={join === "new" || join === "code" ? join : "link"}
    />
  );
}
