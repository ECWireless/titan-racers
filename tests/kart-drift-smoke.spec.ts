import { expect, test } from "@playwright/test";

import {
  getBrakingSmokeLevel,
  getCountdownSmokeLevel,
  getDriftSmokeLevel,
  getTireSmokeLevel,
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
      tireForceUtilization: 0.7,
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
      tireForceUtilization: 0.7,
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
      tireForceUtilization: 0.7,
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

  test("emits light smoke for a heavily loaded straight-line braking tire", () => {
    const hardBrakingWheel = {
      longitudinalSpeed: 12,
      name: "front-left",
      slipAngle: 0,
      supported: true,
      tireForceUtilization: 1,
    };

    expect(getDriftSmokeLevel(hardBrakingWheel)).toBe(0);
    expect(getBrakingSmokeLevel(hardBrakingWheel, 1)).toBe(1);
    expect(getBrakingSmokeLevel(hardBrakingWheel, 0)).toBe(0);
    expect(
      getBrakingSmokeLevel(
        { ...hardBrakingWheel, tireForceUtilization: 0.2 },
        1,
      ),
    ).toBe(0);
    expect(
      getBrakingSmokeLevel({ ...hardBrakingWheel, supported: false }, 1),
    ).toBe(0);
    expect(
      getTireSmokeLevel(hardBrakingWheel, {
        brake: 1,
        countdownThrottle: 0,
      }),
    ).toBe(1);
  });

  test("emits countdown burnout smoke only from supported rear tires", () => {
    const countdownWheel = {
      longitudinalSpeed: 0,
      name: "rear-right",
      slipAngle: 0,
      supported: true,
      tireForceUtilization: 0,
    };

    expect(getCountdownSmokeLevel(countdownWheel, 1)).toBe(2);
    expect(
      getCountdownSmokeLevel({ ...countdownWheel, name: "front-right" }, 1),
    ).toBe(0);
    expect(
      getCountdownSmokeLevel({ ...countdownWheel, supported: false }, 1),
    ).toBe(0);
    expect(getCountdownSmokeLevel(countdownWheel, 0.1)).toBe(0);
    expect(getCountdownSmokeLevel(countdownWheel, 0)).toBe(0);
    expect(getCountdownSmokeLevel(countdownWheel, 0.25, true)).toBe(2);
  });
});
