import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

import { FALLS_VIEW_PARK_DOCUMENT } from "../src/game/course/course-document";
import { getCourseDoorType } from "../src/game/course/course-door-types";
import {
  type AmmoDoorApi,
  type AmmoDoorBody,
  type CourseDoorEvent,
  CourseDoorJoint,
  getCourseDoorFrame,
} from "../src/game/course/course-doors";

// Door 4's leaf and latch on the vendored Ammo build, in its own frame: its
// tunnel face is local +Z, its hinge on the local −X edge, and it opens away
// from a kart coming from +Z. The kart is the Balanced kart's mass and box.
/* eslint-disable @typescript-eslint/no-explicit-any */
type Ammo = Record<string, any>;
const vendor = join(process.cwd(), "public/vendor/ammo");
let ammo: Ammo;
let world: any;

test.beforeAll(async () => {
  const factory = createRequire(__filename)(join(vendor, "ammo.wasm.js"));
  // The glue keeps its module on `this`, which a strict-mode call leaves unset.
  ammo = await factory.call(globalThis, {
    wasmBinary: readFileSync(join(vendor, "ammo.wasm.wasm")),
  });
  world = new ammo.btDiscreteDynamicsWorld(
    new ammo.btCollisionDispatcher(new ammo.btDefaultCollisionConfiguration()),
    new ammo.btDbvtBroadphase(),
    new ammo.btSequentialImpulseConstraintSolver(),
    new ammo.btDefaultCollisionConfiguration(),
  );
  world.setGravity(new ammo.btVector3(0, -9.81, 0));
});

const doorObject = FALLS_VIEW_PARK_DOCUMENT.objects.find(
  (object) => object.id === "tunnel-door-4",
)!;
const doorType = getCourseDoorType(doorObject.door!.type)!;
const doorCollision = doorObject.collision as Extract<
  NonNullable<typeof doorObject.collision>,
  { shape: "box" }
>;
const frame = getCourseDoorFrame(doorObject);
const KART = { halfExtents: [0.19, 0.0815, 0.2325], mass: 1.849 } as const;

function hang(door: any) {
  return new CourseDoorJoint(
    ammo as unknown as AmmoDoorApi,
    world,
    door as AmmoDoorBody,
    frame,
    doorType,
  );
}

function body(
  mass: number,
  shape: any,
  position: [number, number, number],
  yaw = 0,
) {
  const transform = new ammo.btTransform();
  transform.setIdentity();
  transform.setOrigin(new ammo.btVector3(...position));
  transform.setRotation(new ammo.btQuaternion(0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)));
  const inertia = new ammo.btVector3(0, 0, 0);
  shape.calculateLocalInertia(mass, inertia);
  const rigid = new ammo.btRigidBody(
    new ammo.btRigidBodyConstructionInfo(
      mass,
      new ammo.btDefaultMotionState(transform),
      shape,
      inertia,
    ),
  );
  world.addRigidBody(rigid);
  return rigid;
}

/**
 * Door 4's body as PlayCanvas builds it for a leaf at `leaf`, turned `yaw`
 * about up: its box collider, at the collider's offset from the leaf.
 */
function doorBody(leaf: [number, number, number], yaw = 0) {
  const { x, y, z } = doorCollision.halfExtents;
  const offset = doorCollision.offset.position;
  return body(
    doorType.mass,
    new ammo.btBoxShape(new ammo.btVector3(x, y, z)),
    [
      leaf[0] + offset.x * Math.cos(yaw) + offset.z * Math.sin(yaw),
      leaf[1] + offset.y,
      leaf[2] - offset.x * Math.sin(yaw) + offset.z * Math.cos(yaw),
    ],
    yaw,
  );
}

/** Where a point on the leaf, in the leaf's own frame, is in the world. */
function onLeaf(door: any, point: { x: number; y: number; z: number }) {
  const pose = door.getWorldTransform();
  const at = pose.getOrigin();
  const q = pose.getRotation();
  const offset = doorCollision.offset.position;
  const v = { x: point.x - offset.x, y: point.y - offset.y, z: point.z - offset.z };
  const [w, qx, qy, qz] = [q.w(), q.x(), q.y(), q.z()];
  const cx = qy * v.z - qz * v.y;
  const cy = qz * v.x - qx * v.z;
  const cz = qx * v.y - qy * v.x;
  return {
    x: at.x() + v.x + 2 * (w * cx + qy * cz - qz * cy),
    y: at.y() + v.y + 2 * (w * cy + qz * cx - qx * cz),
    z: at.z() + v.z + 2 * (w * cz + qx * cy - qy * cx),
  };
}

/** A hung door 4, and a kart that drives into it square at `x` across it. */
function scene() {
  const door = doorBody([0, 0, 0]);
  door.setFriction(0.5);
  const joint = hang(door);
  const kart = body(KART.mass, new ammo.btBoxShape(new ammo.btVector3(...KART.halfExtents)), [
    0, -0.9, 5,
  ]);
  kart.setFriction(0.12);
  kart.setRestitution(0.04);
  kart.setActivationState(4);
  // The kart flies level, free of gravity, like a kart driving on the floor.
  kart.setFlags(1);
  kart.setGravity(new ammo.btVector3(0, 0, 0));

  const place = (x: number) => {
    const transform = new ammo.btTransform();
    transform.setIdentity();
    transform.setOrigin(new ammo.btVector3(x, -0.9, 0.0225 + KART.halfExtents[2] + 0.05));
    kart.setWorldTransform(transform);
    kart.getMotionState().setWorldTransform(transform);
    kart.setAngularVelocity(new ammo.btVector3(0, 0, 0));
  };
  const run = (
    seconds: number,
    substeps: number,
    drive?: (step: number) => void,
  ): CourseDoorEvent[] => {
    const events: CourseDoorEvent[] = [];
    joint.setSubstepSeconds(1 / 120 / substeps);
    for (let step = 0; step < seconds * 120; step += 1) {
      drive?.(step);
      world.stepSimulation(1 / 120, substeps, 1 / 120 / substeps);
      const event = joint.step(1 / 120);
      if (event) events.push(event);
    }
    return events;
  };
  const hit = (x: number, speed: number, substeps = 4) => {
    place(x);
    kart.setLinearVelocity(new ammo.btVector3(0, 0, -speed));
    return run(1, substeps);
  };
  const remove = () => {
    joint.destroy();
    world.removeRigidBody(door);
    world.removeRigidBody(kart);
  };
  return { door, hit, joint, kart, place, remove, run };
}

