import * as pc from "playcanvas";

import { PHYSICS_GROUP, PHYSICS_MASK } from "../physics/collision-groups";
import type { CourseDocument, CourseObject } from "./course-document";
import { type CourseDoorType, getCourseDoorType } from "./course-door-types";

// Course doors (the course interactables standard): a dynamic leaf on an
// Ammo hinge, held shut by a breakable point-to-point latch. See
// skills/tools/playcanvas-ammo/constraints for the engine's behaviour.

type Vec3 = { x: number; y: number; z: number };

/** The few Ammo calls a door makes, so tests can drive real Ammo in Node. */
type AmmoVector3 = { x(): number; y(): number; z(): number };
type AmmoQuaternion = AmmoVector3 & { w(): number };
type AmmoTransform = { getOrigin(): AmmoVector3; getRotation(): AmmoQuaternion };
export type AmmoDoorBody = {
  activate(force?: boolean): void;
  getAngularVelocity(): AmmoVector3;
  getMotionState(): { setWorldTransform(transform: AmmoTransform): void };
  getWorldTransform(): AmmoTransform;
  setAngularVelocity(velocity: object): void;
  setFlags(flags: number): void;
  setGravity(gravity: object): void;
  setInterpolationAngularVelocity(velocity: object): void;
  setInterpolationLinearVelocity(velocity: object): void;
  setInterpolationWorldTransform(transform: AmmoTransform): void;
  setLinearVelocity(velocity: object): void;
  setWorldTransform(transform: AmmoTransform): void;
};
type AmmoConstraint = { setBreakingImpulseThreshold(impulse: number): void };
type AmmoHinge = AmmoConstraint & {
  enableAngularMotor(enable: boolean, velocity: number, maxImpulse: number): void;
  getHingeAngle(): number;
  setLimit(
    low: number,
    high: number,
    softness: number,
    bias: number,
    relaxation: number,
  ): void;
};
export type AmmoDoorApi = {
  btDefaultMotionState: new (transform: AmmoTransform) => object;
  btHingeConstraint: new (
    body: AmmoDoorBody,
    anchor: object,
    frame: AmmoTransform,
    anchorFrame: AmmoTransform,
    useReferenceFrameA: boolean,
  ) => AmmoHinge;
  btRigidBody: new (info: object) => object;
  btRigidBodyConstructionInfo: new (
    mass: number,
    motionState: object,
    shape: object,
    inertia: object,
  ) => object;
  btSphereShape: new (radius: number) => object;
  btPoint2PointConstraint: new (body: AmmoDoorBody, pivot: object) => AmmoConstraint;
  btQuaternion: new (x: number, y: number, z: number, w: number) => object;
  btTransform: new () => AmmoTransform & {
    setIdentity(): void;
    setOrigin(origin: object): void;
    setRotation(rotation: object): void;
  };
  btVector3: new (x: number, y: number, z: number) => object;
  destroy(object: object): void;
};
export type AmmoDoorWorld = {
  addConstraint(constraint: object, disableCollisionsBetweenLinkedBodies: boolean): void;
  removeConstraint(constraint: object): void;
};

/** Where a door's hinge and latch sit, in its leaf's unscaled local frame. */
export type CourseDoorFrame = {
  /** +1 when opening turns the leaf positively about local +Y. */
  axis: 1 | -1;
  hinge: Vec3;
  latch: Vec3;
  /** The opening stop, radians. */
  stop: number;
  /** Hinge to latch edge, metres. */
  width: number;
};

// Bullet's default hinge softness, bias, and relaxation.
const LIMIT = { bias: 0.3, relaxation: 1, softness: 0.9 } as const;
// The latch holds this far in from the leaf's free edge.
const LATCH_INSET = 0.05;
// Past this angle, the latch has given.
const UNLATCHED_ANGLE = (1 * Math.PI) / 180;
// Within this of a stop, the leaf is on it.
const STOP_ZONE = (0.5 * Math.PI) / 180;
// The leaf's free edge meets a stop at least this fast to sound, m/s.
const STOP_SOUND_SPEED = 0.1;
// Bullet's BT_DISABLE_WORLD_GRAVITY rigid-body flag.
const DISABLE_WORLD_GRAVITY = 1;

