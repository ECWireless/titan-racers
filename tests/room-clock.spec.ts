import { expect, test } from "@playwright/test";

import {
  RoomClock,
  roomRaceMicroseconds,
} from "../src/game/room/room-clock";

test.describe("room clock", () => {
  test("keeps the offset from the shortest round trip", () => {
    const clock = new RoomClock();
    expect(clock.synced).toBe(false);
    // Server is 5,000 ms ahead; one-way delays differ on slow trips.
    expect(clock.addSample(100, 5_100 + 80, 300)).toBe(true);
    expect(clock.offset).toBe(4_980);
    expect(clock.addSample(400, 5_400 + 21, 440)).toBe(true);
    expect(clock.offset).toBe(5_001);
    expect(clock.roundTrip).toBe(40);
    expect(clock.addSample(500, 5_500 + 90, 700)).toBe(false);
    expect(clock.offset).toBe(5_001);
    expect(clock.serverNow(1_000)).toBe(6_001);
    expect(clock.localTimeOf(6_001)).toBe(1_000);
  });

  test("keeps a quiet sample through busy ones until it ages", () => {
    const clock = new RoomClock();
    clock.addSample(0, 1_005, 10);
    // A racing page reads its pongs late: long, lopsided round trips.
    for (let index = 1; index <= 20; index += 1) {
      const sentAt = index * 5_000;
      clock.addSample(sentAt, sentAt + 1_300, sentAt + 600);
    }
    expect(clock.offset).toBe(1_000);
    // Minutes later a fair sample of similar quality takes over.
    const later = 10 * 60_000;
    expect(clock.addSample(later, later + 1_020, later + 30)).toBe(true);
    expect(clock.offset).toBe(1_005);
  });

  test("refuses impossible samples", () => {
    const clock = new RoomClock();
    expect(clock.addSample(10, 0, 5)).toBe(false);
    expect(clock.addSample(0, 0, 10_000)).toBe(false);
    expect(clock.addSample(0, Number.NaN, 10)).toBe(false);
    expect(clock.synced).toBe(false);
  });

  test("reads the room's race time, negative through the countdown", () => {
    expect(roomRaceMicroseconds(10_000, 7_000)).toBe(-3_000_000);
    expect(roomRaceMicroseconds(10_000, 12_345.5)).toBe(2_345_500);
  });
});