test("door 4 is a worn steel door hung on its north edge, opening into the store room", () => {
  expect(doorType).toEqual({ hingeFriction: 2, latchImpulse: 5.5, mass: 40 });
  expect(frame).toMatchObject({ axis: 1, stop: Math.PI / 2, width: 1 });
  // The leaf's hinge edge on its back face, in its body's frame: 27.5 mm
  // behind the leaf, where its collider sits.
  expect(frame.hinge.x).toBe(-0.5);
  expect(frame.hinge.z).toBeCloseTo(-0.0225 + 0.0275, 9);
});

test("a door turned on the course hangs closed and latched", () => {
  // Door 4 is turned 90° about the habitat's up, as on the course.
  const door = doorBody([78.7275, 1.05, -22], Math.PI / 2);
  const joint = hang(door);
  for (let step = 0; step < 60; step += 1) {
    world.stepSimulation(1 / 120, 1, 1 / 120);
    joint.step(1 / 120);
  }
  expect(joint.latched).toBe(true);
  expect(Math.abs(joint.openAngle)).toBeLessThan(0.002);
  joint.destroy();
  world.removeRigidBody(door);
});

test("the latch holds a 3.5 m/s square hit and gives to a 5 m/s one at any substep count", () => {
  for (const substeps of [1, 2, 4, 8]) {
    const { hit, joint, remove } = scene();
    hit(0.25, 3.5, substeps);
    expect(joint.latched).toBe(true);
    expect(joint.openAngle).toBeLessThan(0.01);
    const events = hit(0.25, 5, substeps);
    expect(joint.latched).toBe(false);
    expect(events[0]?.kind).toBe("unlatched");
    remove();
  }
});

test("a push at full drive force, or a hard hit beside the hinge, never opens it", () => {
  const { hit, joint, kart, place, remove, run } = scene();
  place(0.25);
  // The Speed kart's drive force at a standstill is about 34 N.
  run(2, 1, () => kart.applyCentralForce(new ammo.btVector3(0, 0, -34)));
  expect(joint.latched).toBe(true);
  hit(-0.4, 12);
  expect(joint.latched).toBe(true);
  remove();
});

test("a hard hit swings it to its stop, and a reset closes and latches it again", () => {
  const { hit, joint, remove, run } = scene();
  const events = [...hit(0.25, 17), ...run(2, 4)];
  expect(events.map((event) => event.kind)).toEqual(["unlatched", "stopped"]);
  // It rests within about 15° of its rubber stop, having bounced off it.
  expect(joint.openAngle).toBeGreaterThan(frame.stop - 0.26);

  joint.reset();
  expect(joint.latched).toBe(true);
  expect(joint.openAngle).toBe(0);
  run(0.1, 1);
  expect(Math.abs(joint.openAngle)).toBeLessThan(0.002);
  hit(0.25, 3.5);
  expect(joint.latched).toBe(true);
  remove();
});

test("another page's opening swings it to its stop as it swung there, or sets it at rest", () => {
  // Turned as on the course, so the hinge's world axis is not the leaf's own.
  const door = doorBody([78.7275, 1.05, -22], Math.PI / 2);
  const joint = hang(door);
  // The leaf's hinge edge stays where it is drawn as the leaf turns.
  const edge = { x: -0.5, y: 0.8, z: -0.0225 };
  const hingeEdge = onLeaf(door, edge);
  const stays = () => {
    const now = onLeaf(door, edge);
    expect(
      Math.hypot(now.x - hingeEdge.x, now.y - hingeEdge.y, now.z - hingeEdge.z),
    ).toBeLessThan(0.003);
  };
  const run = (seconds: number) => {
    const events: CourseDoorEvent[] = [];
    for (let step = 0; step < seconds * 120; step += 1) {
      world.stepSimulation(1 / 120, 1, 1 / 120);
      const event = joint.step(1 / 120);
      if (event) events.push(event);
    }
    return events;
  };
  joint.open(3);
  const swing = run(0.05);
  expect(swing[0]).toEqual({ kind: "unlatched", speed: 3, remote: true });
  expect(joint.latched).toBe(false);
  // Its free edge moves at about the given speed, the hinge holding its pin.
  expect(joint.openAngle).toBeGreaterThan(0.05 * 3 * 0.8);
  expect(joint.openAngle).toBeLessThan(0.05 * 3 * 1.1);
  const events = run(2);
  expect(events.map(({ kind }) => kind)).toContain("stopped");
  expect(joint.openAngle).toBeGreaterThan(frame.stop - 0.26);
  stays();

  joint.reset();
  joint.open(null);
  expect(joint.latched).toBe(false);
  expect(run(0.5)).toEqual([]);
  expect(Math.abs(joint.openAngle - frame.stop)).toBeLessThan(0.02);
  stays();
  joint.destroy();
  world.removeRigidBody(door);
});
