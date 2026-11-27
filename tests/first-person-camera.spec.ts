import { expect, test } from "@playwright/test";
import type * as Pc from "playcanvas";

import type { ChaseCameraSnapshot } from "../src/game/camera/chase-camera";
import type * as FirstPersonModule from "../src/game/camera/first-person-camera";
import {
  findFirstPersonMounts,
  firstPersonVerticalFov,
} from "../src/game/camera/first-person-camera";
import type * as ChaseModule from "../src/game/camera/chase-camera";
import { loadPlayCanvasForNode } from "./helpers/node-playcanvas";

let pc: typeof Pc;
let chaseModule: typeof ChaseModule;
let firstPersonModule: typeof FirstPersonModule;

test.beforeAll(async () => {
  pc = await loadPlayCanvasForNode();
  chaseModule = await import("../src/game/camera/chase-camera");
  firstPersonModule = await import("../src/game/camera/first-person-camera");
});

const box = (
  minimum: [number, number, number],
  maximum: [number, number, number],
) => ({
  maximum: { x: maximum[0], y: maximum[1], z: maximum[2] },
  minimum: { x: minimum[0], y: minimum[1], z: minimum[2] },
});

test("mounts the onboard cameras at the nose and tail, 11 cm above the parts there and a little beyond", () => {
  // A 46 cm kart: body to 18 cm, wheels outside the centre, a tall part in
  // the middle, a nose part a little taller than the body, and a low tail.
  const { front, rear } = findFirstPersonMounts([
    box([-0.16, 0.04, -0.23], [0.16, 0.18, 0.2]),
    box([-0.225, 0, -0.2], [-0.15, 0.24, -0.06]),
    box([0.15, 0, -0.2], [0.225, 0.24, -0.06]),
    box([-0.05, 0.18, -0.1], [0.05, 0.3, 0.1]),
    box([-0.04, 0.18, -0.23], [0.04, 0.2, -0.15]),
    box([-0.1, 0.02, 0.2], [0.1, 0.1, 0.23]),
  ]);
  // Above the nose part; not the tall part behind or the wheels beside.
  expect(front).toEqual({ x: 0, y: expect.closeTo(0.31, 6), z: expect.closeTo(-0.25, 6) });
  // Above the body where it reaches the tail.
  expect(rear).toEqual({ x: 0, y: expect.closeTo(0.29, 6), z: expect.closeTo(0.25, 6) });
});

test("sees about 90 degrees across a wide screen and at least 70 on an upright phone", () => {
  const across = (vertical: number, aspect: number) =>
    (360 / Math.PI) * Math.atan(Math.tan((vertical * Math.PI) / 360) * aspect);
  expect(across(firstPersonVerticalFov(16 / 9, 0), 16 / 9)).toBeCloseTo(90, 3);
  expect(across(firstPersonVerticalFov(16 / 9, 1), 16 / 9)).toBeCloseTo(95, 3);
  // A square view would be 90 tall: capped.
  expect(firstPersonVerticalFov(1, 0)).toBeCloseTo(75, 3);
  expect(across(firstPersonVerticalFov(9 / 19.5, 0), 9 / 19.5)).toBeCloseTo(70, 3);
});

