/** How sharing a link ended. */
export type ShareOutcome = "cancelled" | "copied" | "failed" | "shared";

/**
 * Shares a message and link through the device's share sheet, or copies
 * them where there is none (most desktop browsers). Must run from a click.
 */
export async function shareLink({
  text,
  url,
}: {
  text: string;
  url: string;
}): Promise<ShareOutcome> {
  const data = { text, url };
  if (typeof navigator.share === "function" && navigator.canShare?.(data) !== false) {
    try {
      await navigator.share(data);
      return "shared";
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return "cancelled";
      }
      // A refused share sheet falls back to copying.
    }
  }
  return copyLink(`${text} ${url}`);
}

/** Copies a link alone, with no message. */
export async function copyLink(text: string): Promise<ShareOutcome> {
  try {
    await navigator.clipboard.writeText(text);
    return "copied";
  } catch {
    return "failed";
  }
}

/** What to tell the player after sharing; nothing once shared or cancelled. */
export function shareNoteFor(outcome: ShareOutcome) {
  if (outcome === "copied") return "Link copied.";
  if (outcome === "failed") return "The link couldn't be shared.";
  return null;
}

/** A racer's ghost link: it races their best on the current board. */
export function ghostLinkUrl(username: string) {
  return new URL(`/?ghost=${encodeURIComponent(username)}`, window.location.origin)
    .href;
}