/**
 * The hinge pin runs up the leaf's hinge edge on the face it opens toward,
 * where a door's knuckles are; the latch holds the free edge at mid-height.
 */
export function getCourseDoorFrame(
  object: Pick<CourseObject, "door" | "visual">,
): CourseDoorFrame {
  const { door, visual } = object;
  if (!door || visual.shape !== "box") throw new Error("Not a door");
  const side = door.hinge === "left" ? -1 : 1;
  const face = door.opens === "front" ? 1 : -1;
  const { x: width, z: thickness } = visual.scale;
  return {
    axis: side === face ? 1 : -1,
    hinge: { x: (side * width) / 2, y: 0, z: (face * thickness) / 2 },
    latch: { x: -side * (width / 2 - LATCH_INSET), y: 0, z: 0 },
    stop: (door.stop * Math.PI) / 180,
    width,
  };
}

export type CourseDoorEvent =
  /**
   * The latch gave; `speed` is the free edge's, m/s. `remote` when another
   * page's kart opened it (`open`).
   */
  | { kind: "unlatched"; speed: number; remote?: true }
  /** The leaf met its open stop or its frame. */
  | { kind: "stopped"; speed: number };

/** One door's hinge and latch on its Ammo body. */
export class CourseDoorJoint {
  private readonly anchor: object[];
  private readonly closed: AmmoTransform;
  private readonly hinge: AmmoHinge;
  private latch: AmmoConstraint | null = null;
  private angle = 0;
  private atStop = true;
  private speed = 0;
  /** An opening `open` set swinging, reported on the next step. */
  private pending: CourseDoorEvent | null = null;

  constructor(
    private readonly ammo: AmmoDoorApi,
    private readonly world: AmmoDoorWorld,
    private readonly body: AmmoDoorBody,
    private readonly frame: CourseDoorFrame,
    private readonly type: CourseDoorType,
  ) {
    // The door is hung plumb, so gravity turns nothing about its hinge: it
    // takes none, whichever way the habitat pulls the kart.
    body.setFlags(DISABLE_WORLD_GRAVITY);
    this.withVector(0, 0, 0, (zero) => body.setGravity(zero));
    const pose = body.getWorldTransform();
    const closed = new ammo.btTransform();
    closed.setOrigin(pose.getOrigin());
    closed.setRotation(pose.getRotation());
    this.closed = closed;

    // Bullet's hinge turns about its frame's Z: turn the frame's Z onto
    // local ±Y, so opening reads as a positive angle from the closed pose.
    // Its one-body form keeps the world's frame unrotated, so a turned door
    // would read its turn as open: the hinge holds to a fixed anchor body
    // instead, by the same frame in the world.
    const half = (-frame.axis * Math.PI) / 4;
    const local = { w: Math.cos(half), x: Math.sin(half), y: 0, z: 0 };
    const turn = pose.getRotation();
    const at = pose.getOrigin();
    const placed = {
      w: turn.w(),
      x: turn.x(),
      y: turn.y(),
      z: turn.z(),
    };
    const pin = rotate(placed, frame.hinge);
    const frames = [
      transform(ammo, frame.hinge, local),
      transform(
        ammo,
        { x: at.x() + pin.x, y: at.y() + pin.y, z: at.z() + pin.z },
        multiply(placed, local),
      ),
    ];
    const anchorPose = new ammo.btTransform();
    anchorPose.setIdentity();
    const motionState = new ammo.btDefaultMotionState(anchorPose);
    const shape = new ammo.btSphereShape(1e-3);
    const inertia = new ammo.btVector3(0, 0, 0);
    const info = new ammo.btRigidBodyConstructionInfo(0, motionState, shape, inertia);
    const anchor = new ammo.btRigidBody(info);
    [anchorPose, inertia, info].forEach((allocation) => ammo.destroy(allocation));
    this.anchor = [anchor, motionState, shape];
    this.hinge = new ammo.btHingeConstraint(body, anchor, frames[0], frames[1], false);
    frames.forEach((allocation) => ammo.destroy(allocation));
    this.hinge.setLimit(0, frame.stop, LIMIT.softness, LIMIT.bias, LIMIT.relaxation);
    world.addConstraint(this.hinge, true);
    this.setSubstepSeconds(1 / 120);
    this.addLatch();
  }

