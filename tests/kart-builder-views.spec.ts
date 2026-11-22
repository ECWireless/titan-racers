import { expect, test } from "@playwright/test";

import type { KartAssemblyDocument } from "../src/game/kart/kart-assembly-document";
import {
  getKartWheelViewPoses,
  KART_REST_POSE,
  measureKartPartGap,
} from "../src/game/kart/kart-clearance";
import { deriveKartSnapshot } from "../src/game/kart/kart-derivation";
import { getKartExplodeOffsets } from "../src/game/kart/kart-explode";
import { runKartFitCheck } from "../src/game/kart/kart-fit-check";
import { createOfficialKartDocument } from "../src/game/kart/official-kart-roster";

const balanced = () => createOfficialKartDocument("balanced-kart");

test("poses each wheel from full droop through rest to full bump, and steers as races do", () => {
  const document = balanced();
  const snapshot = deriveKartSnapshot(document);
  const station = snapshot.geometry.wheelStations.find(
    ({ id }) => id === "wheel-front-left",
  )!;
  const { maximumWheelTravel, restWheelCompression } = station.suspension;
  const at = (steer: number, travel: number) =>
    getKartWheelViewPoses(document, snapshot, { steer, travel });

  for (const pose of at(0, 0).values()) {
    expect(pose.travel).toBe(0);
    expect(pose.steerDegrees).toBe(0);
  }
  expect(at(0, 1).get("wheel-front-left")!.travel).toBeCloseTo(
    maximumWheelTravel - restWheelCompression,
    12,
  );
  expect(at(0, -1).get("wheel-front-left")!.travel).toBeCloseTo(
    -restWheelCompression,
    12,
  );

  // Full left lock: both front wheels turn left (positive), the inner (left)
  // one further, and the rear wheels don't steer.
  const lock = snapshot.physicalProfile.steering.maximumCenterAngle;
  const left = at(1, 0);
  expect(left.get("wheel-front-left")!.centerSteerDegrees).toBeCloseTo(lock, 9);
  expect(left.get("wheel-front-left")!.steerDegrees).toBeGreaterThan(
    left.get("wheel-front-right")!.steerDegrees,
  );
  expect(left.get("wheel-front-right")!.steerDegrees).toBeGreaterThan(0);
  expect(left.get("wheel-rear-left")!.steerDegrees).toBe(0);
  expect(at(-1, 0).get("wheel-front-right")!.steerDegrees).toBeCloseTo(
    -left.get("wheel-front-left")!.steerDegrees,
    9,
  );
});

test("measures the gap between two parts as the kart moves", () => {
  const document = balanced();
  const snapshot = deriveKartSnapshot(document);
  const gap = (pose = KART_REST_POSE) =>
    measureKartPartGap(
      document,
      snapshot,
      "wheel-front-left",
      "chassis-plate",
      pose,
    )!;

  const rest = gap();
  expect(rest.distance).toBeGreaterThan(0.05);
  // Its nearest points lie that far apart.
  expect(
    Math.hypot(
      rest.pointA.x - rest.pointB.x,
      rest.pointA.y - rest.pointB.y,
      rest.pointA.z - rest.pointB.z,
    ),
  ).toBeCloseTo(rest.distance, 6);
  // Steered in at full bump, the wheel comes closer to the plate.
  expect(gap({ steer: 1, travel: 1 }).distance).toBeLessThan(
    rest.distance - 0.02,
  );
  // Measured the other way round, the same.
  expect(
    measureKartPartGap(document, snapshot, "chassis-plate", "wheel-front-left")!
      .distance,
  ).toBeCloseTo(rest.distance, 9);
  expect(
    measureKartPartGap(document, snapshot, "chassis-plate", "chassis-plate"),
  ).toBeNull();
});

test("explodes each part off the face it is mounted on, carrying what sits on it", () => {
  const document = balanced();
  const offsets = getKartExplodeOffsets(document);
  const parentOf = (id: string) =>
    document.structuralAttachments.find(
      ({ child }) => child.instanceId === id,
    )!.parent.instanceId;
  const minus = (id: string, parentId: string) => {
    const [a, b] = [offsets.get(id)!, offsets.get(parentId)!];
    return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
  };

  // The root stays.
  const roots = [
    ...document.primitiveInstances,
    ...document.componentInstances,
  ].filter(
    ({ id }) =>
      !document.structuralAttachments.some(
        ({ child }) => child.instanceId === id,
      ),
  );
  expect(roots.length).toBeGreaterThan(0);
  for (const { id } of roots) expect(offsets.get(id)).toEqual({ x: 0, y: 0, z: 0 });

  // The battery lifts straight up off the plate's top.
  const battery = minus("battery-main", parentOf("battery-main"));
  expect(battery.y).toBeGreaterThan(0.02);
  expect(Math.abs(battery.x)).toBeLessThan(1e-9);
  expect(Math.abs(battery.z)).toBeLessThan(1e-9);

  // Wheels move outboard from their suspension.
  expect(minus("wheel-front-left", parentOf("wheel-front-left")).x).toBeLessThan(0);
  expect(minus("wheel-front-right", parentOf("wheel-front-right")).x).toBeGreaterThan(0);

  // Each part moves as its parent does, plus a step of its own: at least the
  // gap, and never more than the gap and its capped depth.
  for (const id of ["speed-kart", "balanced-kart", "handling-kart"] as const) {
    const kart = createOfficialKartDocument(id);
    const kartOffsets = getKartExplodeOffsets(kart);
    for (const { child, parent } of kart.structuralAttachments) {
      const [a, b] = [
        kartOffsets.get(child.instanceId)!,
        kartOffsets.get(parent.instanceId)!,
      ];
      const step = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
      expect(step).toBeGreaterThan(0.0199);
      expect(step).toBeLessThan(0.0681);
    }
  }
});

test("checks fit as the save gate does: clashes and unsnapped parts", () => {
  const document = balanced();
  const fits = runKartFitCheck(document)!;
  expect(fits.clashes).toEqual([]);
  expect(fits.unsnapped).toBe(0);

  const unsnapped: KartAssemblyDocument = {
    ...document,
    structuralAttachments: document.structuralAttachments.map(
      (attachment) =>
        attachment.child.instanceId === "battery-main"
          ? {
              ...attachment,
              child: { ...attachment.child, mount: null },
              parent: { ...attachment.parent, mount: null },
            }
          : attachment,
    ),
  };
  expect(runKartFitCheck(unsnapped)!.unsnapped).toBe(1);
});
