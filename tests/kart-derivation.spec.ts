import { expect, test } from "@playwright/test";

import { KartAssemblyValidationError } from "../src/game/kart/kart-assembly-validation";
import {
  deriveKartSnapshot,
  hashResolvedKartSnapshot,
  KART_DERIVATION_VERSION,
  parseResolvedKartSnapshot,
  type ResolvedKartSnapshot,
  type ResolvedKartSnapshotV1,
  serializeResolvedKartSnapshot,
  wheelOverlapsCollisionBoundsAtAngle,
} from "../src/game/kart/kart-derivation";
import { buildPrimitiveMassElement } from "../src/game/kart/kart-construction-geometry";
import { getAckermannWheelSteerAngle } from "../src/game/kart/kart-steering";
import {
  createPredictedKartAssemblies,
  createValidKartAssembly,
} from "./support/kart-assembly";

test("derives the accepted balanced physical capabilities from construction", () => {
  const snapshot = deriveKartSnapshot(createValidKartAssembly());

  expect(snapshot.derivationVersion).toBe(KART_DERIVATION_VERSION);
  expect(snapshot.massProperties.totalMass).toBeGreaterThan(1.5);
  expect(snapshot.massProperties.totalMass).toBeLessThan(2.2);
  expect(snapshot.physicalProfile.drivetrain.maximumDriveForce).toBeCloseTo(
    17.8125,
    6,
  );
  expect(snapshot.physicalProfile.drivetrain.noLoadSpeed).toBeCloseTo(
    16.8546445865,
    8,
  );
  expect(snapshot.physicalProfile.brakes.maximumServiceBrakeForce).toBeCloseTo(
    26.25,
    8,
  );
  expect(snapshot.physicalProfile.brakes.maximumHandbrakeForce).toBeCloseTo(
    11.8125,
    8,
  );
  expect(snapshot.physicalProfile.suspension.springRate).toBeCloseTo(812.5, 8);
  expect(snapshot.geometry.wheelbase).toBeCloseTo(0.3, 8);
  expect(snapshot.geometry.trackWidth).toBeCloseTo(0.39, 8);
  expect(snapshot.geometry.wheelStations).toHaveLength(4);
});

test("derives finite symmetric full mass properties and collision geometry", () => {
  const snapshot = deriveKartSnapshot(createValidKartAssembly());
  const { inertiaTensor } = snapshot.massProperties;

  expect(snapshot.massProperties.centerOfMass.y).toBeGreaterThan(0);
  expect(inertiaTensor.xx).toBeGreaterThan(0);
  expect(inertiaTensor.yy).toBeGreaterThan(0);
  expect(inertiaTensor.zz).toBeGreaterThan(0);
  expect(inertiaTensor.xy).toBeCloseTo(inertiaTensor.yx, 12);
  expect(inertiaTensor.xz).toBeCloseTo(inertiaTensor.zx, 12);
  expect(inertiaTensor.yz).toBeCloseTo(inertiaTensor.zy, 12);
  expect(snapshot.geometry.collisionCompound.map(({ id }) => id)).toEqual([
    "chassis-plate",
    "upper-housing",
  ]);
  expect(snapshot.geometry.smallestRelevantCrossSection).toBeGreaterThan(0);
});

test("is deterministic across repeated resolution and irrelevant array order", async () => {
  const document = createValidKartAssembly();
  const reordered = structuredClone(document);
  reordered.componentInstances.reverse();
  reordered.primitiveInstances.reverse();
  reordered.connections.reverse();
  reordered.structuralAttachments.reverse();

  const first = deriveKartSnapshot(document);
  const second = deriveKartSnapshot(document);
  const reorderedSnapshot = deriveKartSnapshot(reordered);

  expect(second).toEqual(first);
  expect(reorderedSnapshot).toEqual(first);
  expect(serializeResolvedKartSnapshot(first)).toBe(
    serializeResolvedKartSnapshot(reorderedSnapshot),
  );
  expect(await hashResolvedKartSnapshot(first)).toBe(
    await hashResolvedKartSnapshot(second),
  );
  expect(await hashResolvedKartSnapshot(first)).toMatch(/^[0-9a-f]{64}$/);
});

