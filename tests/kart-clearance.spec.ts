import { expect, test } from "@playwright/test";

import { createBalancedKartDocument } from "../src/game/kart/balanced-kart-document";
import { createSpeedKartDocument } from "../src/game/kart/speed-kart-document";
import type { KartAssemblyDocument } from "../src/game/kart/kart-assembly-document";
import { checkKartClearance } from "../src/game/kart/kart-clearance";
import {
  rotationMatrix,
  type KartVector,
} from "../src/game/kart/kart-construction-geometry";
import {
  measureConvexPair,
  type KartConvexShape,
} from "../src/game/kart/kart-convex-distance";
import { deriveKartSnapshot } from "../src/game/kart/kart-derivation";
import {
  getDriveshaftEnds,
  planKartLinkagePoses,
} from "../src/game/kart/kart-linkage-poses";

const vector = ([x, y, z]: number[]): KartVector => ({ x, y, z });
const box = (
  center: [number, number, number],
  half = 0.01,
  rotationDegrees = { x: 0, y: 0, z: 0 },
): KartConvexShape => ({
  center: vector(center),
  half: { x: half, y: half, z: half },
  kind: "box",
  rotation: rotationMatrix(rotationDegrees),
});
const rod = (
  start: [number, number, number],
  end: [number, number, number],
  radius: number,
): KartConvexShape => ({
  kind: "rounded",
  points: [vector(start), vector(end)],
  radius,
});

test("measures gaps and overlaps between boxes, cylinders, and rods", () => {
  const cases: Array<[string, KartConvexShape, KartConvexShape, number]> = [
    ["gap", box([0, 0, 0]), box([0.025, 0, 0]), 0.005],
    ["corner to corner", box([0, 0, 0]), box([0.03, 0.03, 0.03]), Math.sqrt(3) * 0.01],
    ["flush", box([0, 0, 0]), box([0.02, 0.004, 0]), 0],
    ["overlap", box([0, 0, 0]), box([0.017, 0.002, 0.001]), -0.003],
    ["coincident", box([0, 0, 0]), box([0, 0, 0]), -0.02],
    ["turned 45°", box([0, 0, 0], 0.01, { x: 0, y: 45, z: 0 }), box([0.03, 0, 0]), 0.02 - 0.01 * Math.SQRT2],
    [
      "wheel on a block",
      {
        axis: { x: 1, y: 0, z: 0 },
        center: { x: 0, y: 0, z: 0 },
        halfHeight: 0.025,
        kind: "cylinder",
        radius: 0.0725,
      },
      box([0, 0.07, 0]),
      -0.0125,
    ],
    ["rod over a block", rod([-0.05, 0.015, 0], [0.05, 0.015, 0], 0.002), box([0, 0, 0]), 0.003],
    ["rod through a block", rod([-0.05, 0.005, 0], [0.05, 0.005, 0], 0.002), box([0, 0, 0]), -0.007],
    ["rod along a rod", rod([0, 0, 0], [0.1, 0, 0], 0.002), rod([0.02, 0, 0], [0.04, 0, 0], 0.001), -0.003],
  ];
  for (const [name, a, b, distance] of cases) {
    const measurement = measureConvexPair(a, b);
    // To a micrometre.
    expect(measurement.distance, name).toBeCloseTo(distance, 6);
    // The reported points are the gap (or overlap) apart.
    expect(
      Math.hypot(
        measurement.pointA.x - measurement.pointB.x,
        measurement.pointA.y - measurement.pointB.y,
        measurement.pointA.z - measurement.pointB.z,
      ),
      name,
    ).toBeCloseTo(Math.abs(distance), 6);
  }
});

const dot = (a: KartVector, b: KartVector) => a.x * b.x + a.y * b.y + a.z * b.z;
const negate = ({ x, y, z }: KartVector) => ({ x: -x, y: -y, z: -z });

// Each shape's reach along a direction, as an independent check.
function reach(shape: KartConvexShape, d: KartVector): number {
  if (shape.kind === "rounded") {
    return Math.max(...shape.points.map((point) => dot(point, d))) + shape.radius;
  }
  if (shape.kind === "hull") {
    return Math.max(...shape.shapes.map((member) => reach(member, d)));
  }
  if (shape.kind === "box") {
    const r = shape.rotation;
    return (
      dot(shape.center, d) +
      Math.abs(r[0] * d.x + r[3] * d.y + r[6] * d.z) * shape.half.x +
      Math.abs(r[1] * d.x + r[4] * d.y + r[7] * d.z) * shape.half.y +
      Math.abs(r[2] * d.x + r[5] * d.y + r[8] * d.z) * shape.half.z
    );
  }
  const along = dot(d, shape.axis);
  return (
    dot(shape.center, d) +
    Math.abs(along) * shape.halfHeight +
    Math.sqrt(Math.max(1 - along * along, 0)) * shape.radius
  );
}

