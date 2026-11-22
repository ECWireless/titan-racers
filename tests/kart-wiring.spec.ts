import { expect, test } from "@playwright/test";

import { createBalancedKartDocument } from "../src/game/kart/balanced-kart-document";
import type { KartAssemblyDocument } from "../src/game/kart/kart-assembly-document";
import { createHandlingKartDocument } from "../src/game/kart/handling-kart-document";
import { getKartWheelViewPoses } from "../src/game/kart/kart-clearance";
import { getApprovedKartComponent } from "../src/game/kart/kart-component-registry";
import {
  buildComponentMassElements,
  buildPrimitiveMassElement,
  type KartVector,
} from "../src/game/kart/kart-construction-geometry";
import {
  getConvexShapeBounds,
  measureConvexPair,
  type KartConvexShape,
} from "../src/game/kart/kart-convex-distance";
import { deriveKartSnapshot } from "../src/game/kart/kart-derivation";
import {
  getDriveshaftEnds,
  getHornAngle,
  getHornBall,
  getKnuckleBall,
  planKartLinkagePoses,
} from "../src/game/kart/kart-linkage-poses";
import {
  BALL_CUP_RADIUS,
  DOGBONE_BALL_RADIUS,
} from "../src/game/kart/kart-linkage-visual-geometry";
import {
  buildKartCablePieces,
  planKartCables,
  type KartCable,
} from "../src/game/kart/kart-wiring";
import { createSpeedKartDocument } from "../src/game/kart/speed-kart-document";

const OFFICIAL_KARTS = [
  createBalancedKartDocument,
  createSpeedKartDocument,
  createHandlingKartDocument,
];

// Parts may rest on each other this deep where they only touch
// (kart-clearance.ts), and cables lie on the plate.
const TOUCH = 0.0002;
// What the cables keep from a moving linkage, whatever its pose.
const LINKAGE_GAP = 0.001;

// Every vertex of a cable as drawn: its tube and any plug housing.
const drawnPoints = (cable: KartCable): KartVector[] =>
  buildKartCablePieces([cable]).flatMap(({ positions }) =>
    Array.from({ length: positions.length / 3 }, (_, index) => ({
      x: positions[3 * index],
      y: positions[3 * index + 1],
      z: positions[3 * index + 2],
    })),
  );

/** The gap from a point to a rod of `radius` between `start` and `end`. */
function rodGap(point: KartVector, start: KartVector, end: KartVector, radius: number) {
  const span = { x: end.x - start.x, y: end.y - start.y, z: end.z - start.z };
  const squared = span.x ** 2 + span.y ** 2 + span.z ** 2;
  const t =
    squared > 0
      ? Math.min(
          1,
          Math.max(
            0,
            ((point.x - start.x) * span.x +
              (point.y - start.y) * span.y +
              (point.z - start.z) * span.z) /
              squared,
          ),
        )
      : 0;
  return (
    Math.hypot(
      point.x - start.x - span.x * t,
      point.y - start.y - span.y * t,
      point.z - start.z - span.z * t,
    ) - radius
  );
}

// Each wired connection's cables: their colours, whether power wire, and
// their plugs.
const wiring = (cables: KartCable[]) => {
  const byConnection: Record<string, string[]> = {};
  for (const { color, parts, plugs, radius } of cables) {
    (byConnection[parts.join(" > ")] ??= []).push(
      `${color} ${radius > 0.0015 ? "power" : "signal"} ${plugs.length} plug`,
    );
  }
  for (const wires of Object.values(byConnection)) wires.sort();
  return byConnection;
};

test("each official kart is wired from its functional connections", () => {
  for (const create of OFFICIAL_KARTS) {
    const document = create();
    expect(wiring(planKartCables(document)), document.kartId).toEqual({
      "battery-main > controller-main": ["black power 1 plug", "red power 1 plug"],
      "controller-main > brakes-main": ["black signal 0 plug"],
      "controller-main > motor-main": [
        "black power 0 plug", "black power 0 plug", "black power 0 plug",
      ],
      "controller-main > steering-main": ["black signal 0 plug"],
    });
    // A connection taken away takes its cable with it.
    const unbraked = {
      ...document,
      connections: document.connections.filter(
        ({ to }) => to.instanceId !== "brakes-main" || to.portId !== "control-input",
      ),
    };
    expect(Object.keys(wiring(planKartCables(unbraked))), document.kartId).not.toContain(
      "controller-main > brakes-main",
    );
  }
});

