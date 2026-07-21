import { z } from "zod";

import {
  type KartAssemblyDocument,
  kartDefinitionReferenceSchema,
  kartStableIdSchema,
  kartTransformSchema,
} from "./kart-assembly-document";
import {
  KartAssemblyValidationError,
  parseValidatedKartAssembly,
  type ValidatedKartAssembly,
} from "./kart-assembly-validation";
import type { ApprovedComponentDefinition } from "./kart-component-registry";
import {
  buildComponentMassElements,
  buildPrimitiveMassElement,
  combineBounds,
  deriveMassProperties,
  projectedRectangleUnionArea,
  type KartBounds,
  type KartMassElement,
  type KartVector,
} from "./kart-construction-geometry";
import type { KartPhysicalProfile } from "./kart-physical-profile";
import { getAckermannWheelSteerAngle } from "./kart-steering";
import { deepFreeze, type DeepReadonly } from "./immutable-registry";

export const KART_DERIVATION_VERSION = 2;
export const RESOLVED_KART_SNAPSHOT_VERSION = 2;
const DRAG_SHAPE_COEFFICIENT = 0.9;
const MINIMUM_USABLE_STEERING_ANGLE_DEGREES = 1;

export type ResolvedKartWheelStation = {
  axleDirection: KartVector;
  driven: boolean;
  handbraked: boolean;
  id: string;
  position: KartVector;
  radius: number;
  serviceBraked: boolean;
  steered: boolean;
  suspension: {
    armPivot: KartVector;
    bumpStartWheelCompression: number;
    chassisAnchor: KartVector;
    hubAnchor: KartVector;
    maximumWheelTravel: number;
    motionRatio: number;
    restWheelCompression: number;
    springArmAnchor: KartVector;
  };
  width: number;
};

export type ResolvedKartSnapshot = {
  derivationVersion: typeof KART_DERIVATION_VERSION;
  geometry: {
    collisionCompound: Array<
      | {
          id: string;
          shape: "box";
          size: KartVector;
          transform: KartAssemblyDocument["primitiveInstances"][number]["transform"];
        }
      | {
          axis: "x" | "y" | "z";
          height: number;
          id: string;
          radius: number;
          shape: "cylinder";
          transform: KartAssemblyDocument["primitiveInstances"][number]["transform"];
        }
    >;
    dimensions: KartVector;
    smallestRelevantCrossSection: number;
    trackWidth: number;
    wheelbase: number;
    wheelStations: ResolvedKartWheelStation[];
  };
  kartId: string;
  massProperties: {
    centerOfMass: KartVector;
    inertiaTensor: {
      xx: number;
      xy: number;
      xz: number;
      yx: number;
      yy: number;
      yz: number;
      zx: number;
      zy: number;
      zz: number;
    };
    totalMass: number;
  };
  physicalProfile: KartPhysicalProfile;
  playerStats: {
    acceleration: number;
    handling: number;
    speed: number;
    stability: number;
  };
  registryReferences: {
    components: Array<{ id: string; version: number }>;
    materials: Array<{ id: string; version: number }>;
    tireCompound: { id: string; version: number };
  };
  snapshotVersion: typeof RESOLVED_KART_SNAPSHOT_VERSION;
};

export type ResolvedKartSnapshotV1 = Omit<
  ResolvedKartSnapshot,
  "derivationVersion" | "registryReferences" | "snapshotVersion"
> & {
  derivationVersion: 1;
  registryReferences: ResolvedKartSnapshot["registryReferences"] & {
    surfaceMaterial: { id: string; version: number };
    tireSurfaceInteractionDerivationVersion: number;
  };
  snapshotVersion: 1;
  tireSurfaceInteraction: {
    peakGripCoefficient: number;
    peakSlipAngleDegrees: number;
    rollingResistanceCoefficient: number;
    slidingGripCoefficient: number;
    slidingSlipAngleDegrees: number;
  };
};

export type PersistedResolvedKartSnapshot =
  | ResolvedKartSnapshotV1
  | ResolvedKartSnapshot;

