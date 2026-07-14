import { expect, test } from "@playwright/test";

import {
  getDriftSmokeLevel,
  shouldEmitDriftSmoke,
} from "../src/game/kart/kart-drift-smoke";

const degreesToRadians = (degrees: number) => degrees * (Math.PI / 180);

test.describe("kart drift smoke", () => {
  test("starts only for grounded rear tires with meaningful speed and slip", () => {
    const driftingRearWheel = {
      longitudinalSpeed: 8,
      name: "rear-left",
      slipAngle: degreesToRadians(8),
      supported: true,
    };

    expect(shouldEmitDriftSmoke(driftingRearWheel)).toBe(true);
    expect(
      shouldEmitDriftSmoke({ ...driftingRearWheel, name: "front-left" }),
    ).toBe(false);
    expect(
      shouldEmitDriftSmoke({ ...driftingRearWheel, supported: false }),
    ).toBe(false);
    expect(
      shouldEmitDriftSmoke({ ...driftingRearWheel, longitudinalSpeed: 5 }),
    ).toBe(false);
    expect(
      shouldEmitDriftSmoke({
        ...driftingRearWheel,
        slipAngle: degreesToRadians(3.5),
      }),
    ).toBe(false);
  });

  test("uses release hysteresis to prevent smoke flicker", () => {
    const settlingRearWheel = {
      longitudinalSpeed: 5,
      name: "rear-right",
      slipAngle: degreesToRadians(3.5),
      supported: true,
    };

    expect(shouldEmitDriftSmoke(settlingRearWheel)).toBe(false);
    expect(shouldEmitDriftSmoke(settlingRearWheel, true)).toBe(true);
    expect(
      shouldEmitDriftSmoke(
        { ...settlingRearWheel, slipAngle: degreesToRadians(2.5) },
        true,
      ),
    ).toBe(false);
  });

  test("adds a heavier smoke layer as rear slip increases", () => {
    const lightDrift = {
      longitudinalSpeed: 10,
      name: "rear-left",
      slipAngle: degreesToRadians(8),
      supported: true,
    };

    expect(getDriftSmokeLevel(lightDrift)).toBe(1);
    expect(
      getDriftSmokeLevel({
        ...lightDrift,
        slipAngle: degreesToRadians(12),
      }),
    ).toBe(2);
    expect(
      getDriftSmokeLevel({ ...lightDrift, slipAngle: degreesToRadians(9) }, 2),
    ).toBe(2);
  });
});