test("tilted solids measure the same both ways, with points on the solids", () => {
  let seed = 7;
  const random = (low: number, high: number) => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return low + ((high - low) * seed) / 4294967296;
  };
  const point = () => vector([0, 0, 0].map(() => random(-0.03, 0.03)));
  const unit = () => {
    const v = point();
    const length = Math.hypot(v.x, v.y, v.z);
    return { x: v.x / length, y: v.y / length, z: v.z / length };
  };
  const shape = (kind: number): KartConvexShape =>
    kind === 0
      ? {
          center: point(),
          half: vector([0, 0, 0].map(() => random(0.002, 0.02))),
          kind: "box",
          rotation: rotationMatrix(vector([0, 0, 0].map(() => random(-180, 180)))),
        }
      : kind === 1
        ? {
            axis: unit(),
            center: point(),
            halfHeight: random(0.002, 0.03),
            kind: "cylinder",
            radius: random(0.002, 0.04),
          }
        : {
            kind: "rounded",
            points: [point(), point()],
            radius: random(0.0005, 0.004),
          };
  // Directions to look for a separating plane along.
  const directions = Array.from({ length: 400 }, (_, i) => {
    const y = 1 - (2 * (i + 0.5)) / 400;
    const r = Math.sqrt(1 - y * y);
    return { x: r * Math.cos(i * 2.399963), y, z: r * Math.sin(i * 2.399963) };
  });
  // The worst of each check over every pair.
  let asymmetry = 0;
  let pointOutside = 0;
  let separatedOverlap = 0;
  let unprovenGap = 0;
  let pointsApart = 0;
  for (let i = 0; i < 600; i += 1) {
    // Every pairing has a cylinder or a box, tilted.
    const a = shape(i % 2);
    const b = shape(i % 3);
    const forward = measureConvexPair(a, b);
    const backward = measureConvexPair(b, a);
    asymmetry = Math.max(asymmetry, Math.abs(forward.distance - backward.distance));
    // Each point lies within its solid.
    for (const d of directions) {
      pointOutside = Math.max(
        pointOutside,
        dot(forward.pointA, d) - reach(a, d),
        dot(forward.pointB, d) - reach(b, d),
      );
    }
    // The points are the gap or overlap apart.
    pointsApart = Math.max(
      pointsApart,
      Math.abs(
        Math.hypot(
          forward.pointA.x - forward.pointB.x,
          forward.pointA.y - forward.pointB.y,
          forward.pointA.z - forward.pointB.z,
        ) - Math.abs(forward.distance),
      ),
    );
    if (forward.distance < -1e-6) {
      // An overlap has no separating plane.
      for (const d of directions) {
        separatedOverlap = Math.max(separatedOverlap, -reach(a, d) - reach(b, negate(d)));
      }
    } else if (forward.distance > 1e-6) {
      // A gap has one, across the reported points.
      const n = {
        x: forward.pointB.x - forward.pointA.x,
        y: forward.pointB.y - forward.pointA.y,
        z: forward.pointB.z - forward.pointA.z,
      };
      const length = Math.hypot(n.x, n.y, n.z);
      const d = { x: n.x / length, y: n.y / length, z: n.z / length };
      unprovenGap = Math.max(
        unprovenGap,
        forward.distance - (-reach(b, negate(d)) - reach(a, d)),
      );
    }
  }
  expect(asymmetry).toBeLessThan(5e-5);
  expect(pointOutside).toBeLessThan(1e-7);
  expect(separatedOverlap).toBeLessThan(1e-9);
  expect(unprovenGap).toBeLessThan(1e-7);
  expect(pointsApart).toBeLessThan(1e-5);
});

function addBlock(
  document: KartAssemblyDocument,
  position: KartVector,
  size: number,
  yawDegrees = 0,
) {
  const plate = document.primitiveInstances.find(
    ({ id }) => id === "chassis-plate",
  )!;
  if (plate.shape !== "box") throw new Error("The plate is a box.");
  document.primitiveInstances.push({
    ...structuredClone(plate),
    id: "test-block",
    size: { x: size, y: size, z: size },
    transform: { position, rotationDegrees: { x: 0, y: yawDegrees, z: 0 } },
  });
}

