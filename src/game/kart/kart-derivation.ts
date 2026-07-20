import type { KartAssemblyDocument } from "./kart-assembly-document";
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
import {
  getApprovedTireSurfaceInteraction,
  type TireSurfaceInteractionDefinition,
} from "./kart-material-registry";
import { deepFreeze, type DeepReadonly } from "./immutable-registry";

export const KART_DERIVATION_VERSION = 1;
export const RESOLVED_KART_SNAPSHOT_VERSION = 1;
const DRAG_SHAPE_COEFFICIENT = 0.9;

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
  derivationVersion: number;
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
    surfaceMaterial: { id: string; version: number };
    tireCompound: { id: string; version: number };
    tireSurfaceInteractionDerivationVersion: number;
  };
  snapshotVersion: number;
  tireSurfaceInteraction: {
    peakGripCoefficient: number;
    peakSlipAngleDegrees: number;
    rollingResistanceCoefficient: number;
    slidingGripCoefficient: number;
    slidingSlipAngleDegrees: number;
  };
};

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

function cleanSnapshot(
  snapshot: DeepReadonly<ResolvedKartSnapshot>,
): ResolvedKartSnapshot {
  return canonicalize(snapshot) as ResolvedKartSnapshot;
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

function deriveSteeringLimit(input: {
  chassisBounds: KartBounds;
  maximumTravelDegrees: number;
  steeredWheels: ResolvedKartWheelStation[];
}) {
  let sharedLimit = input.maximumTravelDegrees;
  const maximumChassisHalfWidth = Math.max(
    Math.abs(input.chassisBounds.minimum.x),
    Math.abs(input.chassisBounds.maximum.x),
  );
  for (const wheel of input.steeredWheels) {
    const clearance = Math.abs(wheel.position.x) - maximumChassisHalfWidth;
    let wheelLimit = 0;
    for (
      let angle = 0;
      angle <= input.maximumTravelDegrees + 1e-9;
      angle += 0.01
    ) {
      const radians = (angle * Math.PI) / 180;
      const inwardExtent =
        (wheel.width / 2) * Math.cos(radians) +
        wheel.radius * Math.sin(radians);
      if (inwardExtent > clearance) break;
      wheelLimit = angle;
    }
    sharedLimit = Math.min(sharedLimit, wheelLimit);
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

function interactionProfile(
  interaction: DeepReadonly<TireSurfaceInteractionDefinition>,
) {
  return {
    peakGripCoefficient: interaction.peakGripCoefficient,
    peakSlipAngleDegrees: interaction.peakSlipAngleDegrees,
    rollingResistanceCoefficient: interaction.rollingResistanceCoefficient,
    slidingGripCoefficient: interaction.slidingGripCoefficient,
    slidingSlipAngleDegrees: interaction.slidingSlipAngleDegrees,
  };
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
  const collisionBounds = combineBounds(
    collisionElements.map(({ bounds: elementBounds }) => elementBounds),
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
    chassisBounds: collisionBounds,
    maximumTravelDegrees: steering.steering.maximumTravelDegrees,
    steeredWheels,
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
  const tireSurfaceInteraction = getApprovedTireSurfaceInteraction({
    derivationVersion: 1,
    surfaceMaterial: { id: "surface.standard-course", version: 1 },
    tireCompound: wheel.wheelTire.tireCompound,
  });
  if (!tireSurfaceInteraction) {
    throw new Error("Validated tire and surface interaction is unavailable.");
  }

  assertDerivedBounds({
    collisionElements,
    dimensions,
    massElements,
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
      surfaceMaterial: tireSurfaceInteraction.surfaceMaterial,
      tireCompound: tireSurfaceInteraction.tireCompound,
      tireSurfaceInteractionDerivationVersion:
        tireSurfaceInteraction.derivationVersion,
    },
    snapshotVersion: RESOLVED_KART_SNAPSHOT_VERSION,
    tireSurfaceInteraction: interactionProfile(tireSurfaceInteraction),
  };
  return deepFreeze(cleanSnapshot(snapshot));
}

function registryReferenceKey(reference: { id: string; version: number }) {
  return `${reference.id}@${reference.version}`;
}

export function serializeResolvedKartSnapshot(
  input: DeepReadonly<ResolvedKartSnapshot>,
) {
  return `${JSON.stringify(cleanSnapshot(input), null, 2)}\n`;
}

export async function hashResolvedKartSnapshot(
  input: DeepReadonly<ResolvedKartSnapshot>,
) {
  const bytes = new TextEncoder().encode(serializeResolvedKartSnapshot(input));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
