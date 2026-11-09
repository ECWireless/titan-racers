import type { RoomSnapshot } from "./room-protocol";

export type RoomDoorOpening = NonNullable<RoomSnapshot["race"]>["doors"][number];

/**
 * An opening this far behind is applied at rest: a page that rejoins, or
 * whose opener was drawn far in the past or not at all, finds the door
 * already open.
 */
export const ROOM_DOOR_AT_REST_US = 1_500_000;

/**
 * Which of the room's door openings this page applies now. Another page's
 * opening waits until its opener, as drawn here, reaches the opening's race
 * time, so the hit is seen before the door moves; it then swings as it did
 * there. One long past is applied at rest. This page's own openings were
 * applied as its kart made them, and an applied door is never applied again.
 */
export function dueRoomDoorOpenings(
  openings: readonly RoomDoorOpening[],
  {
    applied,
    nowUs,
    shownUs,
  }: {
    /** Doors already open here. */
    applied: ReadonlySet<string>;
    /** This page's race time now. */
    nowUs: number;
    /**
     * The race time another kart was shown at last frame (null while it
     * isn't drawn here); undefined for this page's own kart.
     */
    shownUs(id: string): number | null | undefined;
  },
): Array<{ door: string; swing: number | null }> {
  return openings.flatMap(({ by, door, t, w }) => {
    if (applied.has(door)) return [];
    const shown = shownUs(by);
    if (shown === undefined) return [];
    if (shown !== null && shown >= t) {
      return [{ door, swing: shown - t > ROOM_DOOR_AT_REST_US ? null : w }];
    }
    return nowUs - t > ROOM_DOOR_AT_REST_US ? [{ door, swing: null }] : [];
  });
}
