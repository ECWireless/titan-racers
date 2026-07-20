import { expect, test } from "@playwright/test";

import {
  getLinearSpringCompression,
  getSuspensionLoad,
} from "../src/game/kart/kart-suspension-model";
import { DEFAULT_KART_PHYSICAL_PROFILE } from "../src/game/kart/kart-physical-profile";

test.describe("kart suspension model", () => {
  test("derives static compression from supported load and spring rate", () => {
    expect(getLinearSpringCompression(8.4375, 812.5)).toBeCloseTo(0.0104, 3);
    expect(getLinearSpringCompression(16.875, 812.5)).toBeCloseTo(
      getLinearSpringCompression(8.4375, 812.5) * 2,
    );
    expect(getLinearSpringCompression(8.4375, 1_625)).toBeCloseTo(
      getLinearSpringCompression(8.4375, 812.5) / 2,
    );
  });

  test("uses damping only while suspension is moving", () => {
    const staticLoad = getSuspensionLoad(
      0.025,
      0,
      DEFAULT_KART_PHYSICAL_PROFILE.suspension,
    );
    const compressingLoad = getSuspensionLoad(
      0.025,
      -0.5,
      DEFAULT_KART_PHYSICAL_PROFILE.suspension,
    );
    const reboundingLoad = getSuspensionLoad(
      0.025,
      0.5,
      DEFAULT_KART_PHYSICAL_PROFILE.suspension,
    );

    expect(staticLoad).toBe(20.3125);
    expect(compressingLoad).toBe(28.75);
    expect(reboundingLoad).toBe(11.875);
  });

  test("adds progressive bump force only near maximum compression", () => {
    expect(
      getSuspensionLoad(0.04, 0, DEFAULT_KART_PHYSICAL_PROFILE.suspension),
    ).toBe(32.5);
    expect(
      getSuspensionLoad(0.05, 0, DEFAULT_KART_PHYSICAL_PROFILE.suspension),
    ).toBeCloseTo(41.496875);
  });

  test("does not clip physically requested hard-landing force", () => {
    expect(
      getSuspensionLoad(0.05, -1.5, DEFAULT_KART_PHYSICAL_PROFILE.suspension),
    ).toBeCloseTo(66.809375);
  });
});
