import { expect, test } from "@playwright/test";

import { createBalancedKartDocument } from "../src/game/kart/balanced-kart-document";
import {
  createSpeedKartDocument,
  SPEED_KART_CONFIG,
} from "../src/game/kart/speed-kart-document";
import { createOfficialKartAssembly } from "../src/game/kart/official-kart-assembly";
import { HANDLING_KART_CONFIG } from "../src/game/kart/handling-kart-document";
import { getAckermannWheelSteerAngle } from "../src/game/kart/kart-steering";
import type { KartAssemblyDocument } from "../src/game/kart/kart-assembly-document";
import {
  checkKartClearance,
  getCoiloverClashShape,
  getCoiloverConnectorBlock,
} from "../src/game/kart/kart-clearance";
import { APPROVED_KART_COMPONENTS } from "../src/game/kart/kart-component-registry";
import { getKartPartVisual } from "../src/game/kart/kart-part-visuals";
import {
  buildCoilSpring,
  COILOVER_SIZES,
} from "../src/game/kart/kart-part-visual-geometry";
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

test("measures a shock's top connector against other parts", () => {
  // A 2 mm block beside the Balanced front-left shock's top connector, 7 mm
  // down the shock from its top eye: clear of the body and the tower bar.
  const place = (beyond: number) => {
    const document = createBalancedKartDocument();
    const snapshot = deriveKartSnapshot(document);
    const { chassisAnchor, springArmAnchor } = document.componentInstances.find(
      ({ id }) => id === "suspension-front-left",
    )!.suspensionMount!;
    const along = {
      x: springArmAnchor.x - chassisAnchor.x,
      y: springArmAnchor.y - chassisAnchor.y,
      z: springArmAnchor.z - chassisAnchor.z,
    };
    const length = Math.hypot(along.x, along.y, along.z);
    // Across the shock and its eye pin (along Z: it leans only inward).
    const across = { x: -along.y / length, y: along.x / length, z: 0 };
    const out = 0.003 + 0.001 + beyond;
    addBlock(
      document,
      {
        x: chassisAnchor.x + (along.x / length) * 0.007 + across.x * out,
        y: chassisAnchor.y + (along.y / length) * 0.007 + across.y * out,
        z: chassisAnchor.z,
      },
      0.002,
    );
    return checkKartClearance(document, snapshot).clashes.find(
      ({ first, second }) =>
        first === "suspension-front-left" && second === "test-block",
    );
  };
  // 0.5 mm into the connector, and 1 mm clear of it.
  expect(place(-0.0005)?.distance).toBeLessThan(-0.0003);
  expect(place(0.001)).toBeUndefined();
});

test("turns and lifts each wheel past its own shock and the other parts", () => {
  // Speed with its shocks further out along its arms, as it was built
  // before: its front tires reach them only when steered.
  const document = createOfficialKartAssembly({
    ...SPEED_KART_CONFIG,
    motionRatio: 0.85,
  });
  const snapshot = deriveKartSnapshot(document);
  const lock = snapshot.physicalProfile.steering.maximumCenterAngle;
  const { clashes } = checkKartClearance(document, snapshot);
  const clash = clashes.find(
    ({ first, second }) =>
      first === "suspension-front-left" && second === "wheel-front-left",
  );
  expect(clash?.distance).toBeLessThan(-0.001);
  expect(Math.abs(clash!.pose!.centerSteerDegrees)).toBeCloseTo(lock, 6);
  expect(
    clashes.some(
      ({ first, pose }) =>
        first === "suspension-rear-left" && pose?.centerSteerDegrees !== 0,
    ),
  ).toBe(false);

  // Handling's shorter arms as first laid out: its shocks' lower ends reach
  // the turned rims.
  const handling = createOfficialKartAssembly({
    ...HANDLING_KART_CONFIG,
    armLength: 0.1,
  });
  expect(
    checkKartClearance(handling, deriveKartSnapshot(handling)).clashes.some(
      ({ first, second }) =>
        first === "suspension-front-left" && second === "wheel-front-left",
    ),
  ).toBe(true);

  // A block just above the built Speed's front-left tire, which it reaches
  // at full bump.
  const clean = createSpeedKartDocument();
  const cleanSnapshot = deriveKartSnapshot(clean);
  const station = cleanSnapshot.geometry.wheelStations.find(
    ({ id }) => id === "wheel-front-left",
  )!;
  const bump =
    station.suspension.maximumWheelTravel -
    station.suspension.restWheelCompression;
  addBlock(
    clean,
    vector([
      station.position.x,
      station.position.y + station.radius + bump / 2,
      station.position.z,
    ]),
    0.004,
  );
  const above = checkKartClearance(clean, cleanSnapshot).clashes.find(
    ({ first, second }) => first === "test-block" && second === "wheel-front-left",
  );
  expect(above?.pose?.wheelTravel).toBeCloseTo(bump, 6);
});

