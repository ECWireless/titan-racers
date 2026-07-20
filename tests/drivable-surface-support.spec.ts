import { expect, test } from "@playwright/test";
import type * as pc from "playcanvas";

import {
  isCollisionLocalTopContact,
  isDrivableSurfaceTopContact,
  registerDrivableSurfaceSupportShape,
  type DrivableSurfaceSupportShape,
} from "../src/game/physics/drivable-surface-support";

function createTestVector(x: number, y: number, z: number): pc.Vec3 {
  return {
    clone() {
      return createTestVector(this.x, this.y, this.z);
    },
    x,
    y,
    z,
  } as pc.Vec3;
}

function createIdentityQuaternion(onClone: () => void): pc.Quat {
  const quaternion = {
    clone() {
      onClone();
      return createIdentityQuaternion(onClone);
    },
    invert() {
      return this;
    },
    setFromEulerAngles() {
      return this;
    },
    transformVector(input: pc.Vec3, output = createTestVector(0, 0, 0)) {
      output.x = input.x;
      output.y = input.y;
      output.z = input.z;
      return output;
    },
  };
  return quaternion as unknown as pc.Quat;
}

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

  test("classifies translated contacts with one rotation scratch clone", () => {
    let rotationCloneCount = 0;
    const entity = {
      getPosition: () => createTestVector(4, 2, -3),
      getRotation: () =>
        createIdentityQuaternion(() => {
          rotationCloneCount += 1;
        }),
    } as pc.Entity;
    const shape: DrivableSurfaceSupportShape = {
      angularOffset: { x: 0, y: 0, z: 0 },
      halfExtents: { x: 2, y: 0.25, z: 1 },
      linearOffset: { x: 0.3, y: 0.1, z: -0.2 },
      shape: "box",
    };
    registerDrivableSurfaceSupportShape(entity, shape);

    expect(
      isDrivableSurfaceTopContact(
        entity,
        createTestVector(4.3, 2.35, -3.2),
      ),
    ).toBe(true);
    expect(
      isDrivableSurfaceTopContact(
        entity,
        createTestVector(4.3, 2.1, -3.2),
      ),
    ).toBe(false);
    expect(rotationCloneCount).toBe(2);
  });

  test("preserves entity and collision-shape rotation order", async () => {
    const { Entity, Quat, Vec3 } = await import(
      "playcanvas/build/playcanvas/src/index.js"
    );
    const entity = new Entity("rotated support");
    const supportEntity = entity as unknown as pc.Entity;
    entity.setPosition(4, 2, -3);
    entity.setEulerAngles(0, 35, 0);
    const shape: DrivableSurfaceSupportShape = {
      angularOffset: { x: 12, y: 0, z: 8 },
      halfExtents: { x: 2, y: 0.25, z: 1 },
      linearOffset: { x: 0.3, y: 0.1, z: -0.2 },
      shape: "box",
    };
    registerDrivableSurfaceSupportShape(supportEntity, shape);

    const collisionLocalToWorld = (collisionLocalPoint: pc.Vec3) => {
      const entityLocalPoint = new Quat()
        .setFromEulerAngles(
          shape.angularOffset.x,
          shape.angularOffset.y,
          shape.angularOffset.z,
        )
        .transformVector(collisionLocalPoint);
      entityLocalPoint.add(
        new Vec3(
          shape.linearOffset.x,
          shape.linearOffset.y,
          shape.linearOffset.z,
        ),
      );
      return entity
        .getRotation()
        .transformVector(entityLocalPoint)
        .add(entity.getPosition());
    };

    expect(
      isDrivableSurfaceTopContact(
        supportEntity,
        collisionLocalToWorld(new Vec3(0, 0.25, 0)),
      ),
    ).toBe(true);
    expect(
      isDrivableSurfaceTopContact(
        supportEntity,
        collisionLocalToWorld(new Vec3(0, 0, 0)),
      ),
    ).toBe(false);
  });
});
