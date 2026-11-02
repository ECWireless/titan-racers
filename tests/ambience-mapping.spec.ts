import { expect, test } from "@playwright/test";

import {
  approachIndoors,
  getStreamLevel,
  STREAM_SILENT_METRES,
} from "../src/game/audio/ambience-mapping";

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

  test("plays the stream fully at the bank, fading with distance to silence", () => {
    expect(getStreamLevel(0)).toBe(1);
    expect(getStreamLevel(3)).toBe(1);
    expect(getStreamLevel(6)).toBeCloseTo(0.5, 6);
    expect(getStreamLevel(12)).toBeCloseTo(0.25, 6);
    expect(getStreamLevel(STREAM_SILENT_METRES - 1)).toBeGreaterThan(0);
    expect(getStreamLevel(STREAM_SILENT_METRES)).toBe(0);
    expect(getStreamLevel(Number.POSITIVE_INFINITY)).toBe(0);
  });
});