test("rides the kart, keeps a quarter of its lean, looks back, and gives way to the chase on its side, not in a spin", () => {
  const placed = { position: new pc.Vec3(), target: new pc.Vec3(), up: new pc.Vec3() };
  const entity = {
    camera: { fov: 0 },
    lookAt: (target: Pc.Vec3, up: Pc.Vec3) => {
      placed.target.copy(target);
      placed.up.copy(up);
    },
    setPosition: (position: Pc.Vec3) => placed.position.copy(position),
  } as unknown as Pc.Entity;
  const canvas = { clientHeight: 720, clientWidth: 1280 } as HTMLCanvasElement;
  const chase = new chaseModule.ChaseCamera(entity, canvas);
  const camera = new firstPersonModule.FirstPersonCamera(entity, canvas, chase, {
    front: { x: 0, y: 0.2, z: -0.1 },
    rear: { x: 0, y: 0.15, z: 0.25 },
  });
  const snapshot: ChaseCameraSnapshot = {
    angularVelocity: new pc.Vec3(),
    impact: null,
    linearVelocity: new pc.Vec3(0, 0, -8),
    lookBehind: false,
    position: new pc.Vec3(),
    rotation: new pc.Quat(),
    supportCount: 4,
    up: new pc.Vec3(0, 1, 0),
  };
  const step = () => {
    snapshot.position.z -= 8 / 60;
    chase.update(1 / 60, snapshot);
    camera.update(1 / 60, snapshot);
  };
  chase.snap(snapshot);
  step();
  expect(camera.onboard).toBe(true);
  expect(placed.position.x).toBeCloseTo(0, 6);
  expect(placed.position.y).toBeCloseTo(0.2, 6);
  expect(placed.position.z - snapshot.position.z).toBeCloseTo(-0.1, 6);
  expect(placed.target.z).toBeLessThan(placed.position.z);

  // Driving on, it stays on the kart: no lag behind it.
  for (let frame = 0; frame < 30; frame += 1) step();
  expect(placed.position.z - snapshot.position.z).toBeCloseTo(-0.1, 6);

  // Leaning 20 degrees into a corner, the horizon tilts by a quarter of it.
  snapshot.rotation.setFromEulerAngles(0, 0, 20);
  for (let frame = 0; frame < 60; frame += 1) step();
  const tilt = (Math.atan2(-placed.up.x, placed.up.y) * 180) / Math.PI;
  expect(Math.abs(tilt)).toBeCloseTo(5, 1);

  // Looking behind cuts to the tail camera, facing back.
  snapshot.lookBehind = true;
  step();
  expect(placed.target.z).toBeGreaterThan(placed.position.z);
  expect(placed.position.z - snapshot.position.z).toBeCloseTo(0.25, 1);
  snapshot.lookBehind = false;

  // A hard spin, as off a wall, stays onboard.
  snapshot.angularVelocity.set(0, 12, 0);
  step();
  expect(camera.onboard).toBe(true);
  snapshot.angularVelocity.set(0, 0, 0);

  // Rolled onto its side, the chase shows; upright again for a moment, the
  // onboard view comes back.
  snapshot.rotation.setFromEulerAngles(0, 0, 80);
  step();
  expect(camera.onboard).toBe(false);
  snapshot.rotation.set(0, 0, 0, 1);
  for (let frame = 0; frame < 20; frame += 1) step();
  expect(camera.onboard).toBe(false);
  for (let frame = 0; frame < 20; frame += 1) step();
  expect(camera.onboard).toBe(true);

  // A reset while tumbling shows the onboard view at once.
  snapshot.rotation.setFromEulerAngles(0, 0, 80);
  step();
  expect(camera.onboard).toBe(false);
  snapshot.rotation.set(0, 0, 0, 1);
  chase.snap(snapshot);
  camera.update(0, snapshot);
  expect(camera.onboard).toBe(true);

  // Climbing a 10 degree slope at 12 m/s, the lens stays on its mount,
  // through a hard side hit too.
  const climb = (10 * Math.PI) / 180;
  snapshot.rotation.setFromEulerAngles(10, 0, 0);
  for (let frame = 0; frame < 60; frame += 1) {
    if (frame === 30) {
      snapshot.impact = { approachSpeed: 13, id: 1, normal: { x: 1, y: 0, z: 0 } };
    }
    snapshot.position.z -= (12 * Math.cos(climb)) / 60;
    snapshot.position.y += (12 * Math.sin(climb)) / 60;
    chase.update(1 / 60, snapshot);
    camera.update(1 / 60, snapshot);
    const mount = snapshot.rotation
      .transformVector(new pc.Vec3(0, 0.2, -0.1), new pc.Vec3())
      .add(snapshot.position);
    expect(placed.position.distance(mount)).toBeLessThan(0.021);
  }
});

test("stops the nose camera short of a wall the nose is pressed against, and caps pitch lag", () => {
  const placed = { position: new pc.Vec3(), target: new pc.Vec3() };
  const entity = {
    camera: { fov: 0 },
    lookAt: (target: Pc.Vec3) => placed.target.copy(target),
    setPosition: (position: Pc.Vec3) => placed.position.copy(position),
  } as unknown as Pc.Entity;
  const canvas = { clientHeight: 720, clientWidth: 1280 } as HTMLCanvasElement;
  const chase = new chaseModule.ChaseCamera(entity, canvas);
  // A wall across the course at z = -0.23, where the kart's nose ends.
  let wallZ = -0.23;
  const camera = new firstPersonModule.FirstPersonCamera(
    entity,
    canvas,
    chase,
    {
      front: { x: 0, y: 0.16, z: -0.25 },
      rear: { x: 0, y: 0.16, z: 0.25 },
    },
    (pivot, desired) => {
      if (desired.z > wallZ || pivot.z < wallZ) return null;
      const amount = (pivot.z - wallZ) / (pivot.z - desired.z);
      return {
        normal: new pc.Vec3(0, 0, 1),
        point: new pc.Vec3().lerp(pivot, desired, amount),
      };
    },
  );
  const snapshot: ChaseCameraSnapshot = {
    angularVelocity: new pc.Vec3(),
    impact: null,
    linearVelocity: new pc.Vec3(),
    lookBehind: false,
    position: new pc.Vec3(),
    rotation: new pc.Quat(),
    supportCount: 4,
    up: new pc.Vec3(0, 1, 0),
  };
  chase.snap(snapshot);
  camera.update(1 / 60, snapshot);
  expect(placed.position.z).toBeCloseTo(wallZ + 0.03, 6);

  // Just short of the wall, held back to the same margin.
  wallZ = -0.255;
  chase.snap(snapshot);
  camera.update(1 / 60, snapshot);
  expect(placed.position.z).toBeCloseTo(wallZ + 0.03, 6);
  wallZ = -0.23;

  // The nose pitched up 40 degrees in one frame: the aim follows to within
  // 20 degrees at once.
  snapshot.rotation.setFromEulerAngles(40, 0, 0);
  chase.update(1 / 60, snapshot);
  camera.update(1 / 60, snapshot);
  const aim = placed.target.clone().sub(placed.position);
  const pitch = (Math.atan2(aim.y, Math.hypot(aim.x, aim.z)) * 180) / Math.PI;
  expect(pitch).toBeGreaterThanOrEqual(20 - 1e-6);
});
