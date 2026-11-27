import { expect, test } from "@playwright/test";
import type * as Pc from "playcanvas";

import type * as ChaseCameraModule from "../src/game/camera/chase-camera";
import {
  type ChaseCameraSnapshot,
  calculateCameraStabilizationTarget,
  calculateImpactStrength,
  calculatePlanarHeadingStep,
  calculateSignedSlipDegrees,
  selectStrongerImpact,
  smoothCameraStabilizationBlend,
  smoothFactor,
} from "../src/game/camera/chase-camera";
import { loadPlayCanvasForNode } from "./helpers/node-playcanvas";

test("engages camera stabilization for violent spin and severe tilt", () => {
  expect(calculateCameraStabilizationTarget(1, 0)).toBe(0);
  expect(calculateCameraStabilizationTarget(1, 2.5)).toBe(0);
  expect(calculateCameraStabilizationTarget(1, 7)).toBe(1);
  expect(calculateCameraStabilizationTarget(0.7, 0)).toBe(0);
  expect(calculateCameraStabilizationTarget(0.1, 0)).toBe(1);
  expect(calculateCameraStabilizationTarget(-1, 0)).toBe(1);
});

test("caps chase-heading slew across wraparound", () => {
  const almostLeft = {
    x: Math.sin((-179 * Math.PI) / 180),
    y: 0,
    z: -Math.cos((-179 * Math.PI) / 180),
  };
  const almostRight = {
    x: Math.sin((179 * Math.PI) / 180),
    y: 0,
    z: -Math.cos((179 * Math.PI) / 180),
  };

  expect(
    calculatePlanarHeadingStep(almostLeft, almostRight, Math.PI),
  ).toBeCloseTo((-2 * Math.PI) / 180);
  expect(
    calculatePlanarHeadingStep(
      { x: 0, y: 0, z: -1 },
      { x: 1, y: 0, z: 0 },
      Math.PI / 12,
    ),
  ).toBeCloseTo(Math.PI / 12);
  expect(
    calculatePlanarHeadingStep(
      { x: 0, y: 0, z: -1 },
      { x: 1, y: 0, z: 0 },
      -1,
    ),
  ).toBe(0);
});

test("engages stabilization faster than it releases", () => {
  const engaged = smoothCameraStabilizationBlend(0, 1, 0.1);
  const released = smoothCameraStabilizationBlend(1, 0, 0.1);

  expect(engaged).toBeGreaterThan(0.6);
  expect(released).toBeGreaterThan(0.75);
  expect(
    smoothCameraStabilizationBlend(
      smoothCameraStabilizationBlend(0, 1, 1 / 60),
      1,
      1 / 60,
    ),
  ).toBeCloseTo(smoothCameraStabilizationBlend(0, 1, 1 / 30), 10);
});

test("calculates signed planar slip only above the reliable speed", () => {
  expect(
    calculateSignedSlipDegrees(
      { x: 0, y: 0, z: -1 },
      { x: 0.1, y: 0, z: -0.1 },
    ),
  ).toBe(0);
  expect(
    calculateSignedSlipDegrees(
      { x: 0, y: 0, z: -1 },
      { x: 4, y: 0, z: -4 },
    ),
  ).toBeCloseTo(-45);
  expect(
    calculateSignedSlipDegrees(
      { x: 0, y: 0, z: -1 },
      { x: -4, y: 0, z: -4 },
    ),
  ).toBeCloseTo(45);
  expect(
    calculateSignedSlipDegrees(
      { x: 1, y: 0, z: 0 },
      { x: -4, y: 0, z: 0.1 },
    ),
  ).toBe(0);
  expect(
    calculateSignedSlipDegrees(
      { x: 1, y: 0, z: 0 },
      { x: -4, y: 0, z: -0.1 },
    ),
  ).toBe(0);
});

test("bounds impact strength and ignores low-energy contact", () => {
  expect(calculateImpactStrength(3)).toBe(0);
  expect(calculateImpactStrength(8.25)).toBeCloseTo(0.5);
  expect(calculateImpactStrength(30)).toBe(1);
});

test("retains the strongest impact until the render boundary", () => {
  const weaker = {
    approachSpeed: 5,
    id: 2,
    normal: { x: 1, y: 0, z: 0 },
  };
  const stronger = {
    approachSpeed: 12,
    id: 1,
    normal: { x: 0, y: 0, z: 1 },
  };

  expect(selectStrongerImpact(stronger, weaker)).toBe(stronger);
  expect(selectStrongerImpact(weaker, stronger)).toBe(stronger);
  expect(selectStrongerImpact(null, weaker)).toBe(weaker);
});

test("uses delta-time-aware exponential smoothing", () => {
  const oneFrame = smoothFactor(5, 1 / 60);
  const twoFrames = 1 - (1 - oneFrame) ** 2;

  expect(twoFrames).toBeCloseTo(smoothFactor(5, 1 / 30), 10);
  expect(smoothFactor(5, -1)).toBe(0);
});

let pc: typeof Pc;
let cameraModule: typeof ChaseCameraModule;

test.beforeAll(async () => {
  pc = await loadPlayCanvasForNode();
  cameraModule = await import("../src/game/camera/chase-camera");
});

