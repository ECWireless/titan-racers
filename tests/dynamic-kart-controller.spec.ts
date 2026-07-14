import { expect, test } from "@playwright/test";

import { getMaximumSteerAngle } from "../src/game/kart/kart-steering";

test.describe("dynamic kart steering", () => {
  test("progressively reduces steering authority as speed increases", () => {
    expect(getMaximumSteerAngle(0, 17)).toBe(18);
    expect(getMaximumSteerAngle(8.5, 17)).toBe(12);
    expect(getMaximumSteerAngle(17, 17)).toBe(6);
  });

  test("uses speed magnitude and clamps beyond the configured envelope", () => {
    expect(getMaximumSteerAngle(-8.5, 17)).toBe(12);
    expect(getMaximumSteerAngle(34, 17)).toBe(6);
  });
});
