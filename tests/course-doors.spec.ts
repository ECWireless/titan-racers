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

/** A hung door 4, and a kart that drives into it square at `x` across it. */
function scene() {
  const shape = new ammo.btCompoundShape();
  const offset = new ammo.btTransform();
  offset.setIdentity();
  offset.setOrigin(new ammo.btVector3(0, 0, doorCollision.offset.position.z));
  const { x, y, z } = doorCollision.halfExtents;
  shape.addChildShape(offset, new ammo.btBoxShape(new ammo.btVector3(x, y, z)));
  const door = body(doorType.mass, shape, [0, 0, 0]);
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
  expect(doorType).toEqual({ hingeFriction: 2, latchImpulse: 10.5, mass: 40 });
  expect(frame).toMatchObject({ axis: 1, stop: Math.PI / 2, width: 1 });
  expect(frame.hinge).toEqual({ x: -0.5, y: 0, z: -0.0225 });
});

test("a door turned on the course hangs closed and latched", () => {
  // Door 4 is turned 90° about the habitat's up, as on the course.
  const door = body(doorType.mass, new ammo.btBoxShape(new ammo.btVector3(0.5, 1.05, 0.05)), [
    78.7275, 1.05, -22,
  ], Math.PI / 2);
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

test("the latch holds a 6.5 m/s square hit and gives to an 8.5 m/s one at any substep count", () => {
  for (const substeps of [1, 2, 4, 8]) {
    const { hit, joint, remove } = scene();
    hit(0.25, 6.5, substeps);
    expect(joint.latched).toBe(true);
    expect(joint.openAngle).toBeLessThan(0.01);
    const events = hit(0.25, 8.5, substeps);
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
  // It rests within a few degrees of its rubber stop, having bounced off.
  expect(joint.openAngle).toBeGreaterThan(frame.stop - 0.1);

  joint.reset();
  expect(joint.latched).toBe(true);
  expect(joint.openAngle).toBe(0);
  run(0.1, 1);
  expect(Math.abs(joint.openAngle)).toBeLessThan(0.002);
  hit(0.25, 6);
  expect(joint.latched).toBe(true);
  remove();
});
