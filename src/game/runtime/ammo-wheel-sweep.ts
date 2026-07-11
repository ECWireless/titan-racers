import * as pc from "playcanvas";

import { PHYSICS_GROUP, PHYSICS_MASK } from "../physics/collision-groups";

type AmmoPointer = object;

type AmmoVector3 = AmmoPointer & {
  setValue: (x: number, y: number, z: number) => void;
  x: () => number;
  y: () => number;
  z: () => number;
};

type AmmoQuaternion = AmmoPointer & {
  setValue: (x: number, y: number, z: number, w: number) => void;
};

type AmmoTransform = AmmoPointer & {
  setIdentity: () => void;
  setOrigin: (origin: AmmoVector3) => void;
  setRotation: (rotation: AmmoQuaternion) => void;
};

type AmmoCollisionObject = AmmoPointer & {
  entity?: pc.Entity;
};

type AmmoSweepCallback = AmmoPointer & {
  get_m_closestHitFraction: () => number;
  get_m_hitCollisionObject: () => AmmoCollisionObject;
  get_m_hitNormalWorld: () => AmmoVector3;
  get_m_hitPointWorld: () => AmmoVector3;
  hasHit: () => boolean;
  set_m_closestHitFraction: (fraction: number) => void;
  set_m_collisionFilterGroup: (group: number) => void;
  set_m_collisionFilterMask: (mask: number) => void;
  set_m_convexFromWorld: (from: AmmoVector3) => void;
  set_m_convexToWorld: (to: AmmoVector3) => void;
  set_m_hitCollisionObject: (object: number) => void;
};

type AmmoDynamicsWorld = {
  convexSweepTest: (
    shape: AmmoPointer,
    from: AmmoTransform,
    to: AmmoTransform,
    callback: AmmoSweepCallback,
    allowedPenetration: number,
  ) => void;
};

type AmmoApi = {
  ClosestConvexResultCallback: new (
    from: AmmoVector3,
    to: AmmoVector3,
  ) => AmmoSweepCallback;
  btCylinderShapeX: new (halfExtents: AmmoVector3) => AmmoPointer;
  btQuaternion: new (
    x: number,
    y: number,
    z: number,
    w: number,
  ) => AmmoQuaternion;
  btTransform: new () => AmmoTransform;
  btVector3: new (x: number, y: number, z: number) => AmmoVector3;
  castObject: (
    object: AmmoCollisionObject,
    type: unknown,
  ) => AmmoCollisionObject;
  btRigidBody: unknown;
  destroy: (allocation: AmmoPointer) => void;
};

export type WheelSweepHit = {
  entity: pc.Entity;
  fraction: number;
  normal: pc.Vec3;
  point: pc.Vec3;
};

export class AmmoWheelSweep {
  private readonly ammo: AmmoApi;
  private readonly callback: AmmoSweepCallback;
  private readonly fromOrigin: AmmoVector3;
  private readonly fromTransform: AmmoTransform;
  private readonly halfExtents: AmmoVector3;
  private readonly rotation: AmmoQuaternion;
  private readonly shape: AmmoPointer;
  private readonly toOrigin: AmmoVector3;
  private readonly toTransform: AmmoTransform;
  private destroyed = false;

  constructor(
    private readonly world: AmmoDynamicsWorld,
    radius: number,
    halfWidth: number,
  ) {
    const ammo = (globalThis as typeof globalThis & { Ammo?: AmmoApi }).Ammo;

    if (!ammo) {
      throw new Error("Ammo must be initialized before creating wheel sweeps");
    }

    if (radius <= 0 || halfWidth <= 0) {
      throw new Error("Wheel sweep dimensions must be positive");
    }

    this.ammo = ammo;
    this.fromOrigin = new ammo.btVector3(0, 0, 0);
    this.toOrigin = new ammo.btVector3(0, 0, 0);
    this.rotation = new ammo.btQuaternion(0, 0, 0, 1);
    this.fromTransform = new ammo.btTransform();
    this.toTransform = new ammo.btTransform();
    this.halfExtents = new ammo.btVector3(halfWidth, radius, radius);
    this.shape = new ammo.btCylinderShapeX(this.halfExtents);
    this.callback = new ammo.ClosestConvexResultCallback(
      this.fromOrigin,
      this.toOrigin,
    );
    this.callback.set_m_collisionFilterGroup(PHYSICS_GROUP.wheelProbe);
    this.callback.set_m_collisionFilterMask(PHYSICS_MASK.wheelSupport);
  }

  sweep(from: pc.Vec3, to: pc.Vec3, rotation: pc.Quat): WheelSweepHit | null {
    if (this.destroyed) {
      throw new Error("Cannot use a destroyed wheel sweep");
    }

    this.fromOrigin.setValue(from.x, from.y, from.z);
    this.toOrigin.setValue(to.x, to.y, to.z);
    this.rotation.setValue(rotation.x, rotation.y, rotation.z, rotation.w);
    this.fromTransform.setIdentity();
    this.fromTransform.setOrigin(this.fromOrigin);
    this.fromTransform.setRotation(this.rotation);
    this.toTransform.setIdentity();
    this.toTransform.setOrigin(this.toOrigin);
    this.toTransform.setRotation(this.rotation);
    this.callback.set_m_convexFromWorld(this.fromOrigin);
    this.callback.set_m_convexToWorld(this.toOrigin);
    this.callback.set_m_closestHitFraction(1);
    this.callback.set_m_hitCollisionObject(0);
    this.world.convexSweepTest(
      this.shape,
      this.fromTransform,
      this.toTransform,
      this.callback,
      0,
    );

    if (!this.callback.hasHit()) {
      return null;
    }

    const collisionObject = this.callback.get_m_hitCollisionObject();
    const body = this.ammo.castObject(collisionObject, this.ammo.btRigidBody);
    const entity = body.entity;

    if (!entity) {
      return null;
    }

    const point = this.callback.get_m_hitPointWorld();
    const normal = this.callback.get_m_hitNormalWorld();

    return {
      entity,
      fraction: this.callback.get_m_closestHitFraction(),
      normal: new pc.Vec3(normal.x(), normal.y(), normal.z()).normalize(),
      point: new pc.Vec3(point.x(), point.y(), point.z()),
    };
  }

  destroy() {
    if (this.destroyed) {
      return;
    }

    this.destroyed = true;
    [
      this.callback,
      this.shape,
      this.halfExtents,
      this.toTransform,
      this.fromTransform,
      this.rotation,
      this.toOrigin,
      this.fromOrigin,
    ].forEach((allocation) => this.ammo.destroy(allocation));
  }
}

export function requireAmmoDynamicsWorld(app: pc.Application) {
  const world = app.systems.rigidbody?.dynamicsWorld as
    | AmmoDynamicsWorld
    | undefined;

  if (!world) {
    throw new Error("PlayCanvas Ammo dynamics world is unavailable");
  }

  return world;
}
