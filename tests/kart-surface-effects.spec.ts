import { expect, test } from "@playwright/test";

import {
  getClippingRate,
  getTireMarkStrength,
  GrassClippingPool,
  KART_SURFACE_EFFECT_POLICY,
  TireMarkTrails,
} from "../src/game/kart/kart-surface-effects";

const policy = KART_SURFACE_EFFECT_POLICY;
const UP = { x: 0, y: 1, z: 0 };
const asphalt = { id: "surface.standard-course", version: 1 };
const turf = { id: "surface.short-grass", version: 1 };
const lawn = { id: "surface.lawn-grass", version: 1 };

function wheel(scrubWatts: number, surfaceMaterial = asphalt) {
  return {
    appliedLateralTireForce: scrubWatts,
    lateralSpeed: 1,
    longitudinalSpeed: 8,
    supported: true,
    surfaceMaterial,
  };
}

test("marks follow sideways scrub on the surface they belong to", () => {
  const onset = policy.marks.asphalt.scrubOnsetWatts;
  expect(getTireMarkStrength(wheel(onset * 0.9), "asphalt")).toBe(0);
  // A strip already being laid continues a little below the onset.
  expect(
    getTireMarkStrength(wheel(onset * 0.9), "asphalt", true),
  ).toBeGreaterThan(0);
  const partial = getTireMarkStrength(wheel(onset * 1.5), "asphalt");
  expect(partial).toBeGreaterThan(0);
  expect(partial).toBeLessThan(1);
  expect(
    getTireMarkStrength(wheel(policy.markScrubFullWatts * 2), "asphalt"),
  ).toBe(1);
  // Grass scuffs only where tires slide on turf or lawn.
  expect(
    getTireMarkStrength(wheel(policy.markScrubFullWatts, turf), "asphalt"),
  ).toBe(0);
  expect(
    getTireMarkStrength(wheel(policy.markScrubFullWatts, lawn), "grass"),
  ).toBe(1);
  expect(
    getTireMarkStrength(
      wheel(policy.marks.grass.scrubOnsetWatts * 0.9, turf),
      "grass",
    ),
  ).toBe(0);
  expect(getTireMarkStrength(wheel(policy.markScrubFullWatts), "grass")).toBe(
    0,
  );
  expect(
    getTireMarkStrength(
      { ...wheel(policy.markScrubFullWatts), supported: false },
      "asphalt",
    ),
  ).toBe(0);
});

test("clippings come only from grass, sparse when rolling and more under slip", () => {
  expect(getClippingRate(wheel(0))).toBe(0);
  const rolling = getClippingRate(wheel(0, turf));
  expect(rolling).toBeGreaterThan(0);
  expect(rolling).toBeLessThanOrEqual(policy.clippingRollingRate);
  expect(
    getClippingRate(wheel(policy.markScrubFullWatts, lawn)),
  ).toBeGreaterThan(rolling);
});

test("a strip shares edges between quads and restarts after a teleport", () => {
  const trails = new TireMarkTrails(1, "asphalt");
  const sample = (x: number) =>
    trails.sample(0, { x, y: 0, z: 0 }, UP, 0.02, 1);

  expect(sample(0)).toBe(false); // starts the strip
  expect(sample(0.05)).toBe(false); // shorter than a segment
  expect(sample(0.2)).toBe(true);
  expect(sample(0.4)).toBe(true);
  // The second quad starts on the first quad's end edge.
  expect([...trails.positions.slice(12, 18)]).toEqual([
    ...trails.positions.slice(6, 12),
  ]);
  expect(sample(5)).toBe(false); // a jump starts a new strip
  expect(sample(5.2)).toBe(true);
});

test("marks last for the race and fade only before the pool recycles them", () => {
  const { capacity, maxOpacity } = policy.marks.asphalt;
  const trails = new TireMarkTrails(1, "asphalt");
  for (let index = 0; index <= capacity * 0.5; index++) {
    trails.sample(0, { x: index * 0.2, y: 0, z: 0 }, UP, 0.02, 1);
  }
  // A half-full pool keeps every mark at full strength.
  expect(trails.getAlpha(0)).toBeCloseTo(maxOpacity);

  for (let index = capacity * 0.5; index <= capacity * 1.5; index++) {
    trails.sample(0, { x: index * 0.2, y: 0, z: 0 }, UP, 0.02, 1);
  }
  const alphas = Array.from({ length: capacity }, (_, slot) =>
    trails.getAlpha(slot),
  );
  expect(Math.max(...alphas)).toBeCloseTo(maxOpacity);
  // The next slot to be overwritten is already invisible.
  expect(Math.min(...alphas)).toBe(0);

  trails.clear();
  expect(trails.isEmpty).toBe(true);
  expect(trails.getAlpha(0)).toBe(0);
});

test("clippings stay within the pool and land back on their surface", () => {
  const pool = new GrassClippingPool();
  const color = { r: 0.4, g: 0.45, b: 0.35 };
  for (let index = 0; index < policy.clippingCapacity + 5; index++) {
    pool.spawn({ x: 0, y: 0, z: 0 }, UP, { x: 0, y: 1.5, z: 0 }, color);
  }
  expect(pool.count).toBe(policy.clippingCapacity);

  let seconds = 0;
  while (pool.count > 0 && seconds < 2) {
    pool.step(1 / 120);
    seconds += 1 / 120;
    expect(pool.positions[1]).toBeGreaterThanOrEqual(-0.02);
  }
  // A 1.5 m/s toss under real gravity and drag lands before its lifetime ends.
  expect(seconds).toBeLessThan(policy.clippingLifetimeSeconds);
  expect(pool.count).toBe(0);
});
