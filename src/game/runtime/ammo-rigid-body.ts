import type * as pc from "playcanvas";

import type { Position3 } from "../contracts";

type AmmoRigidBody = {
  setMassProps: (mass: number, inertia: AmmoVector3) => void;
  updateInertiaTensor: () => void;
};

type AmmoVector3 = object;

type AmmoApi = {
  btVector3: new (x: number, y: number, z: number) => AmmoVector3;
  destroy: (allocation: AmmoVector3) => void;
};

export function calculateBoxInertia(
  mass: number,
  dimensions: Position3,
): Position3 {
  const factor = mass / 12;

  return {
    x: factor * (dimensions.y ** 2 + dimensions.z ** 2),
    y: factor * (dimensions.x ** 2 + dimensions.z ** 2),
    z: factor * (dimensions.x ** 2 + dimensions.y ** 2),
  };
}

export function setExplicitRigidBodyInertia(
  entity: pc.Entity,
  mass: number,
  inertia: Position3,
) {
  const rigidBody = entity.rigidbody;
  const body = rigidBody?.body as AmmoRigidBody | undefined;
  const ammo = (globalThis as typeof globalThis & { Ammo?: AmmoApi }).Ammo;

  if (!rigidBody || !body || !ammo) {
    throw new Error(
      `Entity ${entity.name} requires an initialized Ammo rigid body`,
    );
  }

  // Ammo allocations are not garbage-collected. This adapter owns and destroys
  // the temporary vector before returning; no Ammo object escapes this boundary.
  const ammoInertia = new ammo.btVector3(inertia.x, inertia.y, inertia.z);

  try {
    body.setMassProps(mass, ammoInertia);
    body.updateInertiaTensor();
    rigidBody.activate();
  } finally {
    ammo.destroy(ammoInertia);
  }
}
