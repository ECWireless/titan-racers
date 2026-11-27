"use client";

import { Analytics, type BeforeSendEvent } from "@vercel/analytics/next";

/**
 * A room's address is its invitation, so a page view of one names only the
 * route, never the code.
 */
export function withoutRoomCode(event: BeforeSendEvent): BeforeSendEvent {
  const url = new URL(event.url);
  if (!url.pathname.startsWith("/room/")) return event;
  url.pathname = "/room/[code]";
  url.search = "";
  url.hash = "";
  return { ...event, url: url.href };
}

export function SiteAnalytics() {
  return <Analytics beforeSend={withoutRoomCode} />;
}