  get latched() {
    return this.latch !== null;
  }

  /** The opening angle, radians: 0 closed. */
  get openAngle() {
    return this.angle;
  }

  /**
   * Hinge friction is a motor holding zero speed, whose limit is an impulse
   * per solve: set it from each fixed step's substep length.
   */
  setSubstepSeconds(seconds: number) {
    this.hinge.enableAngularMotor(true, 0, this.type.hingeFriction * seconds);
  }

  /** After each fixed step: what the door did. */
  step(stepSeconds: number): CourseDoorEvent | null {
    const previous = this.angle;
    this.angle = this.hinge.getHingeAngle();
    const speed = (Math.abs(this.angle - previous) / stepSeconds) * this.frame.width;
    let event: CourseDoorEvent | null = this.pending;
    this.pending = null;
    if (this.latch && this.angle > UNLATCHED_ANGLE) {
      // A broken constraint can't be re-enabled here; it is replaced on reset.
      this.removeLatch();
      event = { kind: "unlatched", speed };
    }
    const onStop =
      this.angle > this.frame.stop - STOP_ZONE ||
      (!this.latch && this.angle < STOP_ZONE);
    if (onStop && !this.atStop && this.speed >= STOP_SOUND_SPEED) {
      event ??= { kind: "stopped", speed: this.speed };
    }
    this.atStop = onStop;
    this.speed = speed;
    return event;
  }

  /**
   * Opens the door as another page's kart did: its latch gone, and its leaf
   * swinging open with its free edge at `swing` m/s, or at rest on its stop
   * (null). A latched door only; a swing reports its unlatching next step.
   */
  open(swing: number | null) {
    if (!this.latch) return;
    this.removeLatch();
    const origin = this.closed.getOrigin();
    const turn = this.closed.getRotation();
    const closed = { w: turn.w(), x: turn.x(), y: turn.y(), z: turn.z() };
    const at = { x: origin.x(), y: origin.y(), z: origin.z() };
    // Opening turns the leaf positively about this world axis, at its pin.
    const axis = rotate(closed, { x: 0, y: this.frame.axis, z: 0 });
    const offset = rotate(closed, this.frame.hinge);
    const pin = { x: at.x + offset.x, y: at.y + offset.y, z: at.z + offset.z };
    const arm = { x: at.x - pin.x, y: at.y - pin.y, z: at.z - pin.z };
    const { body } = this;
    if (swing === null) {
      const half = this.frame.stop / 2;
      const sin = Math.sin(half);
      const opening = { w: Math.cos(half), x: axis.x * sin, y: axis.y * sin, z: axis.z * sin };
      const moved = rotate(opening, arm);
      const pose = transform(
        this.ammo,
        { x: pin.x + moved.x, y: pin.y + moved.y, z: pin.z + moved.z },
        multiply(opening, closed),
      );
      body.setWorldTransform(pose);
      body.setInterpolationWorldTransform(pose);
      body.getMotionState().setWorldTransform(pose);
      this.ammo.destroy(pose);
      this.withVector(0, 0, 0, (zero) => {
        body.setLinearVelocity(zero);
        body.setAngularVelocity(zero);
        body.setInterpolationLinearVelocity(zero);
        body.setInterpolationAngularVelocity(zero);
      });
      this.angle = this.frame.stop;
      this.atStop = true;
      this.speed = 0;
    } else {
      const rate = swing / this.frame.width;
      const spin = { x: axis.x * rate, y: axis.y * rate, z: axis.z * rate };
      this.withVector(spin.x, spin.y, spin.z, (vector) => body.setAngularVelocity(vector));
      // The leaf's centre swings about the pin: spin × arm.
      this.withVector(
        spin.y * arm.z - spin.z * arm.y,
        spin.z * arm.x - spin.x * arm.z,
        spin.x * arm.y - spin.y * arm.x,
        (vector) => body.setLinearVelocity(vector),
      );
      this.pending = { kind: "unlatched", speed: swing, remote: true };
    }
    body.activate(true);
  }

