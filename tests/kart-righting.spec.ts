import { expect, test } from "@playwright/test";

import {
  getAxisMomentOfInertia,
  getManualRightingAxis,
  getManualRightingCaptureLocalTorqueImpulse,
  getManualRightingGeometry,
  getManualRightingLiftImpulse,
  getManualRightingTorqueImpulse,
  getManualRightingTorqueScale,
  KART_MANUAL_RIGHTING_POLICY,
} from "../src/game/kart/kart-righting";
import { REFERENCE_KART_CONSTRUCTION } from "../src/game/kart/kart-reference-construction";

const RIGHTING_GEOMETRY = getManualRightingGeometry(
  REFERENCE_KART_CONSTRUCTION.chassisDimensions.z,
);

test.describe("kart manual righting", () => {
  test("rejects upright, sideways, and invalid orientations", () => {
    expect(
      getManualRightingAxis({ x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: -1 }, 120),
    ).toBeNull();
    expect(
      getManualRightingAxis({ x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: -1 }, 120),
    ).toBeNull();
    expect(
      getManualRightingAxis(
        { x: Number.NaN, y: -1, z: 0 },
        { x: 0, y: 0, z: -1 },
        120,
      ),
    ).toBeNull();
  });

  test("chooses the shortest horizontal roll axis toward upright", () => {
    const axis = getManualRightingAxis(
      { x: 0.2, y: -0.98, z: 0 },
      { x: 0, y: 0, z: -1 },
      120,
    );

    expect(axis).toEqual({ x: 0, y: 0, z: 1 });
  });

  test("uses the chassis heading at the exactly inverted singularity", () => {
    const axis = getManualRightingAxis(
      { x: 0, y: -1, z: 0 },
      { x: Math.SQRT1_2, y: 0, z: -Math.SQRT1_2 },
      120,
    );

    expect(axis?.x).toBeCloseTo(Math.SQRT1_2);
    expect(axis?.y).toBe(0);
    expect(axis?.z).toBeCloseTo(-Math.SQRT1_2);
  });

  test("adds torque near the angled eligibility boundary but not when flat", () => {
    expect(getManualRightingTorqueScale({ x: 0, y: -1, z: 0 }, 120, 0.75)).toBe(
      1,
    );
    expect(
      getManualRightingTorqueScale(
        { x: Math.sin(Math.PI / 3), y: -0.5, z: 0 },
        120,
        0.75,
      ),
    ).toBeCloseTo(1.75);
    expect(
      getManualRightingTorqueScale({ x: 1, y: 0, z: 0 }, 120, 0.75),
    ).toBeNull();
  });

  test("derives equal angular recovery from each kart's axis inertia", () => {
    const localAxis = { x: 1, y: 0, z: 0 };
    const lightInertia = { x: 20, y: 30, z: 40 };
    const heavyInertia = { x: 40, y: 60, z: 80 };
    const lightImpulse = getManualRightingTorqueImpulse(
      lightInertia,
      localAxis,
      9.81,
      RIGHTING_GEOMETRY.liftClearanceHeight,
    );
    const heavyImpulse = getManualRightingTorqueImpulse(
      heavyInertia,
      localAxis,
      9.81,
      RIGHTING_GEOMETRY.liftClearanceHeight,
    );

    const expectedAngularSpeed =
      (Math.PI /
        (2 *
          Math.sqrt(
            (2 * RIGHTING_GEOMETRY.liftClearanceHeight) / 9.81,
          ))) *
      KART_MANUAL_RIGHTING_POLICY.contactTorqueAllowance;

    expect(KART_MANUAL_RIGHTING_POLICY.targetRotationDegrees).toBe(180);
    expect(KART_MANUAL_RIGHTING_POLICY.contactTorqueAllowance).toBe(1.15);
    expect(getAxisMomentOfInertia(lightInertia, localAxis)).toBe(20);
    expect(
      getAxisMomentOfInertia(lightInertia, { x: 1, y: 0, z: 1 }),
    ).toBeCloseTo(30);
    expect(lightImpulse / lightInertia.x).toBeCloseTo(expectedAngularSpeed);
    expect(heavyImpulse).toBe(lightImpulse * 2);
    expect(heavyImpulse / heavyInertia.x).toBeCloseTo(expectedAngularSpeed);
  });

  test("derives equal lift speed from mass, gravity, and clearance policy", () => {
    const lightImpulse = getManualRightingLiftImpulse(
      120,
      9.81,
      RIGHTING_GEOMETRY.liftClearanceHeight,
    );
    const heavyImpulse = getManualRightingLiftImpulse(
      240,
      9.81,
      RIGHTING_GEOMETRY.liftClearanceHeight,
    );

    expect(RIGHTING_GEOMETRY.liftClearanceHeight).toBeCloseTo(0.08);
    expect(RIGHTING_GEOMETRY.supportProbeDistance).toBeCloseTo(0.275);
    expect(lightImpulse / 120).toBeCloseTo(
      Math.sqrt(2 * 9.81 * RIGHTING_GEOMETRY.liftClearanceHeight),
    );
    expect(heavyImpulse).toBeCloseTo(lightImpulse * 2);
    expect(heavyImpulse / 240).toBeCloseTo(lightImpulse / 120);
    expect(
      getManualRightingLiftImpulse(
        0,
        9.81,
        RIGHTING_GEOMETRY.liftClearanceHeight,
      ),
    ).toBe(0);
  });

  test("cancels remaining righting angular momentum from local inertia", () => {
    expect(
      getManualRightingCaptureLocalTorqueImpulse(
        { x: 2, y: 3, z: 4 },
        { x: 5, y: -2, z: 0.5 },
      ),
    ).toEqual({ x: -10, y: 6, z: -2 });
    expect(
      getManualRightingCaptureLocalTorqueImpulse(
        { x: 4, y: 6, z: 8 },
        { x: 5, y: -2, z: 0.5 },
      ),
    ).toEqual({ x: -20, y: 12, z: -4 });
  });
});