// Parts crowding a port, which the router must route round or leave its
// lead out: a block at the controller's brake plug, and a 1 mm cube in the
// side of the battery's red plug housing.
function createCrowdedPortKart() {
  const document = createBalancedKartDocument();
  const box = (id: string, size: number[], position: number[]) =>
    ({
      ...document.primitiveInstances[0],
      id,
      size: { x: size[0], y: size[1], z: size[2] },
      transform: {
        position: { x: position[0], y: position[1], z: position[2] },
        rotationDegrees: { x: 0, y: 0, z: 0 },
      },
    }) as KartAssemblyDocument["primitiveInstances"][number];
  const [plug] = planKartCables(document).find(({ color }) => color === "red")!.plugs;
  document.primitiveInstances.push(
    box("brake-plug-guard", [0.006, 0.017, 0.004], [0.035, 0.0545, -0.0365]),
    box("battery-plug-guard", [0.001, 0.001, 0.001], [
      plug.start.x + 0.0028,
      (plug.start.y + plug.end.y) / 2,
      plug.start.z,
    ]),
  );
  return document;
}

test("cables clear every part but the two they join", () => {
  for (const create of [...OFFICIAL_KARTS, createCrowdedPortKart]) {
    const document = create();
    const solids = [
      ...document.primitiveInstances.map((primitive) => ({
        id: primitive.id,
        shape: buildPrimitiveMassElement(primitive).solid as KartConvexShape,
      })),
      ...document.componentInstances.flatMap((instance) =>
        buildComponentMassElements(
          instance,
          getApprovedKartComponent(instance.definition)!,
        ).map((element) => ({
          id: instance.id,
          shape: element.solid as KartConvexShape,
        })),
      ),
    ].map((solid) => ({ ...solid, bounds: getConvexShapeBounds(solid.shape) }));
    for (const cable of planKartCables(document)) {
      const joined = new Set(cable.parts);
      // Its centreline and plugs as rods catch a thin part they pass
      // through, and its drawn vertices what rounding adds.
      const shapes: KartConvexShape[] = [
        ...cable.points.slice(1).map((end, index) => ({
          kind: "rounded" as const,
          points: [cable.points[index], end],
          radius: cable.radius,
        })),
        ...cable.plugs.map(({ end, start }) => ({
          kind: "rounded" as const,
          points: [start, end],
          radius: 0.0028,
        })),
        ...drawnPoints(cable).map((point) => ({
          kind: "rounded" as const,
          points: [point],
          radius: 0,
        })),
      ];
      for (const shape of shapes) {
        const reach = getConvexShapeBounds(shape);
        for (const { bounds, id, shape: solid } of solids) {
          if (
            joined.has(id) ||
            (["x", "y", "z"] as const).some(
              (axis) =>
                reach.maximum[axis] < bounds.minimum[axis] ||
                reach.minimum[axis] > bounds.maximum[axis],
            )
          ) {
            continue;
          }
          const { distance } = measureConvexPair(shape, solid);
          expect(distance, `${document.kartId} cable vs ${id}`).toBeGreaterThanOrEqual(
            -TOUCH,
          );
        }
      }
    }
  }
});

test("official karts' cables clear the tie rods and driveshafts in every pose", () => {
  for (const create of OFFICIAL_KARTS) {
    const document = create();
    const snapshot = deriveKartSnapshot(document);
    const linkages = planKartLinkagePoses(document);
    const hubs = new Map(
      document.componentInstances.map(({ id, transform }) => [id, transform.position]),
    );
    const cablePoints = planKartCables(document).flatMap(drawnPoints);
    for (const steer of [-1, -0.5, 0, 0.5, 1]) {
      for (const travel of [-1, -0.5, 0, 0.5, 1]) {
        const poses = getKartWheelViewPoses(document, snapshot, { steer, travel });
        const steerOf = (wheelId: string) =>
          ((poses.get(wheelId)?.steerDegrees ?? 0) * Math.PI) / 180;
        const hubOf = (wheelId: string) => {
          const hub = hubs.get(wheelId)!;
          return { ...hub, y: hub.y + (poses.get(wheelId)?.travel ?? 0) };
        };
        const rods: { end: KartVector; radius: number; start: KartVector }[] = [];
        for (const servo of linkages.servos) {
          const hornAngle = getHornAngle(servo, steerOf);
          for (const rod of servo.tieRods) {
            rods.push({
              end: getKnuckleBall(rod, hubOf(rod.wheelId), steerOf(rod.wheelId), {
                x: 0,
                y: 0,
                z: 0,
              }),
              radius: BALL_CUP_RADIUS,
              start: getHornBall(rod, hornAngle, { x: 0, y: 0, z: 0 }),
            });
          }
        }
        for (const driveshaft of linkages.driveshafts) {
          const start = { x: 0, y: 0, z: 0 };
          const end = { x: 0, y: 0, z: 0 };
          getDriveshaftEnds(driveshaft, hubOf(driveshaft.wheelId), start, end);
          rods.push({ end, radius: DOGBONE_BALL_RADIUS, start });
        }
        const nearest = Math.min(
          ...rods.flatMap(({ end, radius, start }) =>
            cablePoints.map((point) => rodGap(point, start, end, radius)),
          ),
        );
        expect(nearest, `${document.kartId} at steer ${steer}, travel ${travel}`)
          .toBeGreaterThanOrEqual(LINKAGE_GAP);
      }
    }
  }
});
