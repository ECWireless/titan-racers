import { expect, test } from "@playwright/test";

import {
  getAxisMomentOfInertia,
  getManualRightingAxis,
  getManualRightingCaptureLocalTorqueImpulse,
  getManualRightingGeometry,
  getManualRightingLiftImpulse,
  getManualRightingLocalTorqueImpulse,
  getManualRightingTorqueScale,
  KART_MANUAL_RIGHTING_POLICY,
} from "../src/game/kart/kart-righting";
import { REFERENCE_KART_CONSTRUCTION } from "../src/game/kart/kart-reference-construction";

const RIGHTING_GEOMETRY = getManualRightingGeometry(
  REFERENCE_KART_CONSTRUCTION.chassisDimensions.z,
);

function diagonalTensor(x: number, y: number, z: number) {
  return {
    xx: x,
    xy: 0,
    xz: 0,
    yx: 0,
    yy: y,
    yz: 0,
    zx: 0,
    zy: 0,
    zz: z,
  };
}

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
    const lightInertia = diagonalTensor(20, 30, 40);
    const heavyInertia = diagonalTensor(40, 60, 80);
    const lightImpulse = getManualRightingLocalTorqueImpulse(
      lightInertia,
      localAxis,
      9.81,
      RIGHTING_GEOMETRY.liftClearanceHeight,
    );
    const heavyImpulse = getManualRightingLocalTorqueImpulse(
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
    expect(lightImpulse.x / lightInertia.xx).toBeCloseTo(expectedAngularSpeed);
    expect(lightImpulse.y).toBe(0);
    expect(lightImpulse.z).toBe(0);
    expect(heavyImpulse.x).toBe(lightImpulse.x * 2);
    expect(heavyImpulse.x / heavyInertia.xx).toBeCloseTo(expectedAngularSpeed);
  });

  test("requests pure righting rotation through the full tensor", () => {
    const impulse = getManualRightingLocalTorqueImpulse(
      {
        xx: 2,
        xy: 0.5,
        xz: -0.25,
        yx: 0.5,
        yy: 3,
        yz: 0.75,
        zx: -0.25,
        zy: 0.75,
        zz: 4,
      },
      { x: 1, y: 0, z: 0 },
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

    expect(impulse.x).toBeCloseTo(2 * expectedAngularSpeed);
    expect(impulse.y).toBeCloseTo(0.5 * expectedAngularSpeed);
    expect(impulse.z).toBeCloseTo(-0.25 * expectedAngularSpeed);
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
        diagonalTensor(2, 3, 4),
        { x: 5, y: -2, z: 0.5 },
      ),
    ).toEqual({ x: -10, y: 6, z: -2 });
    expect(
      getManualRightingCaptureLocalTorqueImpulse(
        diagonalTensor(4, 6, 8),
        { x: 5, y: -2, z: 0.5 },
      ),
    ).toEqual({ x: -20, y: 12, z: -4 });
  });

  test("captures coupled angular momentum from the full inertia tensor", () => {
    expect(
      getManualRightingCaptureLocalTorqueImpulse(
        {
          xx: 2,
          xy: 0.5,
          xz: -0.25,
          yx: 0.5,
          yy: 3,
          yz: 0.75,
          zx: -0.25,
          zy: 0.75,
          zz: 4,
        },
        { x: 5, y: -2, z: 0.5 },
      ),
    ).toEqual({ x: -8.875, y: 3.125, z: 0.75 });
  });
});