const finiteNumberSchema = z.number().finite();
const resolvedVectorSchema = z.strictObject({
  x: finiteNumberSchema,
  y: finiteNumberSchema,
  z: finiteNumberSchema,
});
const resolvedSuspensionSchema = z.strictObject({
  armPivot: resolvedVectorSchema,
  bumpStartWheelCompression: finiteNumberSchema,
  chassisAnchor: resolvedVectorSchema,
  hubAnchor: resolvedVectorSchema,
  maximumWheelTravel: finiteNumberSchema,
  motionRatio: finiteNumberSchema,
  restWheelCompression: finiteNumberSchema,
  springArmAnchor: resolvedVectorSchema,
});
const resolvedWheelStationSchema = z.strictObject({
  axleDirection: resolvedVectorSchema,
  driven: z.boolean(),
  handbraked: z.boolean(),
  id: kartStableIdSchema,
  position: resolvedVectorSchema,
  radius: finiteNumberSchema,
  serviceBraked: z.boolean(),
  steered: z.boolean(),
  suspension: resolvedSuspensionSchema,
  width: finiteNumberSchema,
});
const resolvedCollisionPrimitiveSchema = z.discriminatedUnion("shape", [
  z.strictObject({
    id: kartStableIdSchema,
    shape: z.literal("box"),
    size: resolvedVectorSchema,
    transform: kartTransformSchema,
  }),
  z.strictObject({
    axis: z.enum(["x", "y", "z"]),
    height: finiteNumberSchema,
    id: kartStableIdSchema,
    radius: finiteNumberSchema,
    shape: z.literal("cylinder"),
    transform: kartTransformSchema,
  }),
]);

const resolvedKartSnapshotV2ObjectSchema = z.strictObject({
    derivationVersion: z.literal(2),
    geometry: z.strictObject({
      collisionCompound: z.array(resolvedCollisionPrimitiveSchema).min(1).max(64),
      dimensions: resolvedVectorSchema,
      smallestRelevantCrossSection: finiteNumberSchema,
      trackWidth: finiteNumberSchema,
      wheelbase: finiteNumberSchema,
      wheelStations: z.array(resolvedWheelStationSchema).length(4),
    }),
    kartId: kartStableIdSchema,
    massProperties: z.strictObject({
      centerOfMass: resolvedVectorSchema,
      inertiaTensor: z.strictObject({
        xx: finiteNumberSchema,
        xy: finiteNumberSchema,
        xz: finiteNumberSchema,
        yx: finiteNumberSchema,
        yy: finiteNumberSchema,
        yz: finiteNumberSchema,
        zx: finiteNumberSchema,
        zy: finiteNumberSchema,
        zz: finiteNumberSchema,
      }),
      totalMass: finiteNumberSchema,
    }),
    physicalProfile: z.strictObject({
      aerodynamics: z.strictObject({ dragArea: finiteNumberSchema }),
      brakes: z.strictObject({
        maximumHandbrakeForce: finiteNumberSchema,
        maximumServiceBrakeForce: finiteNumberSchema,
      }),
      drivetrain: z.strictObject({
        maximumDriveForce: finiteNumberSchema,
        noLoadSpeed: finiteNumberSchema,
      }),
      steering: z.strictObject({ maximumCenterAngle: finiteNumberSchema }),
      suspension: z.strictObject({
        bumpRate: finiteNumberSchema,
        bumpStart: finiteNumberSchema,
        damperRate: finiteNumberSchema,
        springRate: finiteNumberSchema,
      }),
    }),
    playerStats: z.strictObject({
      acceleration: finiteNumberSchema,
      handling: finiteNumberSchema,
      speed: finiteNumberSchema,
      stability: finiteNumberSchema,
    }),
    registryReferences: z.strictObject({
      components: z.array(kartDefinitionReferenceSchema).min(1).max(32),
      materials: z.array(kartDefinitionReferenceSchema).min(1).max(64),
      tireCompound: kartDefinitionReferenceSchema,
    }),
    snapshotVersion: z.literal(2),
  });

export const resolvedKartSnapshotV2Schema: z.ZodType<ResolvedKartSnapshot> =
  resolvedKartSnapshotV2ObjectSchema;

