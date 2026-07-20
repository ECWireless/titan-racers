import type { Position3 } from "../contracts";
import {
  getKartComponent,
  type KartComponentCategory,
  type ReadonlyKartComponentDefinition,
  type KartTransform,
} from "./kart-component-catalog";
import {
  parseKartConstructionDocument,
  type KartComponentInstance,
  type KartConstructionDocument,
} from "./kart-construction";

type Matrix3 = [
  [number, number, number],
  [number, number, number],
  [number, number, number],
];

export type KartInertiaTensor = {
  xx: number;
  xy: number;
  xz: number;
  yy: number;
  yz: number;
  zz: number;
};

export type DerivedKartPhysicalProfile = {
  bounds: {
    dimensions: Position3;
    maximum: Position3;
    minimum: Position3;
  };
  collisionPrimitives: Array<{
    componentInstanceId: string;
    componentTransform: KartTransform;
    primitive: ReadonlyKartComponentDefinition["collisionPrimitives"][number];
  }>;
  derivationVersion: 1;
  drive: {
    acceleration: number;
    brakeDeceleration: number;
    driveForceNewtons: number;
    maximumForwardSpeed: number;
    maximumReverseSpeed: number;
    serviceBrakeForceNewtons: number;
  };
  grip: {
    peakCoefficient: number;
    rearMultiplier: number;
    slidingCoefficient: number;
  };
  kartId: string;
  mass: {
    centerOfMass: Position3;
    inertiaTensor: KartInertiaTensor;
    totalKg: number;
  };
  sourceComponents: Array<{
    category: KartComponentCategory;
    componentId: string;
    componentRevision: number;
    instanceId: string;
    slotId: string;
  }>;
  statBars: {
    acceleration: number;
    handling: number;
    speed: number;
    stability: number;
  };
  steering: {
    maximumAngleDegrees: number;
    minimumHighSpeedAngleDegrees: number;
    theoreticalTurningRadius: number;
  };
  suspension: {
    bumpRate: number;
    bumpStart: number;
    damperRate: number;
    maximumCompressionY: number;
    maximumLoad: number;
    restTravel: number;
    springRate: number;
    travel: number;
  };
  wheels: {
    mounts: Array<{
      axle: "front" | "rear";
      id: string;
      position: Position3;
      side: "left" | "right";
    }>;
    radius: number;
    trackWidth: number;
    wheelbase: number;
    width: number;
  };
};

export const KART_STAT_DERIVATION_BOUNDS = {
  acceleration: { maximum: 14, minimum: 5 },
  handlingTurningRadius: { best: 2, worst: 5.4 },
  speed: { maximum: 24, minimum: 10 },
  stabilityRatio: { maximum: 2.2285714285714286, minimum: 1.2 },
} as const;

type ResolvedComponent = {
  component: ReadonlyKartComponentDefinition;
  instance: KartComponentInstance;
  transform: KartTransform;
};

type ResolvedMassElement = {
  center: Position3;
  dimensions: Position3;
  massKg: number;
  rotation: Matrix3;
};

function addVectors(left: Position3, right: Position3): Position3 {
  return {
    x: left.x + right.x,
    y: left.y + right.y,
    z: left.z + right.z,
  };
}

function multiplyMatrixVector(matrix: Matrix3, vector: Position3): Position3 {
  return {
    x:
      matrix[0][0] * vector.x +
      matrix[0][1] * vector.y +
      matrix[0][2] * vector.z,
    y:
      matrix[1][0] * vector.x +
      matrix[1][1] * vector.y +
      matrix[1][2] * vector.z,
    z:
      matrix[2][0] * vector.x +
      matrix[2][1] * vector.y +
      matrix[2][2] * vector.z,
  };
}