test("canonicalizes object key order before serialization and hashing", async () => {
  const snapshot = deriveKartSnapshot(createValidKartAssembly());
  const reordered = Object.fromEntries(
    Object.entries(structuredClone(snapshot)).reverse(),
  ) as unknown as ResolvedKartSnapshot;

  expect(serializeResolvedKartSnapshot(reordered)).toBe(
    serializeResolvedKartSnapshot(snapshot),
  );
  expect(await hashResolvedKartSnapshot(reordered)).toBe(
    await hashResolvedKartSnapshot(snapshot),
  );
});

test("moving the same sealed component changes mass distribution but not capability", () => {
  const originalDocument = createValidKartAssembly();
  const movedDocument = structuredClone(originalDocument);
  const battery = movedDocument.componentInstances.find(
    ({ id }) => id === "battery-main",
  )!;
  battery.transform.position.x = 0.04;
  const batteryMount = movedDocument.structuralAttachments.find(
    ({ id }) => id === "mount-battery-main",
  )!;
  batteryMount.parent.anchor.x += 0.04;

  const original = deriveKartSnapshot(originalDocument);
  const moved = deriveKartSnapshot(movedDocument);

  expect(moved.massProperties.totalMass).toBe(original.massProperties.totalMass);
  expect(moved.massProperties.centerOfMass.x).toBeGreaterThan(
    original.massProperties.centerOfMass.x,
  );
  expect(moved.massProperties.inertiaTensor.yy).not.toBe(
    original.massProperties.inertiaTensor.yy,
  );
  expect(moved.physicalProfile.drivetrain).toEqual(
    original.physicalProfile.drivetrain,
  );
});

test("construction material changes mass without an authored mass field", () => {
  const aluminum = createValidKartAssembly();
  const polymer = createValidKartAssembly({
    bodyMaterial: "material.engineering-polymer",
  });

  const aluminumSnapshot = deriveKartSnapshot(aluminum);
  const polymerSnapshot = deriveKartSnapshot(polymer);

  expect(polymerSnapshot.massProperties.totalMass).toBeLessThan(
    aluminumSnapshot.massProperties.totalMass,
  );
  expect(polymer).not.toHaveProperty("totalMass");
  expect(polymer).not.toHaveProperty("maximumDriveForce");
});

test("preserves the predicted official-build behavior ordering", () => {
  const documents = createPredictedKartAssemblies();
  const balanced = deriveKartSnapshot(documents.balanced);
  const handling = deriveKartSnapshot(documents.handling);
  const speed = deriveKartSnapshot(documents.speed);
  const acceleration = (snapshot: typeof balanced) =>
    snapshot.physicalProfile.drivetrain.maximumDriveForce /
    snapshot.massProperties.totalMass;

  expect(acceleration(handling)).toBeGreaterThan(acceleration(balanced));
  expect(acceleration(balanced)).toBeGreaterThan(acceleration(speed));
  expect(speed.physicalProfile.drivetrain.noLoadSpeed).toBeGreaterThan(
    balanced.physicalProfile.drivetrain.noLoadSpeed,
  );
  expect(balanced.physicalProfile.drivetrain.noLoadSpeed).toBeGreaterThan(
    handling.physicalProfile.drivetrain.noLoadSpeed,
  );
  expect(handling.playerStats.handling).toBeGreaterThan(
    balanced.playerStats.handling,
  );
  expect(balanced.playerStats.handling).toBeGreaterThan(
    speed.playerStats.handling,
  );
  expect(handling.playerStats.stability).toBeGreaterThan(
    balanced.playerStats.stability,
  );
  expect(balanced.playerStats.stability).toBeGreaterThan(
    speed.playerStats.stability,
  );
});

test("derives suspension travel and rest geometry at every wheel station", () => {
  const snapshot = deriveKartSnapshot(createValidKartAssembly());

  for (const station of snapshot.geometry.wheelStations) {
    expect(station.axleDirection).toEqual({ x: 1, y: 0, z: 0 });
    expect(station.suspension.motionRatio).toBeCloseTo(
      Math.sqrt(812.5 / 1_600),
      8,
    );
    expect(station.suspension.maximumWheelTravel).toBeGreaterThan(0);
    expect(station.suspension.restWheelCompression).toBeGreaterThan(0);
    expect(station.suspension.restWheelCompression).toBeLessThan(
      station.suspension.maximumWheelTravel,
    );
    expect(station.suspension.bumpStartWheelCompression).toBeLessThan(
      station.suspension.maximumWheelTravel,
    );
  }
});