export const resolvedKartSnapshotV1Schema: z.ZodType<ResolvedKartSnapshotV1> =
  resolvedKartSnapshotV2ObjectSchema.extend({
    derivationVersion: z.literal(1),
    registryReferences: z.strictObject({
      components: z.array(kartDefinitionReferenceSchema).min(1).max(32),
      materials: z.array(kartDefinitionReferenceSchema).min(1).max(64),
      surfaceMaterial: kartDefinitionReferenceSchema,
      tireCompound: kartDefinitionReferenceSchema,
      tireSurfaceInteractionDerivationVersion: z.number().int().positive(),
    }),
    snapshotVersion: z.literal(1),
    tireSurfaceInteraction: z.strictObject({
      peakGripCoefficient: finiteNumberSchema,
      peakSlipAngleDegrees: finiteNumberSchema,
      rollingResistanceCoefficient: finiteNumberSchema,
      slidingGripCoefficient: finiteNumberSchema,
      slidingSlipAngleDegrees: finiteNumberSchema,
    }),
  });

export function parseResolvedKartSnapshot(
  input: unknown,
): PersistedResolvedKartSnapshot {
  const version = z
    .object({
      derivationVersion: z.number().int().positive(),
      snapshotVersion: z.number().int().positive(),
    })
    .parse(input);

  if (version.snapshotVersion === 1 && version.derivationVersion === 1) {
    return resolvedKartSnapshotV1Schema.parse(input);
  }
  if (version.snapshotVersion === 2 && version.derivationVersion === 2) {
    return resolvedKartSnapshotV2Schema.parse(input);
  }

  throw new Error(
    `Unsupported resolved kart snapshot version ${version.snapshotVersion} with derivation version ${version.derivationVersion}.`,
  );
}

function cleanNumber(value: number) {
  const cleaned = Math.round(value * 1e12) / 1e12;
  return Object.is(cleaned, -0) ? 0 : cleaned;
}

function canonicalize(value: unknown): unknown {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("Resolved kart snapshots cannot contain non-finite numbers.");
    }
    return cleanNumber(value);
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nestedValue]) => [key, canonicalize(nestedValue)]),
    );
  }
  return value;
}

function cleanSnapshot<Snapshot extends PersistedResolvedKartSnapshot>(
  snapshot: DeepReadonly<Snapshot>,
): Snapshot {
  return canonicalize(snapshot) as Snapshot;
}

function categoryComponent<
  Category extends ApprovedComponentDefinition["category"],
>(assembly: ValidatedKartAssembly, category: Category) {
  const match = [...assembly.components.values()].find(
    ({ definition }) => definition.category === category,
  );
  if (!match) throw new Error(`Validated assembly is missing ${category}.`);
  return match as typeof match & {
    definition: Extract<ApprovedComponentDefinition, { category: Category }>;
  };
}

function endpointUses(
  document: KartAssemblyDocument,
  instanceId: string,
  portId: string,
) {
  return document.connections.some(
    ({ from, to }) =>
      (from.instanceId === instanceId && from.portId === portId) ||
      (to.instanceId === instanceId && to.portId === portId),
  );
}