function rotationMatrix(rotation: Position3): Matrix3 {
  const halfToRadians = Math.PI / 360;
  const ex = rotation.x * halfToRadians;
  const ey = rotation.y * halfToRadians;
  const ez = rotation.z * halfToRadians;
  const sx = Math.sin(ex);
  const cx = Math.cos(ex);
  const sy = Math.sin(ey);
  const cy = Math.cos(ey);
  const sz = Math.sin(ez);
  const cz = Math.cos(ez);
  const quaternion = {
    w: cx * cy * cz + sx * sy * sz,
    x: sx * cy * cz - cx * sy * sz,
    y: cx * sy * cz + sx * cy * sz,
    z: cx * cy * sz - sx * sy * cz,
  };
  const { w, x, y, z } = quaternion;

  return [
    [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
    [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
    [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
  ];
}

function multiplyMatrices(left: Matrix3, right: Matrix3): Matrix3 {
  return [0, 1, 2].map((row) =>
    [0, 1, 2].map(
      (column) =>
        left[row][0] * right[0][column] +
        left[row][1] * right[1][column] +
        left[row][2] * right[2][column],
    ),
  ) as Matrix3;
}

function transpose(matrix: Matrix3): Matrix3 {
  return [
    [matrix[0][0], matrix[1][0], matrix[2][0]],
    [matrix[0][1], matrix[1][1], matrix[2][1]],
    [matrix[0][2], matrix[1][2], matrix[2][2]],
  ];
}

function matrixFromTensor(tensor: KartInertiaTensor): Matrix3 {
  return [
    [tensor.xx, tensor.xy, tensor.xz],
    [tensor.xy, tensor.yy, tensor.yz],
    [tensor.xz, tensor.yz, tensor.zz],
  ];
}

function tensorFromMatrix(matrix: Matrix3): KartInertiaTensor {
  return {
    xx: matrix[0][0],
    xy: (matrix[0][1] + matrix[1][0]) / 2,
    xz: (matrix[0][2] + matrix[2][0]) / 2,
    yy: matrix[1][1],
    yz: (matrix[1][2] + matrix[2][1]) / 2,
    zz: matrix[2][2],
  };
}

function calculateBoxInertiaTensor(
  massKg: number,
  dimensions: Position3,
): KartInertiaTensor {
  const factor = massKg / 12;

  return {
    xx: factor * (dimensions.y ** 2 + dimensions.z ** 2),
    xy: 0,
    xz: 0,
    yy: factor * (dimensions.x ** 2 + dimensions.z ** 2),
    yz: 0,
    zz: factor * (dimensions.x ** 2 + dimensions.y ** 2),
  };
}

function rotateTensor(tensor: KartInertiaTensor, rotation: Matrix3) {
  return tensorFromMatrix(
    multiplyMatrices(
      multiplyMatrices(rotation, matrixFromTensor(tensor)),
      transpose(rotation),
    ),
  );
}

function addTranslatedTensor(
  target: KartInertiaTensor,
  local: KartInertiaTensor,
  massKg: number,
  offset: Position3,
) {
  target.xx += local.xx + massKg * (offset.y ** 2 + offset.z ** 2);
  target.xy += local.xy - massKg * offset.x * offset.y;
  target.xz += local.xz - massKg * offset.x * offset.z;
  target.yy += local.yy + massKg * (offset.x ** 2 + offset.z ** 2);
  target.yz += local.yz - massKg * offset.y * offset.z;
  target.zz += local.zz + massKg * (offset.x ** 2 + offset.y ** 2);
}

function resolveComponents(document: KartConstructionDocument) {
  const frameInstance = document.components.find(
    (instance) =>
      getKartComponent(instance.componentId, instance.componentRevision)
        ?.properties.kind === "frame",
  );
  if (!frameInstance) {
    throw new Error("Validated kart requires a frame");
  }

  const frame = getKartComponent(
    frameInstance.componentId,
    frameInstance.componentRevision,
  );
  if (!frame || frame.properties.kind !== "frame") {
    throw new Error("Validated kart frame reference is unavailable");
  }
  const frameProperties = frame.properties;

  return document.components.map((instance): ResolvedComponent => {
    const component = getKartComponent(
      instance.componentId,
      instance.componentRevision,
    );
    if (!component) {
      throw new Error("Validated kart component reference is unavailable");
    }

    if (component.properties.kind === "frame") {
      return {
        component,
        instance,
        transform: {
          position: { x: 0, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
        },
      };
    }

    const slot = frameProperties.slots.find(
      (candidate) => candidate.slotId === instance.slotId,
    );
    if (!slot) {
      throw new Error("Validated kart attachment slot is unavailable");
    }

    return {
      component,
      instance,
      transform: {
        position: addVectors(
          slot.defaultTransform.position,
          instance.transformAdjustment.position,
        ),
        rotation: addVectors(
          slot.defaultTransform.rotation,
          instance.transformAdjustment.rotation,
        ),
      },
    };
  });
}

function componentByCategory(
  resolved: ResolvedComponent[],
  category: KartComponentCategory,
) {
  const match = resolved.find(
    ({ component }) => component.properties.kind === category,
  );
  if (!match) {
    throw new Error(`Validated kart requires a ${category} component`);
  }
  return match;
}

function resolveMassElements(resolved: ResolvedComponent[]) {
  const frame = componentByCategory(resolved, "frame");
  if (frame.component.properties.kind !== "frame") {
    throw new Error("Validated kart requires frame wheel mounts");
  }
  const frameProperties = frame.component.properties;

  return resolved.flatMap(({ component, transform }) => {
    const rotation = rotationMatrix(transform.rotation);

    return component.massElements.map(
      (element): ResolvedMassElement => {
        const wheelMount = element.wheelMount
          ? frameProperties.wheelMounts.find(
              (mount) =>
                mount.axle === element.wheelMount!.axle &&
                mount.side === element.wheelMount!.side,
            )
          : undefined;
        if (element.wheelMount && !wheelMount) {
          throw new Error("Validated wheel mass template has no frame mount");
        }
        const localCenter = wheelMount
          ? addVectors(wheelMount.position, element.center)
          : element.center;

        return {
          center: addVectors(
            transform.position,
            multiplyMatrixVector(rotation, localCenter),
          ),
          dimensions: { ...element.dimensions },
          massKg: element.massKg,
          rotation,
        };
      },
    );
  });
}

function distance(left: Position3, right: Position3) {
  return Math.hypot(
    right.x - left.x,
    right.y - left.y,
    right.z - left.z,
  );
}

function deriveMass(elements: ResolvedMassElement[]) {
  const totalKg = elements.reduce((sum, element) => sum + element.massKg, 0);
  const centerOfMass = elements.reduce(
    (center, element) => ({
      x: center.x + element.center.x * element.massKg,
      y: center.y + element.center.y * element.massKg,
      z: center.z + element.center.z * element.massKg,
    }),
    { x: 0, y: 0, z: 0 },
  );
  centerOfMass.x /= totalKg;
  centerOfMass.y /= totalKg;
  centerOfMass.z /= totalKg;

  const inertiaTensor: KartInertiaTensor = {
    xx: 0,
    xy: 0,
    xz: 0,
    yy: 0,
    yz: 0,
    zz: 0,
  };
  elements.forEach((element) => {
    const localTensor = rotateTensor(
      calculateBoxInertiaTensor(element.massKg, element.dimensions),
      element.rotation,
    );
    addTranslatedTensor(inertiaTensor, localTensor, element.massKg, {
      x: element.center.x - centerOfMass.x,
      y: element.center.y - centerOfMass.y,
      z: element.center.z - centerOfMass.z,
    });
  });

  return { centerOfMass, inertiaTensor, totalKg };
}

function expandBoundsForOrientedBox(
  bounds: { maximum: Position3; minimum: Position3 },
  center: Position3,
  dimensions: Position3,
  rotation: Matrix3,
) {
  const half = {
    x: dimensions.x / 2,
    y: dimensions.y / 2,
    z: dimensions.z / 2,
  };
  const extent = {
    x:
      Math.abs(rotation[0][0]) * half.x +
      Math.abs(rotation[0][1]) * half.y +
      Math.abs(rotation[0][2]) * half.z,
    y:
      Math.abs(rotation[1][0]) * half.x +
      Math.abs(rotation[1][1]) * half.y +
      Math.abs(rotation[1][2]) * half.z,
    z:
      Math.abs(rotation[2][0]) * half.x +
      Math.abs(rotation[2][1]) * half.y +
      Math.abs(rotation[2][2]) * half.z,
  };

  (["x", "y", "z"] as const).forEach((axis) => {
    bounds.minimum[axis] = Math.min(
      bounds.minimum[axis],
      center[axis] - extent[axis],
    );
    bounds.maximum[axis] = Math.max(
      bounds.maximum[axis],
      center[axis] + extent[axis],
    );
  });
}

function deriveBounds(elements: ResolvedMassElement[]) {
  const bounds = {
    maximum: {
      x: Number.NEGATIVE_INFINITY,
      y: Number.NEGATIVE_INFINITY,
      z: Number.NEGATIVE_INFINITY,
    },
    minimum: {
      x: Number.POSITIVE_INFINITY,
      y: Number.POSITIVE_INFINITY,
      z: Number.POSITIVE_INFINITY,
    },
  };
  elements.forEach((element) =>
    expandBoundsForOrientedBox(
      bounds,
      element.center,
      element.dimensions,
      element.rotation,
    ),
  );

  return {
    dimensions: {
      x: bounds.maximum.x - bounds.minimum.x,
      y: bounds.maximum.y - bounds.minimum.y,
      z: bounds.maximum.z - bounds.minimum.z,
    },
    ...bounds,
  };
}

function clampStat(value: number) {
  return Math.round(Math.min(Math.max(value, 0), 100));
}

function normalizedStat(value: number, minimum: number, maximum: number) {
  return clampStat(((value - minimum) / (maximum - minimum)) * 100);
}

function reverseNormalizedStat(
  value: number,
  best: number,
  worst: number,
) {
  return clampStat(((worst - value) / (worst - best)) * 100);
}

function assertFiniteProfile(profile: DerivedKartPhysicalProfile) {
  const finiteValues = [
    profile.mass.totalKg,
    ...Object.values(profile.mass.centerOfMass),
    ...Object.values(profile.mass.inertiaTensor),
    ...Object.values(profile.bounds.dimensions),
    profile.wheels.wheelbase,
    profile.wheels.trackWidth,
    profile.drive.acceleration,
    profile.drive.brakeDeceleration,
    profile.drive.maximumForwardSpeed,
    profile.drive.maximumReverseSpeed,
  ];
  const positiveValues = [
    profile.mass.totalKg,
    profile.mass.inertiaTensor.xx,
    profile.mass.inertiaTensor.yy,
    profile.mass.inertiaTensor.zz,
    ...Object.values(profile.bounds.dimensions),
    profile.wheels.wheelbase,
    profile.wheels.trackWidth,
    profile.drive.acceleration,
    profile.drive.brakeDeceleration,
    profile.drive.maximumForwardSpeed,
    profile.drive.maximumReverseSpeed,
  ];
  if (
    finiteValues.some((value) => !Number.isFinite(value)) ||
    positiveValues.some((value) => value <= 0)
  ) {
    throw new Error("Kart derivation produced an invalid physical profile");
  }
}

export function deriveKartPhysicalProfile(
  input: unknown,
): DerivedKartPhysicalProfile {
  const document = parseKartConstructionDocument(input);
  const resolved = resolveComponents(document);
  const frame = componentByCategory(resolved, "frame");
  const motor = componentByCategory(resolved, "motor");
  const battery = componentByCategory(resolved, "battery");
  const wheelSet = componentByCategory(resolved, "wheel-set");
  const suspension = componentByCategory(resolved, "suspension");
  if (
    frame.component.properties.kind !== "frame" ||
    motor.component.properties.kind !== "motor" ||
    battery.component.properties.kind !== "battery" ||
    wheelSet.component.properties.kind !== "wheel-set" ||
    suspension.component.properties.kind !== "suspension"
  ) {
    throw new Error("Validated kart contains mismatched component categories");
  }

  const massElements = resolveMassElements(resolved);
  const mass = deriveMass(massElements);
  const bounds = deriveBounds(massElements);
  const wheelRotation = rotationMatrix(wheelSet.transform.rotation);
  const mounts = frame.component.properties.wheelMounts.map((mount) => ({
    ...mount,
    position: addVectors(
      wheelSet.transform.position,
      multiplyMatrixVector(wheelRotation, mount.position),
    ),
  }));
  const frontMounts = mounts.filter((mount) => mount.axle === "front");
  const rearMounts = mounts.filter((mount) => mount.axle === "rear");
  const frontLeft = frontMounts.find((mount) => mount.side === "left")!;
  const frontRight = frontMounts.find((mount) => mount.side === "right")!;
  const rearLeft = rearMounts.find((mount) => mount.side === "left")!;
  const rearRight = rearMounts.find((mount) => mount.side === "right")!;
  const frontCenter = {
    x: (frontLeft.position.x + frontRight.position.x) / 2,
    y: (frontLeft.position.y + frontRight.position.y) / 2,
    z: (frontLeft.position.z + frontRight.position.z) / 2,
  };
  const rearCenter = {
    x: (rearLeft.position.x + rearRight.position.x) / 2,
    y: (rearLeft.position.y + rearRight.position.y) / 2,
    z: (rearLeft.position.z + rearRight.position.z) / 2,
  };
  const wheelbase = distance(frontCenter, rearCenter);
  const trackWidth = distance(frontLeft.position, frontRight.position);
  const driveForceNewtons = Math.min(
    motor.component.properties.driveForceNewtons,
    battery.component.properties.maximumDriveForceNewtons,
  );
  const maximumForwardSpeed =
    motor.component.properties.maximumWheelAngularSpeed *
    wheelSet.component.properties.radius;
  const acceleration = driveForceNewtons / mass.totalKg;
  const brakeDeceleration =
    wheelSet.component.properties.serviceBrakeForceNewtons / mass.totalKg;
  const theoreticalTurningRadius =
    wheelbase /
    Math.tan(
      (frame.component.properties.maximumSteerAngleDegrees * Math.PI) / 180,
    );
  const averageWheelY =
    mounts.reduce((sum, mount) => sum + mount.position.y, 0) / mounts.length;
  const groundY = averageWheelY - wheelSet.component.properties.radius;
  const centerOfMassHeight = mass.centerOfMass.y - groundY;
  const rolloverStabilityRatio =
    trackWidth / (2 * Math.max(centerOfMassHeight, 0.01));

  const profile: DerivedKartPhysicalProfile = {
    bounds,
    collisionPrimitives: resolved.flatMap(
      ({ component, instance, transform }) =>
        component.collisionPrimitives.map((primitive) => ({
          componentInstanceId: instance.instanceId,
          componentTransform: structuredClone(transform),
          primitive: structuredClone(primitive),
        })),
    ),
    derivationVersion: 1,
    drive: {
      acceleration,
      brakeDeceleration,
      driveForceNewtons,
      maximumForwardSpeed,
      maximumReverseSpeed:
        maximumForwardSpeed * motor.component.properties.reverseSpeedRatio,
      serviceBrakeForceNewtons:
        wheelSet.component.properties.serviceBrakeForceNewtons,
    },
    grip: {
      peakCoefficient: wheelSet.component.properties.peakGripCoefficient,
      rearMultiplier: wheelSet.component.properties.rearGripMultiplier,
      slidingCoefficient:
        wheelSet.component.properties.slidingGripCoefficient,
    },
    kartId: document.kartId,
    mass,
    sourceComponents: resolved.map(({ component, instance }) => ({
      category: component.properties.kind,
      componentId: component.componentId,
      componentRevision: component.revision,
      instanceId: instance.instanceId,
      slotId: instance.slotId,
    })),
    statBars: {
      acceleration: normalizedStat(
        acceleration,
        KART_STAT_DERIVATION_BOUNDS.acceleration.minimum,
        KART_STAT_DERIVATION_BOUNDS.acceleration.maximum,
      ),
      handling: reverseNormalizedStat(
        theoreticalTurningRadius,
        KART_STAT_DERIVATION_BOUNDS.handlingTurningRadius.best,
        KART_STAT_DERIVATION_BOUNDS.handlingTurningRadius.worst,
      ),
      speed: normalizedStat(
        maximumForwardSpeed,
        KART_STAT_DERIVATION_BOUNDS.speed.minimum,
        KART_STAT_DERIVATION_BOUNDS.speed.maximum,
      ),
      stability: normalizedStat(
        rolloverStabilityRatio,
        KART_STAT_DERIVATION_BOUNDS.stabilityRatio.minimum,
        KART_STAT_DERIVATION_BOUNDS.stabilityRatio.maximum,
      ),
    },
    steering: {
      maximumAngleDegrees:
        frame.component.properties.maximumSteerAngleDegrees,
      minimumHighSpeedAngleDegrees:
        frame.component.properties.minimumHighSpeedSteerAngleDegrees,
      theoreticalTurningRadius,
    },
    suspension: {
      bumpRate: suspension.component.properties.bumpRate,
      bumpStart: suspension.component.properties.bumpStart,
      damperRate: suspension.component.properties.damperRate,
      maximumCompressionY:
        suspension.component.properties.maximumCompressionY,
      maximumLoad: suspension.component.properties.maximumLoad,
      restTravel: suspension.component.properties.restTravel,
      springRate: suspension.component.properties.springRate,
      travel: suspension.component.properties.travel,
    },
    wheels: {
      mounts,
      radius: wheelSet.component.properties.radius,
      trackWidth,
      wheelbase,
      width: wheelSet.component.properties.width,
    },
  };

  assertFiniteProfile(profile);
  return profile;
}