  /** Closes and latches the door, at rest. */
  reset() {
    this.pending = null;
    this.removeLatch();
    const { body } = this;
    body.setWorldTransform(this.closed);
    body.setInterpolationWorldTransform(this.closed);
    body.getMotionState().setWorldTransform(this.closed);
    this.withVector(0, 0, 0, (zero) => {
      body.setLinearVelocity(zero);
      body.setAngularVelocity(zero);
      body.setInterpolationLinearVelocity(zero);
      body.setInterpolationAngularVelocity(zero);
    });
    body.activate();
    this.angle = 0;
    this.atStop = true;
    this.speed = 0;
    this.addLatch();
  }

  destroy() {
    this.removeLatch();
    this.world.removeConstraint(this.hinge);
    this.ammo.destroy(this.hinge);
    this.ammo.destroy(this.closed);
    this.anchor.forEach((allocation) => this.ammo.destroy(allocation));
  }

  private addLatch() {
    const { x, y, z } = this.frame.latch;
    this.withVector(x, y, z, (pivot) => {
      this.latch = new this.ammo.btPoint2PointConstraint(this.body, pivot);
    });
    this.latch!.setBreakingImpulseThreshold(this.type.latchImpulse);
    this.world.addConstraint(this.latch!, true);
  }

  private removeLatch() {
    if (!this.latch) return;
    this.world.removeConstraint(this.latch);
    this.ammo.destroy(this.latch);
    this.latch = null;
  }

  private withVector(x: number, y: number, z: number, apply: (vector: object) => void) {
    const vector = new this.ammo.btVector3(x, y, z);
    try {
      apply(vector);
    } finally {
      this.ammo.destroy(vector);
    }
  }
}

type Quaternion = { w: number; x: number; y: number; z: number };

function multiply(a: Quaternion, b: Quaternion): Quaternion {
  return {
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  };
}

function rotate({ w, x, y, z }: Quaternion, v: Vec3): Vec3 {
  // v + 2w(u × v) + 2u × (u × v), for u the quaternion's vector part.
  const cx = y * v.z - z * v.y;
  const cy = z * v.x - x * v.z;
  const cz = x * v.y - y * v.x;
  return {
    x: v.x + 2 * (w * cx + y * cz - z * cy),
    y: v.y + 2 * (w * cy + z * cx - x * cz),
    z: v.z + 2 * (w * cz + x * cy - y * cx),
  };
}

function transform(ammo: AmmoDoorApi, origin: Vec3, rotation: Quaternion) {
  const result = new ammo.btTransform();
  const vector = new ammo.btVector3(origin.x, origin.y, origin.z);
  const quaternion = new ammo.btQuaternion(rotation.x, rotation.y, rotation.z, rotation.w);
  result.setIdentity();
  result.setOrigin(vector);
  result.setRotation(quaternion);
  ammo.destroy(vector);
  ammo.destroy(quaternion);
  return result;
}

// PlayCanvas's reparent keeps the local pose; a carried part keeps its world
// pose, and its own scale under the unscaled body.
function carry(body: pc.Entity, entity: pc.Entity) {
  const position = entity.getPosition().clone();
  const rotation = entity.getRotation().clone();
  entity.reparent(body);
  entity.setPosition(position);
  entity.setRotation(rotation);
}

export type CourseDoorStep = CourseDoorEvent & { id: string; position: Vec3 };

export type CourseDoors = {
  /** Each door's state, for tests. */
  describe(): Array<{ id: string; lampLit: boolean; latched: boolean; openAngle: number }>;
  /** Doors, their parts, and their lamps: drawn apart from the static batch. */
  movingIds: ReadonlySet<string>;
  setSubstepSeconds(seconds: number): void;
  /** After each fixed step: what each door did. */
  step(stepSeconds: number): CourseDoorStep[];
  /**
   * Opens a latched door as another page's kart did, swinging (free edge,
   * m/s) or at rest on its stop (null), and lights its lamp.
   */
  open(id: string, swing: number | null): void;
  /** Every door closed and latched, its lamp dark: a race's start. */
  reset(): void;
  destroy(): void;
};

/**
 * Hangs each door of a built course on its hinge: the builder's static door
 * becomes the leaf of a dynamic body named for it, carrying its parts, that
 * only karts touch. Each door's lamp lights once it opens. Null without doors.
 */
