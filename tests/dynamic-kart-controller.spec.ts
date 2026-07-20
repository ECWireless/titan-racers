import { expect, test } from "@playwright/test";

import {
  DEFAULT_KART_STEERING_GEOMETRY,
  getAckermannWheelSteerAngle,
  getActualTurnRadius,
  getGeometricTurnRadius,
  getMaximumSteerAngle,
  getPhysicalLateralAccelerationLimit,
  getSteeringResponseRate,
  getSteeringRequestLateralAccelerationLimit,
  STEERING_REQUEST_PHYSICAL_LIMIT_RATIO,
  STEERING_TRANSIENT_SLIP_AUTHORITY_RATIO,
  STEERING_CENTER_TO_FULL_RESPONSE_SECONDS,
} from "../src/game/kart/kart-steering";
import { DEFAULT_TIRE_SURFACE_INTERACTION } from "../src/game/kart/tire-surface-interaction";
import { REFERENCE_KART_CONSTRUCTION } from "../src/game/kart/kart-reference-construction";
import { EARTH_WORLD_ENVIRONMENT } from "../src/game/physics/world-environment";

test.describe("dynamic kart steering", () => {
  test("derives a nonlinear speed envelope from lateral acceleration", () => {
    expect(getMaximumSteerAngle(0)).toBe(18);
    expect(getMaximumSteerAngle(8.5)).toBeCloseTo(3.74, 1);
    expect(getMaximumSteerAngle(12.75)).toBeCloseTo(2.91, 1);
    expect(getMaximumSteerAngle(17)).toBeCloseTo(2.62, 1);
  });

  test("uses speed magnitude and continues reducing beyond no-load speed", () => {
    expect(getMaximumSteerAngle(-8.5)).toBeCloseTo(
      getMaximumSteerAngle(8.5),
    );
    expect(getMaximumSteerAngle(34)).toBeLessThan(getMaximumSteerAngle(17));
    expect(getMaximumSteerAngle(34)).toBeGreaterThan(
      DEFAULT_TIRE_SURFACE_INTERACTION.peakSlipAngleDegrees *
        STEERING_REQUEST_PHYSICAL_LIMIT_RATIO *
        STEERING_TRANSIENT_SLIP_AUTHORITY_RATIO,
    );
  });

  test("uses the lower tire-grip or rollover boundary", () => {
    const gripLimit =
      DEFAULT_TIRE_SURFACE_INTERACTION.peakGripCoefficient *
      EARTH_WORLD_ENVIRONMENT.gravity;
    const baselineLimit = getPhysicalLateralAccelerationLimit(
      DEFAULT_TIRE_SURFACE_INTERACTION,
      EARTH_WORLD_ENVIRONMENT,
      DEFAULT_KART_STEERING_GEOMETRY,
    );
    const highCenterOfMassLimit = getPhysicalLateralAccelerationLimit(
      DEFAULT_TIRE_SURFACE_INTERACTION,
      EARTH_WORLD_ENVIRONMENT,
      {
        ...DEFAULT_KART_STEERING_GEOMETRY,
        centerOfMassHeight: 1,
      },
    );

    expect(baselineLimit).toBeCloseTo(gripLimit);
    expect(highCenterOfMassLimit).toBeCloseTo(
      (EARTH_WORLD_ENVIRONMENT.gravity *
        DEFAULT_KART_STEERING_GEOMETRY.trackWidth) /
        2,
    );
    expect(highCenterOfMassLimit).toBeLessThan(baselineLimit);
  });

  test("keeps a shared steering reserve below the physical boundary", () => {
    const physicalLimit = getPhysicalLateralAccelerationLimit(
      DEFAULT_TIRE_SURFACE_INTERACTION,
      EARTH_WORLD_ENVIRONMENT,
      DEFAULT_KART_STEERING_GEOMETRY,
    );
    const requestedLimit = getSteeringRequestLateralAccelerationLimit(
      DEFAULT_TIRE_SURFACE_INTERACTION,
      EARTH_WORLD_ENVIRONMENT,
      DEFAULT_KART_STEERING_GEOMETRY,
    );

    expect(STEERING_REQUEST_PHYSICAL_LIMIT_RATIO).toBe(0.45);
    expect(STEERING_TRANSIENT_SLIP_AUTHORITY_RATIO).toBe(1);
    expect(requestedLimit).toBeCloseTo(physicalLimit * 0.45);
  });

  test("uses one shared center-to-full response duration at every speed", () => {
    const lowSpeedMaximum = getMaximumSteerAngle(0);
    const highSpeedMaximum = getMaximumSteerAngle(17);

    expect(STEERING_CENTER_TO_FULL_RESPONSE_SECONDS).toBe(0.225);
    expect(getSteeringResponseRate(lowSpeedMaximum)).toBe(80);
    expect(getSteeringResponseRate(highSpeedMaximum)).toBeCloseTo(11.66, 1);
    expect(
      lowSpeedMaximum / getSteeringResponseRate(lowSpeedMaximum),
    ).toBeCloseTo(0.225);
    expect(
      highSpeedMaximum / getSteeringResponseRate(highSpeedMaximum),
    ).toBeCloseTo(0.225);
  });

  test("derives mirrored Ackermann angles from one center request", () => {
    const frontLeft = REFERENCE_KART_CONSTRUCTION.wheelStations.find(
      (wheel) => wheel.name === "front-left",
    );
    const frontRight = REFERENCE_KART_CONSTRUCTION.wheelStations.find(
      (wheel) => wheel.name === "front-right",
    );

    expect(frontLeft).toBeDefined();
    expect(frontRight).toBeDefined();

    const leftInnerAngle = getAckermannWheelSteerAngle(
      18,
      frontLeft?.x ?? 0,
      DEFAULT_KART_STEERING_GEOMETRY,
    );
    const leftOuterAngle = getAckermannWheelSteerAngle(
      18,
      frontRight?.x ?? 0,
      DEFAULT_KART_STEERING_GEOMETRY,
    );
    const rightInnerAngle = getAckermannWheelSteerAngle(
      -18,
      frontRight?.x ?? 0,
      DEFAULT_KART_STEERING_GEOMETRY,
    );

    expect(leftInnerAngle).toBeCloseTo(23.25, 1);
    expect(leftOuterAngle).toBeCloseTo(14.65, 1);
    expect(rightInnerAngle).toBeCloseTo(-leftInnerAngle);
    expect(Math.abs(leftInnerAngle)).toBeGreaterThan(
      Math.abs(leftOuterAngle),
    );
  });

  test("distinguishes requested geometry from the observed chassis path", () => {
    expect(
      getGeometricTurnRadius(18, DEFAULT_KART_STEERING_GEOMETRY.wheelbase),
    ).toBeCloseTo(0.92, 1);
    expect(
      getGeometricTurnRadius(-18, DEFAULT_KART_STEERING_GEOMETRY.wheelbase),
    ).toBeCloseTo(0.92, 1);
    expect(getActualTurnRadius(12, 1.5)).toBe(8);
    expect(getActualTurnRadius(-12, -1.5)).toBe(8);
  });

  test("does not report a finite turn radius while traveling straight", () => {
    expect(
      getGeometricTurnRadius(0, DEFAULT_KART_STEERING_GEOMETRY.wheelbase),
    ).toBeNull();
    expect(getActualTurnRadius(12, 0)).toBeNull();
    expect(getActualTurnRadius(0, 1.5)).toBeNull();
  });
});
