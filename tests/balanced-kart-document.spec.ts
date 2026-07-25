import { expect, test } from "@playwright/test";

import {
  BALANCED_KART_ID,
  createBalancedKartDocument,
} from "../src/game/kart/balanced-kart-document";
import { deriveKartSnapshot } from "../src/game/kart/kart-derivation";

test("ships a fresh valid Balanced Kart assembly template", () => {
  const first = createBalancedKartDocument();
  const second = createBalancedKartDocument();
  const snapshot = deriveKartSnapshot(first);

  expect(first).toEqual(second);
  expect(first).not.toBe(second);
  expect(first.kartId).toBe(BALANCED_KART_ID);
  expect(first.name).toBe("Balanced Kart");
  expect(
    Object.fromEntries(
      first.componentInstances.map(({ definition, id }) => [id, definition.id]),
    ),
  ).toEqual({
    "battery-main": "battery.lipo-standard",
    "brakes-main": "brakes.combined-standard",
    "controller-main": "control.receiver-esc-standard",
    "motor-main": "motor.brushless-standard",
    "steering-main": "steering.servo-standard",
    "suspension-front-left": "suspension.firm-short",
    "suspension-front-right": "suspension.firm-short",
    "suspension-rear-left": "suspension.firm-short",
    "suspension-rear-right": "suspension.firm-short",
    "transmission-main": "transmission.balanced-5to1",
    "wheel-front-left": "wheel-tire.small-standard",
    "wheel-front-right": "wheel-tire.small-standard",
    "wheel-rear-left": "wheel-tire.small-standard",
    "wheel-rear-right": "wheel-tire.small-standard",
  });
  const components = new Map(
    first.componentInstances.map((instance) => [instance.id, instance]),
  );
  const frontLeft = components.get("wheel-front-left")!;
  const frontRight = components.get("wheel-front-right")!;
  const rearLeft = components.get("wheel-rear-left")!;
  const chassis = first.primitiveInstances.find(
    ({ id }) => id === "chassis-plate",
  )!;
  if (chassis.shape !== "box") {
    throw new Error("Balanced Kart chassis must be a box.");
  }
  expect(frontRight.transform.position.x - frontLeft.transform.position.x).toBe(
    0.39,
  );
  expect(rearLeft.transform.position.z - frontLeft.transform.position.z).toBe(
    0.3,
  );
  expect(
    first.componentInstances
      .filter(({ mirrorOf }) => mirrorOf)
      .map(({ id, mirrorOf }) => [id, mirrorOf]),
  ).toEqual([
    ["suspension-front-right", "suspension-front-left"],
    ["suspension-rear-right", "suspension-rear-left"],
    ["wheel-front-right", "wheel-front-left"],
    ["wheel-rear-right", "wheel-rear-left"],
  ]);
  expect(first.connections.map(({ id }) => id).sort()).toEqual(
    [
      "control-controller-brakes",
      "control-controller-steering",
      "drive-motor-transmission",
      "drive-transmission-rear-left",
      "drive-transmission-rear-right",
      "handbrake-rear-left",
      "handbrake-rear-right",
      "link-suspension-front-left",
      "link-suspension-front-right",
      "link-suspension-rear-left",
      "link-suspension-rear-right",
      "power-battery-controller",
      "power-controller-motor",
      "service-brake-front-left",
      "service-brake-front-right",
      "service-brake-rear-left",
      "service-brake-rear-right",
      "steering-front-left",
      "steering-front-right",
    ].sort(),
  );
  expect(first.structuralAttachments).toHaveLength(17);
  for (const station of [
    "front-left",
    "front-right",
    "rear-left",
    "rear-right",
  ]) {
    const suspension = components.get(`suspension-${station}`)!;
    const wheel = components.get(`wheel-${station}`)!;
    expect(suspension.suspensionMount?.hubAnchor).toEqual(
      wheel.transform.position,
    );
    const chassisAnchor = suspension.suspensionMount?.chassisAnchor;
    expect(chassisAnchor).toBeDefined();
    expect(chassisAnchor?.y).toBeCloseTo(
      chassis.transform.position.y + chassis.size.y / 2,
    );
    expect(Math.abs(chassisAnchor?.x ?? Infinity)).toBeLessThanOrEqual(
      chassis.size.x / 2,
    );
    expect(Math.abs(chassisAnchor?.z ?? Infinity)).toBeLessThanOrEqual(
      chassis.size.z / 2,
    );
    expect(
      Math.hypot(
        (chassisAnchor?.x ?? Infinity) -
          (suspension.suspensionMount?.springArmAnchor.x ?? -Infinity),
        (chassisAnchor?.y ?? Infinity) -
          (suspension.suspensionMount?.springArmAnchor.y ?? -Infinity),
        (chassisAnchor?.z ?? Infinity) -
          (suspension.suspensionMount?.springArmAnchor.z ?? -Infinity),
      ),
    ).toBeCloseTo(0.102);
    const suspensionAttachment = first.structuralAttachments.find(
      ({ child }) => child.instanceId === suspension.id,
    );
    expect(suspensionAttachment?.parent.instanceId).toBe(chassis.id);
    expect(
      chassis.transform.position.x +
        (suspensionAttachment?.parent.anchor.x ?? Infinity),
    ).toBeCloseTo(chassisAnchor?.x ?? -Infinity);
    expect(
      chassis.transform.position.y +
        (suspensionAttachment?.parent.anchor.y ?? Infinity),
    ).toBeCloseTo(chassisAnchor?.y ?? -Infinity);
    expect(
      chassis.transform.position.z +
        (suspensionAttachment?.parent.anchor.z ?? Infinity),
    ).toBeCloseTo(chassisAnchor?.z ?? -Infinity);
    expect(
      first.structuralAttachments.find(
        ({ child }) => child.instanceId === wheel.id,
      )?.parent.instanceId,
    ).toBe(suspension.id);
  }
  expect(snapshot.massProperties.totalMass).toBeCloseTo(1.8242717435, 8);
  expect(snapshot.geometry.wheelStations).toHaveLength(4);
  expect(snapshot.playerStats).toEqual({
    acceleration: 42,
    handling: 57,
    speed: 41,
    stability: 42,
  });
  expect(
    Math.max(...Object.values(snapshot.playerStats)) -
      Math.min(...Object.values(snapshot.playerStats)),
  ).toBeLessThanOrEqual(20);
  expect(
    Object.fromEntries(
      first.primitiveInstances.map(({ id, material }) => [id, material.id]),
    ),
  ).toMatchObject({
    "front-bumper": "material.engineering-polymer",
    "rear-bumper": "material.engineering-polymer",
  });
  expect(
    first.primitiveInstances.find(({ id }) => id === "upper-housing")
      ?.construction,
  ).toEqual({ mode: "shell", thickness: 0.0005 });
});

test("can initialize a distinct protected draft ID without changing construction", () => {
  const document = createBalancedKartDocument("admin-kart-draft");
  const canonical = createBalancedKartDocument();
  expect(document.kartId).toBe("admin-kart-draft");
  expect({ ...document, kartId: BALANCED_KART_ID }).toEqual(canonical);
  expect(() => deriveKartSnapshot(document)).not.toThrow();
});