export function addCourseDoors(
  app: pc.AppBase,
  document: CourseDocument,
  entities: ReadonlyMap<string, pc.Entity>,
): CourseDoors | null {
  const doors = document.objects.filter((object) => object.door);
  if (doors.length === 0) return null;
  const ammo = (globalThis as typeof globalThis & { Ammo?: AmmoDoorApi }).Ammo;
  const world = app.systems.rigidbody?.dynamicsWorld as AmmoDoorWorld | undefined;
  if (!ammo || !world) throw new Error("Ammo is unavailable for course doors");

  const movingIds = new Set<string>();
  const hung = doors.flatMap((object) => {
    const door = object.door!;
    const type = getCourseDoorType(door.type);
    const leaf = entities.get(object.id);
    if (!type || !leaf || object.collision?.shape !== "box") return [];
    const { collision, transform } = object;
    leaf.removeComponent("rigidbody");
    leaf.removeComponent("collision");
    leaf.tags.remove("obstacle");
    const body = new pc.Entity(object.id);
    body.setPosition(transform.position.x, transform.position.y, transform.position.z);
    body.setEulerAngles(transform.rotation.x, transform.rotation.y, transform.rotation.z);
    app.root.addChild(body);
    leaf.name = `${object.id}-leaf`;
    carry(body, leaf);
    movingIds.add(object.id);
    document.objects.forEach((part) => {
      const entity = part.attachedTo === object.id ? entities.get(part.id) : null;
      if (!entity) return;
      carry(body, entity);
      movingIds.add(part.id);
    });
    const { offset } = collision;
    body.addComponent("collision", {
      angularOffset: new pc.Quat().setFromEulerAngles(
        offset.rotation.x,
        offset.rotation.y,
        offset.rotation.z,
      ),
      halfExtents: new pc.Vec3(
        collision.halfExtents.x,
        collision.halfExtents.y,
        collision.halfExtents.z,
      ),
      linearOffset: new pc.Vec3(offset.position.x, offset.position.y, offset.position.z),
      type: "box",
    });
    body.addComponent("rigidbody", {
      angularDamping: 0,
      friction: collision.friction,
      group: PHYSICS_GROUP.solidObstacle,
      linearDamping: 0,
      // Only karts touch a door: it swings past its frame and walls.
      mask: PHYSICS_MASK.solidObstacle,
      mass: type.mass,
      restitution: collision.restitution,
      type: pc.BODYTYPE_DYNAMIC,
    });
    body.tags.add("obstacle");
    // The body takes the entity's pose before its hinge is fixed to it.
    body.rigidbody!.teleport(body.getPosition(), body.getRotation());
    const joint = new CourseDoorJoint(
      ammo,
      world,
      body.rigidbody!.body as unknown as AmmoDoorBody,
      getCourseDoorFrame(object),
      type,
    );
    const lamp = door.lamp ? entities.get(door.lamp) : undefined;
    if (door.lamp && lamp) movingIds.add(door.lamp);
    const glow = lamp
      ? [`${door.lamp}-lens`, `${door.lamp}-light`].flatMap(
          (name) => (lamp.findByName(name) as pc.Entity | null) ?? [],
        )
      : [];
    const light = (on: boolean) => glow.forEach((entity) => (entity.enabled = on));
    light(false);
    return [{ body, glow, id: object.id, joint, light }];
  });

  return {
    describe() {
      return hung.map(({ glow, id, joint }) => ({
        id,
        lampLit: glow.length > 0 && glow.every((entity) => entity.enabled),
        latched: joint.latched,
        openAngle: joint.openAngle,
      }));
    },
    movingIds,
    setSubstepSeconds(seconds) {
      hung.forEach(({ joint }) => joint.setSubstepSeconds(seconds));
    },
    step(stepSeconds) {
      return hung.flatMap(({ body, id, joint, light }) => {
        const event = joint.step(stepSeconds);
        if (!event) return [];
        if (event.kind === "unlatched") light(true);
        const { x, y, z } = body.getPosition();
        return [{ ...event, id, position: { x, y, z } }];
      });
    },
    open(id, swing) {
      const door = hung.find((candidate) => candidate.id === id);
      if (!door?.joint.latched) return;
      door.joint.open(swing);
      door.light(true);
    },
    reset() {
      hung.forEach(({ joint, light }) => {
        joint.reset();
        light(false);
      });
    },
    destroy() {
      hung.forEach(({ joint }) => joint.destroy());
    },
  };
}
