import { expect, test } from "@playwright/test";

import {
  ROOM_CLOCK_SAMPLES,
  RoomClock,
  roomRaceMicroseconds,
} from "../src/game/room/room-clock";

test.describe("room clock", () => {
  test("keeps the offset from the shortest recent round trip", () => {
    const clock = new RoomClock();
    expect(clock.synced).toBe(false);
    // Server is 5,000 ms ahead; one-way delays differ on slow trips.
    expect(clock.addSample(100, 5_100 + 80, 300)).toBe(true);
    expect(clock.offset).toBe(4_980);
    expect(clock.addSample(400, 5_400 + 21, 440)).toBe(true);
    expect(clock.offset).toBe(5_001);
    expect(clock.roundTrip).toBe(40);
    expect(clock.addSample(500, 5_500 + 90, 700)).toBe(true);
    expect(clock.offset).toBe(5_001);
    expect(clock.serverNow(1_000)).toBe(6_001);
    expect(clock.localTimeOf(6_001)).toBe(1_000);
  });

  test("forgets old samples and refuses impossible ones", () => {
    const clock = new RoomClock();
    clock.addSample(0, 1_005, 10);
    for (let index = 1; index <= ROOM_CLOCK_SAMPLES; index += 1) {
      clock.addSample(index * 100, index * 100 + 2_050, index * 100 + 100);
    }
    expect(clock.offset).toBe(2_000);
    expect(clock.addSample(10, 0, 5)).toBe(false);
    expect(clock.addSample(0, 0, 10_000)).toBe(false);
    expect(clock.addSample(0, Number.NaN, 10)).toBe(false);
  });

  test("reads the room's race time, negative through the countdown", () => {
    expect(roomRaceMicroseconds(10_000, 7_000)).toBe(-3_000_000);
    expect(roomRaceMicroseconds(10_000, 12_345.5)).toBe(2_345_500);
  });
});
