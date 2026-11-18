import { createRequire } from "node:module";
import path from "node:path";

import { expect, test } from "@playwright/test";
import type * as Pc from "playcanvas";

import { createBalancedKartDocument } from "../src/game/kart/balanced-kart-document";
import { createHandlingKartDocument } from "../src/game/kart/handling-kart-document";
import type * as KartAssemblyVisual from "../src/game/kart/kart-assembly-visual";
import { createSpeedKartDocument } from "../src/game/kart/speed-kart-document";

let pc: typeof Pc;
let visual: typeof KartAssemblyVisual;

test.beforeAll(async () => {
  // PlayCanvas's CommonJS build exports nothing in Node, so the visual's
  // `import * as pc from "playcanvas"` gets the ES module instead.
  pc = (await import(
    "playcanvas/build/playcanvas/src/index.js"
  )) as unknown as typeof Pc;
  const require = createRequire(__filename);
  const id = require.resolve("playcanvas");
  require.cache[id] = { exports: pc, filename: id, id, loaded: true } as NodeJS.Module;
  // A spec run earlier in this worker may have loaded the game's modules
  // against the empty build; load them afresh.
  const game = path.resolve(__dirname, "../src/game");
  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(game)) delete require.cache[key];
  }
  visual = await import("../src/game/kart/kart-assembly-visual");
});

// Without a device the visual has no meshes but poses like the drawn kart.
const createVisual = (document: ReturnType<typeof createBalancedKartDocument>) =>
  visual.createKartAssemblyVisual(
    document,
    () => {
      throw new Error("A posing check draws nothing.");
    },
    null,
  );
const DOCUMENTS = [
  createBalancedKartDocument(),
  createSpeedKartDocument(),
  createHandlingKartDocument(),
];

test("tie rods stay on the horn and steering arms however wheels are posed", () => {
  for (const document of DOCUMENTS) {
    const { root, wheels } = createVisual(document);
    const steered = wheels.filter((wheel) => wheel.tieRod);
    expect(steered, document.kartId).toHaveLength(2);
    // Like a race frame: each wheel is steered, then posed, in turn, with
    // different angles (Ackermann) and travel.
    for (const [left, right, travel] of [
      [12, 9, 0],
      [-20, -24, 0.008],
      [3, 3, -0.006],
    ]) {
      steered.forEach((wheel, index) => {
        wheel.pivot.setLocalEulerAngles(0, index === 0 ? left : right, 0);
        visual.poseKartWheelVisual(wheel, wheel.hub.y + travel);
      });
      root.syncHierarchy();
      expect(steered[0].tieRod!.rig.hornAngle !== 0, document.kartId).toBe(left !== 0);
      for (const wheel of steered) {
        const tieRod = wheel.tieRod!;
        const { hornBall: horn, knuckleBall: knuckle, restLength } = tieRod.pose;
        const hornBall = tieRod.rig.horn
          .getWorldTransform()
          .transformPoint(new pc.Vec3(horn.x, horn.y, horn.z), new pc.Vec3());
        const knuckleBall = wheel.pivot
          .getWorldTransform()
          .transformPoint(new pc.Vec3(knuckle.x, knuckle.y, knuckle.z), new pc.Vec3());
        const rodEnd = tieRod.rod
          .getWorldTransform()
          .transformPoint(new pc.Vec3(restLength, 0, 0), new pc.Vec3());
        expect(tieRod.rod.getPosition().distance(hornBall), document.kartId).toBeLessThan(1e-6);
        expect(rodEnd.distance(knuckleBall), document.kartId).toBeLessThan(1e-6);
        // The horn turns to meet the arms, so the rods barely stretch.
        expect(Math.abs(tieRod.rod.getLocalScale().x - 1), document.kartId).toBeLessThan(0.03);
      }
    }
  }
});

test("driveshafts stay rigid and in their outdrives through suspension travel", () => {
  for (const document of DOCUMENTS) {
    const { root, wheels } = createVisual(document);
    const driven = wheels.filter((wheel) => wheel.driveshaft);
    expect(driven, document.kartId).toHaveLength(2);
    for (const travel of [-0.015, 0, 0.015]) {
      for (const wheel of driven) visual.poseKartWheelVisual(wheel, wheel.hub.y + travel);
      root.syncHierarchy();
      for (const wheel of driven) {
        const { bone, pose } = wheel.driveshaft!;
        const outputAxis = new pc.Vec3(pose.outputAxis.x, pose.outputAxis.y, pose.outputAxis.z);
        const outputPoint = new pc.Vec3(pose.outputPoint.x, pose.outputPoint.y, pose.outputPoint.z);
        const inner = bone
          .getWorldTransform()
          .transformPoint(new pc.Vec3(pose.length, 0, 0), new pc.Vec3());
        const fromOutput = inner.clone().sub(outputPoint);
        const along = fromOutput.dot(outputAxis);
        // The inner ball slides along the outdrive's axis, a few millimetres.
        expect(bone.getLocalScale().x, document.kartId).toBe(1);
        expect(
          fromOutput.sub(outputAxis.clone().mulScalar(along)).length(),
          document.kartId,
        ).toBeLessThan(1e-6);
        expect(Math.abs(along), document.kartId).toBeLessThan(0.003);
      }
    }
  }
});

test("a draft's driven wheel without a suspension draws no driveshaft", () => {
  const document = createBalancedKartDocument();
  const { wheels } = createVisual(document);
  const wheelId = wheels.find((wheel) => wheel.driveshaft)!.instanceId;
  const draft = {
    ...document,
    connections: document.connections.filter(
      ({ from, to }) =>
        !(
          (from.instanceId === wheelId && from.portId === "hub-mount") ||
          (to.instanceId === wheelId && to.portId === "hub-mount")
        ),
    ),
  };
  const wheel = createVisual(draft).wheels.find(
    ({ instanceId }) => instanceId === wheelId,
  )!;
  expect(wheel.suspension).toBeNull();
  expect(wheel.driveshaft).toBeNull();
});