function deriveWheelStations(assembly: ValidatedKartAssembly) {
  const suspensions = [...assembly.components.values()].filter(
    ({ definition }) => definition.category === "suspension",
  );
  const suspensionForWheel = (wheelId: string) => {
    const connection = assembly.document.connections.find(
      ({ from, to }) =>
        (from.instanceId === wheelId && to.portId === "hub-mount") ||
        (to.instanceId === wheelId && from.portId === "hub-mount"),
    );
    const suspensionId =
      connection?.from.instanceId === wheelId
        ? connection.to.instanceId
        : connection?.from.instanceId;
    const suspension = suspensions.find(
      ({ instance }) => instance.id === suspensionId,
    );
    if (!suspension || suspension.definition.category !== "suspension") {
      throw new Error("Validated wheel suspension is unavailable.");
    }
    return suspension as typeof suspension & {
      definition: Extract<
        ApprovedComponentDefinition,
        { category: "suspension" }
      >;
    };
  };

  return [...assembly.components.values()]
    .filter(({ definition }) => definition.category === "wheel-tire")
    .map(({ definition, instance }) => {
      if (definition.category !== "wheel-tire") {
        throw new Error("Validated wheel category narrowed incorrectly.");
      }
      const suspension = suspensionForWheel(instance.id);
      const mount = suspension.instance.suspensionMount!;
      const hubLever = Math.hypot(
        mount.hubAnchor.x - mount.armPivot.x,
        mount.hubAnchor.y - mount.armPivot.y,
        mount.hubAnchor.z - mount.armPivot.z,
      );
      const springLever = Math.hypot(
        mount.springArmAnchor.x - mount.armPivot.x,
        mount.springArmAnchor.y - mount.armPivot.y,
        mount.springArmAnchor.z - mount.armPivot.z,
      );
      const motionRatio = springLever / hubLever;
      const shockLength = Math.hypot(
        mount.chassisAnchor.x - mount.springArmAnchor.x,
        mount.chassisAnchor.y - mount.springArmAnchor.y,
        mount.chassisAnchor.z - mount.springArmAnchor.z,
      );
      const suspensionConstruction = suspension.definition.suspension;
      return {
        axleDirection: { x: 1, y: 0, z: 0 },
        driven: endpointUses(assembly.document, instance.id, "drive-input"),
        handbraked: endpointUses(
          assembly.document,
          instance.id,
          "handbrake-input",
        ),
        id: instance.id,
        position: instance.transform.position,
        radius: definition.wheelTire.radius,
        serviceBraked: endpointUses(
          assembly.document,
          instance.id,
          "service-brake-input",
        ),
        steered: endpointUses(
          assembly.document,
          instance.id,
          "steering-input",
        ),
        suspension: {
          armPivot: mount.armPivot,
          bumpStartWheelCompression:
            suspensionConstruction.bumpStart / motionRatio,
          chassisAnchor: mount.chassisAnchor,
          hubAnchor: mount.hubAnchor,
          maximumWheelTravel:
            suspensionConstruction.maximumStroke / motionRatio,
          motionRatio,
          restWheelCompression:
            (suspensionConstruction.extendedLength - shockLength) /
            motionRatio,
          springArmAnchor: mount.springArmAnchor,
        },
        width: definition.wheelTire.width,
      };
    })
    .sort((left, right) => left.id.localeCompare(right.id));
}

