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

/** Within this many metres of the water, the stream plays at full level. */
const STREAM_FULL_METRES = 3;
/** Beyond this, the stream is silent and stops playing. */
export const STREAM_SILENT_METRES = 30;

/**
 * How loud the stream is at a distance from its water: full up close, then
 * falling off as a real source does (level ∝ 1 / distance), faded linearly
 * to silence over the last 30% before `STREAM_SILENT_METRES`.
 */
export function getStreamLevel(distance: number) {
  if (!(distance < STREAM_SILENT_METRES)) return 0;
  const falloff = STREAM_FULL_METRES / Math.max(distance, STREAM_FULL_METRES);
  const edge = Math.min(
    1,
    (STREAM_SILENT_METRES - distance) / (STREAM_SILENT_METRES * 0.3),
  );
  return falloff * edge;
}
