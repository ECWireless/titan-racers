import { expect, test } from "@playwright/test";

import { approachIndoors } from "../src/game/audio/ambience-mapping";

test.describe("ambience mapping", () => {
  test("crossfades into and out of the tunnel instead of cutting", () => {
    let indoors = 0;
    indoors = approachIndoors(indoors, true, 1 / 60);
    expect(indoors).toBeGreaterThan(0);
    expect(indoors).toBeLessThan(0.1);

    indoors = approachIndoors(0, true, 0.35);
    expect(indoors).toBeCloseTo(1 - Math.exp(-1), 6);
    expect(approachIndoors(1, true, 5)).toBe(1);
    expect(approachIndoors(1, false, 0.35)).toBeCloseTo(Math.exp(-1), 6);
    // It lands exactly, rather than approaching for seconds.
    expect(approachIndoors(0.9995, true, 1 / 60)).toBe(1);
  });
});