test("finds a wheel's clash between its sampled steering angles", () => {
  // A half-millimetre block just inside the circle the front-left tire's
  // front outboard corner sweeps, where it passes at 18.75° of centre
  // steering: midway between the 15° and 22.5° samples.
  const document = createSpeedKartDocument();
  const snapshot = deriveKartSnapshot(document);
  const station = snapshot.geometry.wheelStations.find(
    ({ id }) => id === "wheel-front-left",
  )!;
  const steered = snapshot.geometry.wheelStations.filter(({ steered }) => steered);
  const centerX =
    steered.reduce((sum, { position }) => sum + position.x, 0) / steered.length;
  const angle =
    (getAckermannWheelSteerAngle(18.75, station.position.x - centerX, {
      centerOfMassHeight: 0,
      trackWidth: snapshot.geometry.trackWidth,
      wheelbase: snapshot.geometry.wheelbase,
    }) *
      Math.PI) /
    180;
  const corner = { x: -station.width / 2, z: -station.radius };
  const inward = 1 - 0.0003 / Math.hypot(corner.x, corner.z);
  addBlock(
    document,
    vector([
      station.position.x +
        inward * (corner.x * Math.cos(angle) + corner.z * Math.sin(angle)),
      station.position.y,
      station.position.z +
        inward * (-corner.x * Math.sin(angle) + corner.z * Math.cos(angle)),
    ]),
    0.0005,
  );
  const clash = checkKartClearance(document, snapshot).clashes.find(
    ({ first, second }) => first === "test-block" && second === "wheel-front-left",
  );
  expect(clash?.pose?.centerSteerDegrees).toBeGreaterThan(15.5);
  expect(clash?.pose?.centerSteerDegrees).toBeLessThan(22);
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

test("gives each tie rod its own horn stud however the servo is turned", () => {
  for (const yaw of [0, 90, 180, -90]) {
    const document = createBalancedKartDocument();
    document.componentInstances.find(
      ({ id }) => id === "steering-main",
    )!.transform.rotationDegrees.y = yaw;
    const [left, right] = planKartLinkagePoses(document).servos[0].tieRods;
    expect(left.hornBall, `servo turned ${yaw}°`).not.toEqual(right.hornBall);
  }
});

test("finds two tie rods running into each other", () => {
  // The servo turned on a bracket far out to the side, where the right rod
  // runs through the left rod's horn end at lock and full bump.
  const source = createBalancedKartDocument();
  const plate = source.primitiveInstances.find(({ id }) => id === "chassis-plate")!;
  const servo = source.componentInstances.find(({ id }) => id === "steering-main")!;
  const seat = source.structuralAttachments.find(
    ({ child }) => child.instanceId === "steering-main",
  )!;
  if (plate.shape !== "box") throw new Error("The plate is a box.");
  const [x, y, z, padHeight, railThickness] = [0.4, 0.13, -0.085, 0.025, 0.002];
  const baseY = plate.transform.position.y + plate.size.y / 2;
  const post = { x: 0.05, z };
  const railTop = y - (servo.transform.position.y - baseY) - padHeight;
  const railX = (x + post.x) / 2;
  const postHeight = railTop - railThickness - baseY;
  const box = (id: string, size: KartVector, position: KartVector) => ({
    ...plate,
    id,
    size,
    transform: { ...plate.transform, position },
  });
  const document: KartAssemblyDocument = {
    ...source,
    componentInstances: source.componentInstances.map((part) =>
      part.id === "steering-main"
        ? { ...part, transform: { position: { x, y, z }, rotationDegrees: { x: 0, y: 155, z: 0 } } }
        : part,
    ),
    primitiveInstances: [
      ...source.primitiveInstances.filter(({ id }) => id !== "top-deck"),
      box("servo-post", { x: 0.012, y: postHeight, z: 0.012 }, { x: post.x, y: baseY + postHeight / 2, z }),
      box("servo-rail", { x: x - post.x + 0.06, y: railThickness, z: 0.055 }, { x: railX, y: railTop - railThickness / 2, z }),
      box("servo-pad", { x: 0.055, y: padHeight, z: 0.055 }, { x, y: railTop + padHeight / 2, z }),
    ],
    structuralAttachments: [
      ...source.structuralAttachments.filter(
        ({ child }) => child.instanceId !== "steering-main" && child.instanceId !== "top-deck",
      ),
      {
        child: { anchor: { x: 0, y: -postHeight / 2, z: 0 }, instanceId: "servo-post", mount: "bottom" },
        id: "mount-servo-post",
        parent: {
          anchor: { x: post.x - plate.transform.position.x, y: plate.size.y / 2, z: z - plate.transform.position.z },
          instanceId: "chassis-plate",
          mount: "top",
        },
      },
      {
        child: { anchor: { x: post.x - railX, y: -railThickness / 2, z: 0 }, instanceId: "servo-rail", mount: "bottom" },
        id: "mount-servo-rail",
        parent: { anchor: { x: 0, y: postHeight / 2, z: 0 }, instanceId: "servo-post", mount: "top" },
      },
      {
        child: { anchor: { x: 0, y: -padHeight / 2, z: 0 }, instanceId: "servo-pad", mount: "bottom" },
        id: "mount-servo-pad",
        parent: { anchor: { x: x - railX, y: railThickness / 2, z: 0 }, instanceId: "servo-rail", mount: "top" },
      },
      {
        ...seat,
        parent: { anchor: { x: 0, y: padHeight / 2, z: 0 }, instanceId: "servo-pad", mount: "top" },
      },
    ],
  };
  const clashes = checkKartClearance(document, deriveKartSnapshot(document)).clashes;
  expect(
    clashes.some(
      ({ first, second }) =>
        first === "wheel-front-left:tie-rod" && second === "wheel-front-right:tie-rod",
    ),
  ).toBe(true);
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

test("each drawn coilover lies inside its clash shape", () => {
  // Every coilover version, stood upright from its chassis eye at the
  // origin and posed as the kart draws it, fully extended and fully
  // compressed: its spring built at a rest length between them and
  // stretched. The top eye rides on its tower's pin, so its ring is left
  // out of the shape.
  const coilovers = APPROVED_KART_COMPONENTS.filter(
    (definition) => definition.category === "suspension",
  );
  expect(coilovers.length).toBeGreaterThan(0);
  for (const definition of coilovers) {
    const visual = getKartPartVisual(definition);
    const construction = definition.construction[0];
    if (visual?.kind !== "coilover" || construction.shape !== "cylinder") {
      throw new Error(`${definition.id} has no coilover visual.`);
    }
    const drawn = visual.build(definition);
    const { extendedLength, maximumStroke } = definition.suspension;
    const perches = drawn.topPerch + drawn.bottomPerch;
    const restCoil = extendedLength - maximumStroke / 2 - perches;
    const spring = buildCoilSpring(drawn.spring, restCoil);
    const { eye } = COILOVER_SIZES;
    const inTopEye = ({ x, y, z }: KartVector) =>
      Math.hypot(x, y) <= eye.radius + 1e-6 && Math.abs(z) <= eye.halfWidth + 1e-6;
    for (const length of [extendedLength, extendedLength - maximumStroke]) {
      const shapes = [
        getCoiloverClashShape(vector([0, 0, 0]), vector([0, length, 0]), construction.radius),
        getCoiloverConnectorBlock(vector([0, 0, 0]), vector([0, 1, 0])),
      ];
      const stretch = (length - perches) / restCoil;
      const points = [
        // Every body piece but the top eye's ring, which lies wholly in it.
        ...pointsOf(
          drawn.body.filter(
            (piece) => !pointsOf([piece], (point) => point).every(inTopEye),
          ),
          ([x, y, z]) => [x, y, z],
        ),
        // The shaft is turned 180° about Z to face back up the shock.
        ...pointsOf(drawn.shaft, ([x, y, z]) => [-x, length - y, z]),
        ...pointsOf([spring], ([x, y, z]) => [x, drawn.topPerch + y * stretch, z]),
      ];
      for (const point of points) {
        const gap = Math.min(
          ...shapes.map(
            (shape) =>
              measureConvexPair({ kind: "rounded", points: [point], radius: 0 }, shape)
                .distance,
          ),
        );
        expect(gap, `${definition.id}@${definition.version} at ${length} m`)
          .toBeLessThanOrEqual(1e-5);
      }
    }
  }
});

function pointsOf(
  pieces: { positions: number[] }[],
  place: (point: [number, number, number]) => [number, number, number],
) {
  return pieces.flatMap(({ positions }) =>
    Array.from({ length: positions.length / 3 }, (_, index) =>
      vector(place([positions[3 * index], positions[3 * index + 1], positions[3 * index + 2]])),
    ),
  );
}