test("cuts to a rear shot that holds ahead of a kart driving at it, eases off walls, and cuts back to a settled chase", () => {
  const placed = { position: new pc.Vec3(), target: new pc.Vec3() };
  const entity = {
    camera: { fov: 0 },
    lookAt: (target: Pc.Vec3) => placed.target.copy(target),
    setPosition: (position: Pc.Vec3) => placed.position.copy(position),
  } as unknown as Pc.Entity;
  const canvas = { clientHeight: 720, clientWidth: 1280 } as HTMLCanvasElement;
  // A wall 20% of the way to the camera, while `walled`.
  let walled = false;
  const camera = new cameraModule.ChaseCamera(entity, canvas, (pivot, desired) =>
    walled
      ? {
          normal: new pc.Vec3(0, 0, 1),
          point: new pc.Vec3().lerp(pivot, desired, 0.2),
        }
      : null,
  );
  // The kart faces -z and drives that way at 8 m/s.
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
  camera.snap(snapshot);
  const behind = placed.position.z;
  expect(behind).toBeGreaterThan(0);

  snapshot.lookBehind = true;
  camera.update(1 / 60, snapshot);
  expect(camera.getDiagnostics().lookingBehind).toBe(true);
  expect(placed.position.z).toBeCloseTo(-behind, 5);
  expect(placed.target.z).toBeGreaterThan(0);

  for (let frame = 0; frame < 60; frame += 1) {
    snapshot.position.z -= 8 / 60;
    camera.update(1 / 60, snapshot);
  }
  // No lag along the heading: still as far ahead as it cut to.
  expect(placed.position.z - snapshot.position.z).toBeCloseTo(-behind, 5);

  // A wall pulls it in; once clear, it eases back out as it drives.
  const ahead = () => snapshot.position.z - placed.position.z;
  walled = true;
  for (let frame = 0; frame < 30; frame += 1) {
    snapshot.position.z -= 8 / 60;
    camera.update(1 / 60, snapshot);
  }
  expect(ahead()).toBeLessThan(0.4 * behind);
  walled = false;
  snapshot.position.z -= 8 / 60;
  camera.update(1 / 60, snapshot);
  expect(ahead()).toBeLessThan(0.5 * behind);
  for (let frame = 0; frame < 120; frame += 1) {
    snapshot.position.z -= 8 / 60;
    camera.update(1 / 60, snapshot);
  }
  expect(ahead()).toBeCloseTo(behind, 2);

  // Letting go cuts to the chase exactly where it would be had the player
  // never looked behind: already trailing at speed, with nothing to settle.
  const chasePlaced = new pc.Vec3();
  const chase = new cameraModule.ChaseCamera(
    {
      camera: { fov: 0 },
      lookAt: () => undefined,
      setPosition: (position: Pc.Vec3) => chasePlaced.copy(position),
    } as unknown as Pc.Entity,
    canvas,
  );
  const chaseSnapshot = { ...snapshot, lookBehind: false, position: new pc.Vec3() };
  chase.snap(chaseSnapshot);
  snapshot.position.set(0, 0, 0);
  camera.snap(snapshot);
  for (let frame = 0; frame < 60; frame += 1) {
    snapshot.position.z -= 8 / 60;
    chaseSnapshot.position.z -= 8 / 60;
    camera.update(1 / 60, snapshot);
    chase.update(1 / 60, chaseSnapshot);
  }
  snapshot.lookBehind = false;
  snapshot.position.z -= 8 / 60;
  chaseSnapshot.position.z -= 8 / 60;
  camera.update(1 / 60, snapshot);
  chase.update(1 / 60, chaseSnapshot);
  expect(placed.position.z - snapshot.position.z).toBeGreaterThan(behind);
  expect(placed.position.distance(chasePlaced)).toBeLessThan(1e-6);
});

test("holds the rear shot on the near side of a wall the kart drives at", () => {
  const placed = new pc.Vec3();
  const entity = {
    camera: { fov: 0 },
    lookAt: () => undefined,
    setPosition: (position: Pc.Vec3) => placed.copy(position),
  } as unknown as Pc.Entity;
  const canvas = { clientHeight: 720, clientWidth: 1280 } as HTMLCanvasElement;
  // A fixed wall across the course at z = -3.
  const wallZ = -3;
  const camera = new cameraModule.ChaseCamera(entity, canvas, (pivot, desired) => {
    if (desired.z > wallZ || pivot.z < wallZ) return null;
    const amount = (pivot.z - wallZ) / (pivot.z - desired.z);
    return {
      normal: new pc.Vec3(0, 0, 1),
      point: new pc.Vec3().lerp(pivot, desired, amount),
    };
  });
  const snapshot: ChaseCameraSnapshot = {
    angularVelocity: new pc.Vec3(),
    impact: null,
    linearVelocity: new pc.Vec3(0, 0, -8),
    lookBehind: true,
    position: new pc.Vec3(),
    rotation: new pc.Quat(),
    supportCount: 4,
    up: new pc.Vec3(0, 1, 0),
  };
  camera.snap(snapshot);
  let nearest = Infinity;
  while (snapshot.position.z > wallZ + 0.4) {
    snapshot.position.z -= 8 / 120;
    camera.update(1 / 120, snapshot);
    expect(placed.z).toBeGreaterThan(wallZ);
    if (camera.getDiagnostics().obstructed) {
      nearest = Math.min(nearest, placed.z - wallZ);
    }
  }
  // Held a clear margin short of it the whole way, not just on its side.
  expect(nearest).toBeGreaterThan(0.06);
});
