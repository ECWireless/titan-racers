import { expect, test } from "@playwright/test";

import { createBalancedKartDocument } from "../src/game/kart/balanced-kart-document";
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

test("each official kart is wired from its functional connections", () => {
  for (const create of OFFICIAL_KARTS) {
    const document = create();
    const cables = planKartCables(document);
    // Battery to controller (red and black), three motor phases, and the
    // servo and brake leads.
    expect(cables.map(({ color }) => color).sort(), document.kartId).toEqual([
      "black", "black", "black", "black", "black", "black", "red",
    ]);
    const power = cables.filter(({ radius }) => radius > 0.0015);
    expect(power, document.kartId).toHaveLength(5);
    expect(cables.flatMap(({ plugs }) => plugs), document.kartId).toHaveLength(2);
  }
});

test("official karts' cables clear every part but the two they join", () => {
  for (const create of OFFICIAL_KARTS) {
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
      // Its centreline as a rod catches a thin part it passes through, and
      // its drawn vertices what rounding and plugs add.
      const shapes: KartConvexShape[] = [
        ...cable.points.slice(1).map((end, index) => ({
          kind: "rounded" as const,
          points: [cable.points[index], end],
          radius: cable.radius,
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
