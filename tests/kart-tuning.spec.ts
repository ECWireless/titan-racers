import { expect, test } from "@playwright/test";

import {
  DEFAULT_KART_DEVELOPMENT_VALUES,
  KART_DEVELOPMENT_VALUE_BOUNDS,
  KART_DEVELOPMENT_VALUE_METADATA,
  normalizeKartDevelopmentValues,
  resolveKartDevelopmentValues,
} from "../src/game/kart/kart-development-values";

test.describe("kart development values", () => {
  test("keeps every diagnostic default inside its development bounds", () => {
    expect(DEFAULT_KART_DEVELOPMENT_VALUES.maxForwardSpeed).toBe(17);
    Object.entries(DEFAULT_KART_DEVELOPMENT_VALUES).forEach(([key, value]) => {
      const bounds =
        KART_DEVELOPMENT_VALUE_BOUNDS[
          key as keyof typeof KART_DEVELOPMENT_VALUE_BOUNDS
        ];
      expect(value, key).toBeGreaterThanOrEqual(bounds.minimum);
      expect(value, key).toBeLessThanOrEqual(bounds.maximum);
    });
    expect(
      normalizeKartDevelopmentValues(DEFAULT_KART_DEVELOPMENT_VALUES),
    ).toEqual(
      DEFAULT_KART_DEVELOPMENT_VALUES,
    );
  });

  test("rejects non-finite values and clamps unsafe values", () => {
    const values = normalizeKartDevelopmentValues({
      maxForwardSpeed: 500,
      maximumDriveForce: Number.NaN,
      maximumHandbrakeForce: -1,
    });

    expect(values.maximumDriveForce).toBe(
      DEFAULT_KART_DEVELOPMENT_VALUES.maximumDriveForce,
    );
    expect(values.maxForwardSpeed).toBe(
      KART_DEVELOPMENT_VALUE_BOUNDS.maxForwardSpeed.maximum,
    );
    expect(values.maximumHandbrakeForce).toBe(0);
  });

  test("preserves required ordering between related thresholds", () => {
    const values = normalizeKartDevelopmentValues({
      maximumCenterSteerAngle: 8,
      peakGripCoefficient: 1,
      peakSlipAngleDegrees: 15,
      slidingGripCoefficient: 2,
      slidingSlipAngleDegrees: 10,
    });

    expect(values.slidingGripCoefficient).toBeLessThanOrEqual(
      values.peakGripCoefficient,
    );
    expect(values.slidingSlipAngleDegrees).toBeGreaterThan(
      values.peakSlipAngleDegrees,
    );
  });

  test("maps every flat diagnostic value to an explicit runtime owner", () => {
    expect(Object.keys(KART_DEVELOPMENT_VALUE_METADATA)).toEqual(
      Object.keys(DEFAULT_KART_DEVELOPMENT_VALUES),
    );
    expect(KART_DEVELOPMENT_VALUE_METADATA.gravity).toEqual({
      classification: "environment",
      owner: "world-environment",
    });

    const resolved = resolveKartDevelopmentValues(
      DEFAULT_KART_DEVELOPMENT_VALUES,
    );
    expect(resolved.environment.airDensity).toBe(1.225);
    expect(resolved.environment.gravity).toBe(9.81);
    expect(resolved.kart.drivetrain).toEqual({
      maximumDriveForce: DEFAULT_KART_DEVELOPMENT_VALUES.maximumDriveForce,
      noLoadSpeed: DEFAULT_KART_DEVELOPMENT_VALUES.maxForwardSpeed,
    });
  });
});
