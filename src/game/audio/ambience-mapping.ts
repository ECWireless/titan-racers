/**
 * Turns where the kart is into ambience levels. Pure, like the kart sound
 * mapping: it reads positions and never feeds anything back.
 */

/** Seconds for the ambience to cross a tunnel portal, to 1/e. */
const PORTAL_SECONDS = 0.35;

/**
 * Eases how far the listener is inside, 0 outdoors to 1 in the tunnel, so
 * crossing a portal crossfades rather than cuts.
 */
export function approachIndoors(
  previous: number,
  indoors: boolean,
  deltaSeconds: number,
) {
  const target = indoors ? 1 : 0;
  const settle = Math.exp(-Math.max(deltaSeconds, 0) / PORTAL_SECONDS);
  const next = target + (Math.min(Math.max(previous, 0), 1) - target) * settle;
  // Land on the target, so the levels stop being rewritten every frame.
  return Math.abs(next - target) < 1e-3 ? target : next;
}
