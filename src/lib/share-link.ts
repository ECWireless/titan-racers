/** How copying a link ended. */
export type CopyOutcome = "copied" | "failed";

/** Copies a link, with no message: its preview tells the rest. */
export async function copyLink(url: string): Promise<CopyOutcome> {
  try {
    await navigator.clipboard.writeText(url);
    return "copied";
  } catch {
    return "failed";
  }
}

/** What to tell the player after copying. */
export function copyNoteFor(outcome: CopyOutcome) {
  return outcome === "copied" ? "Link copied." : "The link couldn't be copied.";
}

/** A racer's ghost link: it races their best on the current board. */
export function ghostLinkUrl(username: string) {
  return new URL(`/?ghost=${encodeURIComponent(username)}`, window.location.origin)
    .href;
}
