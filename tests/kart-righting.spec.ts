import { expect, test } from "@playwright/test";

import {
  getManualRightingAxis,
  getManualRightingTorqueScale,
} from "../src/game/kart/kart-righting";

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
});