function average(values: readonly number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function deriveMotionRatio(assembly: ValidatedKartAssembly) {
  return average(
    [...assembly.components.values()]
      .filter(({ definition }) => definition.category === "suspension")
      .map(({ instance }) => {
        const mount = instance.suspensionMount!;
        const hubLever = Math.hypot(
          mount.hubAnchor.x - mount.armPivot.x,
          mount.hubAnchor.y - mount.armPivot.y,
          mount.hubAnchor.z - mount.armPivot.z,
        );
        const springLever = Math.hypot(
          mount.springArmAnchor.x - mount.armPivot.x,
          mount.springArmAnchor.y - mount.armPivot.y,
          mount.springArmAnchor.z - mount.armPivot.z,
        );
        return springLever / hubLever;
      }),
  );
}

export function wheelOverlapsCollisionBoundsAtAngle(
  wheel: ResolvedKartWheelStation,
  angleDegrees: number,
  bounds: KartBounds,
) {
  if (
    wheel.position.y + wheel.radius <= bounds.minimum.y ||
    wheel.position.y - wheel.radius >= bounds.maximum.y
  ) {
    return false;
  }
  const angle = (angleDegrees * Math.PI) / 180;
  const axle = { x: Math.cos(angle), z: -Math.sin(angle) };
  const rolling = { x: Math.sin(angle), z: Math.cos(angle) };
  const boundsCenter = {
    x: (bounds.minimum.x + bounds.maximum.x) / 2,
    z: (bounds.minimum.z + bounds.maximum.z) / 2,
  };
  const boundsHalf = {
    x: (bounds.maximum.x - bounds.minimum.x) / 2,
    z: (bounds.maximum.z - bounds.minimum.z) / 2,
  };
  const centerOffset = {
    x: wheel.position.x - boundsCenter.x,
    z: wheel.position.z - boundsCenter.z,
  };
  const separatedOnAxis = (axis: { x: number; z: number }) => {
    const centerDistance = Math.abs(
      centerOffset.x * axis.x + centerOffset.z * axis.z,
    );
    const wheelProjection =
      (wheel.width / 2) * Math.abs(axle.x * axis.x + axle.z * axis.z) +
      wheel.radius * Math.abs(rolling.x * axis.x + rolling.z * axis.z);
    const boundsProjection =
      boundsHalf.x * Math.abs(axis.x) + boundsHalf.z * Math.abs(axis.z);
    return centerDistance >= wheelProjection + boundsProjection - 1e-9;
  };
  return ![
    { x: 1, z: 0 },
    { x: 0, z: 1 },
    axle,
    rolling,
  ].some(separatedOnAxis);
}

function deriveSteeringLimit(input: {
  collisionElements: KartMassElement[];
  maximumTravelDegrees: number;
  steeredWheels: ResolvedKartWheelStation[];
  trackWidth: number;
  wheelbase: number;
}) {
  const steeringCenterX = average(
    input.steeredWheels.map(({ position }) => position.x),
  );
  let sharedLimit = 0;
  for (
    let centerAngle = 0;
    centerAngle <= input.maximumTravelDegrees + 1e-9;
    centerAngle += 0.01
  ) {
    const collides = input.steeredWheels.some((wheel) =>
      [-centerAngle, centerAngle].some((signedCenterAngle) => {
        const wheelAngle = getAckermannWheelSteerAngle(
          signedCenterAngle,
          wheel.position.x - steeringCenterX,
          {
            centerOfMassHeight: 0,
            trackWidth: input.trackWidth,
            wheelbase: input.wheelbase,
          },
        );
        if (
          Math.abs(signedCenterAngle) > 1e-9 &&
          (wheelAngle === 0 ||
            Math.sign(wheelAngle) !== Math.sign(signedCenterAngle))
        ) {
          return true;
        }
        return input.collisionElements.some(({ bounds }) =>
          wheelOverlapsCollisionBoundsAtAngle(wheel, wheelAngle, bounds),
        );
      }),
    );
    if (collides) break;
    sharedLimit = centerAngle;
  }
  return sharedLimit;
}

function score(value: number, minimum: number, maximum: number) {
  const normalized = Math.max(0, Math.min(1, (value - minimum) / (maximum - minimum)));
  return Math.round(1 + normalized * 99);
}

function boundsOverlap(left: KartBounds, right: KartBounds) {
  return (
    left.minimum.x < right.maximum.x &&
    left.maximum.x > right.minimum.x &&
    left.minimum.y < right.maximum.y &&
    left.maximum.y > right.minimum.y &&
    left.minimum.z < right.maximum.z &&
    left.maximum.z > right.minimum.z
  );
}

function assertDerivedBounds(input: {
  collisionElements: KartMassElement[];
  dimensions: KartVector;
  massElements: KartMassElement[];
  maximumCenterAngle: number;
  totalMass: number;
  wheelStations: ResolvedKartWheelStation[];
}) {
  const issues: ConstructorParameters<typeof KartAssemblyValidationError>[0] = [];
  if (input.totalMass < 0.5 || input.totalMass > 5) {
    issues.push({
      code: "derived-mass-out-of-bounds",
      message: "Derived kart mass must be between 0.5 kg and 5 kg.",
      path: ["primitiveInstances"],
    });
  }
  if (input.maximumCenterAngle < MINIMUM_USABLE_STEERING_ANGLE_DEGREES) {
    issues.push({
      code: "insufficient-steering-clearance",
      message: `Derived steering clearance must permit at least ${MINIMUM_USABLE_STEERING_ANGLE_DEGREES} degree of center travel in both directions.`,
      path: ["primitiveInstances"],
    });
  }
  if (
    input.dimensions.x < 0.2 ||
    input.dimensions.x > 0.8 ||
    input.dimensions.y < 0.05 ||
    input.dimensions.y > 0.5 ||
    input.dimensions.z < 0.25 ||
    input.dimensions.z > 0.8
  ) {
    issues.push({
      code: "derived-dimensions-out-of-bounds",
      message: "Derived kart dimensions exceed the supported miniature RC envelope.",
      path: ["primitiveInstances"],
    });
  }

  for (const wheel of input.wheelStations) {
    const wheelBounds = combineBounds(
      input.massElements
        .filter(({ instanceId }) => instanceId === wheel.id)
        .map(({ bounds }) => bounds),
    );
    if (
      input.collisionElements.some(({ bounds }) =>
        boundsOverlap(wheelBounds, bounds),
      )
    ) {
      issues.push({
        code: "wheel-collision-overlap",
        message: `Wheel station "${wheel.id}" intersects authored chassis collision geometry.`,
        path: ["componentInstances"],
      });
    }
  }

  if (issues.length > 0) throw new KartAssemblyValidationError(issues);
}

export function deriveKartSnapshot(input: unknown): DeepReadonly<ResolvedKartSnapshot> {
  const assembly = parseValidatedKartAssembly(input);
  const massElements = [
    ...assembly.document.primitiveInstances
      .slice()
      .sort((left, right) => left.id.localeCompare(right.id))
      .map(buildPrimitiveMassElement),
    ...[...assembly.components.values()]
      .sort((left, right) => left.instance.id.localeCompare(right.instance.id))
      .flatMap(({ definition, instance }) =>
        buildComponentMassElements(instance, definition),
      ),
  ];
  const bounds = combineBounds(massElements.map((element) => element.bounds));
  const dimensions = {
    x: bounds.maximum.x - bounds.minimum.x,
    y: bounds.maximum.y - bounds.minimum.y,
    z: bounds.maximum.z - bounds.minimum.z,
  };
  const collisionPrimitives = assembly.document.primitiveInstances
    .filter(({ collision }) => collision === "solid")
    .sort((left, right) => left.id.localeCompare(right.id));
  const collisionIds = new Set(collisionPrimitives.map(({ id }) => id));
  const collisionElements = massElements.filter(({ instanceId }) =>
    collisionIds.has(instanceId),
  );
  const massProperties = deriveMassProperties(massElements);
  const wheelStations = deriveWheelStations(assembly);
  const steeredWheels = wheelStations.filter(({ steered }) => steered);
  const drivenWheels = wheelStations.filter(({ driven }) => driven);
  const frontZ = average(steeredWheels.map(({ position }) => position.z));
  const rearZ = average(drivenWheels.map(({ position }) => position.z));
  const trackWidth = average(
    [steeredWheels, drivenWheels].map(
      (axle) =>
        Math.max(...axle.map(({ position }) => position.x)) -
        Math.min(...axle.map(({ position }) => position.x)),
    ),
  );
  const wheelbase = rearZ - frontZ;
  const battery = categoryComponent(assembly, "battery").definition;
  const controller = categoryComponent(
    assembly,
    "receiver-speed-controller",
  ).definition;
  const motor = categoryComponent(assembly, "motor").definition;
  const transmission = categoryComponent(assembly, "transmission").definition;
  const brakes = categoryComponent(assembly, "brakes").definition;
  const steering = categoryComponent(assembly, "steering").definition;
  const suspension = categoryComponent(assembly, "suspension").definition;
  const wheel = categoryComponent(assembly, "wheel-tire").definition;
  const safeCurrent = Math.min(
    battery.electrical.maximumCurrent,
    controller.electrical.maximumMotorCurrent,
    motor.electrical.safeCurrent,
    battery.electrical.voltage / motor.electrical.windingResistance,
  );
  const torqueConstant =
    60 / (2 * Math.PI * motor.electrical.speedConstantRpmPerVolt);
  const motorTorque = torqueConstant * safeCurrent;
  const maximumDriveForce =
    (motorTorque *
      transmission.transmission.motorRotationsPerWheelRotation *
      transmission.transmission.efficiency) /
    wheel.wheelTire.radius;
  const motorNoLoadAngularSpeed =
    (battery.electrical.voltage *
      motor.electrical.speedConstantRpmPerVolt *
      2 *
      Math.PI) /
    60;
  const noLoadSpeed =
    (motorNoLoadAngularSpeed /
      transmission.transmission.motorRotationsPerWheelRotation) *
    wheel.wheelTire.radius;
  const motionRatio = deriveMotionRatio(assembly);
  const maximumCenterAngle = deriveSteeringLimit({
    collisionElements,
    maximumTravelDegrees: steering.steering.maximumTravelDegrees,
    steeredWheels,
    trackWidth,
    wheelbase,
  });
  const dragArea =
    projectedRectangleUnionArea(
      massElements.map(({ bounds: elementBounds }) => elementBounds),
    ) * DRAG_SHAPE_COEFFICIENT;
  const physicalProfile: KartPhysicalProfile = {
    aerodynamics: { dragArea },
    brakes: {
      maximumHandbrakeForce:
        brakes.brakes.totalHandbrakeTorque / wheel.wheelTire.radius,
      maximumServiceBrakeForce:
        brakes.brakes.totalServiceBrakeTorque / wheel.wheelTire.radius,
    },
    drivetrain: { maximumDriveForce, noLoadSpeed },
    steering: { maximumCenterAngle },
    suspension: {
      bumpRate: suspension.suspension.quadraticBumpRate * motionRatio ** 3,
      bumpStart: suspension.suspension.bumpStart / motionRatio,
      damperRate: suspension.suspension.damperRate * motionRatio ** 2,
      springRate: suspension.suspension.springRate * motionRatio ** 2,
    },
  };
  assertDerivedBounds({
    collisionElements,
    dimensions,
    massElements,
    maximumCenterAngle,
    totalMass: massProperties.totalMass,
    wheelStations,
  });

  const acceleration = maximumDriveForce / massProperties.totalMass;
  const curvature =
    Math.tan((maximumCenterAngle * Math.PI) / 180) / wheelbase;
  const contactPlaneY = average(
    wheelStations.map(({ position, radius }) => position.y - radius),
  );
  const centerOfMassHeight = massProperties.centerOfMass.y - contactPlaneY;
  const stabilityRatio =
    trackWidth / (2 * Math.max(0.01, centerOfMassHeight));
  const componentReferences = [
    ...new Map(
      assembly.document.componentInstances.map(({ definition }) => [
        `${definition.id}@${definition.version}`,
        definition,
      ]),
    ).values(),
  ].sort((left, right) => registryReferenceKey(left).localeCompare(registryReferenceKey(right)));
  const materialReferences = [
    ...new Map(
      assembly.document.primitiveInstances.map(({ material }) => [
        `${material.id}@${material.version}`,
        material,
      ]),
    ).values(),
  ].sort((left, right) => registryReferenceKey(left).localeCompare(registryReferenceKey(right)));
  const collisionCompound = collisionPrimitives.map((primitive) =>
    primitive.shape === "box"
      ? {
          id: primitive.id,
          shape: primitive.shape,
          size: primitive.size,
          transform: primitive.transform,
        }
      : {
          axis: primitive.axis,
          height: primitive.height,
          id: primitive.id,
          radius: primitive.radius,
          shape: primitive.shape,
          transform: primitive.transform,
        },
  );
  const smallestRelevantCrossSection = Math.min(
    ...collisionPrimitives.map((primitive) =>
      primitive.shape === "box"
        ? Math.min(primitive.size.x, primitive.size.y, primitive.size.z)
        : Math.min(primitive.radius * 2, primitive.height),
    ),
  );
  const inertia = massProperties.inertia;
  const snapshot: ResolvedKartSnapshot = {
    derivationVersion: KART_DERIVATION_VERSION,
    geometry: {
      collisionCompound,
      dimensions,
      smallestRelevantCrossSection,
      trackWidth,
      wheelbase,
      wheelStations,
    },
    kartId: assembly.document.kartId,
    massProperties: {
      centerOfMass: massProperties.centerOfMass,
      inertiaTensor: {
        xx: inertia[0],
        xy: inertia[1],
        xz: inertia[2],
        yx: inertia[3],
        yy: inertia[4],
        yz: inertia[5],
        zx: inertia[6],
        zy: inertia[7],
        zz: inertia[8],
      },
      totalMass: massProperties.totalMass,
    },
    physicalProfile,
    playerStats: {
      acceleration: score(acceleration, 5, 22),
      handling: score(curvature, 0.6, 2.4),
      speed: score(noLoadSpeed, 7, 23),
      stability: score(stabilityRatio, 1.4, 2.8),
    },
    registryReferences: {
      components: componentReferences,
      materials: materialReferences,
      tireCompound: wheel.wheelTire.tireCompound,
    },
    snapshotVersion: RESOLVED_KART_SNAPSHOT_VERSION,
  };
  return deepFreeze(cleanSnapshot(snapshot));
}

function registryReferenceKey(reference: { id: string; version: number }) {
  return `${reference.id}@${reference.version}`;
}

export function serializeResolvedKartSnapshot(
  input: DeepReadonly<PersistedResolvedKartSnapshot>,
) {
  return `${JSON.stringify(cleanSnapshot(input), null, 2)}\n`;
}

export async function hashResolvedKartSnapshot(
  input: DeepReadonly<PersistedResolvedKartSnapshot>,
) {
  const bytes = new TextEncoder().encode(serializeResolvedKartSnapshot(input));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
