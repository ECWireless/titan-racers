import { expect, test } from "@playwright/test";

import {
  dueRoomDoorOpenings,
  ROOM_DOOR_AT_REST_US,
} from "../src/game/room/room-doors";

const OPENING = { door: "tunnel-door-4", t: 30_000_000, w: 3.2, by: "p2" };

function due(
  shown: number | null | undefined,
  nowUs = OPENING.t + 200_000,
  applied: string[] = [],
) {
  return dueRoomDoorOpenings([OPENING], {
    applied: new Set(applied),
    nowUs,
    shownUs: (id) => (id === "p2" ? shown : undefined),
  });
}

test("another page's opening waits until its opener is shown reaching the door", () => {
  expect(due(OPENING.t - 120_000)).toEqual([]);
  expect(due(OPENING.t)).toEqual([{ door: OPENING.door, swing: 3.2 }]);
  // Once applied, never again.
  expect(due(OPENING.t, undefined, [OPENING.door])).toEqual([]);
});

test("an opening long past, or whose opener isn't drawn, is applied at rest", () => {
  const late = OPENING.t + ROOM_DOOR_AT_REST_US + 1;
  expect(due(late, late)).toEqual([{ door: OPENING.door, swing: null }]);
  expect(due(null)).toEqual([]);
  expect(due(null, late)).toEqual([{ door: OPENING.door, swing: null }]);
  expect(due(OPENING.t - 1_000_000, late)).toEqual([
    { door: OPENING.door, swing: null },
  ]);
});

test("this page's own opening was applied as its kart made it", () => {
  const own = dueRoomDoorOpenings([{ ...OPENING, by: "p1" }], {
    applied: new Set(),
    nowUs: OPENING.t + 10_000_000,
    shownUs: (id) => (id === "p2" ? OPENING.t : undefined),
  });
  expect(own).toEqual([]);
});
