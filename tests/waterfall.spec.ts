import { expect, test } from "@playwright/test";

import { TERRACE_REACH } from "../src/game/enclosure/habitat-land";
import { FALLS, fallPath, sheetHalfWidth, veilShape } from "../src/game/enclosure/waterfall";

const RADIUS = 4_000;
const DEGREES = 180 / Math.PI;

test("bends the falls anti-spinward as the habitat turns beneath them", () => {
  const path = fallPath(RADIUS, FALLS.drop, 0, 40);
  const landing = path[path.length - 1]!;
  // The habitat-land-use note: an 800 m drop takes 15.1 s and lands about
  // 426 m anti-spinward.
  expect(landing.radius).toBeCloseTo(RADIUS, 6);
  expect(landing.time).toBeCloseTo(15.1, 1);
  expect(-landing.turn * RADIUS).toBeCloseTo(426, 0);
  // It bends ever further as it falls.
  path.slice(1).forEach((point, i) => expect(point.turn).toBeLessThan(path[i]!.turn));
});

test("keeps the falls inside their gorge and lands them in its pool", () => {
  const path = fallPath(RADIUS, FALLS.drop, FALLS.outflow, 40);
  const landing = path[path.length - 1]!;
  expect(FALLS.cliff.in + FALLS.lip + landing.out).toBeLessThan(TERRACE_REACH);
  path.forEach(({ radius, time, turn }) => {
    const centre = FALLS.azimuth + turn * DEGREES;
    const half = (sheetHalfWidth(time, landing.time) / radius) * DEGREES;
    expect(centre - half).toBeGreaterThan(FALLS.gorge[0]);
    expect(centre + half).toBeLessThan(FALLS.gorge[1]);
    // So do the spray veils off its edges.
    ([-1, 1] as const).forEach((side) => {
      const veil = veilShape(side, time, landing.time);
      const middle = centre + (veil.offset / radius) * DEGREES;
      const spread = (veil.half / radius) * DEGREES;
      expect(middle - spread).toBeGreaterThan(FALLS.gorge[0]);
      expect(middle + spread).toBeLessThan(FALLS.gorge[1]);
    });
  });
});
