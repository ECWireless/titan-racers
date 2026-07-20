import { expect, test } from "@playwright/test";

import {
  isCollisionLocalTopContact,
  type DrivableSurfaceSupportShape,
} from "../src/game/physics/drivable-surface-support";

test.describe("drivable surface support", () => {
  test("accepts box tops while rejecting side and underside contacts", () => {
    const shape: DrivableSurfaceSupportShape = {
      angularOffset: { x: 0, y: 0, z: 0 },
      halfExtents: { x: 2, y: 0.25, z: 1 },
      linearOffset: { x: 0, y: 0.1, z: 0 },
      shape: "box",
    };

    expect(isCollisionLocalTopContact(shape, { x: 0, y: 0.25, z: 0 })).toBe(
      true,
    );
    expect(isCollisionLocalTopContact(shape, { x: 2, y: 0, z: 0 })).toBe(
      false,
    );
    expect(isCollisionLocalTopContact(shape, { x: 0, y: -0.25, z: 0 })).toBe(
      false,
    );
  });

  test("accepts only upward cylinder caps as drivable support", () => {
    const upright: DrivableSurfaceSupportShape = {
      angularOffset: { x: 0, y: 0, z: 0 },
      axis: 1,
      height: 0.4,
      linearOffset: { x: 0, y: 0, z: 0 },
      shape: "cylinder",
    };
    const sideways: DrivableSurfaceSupportShape = {
      angularOffset: { x: 0, y: 0, z: 0 },
      axis: 0,
      height: 0.4,
      linearOffset: { x: 0, y: 0, z: 0 },
      shape: "cylinder",
    };

    expect(isCollisionLocalTopContact(upright, { x: 0, y: 0.2, z: 0 })).toBe(
      true,
    );
    expect(isCollisionLocalTopContact(upright, { x: 1, y: 0, z: 0 })).toBe(
      false,
    );
    expect(isCollisionLocalTopContact(sideways, { x: 0.2, y: 0, z: 0 })).toBe(
      false,
    );
  });
});
