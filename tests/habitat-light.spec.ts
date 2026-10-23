import { expect, test } from "@playwright/test";

import { AGRICULTURAL_ZONE_DOCUMENT } from "../src/game/course/course-document";
import { getHabitatLight } from "../src/game/enclosure/habitat-light";
import { getEnclosureFrame } from "../src/game/enclosure/island-three";
import {
  createDirectionalEnvironmentAtlasPixels,
  createEnvironmentAtlasPixels,
  ENVIRONMENT_ATLAS_SIZE,
} from "../src/game/render/habitat-environment-atlas";

const sunlit = AGRICULTURAL_ZONE_DOCUMENT.enclosure;
// The far half of the valley, beyond the mirror's band.
const shaded = {
  ...sunlit,
  placement: { ...sunlit.placement, axial: -8_000 },
};
const down = { x: 0, y: -1, z: 0 };

function luminance({ b, g, r }: { b: number; g: number; r: number }) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Linear red of an RGBP-encoded atlas texel. */
function atlasRed(pixels: Uint8Array, column: number, row: number) {
  const index = (row * ENVIRONMENT_ATLAS_SIZE + column) * 4;
  const scale = 8 - (pixels[index + 3]! / 255) * 7;
  return ((pixels[index]! / 255) * scale) ** 2;
}

test("lights a course from the enclosure around it", () => {
  const light = getHabitatLight(sunlit);
  const sun = getEnclosureFrame(sunlit).sunDirection();
  // As high above the opposite horizon.
  const awayFromSun = { x: -sun.x, y: sun.y, z: -sun.z };

  // The haze glows toward the sun's image, low over the anti-sun cap.
  expect(luminance(light.radiance(sun))).toBeGreaterThan(
    2 * luminance(light.radiance(awayFromSun)),
  );
  expect(light.sunGlow).toBeGreaterThan(0);
  // The fill light is the habitat's own: far dimmer than the sunlight.
  expect(luminance(light.fill)).toBeGreaterThan(0.05);
  expect(luminance(light.fill)).toBeLessThan(0.3);
});

test("dims the floor and the haze glow outside the mirror's band", () => {
  const lit = getHabitatLight(sunlit);
  const dark = getHabitatLight(shaded);

  expect(luminance(dark.radiance(down))).toBeLessThan(
    0.5 * luminance(lit.radiance(down)),
  );
  expect(dark.sunGlow).toBe(0);
});

test("builds the elevation-only atlas from directional light", () => {
  const colorAtElevation = (sine: number) => ({
    b: 0.2 + 0.2 * sine,
    g: 0.3 + 0.1 * sine,
    r: 0.4 - 0.1 * sine,
  });
  const expected = createEnvironmentAtlasPixels(colorAtElevation);
  const actual = createDirectionalEnvironmentAtlasPixels((direction) =>
    colorAtElevation(direction.y),
  );

  let largest = 0;
  for (let i = 0; i < expected.length; i += 1) {
    largest = Math.max(largest, Math.abs(expected[i]! - actual[i]!));
  }
  expect(largest).toBeLessThanOrEqual(2);
});

test("stores directional light where the engine looks it up", () => {
  // Light only from world +X. Atlas lookups mirror X, so world +X sits at
  // u = 0.25 and world -X at u = 0.75 in the 64×32 ambient block at
  // (128, 384), whose texels inset by a one-texel seam.
  const pixels = createDirectionalEnvironmentAtlasPixels((direction) => {
    const value = Math.max(direction.x, 0);
    return { b: value, g: value, r: value };
  });
  const row = 384 + 16;
  const column = (u: number) => Math.floor(128 + 1 + u * 62);

  expect(atlasRed(pixels, column(0.25), row)).toBeGreaterThan(0.5);
  expect(atlasRed(pixels, column(0.75), row)).toBeLessThan(0.05);
});
