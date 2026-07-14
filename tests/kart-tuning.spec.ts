import { expect, test } from "@playwright/test";

import {
  DEFAULT_KART_TUNING,
  KART_TUNING_BOUNDS,
  normalizeKartTuning,
} from "../src/game/kart/kart-tuning";

test.describe("kart tuning", () => {
  test("keeps every authored default inside its public tuning bounds", () => {
    expect(DEFAULT_KART_TUNING.maxReverseSpeed).toBe(17);
    Object.entries(DEFAULT_KART_TUNING).forEach(([key, value]) => {
      const bounds = KART_TUNING_BOUNDS[key as keyof typeof KART_TUNING_BOUNDS];
      expect(value, key).toBeGreaterThanOrEqual(bounds.minimum);
      expect(value, key).toBeLessThanOrEqual(bounds.maximum);
    });
    expect(normalizeKartTuning(DEFAULT_KART_TUNING)).toEqual(
      DEFAULT_KART_TUNING,
    );
  });

  test("rejects non-finite values and clamps unsafe values", () => {
    const tuning = normalizeKartTuning({
      acceleration: Number.NaN,
      maxForwardSpeed: 500,
      maximumBrakingForceReduction: -1,
    });

    expect(tuning.acceleration).toBe(DEFAULT_KART_TUNING.acceleration);
    expect(tuning.maxForwardSpeed).toBe(
      KART_TUNING_BOUNDS.maxForwardSpeed.maximum,
    );
    expect(tuning.maximumBrakingForceReduction).toBe(0);
  });

  test("preserves required ordering between related thresholds", () => {
    const tuning = normalizeKartTuning({
      brakingAssistFullAngleDegrees: 2,
      brakingAssistStartAngleDegrees: 8,
      brakingSlideStartAngleDegrees: 30,
      driftSmokeStartSlipAngleDegrees: 9,
      driftSmokeStartSpeed: 4,
      driftSmokeStopSlipAngleDegrees: 12,
      driftSmokeStopSpeed: 8,
      heavyDriftSmokeStartSlipAngleDegrees: 5,
      heavyDriftSmokeStopSlipAngleDegrees: 30,
      maximumSteerAngle: 8,
      minimumHighSpeedSteerAngle: 20,
      peakGripCoefficient: 1,
      peakSlipAngleDegrees: 15,
      slidingGripCoefficient: 2,
      slidingSlipAngleDegrees: 10,
    });

    expect(tuning.minimumHighSpeedSteerAngle).toBeLessThanOrEqual(
      tuning.maximumSteerAngle,
    );
    expect(tuning.slidingGripCoefficient).toBeLessThanOrEqual(
      tuning.peakGripCoefficient,
    );
    expect(tuning.slidingSlipAngleDegrees).toBeGreaterThan(
      tuning.peakSlipAngleDegrees,
    );
    expect(tuning.brakingSlideStartAngleDegrees).toBeLessThan(
      tuning.slidingSlipAngleDegrees,
    );
    expect(tuning.brakingAssistFullAngleDegrees).toBeGreaterThan(
      tuning.brakingAssistStartAngleDegrees,
    );
    expect(tuning.driftSmokeStopSpeed).toBeLessThanOrEqual(
      tuning.driftSmokeStartSpeed,
    );
    expect(tuning.driftSmokeStopSlipAngleDegrees).toBeLessThanOrEqual(
      tuning.driftSmokeStartSlipAngleDegrees,
    );
    expect(tuning.heavyDriftSmokeStartSlipAngleDegrees).toBeGreaterThan(
      tuning.driftSmokeStartSlipAngleDegrees,
    );
    expect(tuning.heavyDriftSmokeStopSlipAngleDegrees).toBeLessThanOrEqual(
      tuning.heavyDriftSmokeStartSlipAngleDegrees,
    );
  });
});