test("keeps stability invariant when the assembly datum is translated", () => {
  const document = createValidKartAssembly();
  const translated = structuredClone(document);
  for (const instance of [
    ...translated.componentInstances,
    ...translated.primitiveInstances,
  ]) {
    instance.transform.position.y += 0.1;
  }
  for (const instance of translated.componentInstances) {
    if (!instance.suspensionMount) continue;
    instance.suspensionMount.armPivot.y += 0.1;
    instance.suspensionMount.chassisAnchor.y += 0.1;
    instance.suspensionMount.hubAnchor.y += 0.1;
    instance.suspensionMount.springArmAnchor.y += 0.1;
  }

  const original = deriveKartSnapshot(document);
  const moved = deriveKartSnapshot(translated);

  expect(moved.massProperties.centerOfMass.y).toBeCloseTo(
    original.massProperties.centerOfMass.y + 0.1,
    10,
  );
  expect(moved.massProperties.totalMass).toBe(original.massProperties.totalMass);
  expect(moved.massProperties.inertiaTensor).toEqual(
    original.massProperties.inertiaTensor,
  );
  expect(moved.playerStats.stability).toBe(original.playerStats.stability);
});

test("records tire construction without persisting contacted-surface values", () => {
  const snapshot = deriveKartSnapshot(createValidKartAssembly());

  expect(snapshot.registryReferences.tireCompound).toEqual({
    id: "tire-compound.standard-rubber",
    version: 1,
  });
  expect(snapshot.registryReferences).not.toHaveProperty("surfaceMaterial");
  expect(snapshot).not.toHaveProperty("tireSurfaceInteraction");
});

test("retains version-one evidence and its audit hash", async () => {
  const current = structuredClone(
    deriveKartSnapshot(createValidKartAssembly()),
  ) as unknown as ResolvedKartSnapshot;
  const legacy: ResolvedKartSnapshotV1 = {
    ...current,
    derivationVersion: 1,
    registryReferences: {
      components: current.registryReferences.components.map(({ id, version }) => ({
        id,
        version,
      })),
      materials: current.registryReferences.materials.map(({ id, version }) => ({
        id,
        version,
      })),
      surfaceMaterial: { id: "surface.standard-course", version: 1 },
      tireCompound: { ...current.registryReferences.tireCompound },
      tireSurfaceInteractionDerivationVersion: 1,
    },
    snapshotVersion: 1,
    tireSurfaceInteraction: {
      peakGripCoefficient: 1.42,
      peakSlipAngleDegrees: 5,
      rollingResistanceCoefficient: 0.025,
      slidingGripCoefficient: 0.98,
      slidingSlipAngleDegrees: 18,
    },
  };

  expect(parseResolvedKartSnapshot(legacy)).toEqual(legacy);
  await expect(hashResolvedKartSnapshot(legacy)).resolves.toMatch(
    /^[0-9a-f]{64}$/,
  );
});

test("rejects derived wheel and chassis collision overlap", () => {
  const overlapping = createValidKartAssembly({ trackWidth: 0.28 });

  expect(() => deriveKartSnapshot(overlapping)).toThrow(
    KartAssemblyValidationError,
  );
  try {
    deriveKartSnapshot(overlapping);
  } catch (error) {
    expect(error).toBeInstanceOf(KartAssemblyValidationError);
    expect((error as KartAssemblyValidationError).issues).toContainEqual(
      expect.objectContaining({ code: "wheel-collision-overlap" }),
    );
  }
});

test("uses collision geometry local to the swept front-wheel envelope", () => {
  const shortWideBody = deriveKartSnapshot(
    createValidKartAssembly({ bodySize: { x: 0.38, y: 0.03, z: 0.18 } }),
  );

  expect(shortWideBody.physicalProfile.steering.maximumCenterAngle).toBeGreaterThan(
    1,
  );
});