test("reports a part sunk into the plate, and not parts bolted flat to it", () => {
  const document = createBalancedKartDocument();
  const snapshot = deriveKartSnapshot(document);
  const before = checkKartClearance(document, snapshot);
  expect(
    before.clashes.filter(({ first, second }) =>
      [first, second].includes("battery-main"),
    ),
  ).toEqual([]);

  const battery = document.componentInstances.find(
    ({ id }) => id === "battery-main",
  )!;
  battery.transform.position.y -= 0.002;
  const { clashes } = checkKartClearance(document, snapshot);
  const clash = clashes.find(
    ({ first, second }) => first === "battery-main" && second === "chassis-plate",
  );
  expect(clash?.distance).toBeCloseTo(-0.002, 6);
  expect(clash?.pose).toBeNull();
});

test("sweeps a driveshaft through its travel and reports where it runs deepest", () => {
  const document = createBalancedKartDocument();
  const snapshot = deriveKartSnapshot(document);
  const station = snapshot.geometry.wheelStations.find(
    ({ id }) => id === "wheel-rear-left",
  )!;
  const droop = -station.suspension.restWheelCompression;
  const shaft = planKartLinkagePoses(document).driveshafts.find(
    ({ wheelId }) => wheelId === station.id,
  )!;
  const start = vector([0, 0, 0]);
  const end = vector([0, 0, 0]);
  getDriveshaftEnds(
    shaft,
    { ...station.position, y: station.position.y + droop },
    start,
    end,
  );
  // A block on the drooped shaft's middle, which the shaft leaves as the
  // wheel rises.
  addBlock(
    document,
    vector([(start.x + end.x) / 2, (start.y + end.y) / 2, (start.z + end.z) / 2]),
    0.004,
  );
  const { clashes } = checkKartClearance(document, snapshot);
  const clash = clashes.find(
    ({ first, second }) =>
      first === "wheel-rear-left:driveshaft" && second === "test-block",
  );
  expect(clash?.distance).toBeLessThan(-0.002);
  expect(clash?.pose?.wheelTravel).toBeCloseTo(droop, 9);
});

test("finds tie rod clashes between sampled poses, and not near misses", () => {
  // 1 mm blocks near a left tie rod's sweep: some it reaches only between
  // the first samples (one only as the drawn rod stretches), and one its cup
  // passes 0.36 mm above.
  const cases: Array<
    [() => KartAssemblyDocument, [number, number, number], number, boolean]
  > = [
    [createBalancedKartDocument, [-0.122677, 0.058688, -0.152135], 0, true],
    [createBalancedKartDocument, [-0.014023474, 0.0776, -0.103213576], -124.005407, true],
    [createBalancedKartDocument, [-0.007, 0.08147, -0.104], 0, false],
    [createSpeedKartDocument, [-0.154184591, 0.063740738, -0.179535258], 161.818731, true],
  ];
  for (const [create, position, yaw, clashes] of cases) {
    const document = create();
    const snapshot = deriveKartSnapshot(document);
    addBlock(document, vector(position), 0.001, yaw);
    const clash = checkKartClearance(document, snapshot).clashes.find(
      ({ first, second }) =>
        first === "wheel-front-left:tie-rod" && second === "test-block",
    );
    expect(!!clash, `block at ${position}`).toBe(clashes);
  }
});

test("reports a driveshaft that leaves its outdrive cup", () => {
  // Off the outdrive's axis beyond the bone's reach, and along it out of the
  // cup's mouth.
  const cases: Array<[KartVector, number]> = [
    [{ x: -0.08, y: 0.048, z: 0.16 }, 0],
    [{ x: 0.007858, y: 0.061, z: 0.099276 }, 75.664],
  ];
  for (const [position, yaw] of cases) {
    const document = createBalancedKartDocument();
    const snapshot = deriveKartSnapshot(document);
    const transmission = document.componentInstances.find(
      ({ id }) => id === "transmission-main",
    )!;
    transmission.transform.position = position;
    transmission.transform.rotationDegrees = { x: 0, y: yaw, z: 0 };
    const clashes = checkKartClearance(document, snapshot).clashes.filter(
      ({ first, second }) =>
        first.endsWith(":driveshaft") && second === "transmission-main",
    );
    expect(clashes.length, `transmission at ${JSON.stringify(position)}`).toBeGreaterThan(0);
    expect(Math.min(...clashes.map(({ distance }) => distance))).toBeLessThan(-0.001);
  }
});
