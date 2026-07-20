import { expect, test } from "@playwright/test";

import {
  getCountdownSmokeLevel,
  getDriftSmokeLevel,
  getLateralScrubPower,
  getTireSmokeLevel,
  KART_TIRE_SMOKE_POLICY,
  shouldEmitDriftSmoke,
} from "../src/game/kart/kart-drift-smoke";

test.describe("kart drift smoke", () => {
  const driftingRearWheel = {
    appliedLateralTireForce:
      KART_TIRE_SMOKE_POLICY.lateralScrubPowerOnsetWatts * 1.5,
    driven: true,
    lateralSpeed: 1,
    name: "rear-left",
    supported: true,
  };

  test("derives rear-tire smoke from applied lateral scrub power", () => {
    expect(getLateralScrubPower(driftingRearWheel)).toBeCloseTo(
      KART_TIRE_SMOKE_POLICY.lateralScrubPowerOnsetWatts * 1.5,
    );
    expect(shouldEmitDriftSmoke(driftingRearWheel)).toBe(true);
    expect(
      shouldEmitDriftSmoke({ ...driftingRearWheel, name: "front-left" }),
    ).toBe(false);
    expect(
      shouldEmitDriftSmoke({ ...driftingRearWheel, supported: false }),
    ).toBe(false);
    expect(
      shouldEmitDriftSmoke({
        ...driftingRearWheel,
        appliedLateralTireForce:
          KART_TIRE_SMOKE_POLICY.lateralScrubPowerOnsetWatts * 0.5,
      }),
    ).toBe(false);
  });

  test("uses one shared release ratio to prevent smoke flicker", () => {
    const settlingRearWheel = {
      ...driftingRearWheel,
      appliedLateralTireForce:
        KART_TIRE_SMOKE_POLICY.lateralScrubPowerOnsetWatts * 0.85,
      lateralSpeed: 1,
    };

    expect(getLateralScrubPower(settlingRearWheel)).toBeCloseTo(
      KART_TIRE_SMOKE_POLICY.lateralScrubPowerOnsetWatts * 0.85,
    );
    expect(shouldEmitDriftSmoke(settlingRearWheel)).toBe(false);
    expect(shouldEmitDriftSmoke(settlingRearWheel, true)).toBe(true);
    expect(
      shouldEmitDriftSmoke(
        {
          ...settlingRearWheel,
          appliedLateralTireForce:
            KART_TIRE_SMOKE_POLICY.lateralScrubPowerOnsetWatts * 0.7,
        },
        true,
      ),
    ).toBe(false);
  });

  test("increases smoke density continuously with scrub power", () => {
    const lightLevel = getDriftSmokeLevel(driftingRearWheel);
    const mediumLevel = getDriftSmokeLevel({
      ...driftingRearWheel,
      appliedLateralTireForce:
        (KART_TIRE_SMOKE_POLICY.lateralScrubPowerOnsetWatts +
          KART_TIRE_SMOKE_POLICY.lateralScrubPowerFullWatts) /
        2,
      lateralSpeed: 1,
    });
    const fullLevel = getDriftSmokeLevel({
      ...driftingRearWheel,
      appliedLateralTireForce:
        KART_TIRE_SMOKE_POLICY.lateralScrubPowerFullWatts,
      lateralSpeed: 1,
    });

    expect(lightLevel).toBeGreaterThan(0);
    expect(lightLevel).toBeLessThan(mediumLevel);
    expect(mediumLevel).toBeLessThan(2);
    expect(fullLevel).toBe(2);
  });

  test("does not infer smoke from straight braking without longitudinal slip", () => {
    const straightBrakingWheel = {
      appliedLateralTireForce: 0,
      driven: true,
      lateralSpeed: 0,
      name: "rear-left",
      supported: true,
    };

    expect(getDriftSmokeLevel(straightBrakingWheel)).toBe(0);
    expect(getTireSmokeLevel(straightBrakingWheel)).toBe(0);
  });

  test("keeps stylized countdown smoke on supported rear tires", () => {
    const countdownWheel = {
      appliedLateralTireForce: 0,
      driven: true,
      lateralSpeed: 0,
      name: "rear-right",
      supported: true,
    };

    expect(getCountdownSmokeLevel(countdownWheel, 1)).toBe(2);
    expect(
      getCountdownSmokeLevel({ ...countdownWheel, name: "front-right" }, 1),
    ).toBe(0);
    expect(
      getCountdownSmokeLevel({ ...countdownWheel, supported: false }, 1),
    ).toBe(0);
    expect(getCountdownSmokeLevel(countdownWheel, 0.1)).toBe(0);
    expect(
      getCountdownSmokeLevel(
        countdownWheel,
        KART_TIRE_SMOKE_POLICY.countdownThrottleOnset * 0.8,
        true,
      ),
    ).toBe(2);
  });
});