test("keeps runtime Ackermann wheel angles clear at derived steering lock", () => {
  const document = createValidKartAssembly();
  const snapshot = deriveKartSnapshot(document);
  const steeredWheels = snapshot.geometry.wheelStations.filter(
    ({ steered }) => steered,
  );
  const steeringCenterX =
    steeredWheels.reduce((sum, wheel) => sum + wheel.position.x, 0) /
    steeredWheels.length;
  const collisionBounds = document.primitiveInstances
    .filter(({ collision }) => collision === "solid")
    .map((primitive) => buildPrimitiveMassElement(primitive).bounds);
  const maximumCenterAngle =
    snapshot.physicalProfile.steering.maximumCenterAngle;
  const actualAngles: number[] = [];

  for (const signedCenterAngle of [
    -maximumCenterAngle,
    maximumCenterAngle,
  ]) {
    for (const wheel of steeredWheels) {
      const wheelAngle = getAckermannWheelSteerAngle(
        signedCenterAngle,
        wheel.position.x - steeringCenterX,
        {
          centerOfMassHeight: 0,
          trackWidth: snapshot.geometry.trackWidth,
          wheelbase: snapshot.geometry.wheelbase,
        },
      );
      actualAngles.push(Math.abs(wheelAngle));
      for (const bounds of collisionBounds) {
        expect(
          wheelOverlapsCollisionBoundsAtAngle(wheel, wheelAngle, bounds),
        ).toBe(false);
      }
    }
  }
  expect(Math.max(...actualAngles)).toBeGreaterThan(maximumCenterAngle);
});

test("bounds extreme Ackermann geometry before an inside wheel becomes invalid", () => {
  const document = createValidKartAssembly({
    bodySize: { x: 0.41, y: 0.03, z: 0.1 },
    trackWidth: 0.6,
    wheelbase: 0.15,
  });
  const snapshot = deriveKartSnapshot(document);
  const steeredWheels = snapshot.geometry.wheelStations.filter(
    ({ steered }) => steered,
  );
  const steeringCenterX =
    steeredWheels.reduce((sum, wheel) => sum + wheel.position.x, 0) /
    steeredWheels.length;
  const collisionBounds = document.primitiveInstances
    .filter(({ collision }) => collision === "solid")
    .map((primitive) => buildPrimitiveMassElement(primitive).bounds);
  const maximumCenterAngle =
    snapshot.physicalProfile.steering.maximumCenterAngle;

  for (const signedCenterAngle of [
    -maximumCenterAngle,
    maximumCenterAngle,
  ]) {
    for (const wheel of steeredWheels) {
      const wheelAngle = getAckermannWheelSteerAngle(
        signedCenterAngle,
        wheel.position.x - steeringCenterX,
        {
          centerOfMassHeight: 0,
          trackWidth: snapshot.geometry.trackWidth,
          wheelbase: snapshot.geometry.wheelbase,
        },
      );
      expect(Number.isFinite(wheelAngle)).toBe(true);
      expect(Math.abs(wheelAngle)).toBeGreaterThan(0);
      expect(Math.sign(wheelAngle)).toBe(Math.sign(signedCenterAngle));
      for (const bounds of collisionBounds) {
        expect(
          wheelOverlapsCollisionBoundsAtAngle(wheel, wheelAngle, bounds),
        ).toBe(false);
      }
    }
  }
});

test("rejects construction without minimum usable steering clearance", () => {
  const steeringBlocked = createValidKartAssembly({
    bodySize: { x: 0.36, y: 0.03, z: 0.4 },
  });

  expect(() => deriveKartSnapshot(steeringBlocked)).toThrow(
    KartAssemblyValidationError,
  );
  try {
    deriveKartSnapshot(steeringBlocked);
  } catch (error) {
    expect(error).toBeInstanceOf(KartAssemblyValidationError);
    expect((error as KartAssemblyValidationError).issues).toContainEqual(
      expect.objectContaining({ code: "insufficient-steering-clearance" }),
    );
  }
});

test("returns deeply immutable resolved evidence", () => {
  const snapshot = deriveKartSnapshot(createValidKartAssembly());
  const originalMass = snapshot.massProperties.totalMass;

  expect(() => {
    (snapshot.massProperties as { totalMass: number }).totalMass = 99;
  }).toThrow(TypeError);
  expect(snapshot.massProperties.totalMass).toBe(originalMass);
});
