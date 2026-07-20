import {
  DEFAULT_KART_PHYSICAL_PROFILE,
  type KartPhysicalProfile,
} from "./kart-physical-profile";
import {
  EARTH_WORLD_ENVIRONMENT,
  type WorldEnvironment,
} from "../physics/world-environment";
import {
  DEFAULT_TIRE_SURFACE_INTERACTION,
  type TireSurfaceInteractionProfile,
} from "./tire-surface-interaction";

export type KartDevelopmentValues = {
  aerodynamicDragArea: number;
  gravity: number;
  maxForwardSpeed: number;
  maximumBrakingForce: number;
  maximumCenterSteerAngle: number;
  maximumDriveForce: number;
  maximumHandbrakeForce: number;
  peakGripCoefficient: number;
  peakSlipAngleDegrees: number;
  rollingResistanceCoefficient: number;
  slidingGripCoefficient: number;
  slidingSlipAngleDegrees: number;
  suspensionBumpRate: number;
  suspensionBumpStart: number;
  suspensionDamperRate: number;
  suspensionSpringRate: number;
};

export type KartDevelopmentValueKey = keyof KartDevelopmentValues;

export type KartDevelopmentValueMetadata = {
  classification:
    | "environment"
    | "kart-derived-physical"
    | "runtime-contact-interaction";
  owner:
    | "aerodynamics"
    | "brakes"
    | "drivetrain"
    | "steering"
    | "suspension"
    | "tire-surface-interaction"
    | "world-environment";
};

type KartDevelopmentValueBound = {
  maximum: number;
  minimum: number;
  step: number;
};

export const DEFAULT_KART_DEVELOPMENT_VALUES: KartDevelopmentValues = {
  aerodynamicDragArea: DEFAULT_KART_PHYSICAL_PROFILE.aerodynamics.dragArea,
  gravity: EARTH_WORLD_ENVIRONMENT.gravity,
  maxForwardSpeed: DEFAULT_KART_PHYSICAL_PROFILE.drivetrain.noLoadSpeed,
  maximumBrakingForce:
    DEFAULT_KART_PHYSICAL_PROFILE.brakes.maximumServiceBrakeForce,
  maximumCenterSteerAngle:
    DEFAULT_KART_PHYSICAL_PROFILE.steering.maximumCenterAngle,
  maximumDriveForce:
    DEFAULT_KART_PHYSICAL_PROFILE.drivetrain.maximumDriveForce,
  maximumHandbrakeForce:
    DEFAULT_KART_PHYSICAL_PROFILE.brakes.maximumHandbrakeForce,
  peakGripCoefficient:
    DEFAULT_TIRE_SURFACE_INTERACTION.peakGripCoefficient,
  peakSlipAngleDegrees:
    DEFAULT_TIRE_SURFACE_INTERACTION.peakSlipAngleDegrees,
  rollingResistanceCoefficient:
    DEFAULT_TIRE_SURFACE_INTERACTION.rollingResistanceCoefficient,
  slidingGripCoefficient:
    DEFAULT_TIRE_SURFACE_INTERACTION.slidingGripCoefficient,
  slidingSlipAngleDegrees:
    DEFAULT_TIRE_SURFACE_INTERACTION.slidingSlipAngleDegrees,
  suspensionBumpRate: DEFAULT_KART_PHYSICAL_PROFILE.suspension.bumpRate,
  suspensionBumpStart: DEFAULT_KART_PHYSICAL_PROFILE.suspension.bumpStart,
  suspensionDamperRate: DEFAULT_KART_PHYSICAL_PROFILE.suspension.damperRate,
  suspensionSpringRate: DEFAULT_KART_PHYSICAL_PROFILE.suspension.springRate,
};

export const KART_DEVELOPMENT_VALUE_METADATA: Record<
  KartDevelopmentValueKey,
  KartDevelopmentValueMetadata
> = {
  aerodynamicDragArea: {
    classification: "kart-derived-physical",
    owner: "aerodynamics",
  },
  gravity: { classification: "environment", owner: "world-environment" },
  maxForwardSpeed: {
    classification: "kart-derived-physical",
    owner: "drivetrain",
  },
  maximumBrakingForce: {
    classification: "kart-derived-physical",
    owner: "brakes",
  },
  maximumCenterSteerAngle: {
    classification: "kart-derived-physical",
    owner: "steering",
  },
  maximumDriveForce: {
    classification: "kart-derived-physical",
    owner: "drivetrain",
  },
  maximumHandbrakeForce: {
    classification: "kart-derived-physical",
    owner: "brakes",
  },
  peakGripCoefficient: {
    classification: "runtime-contact-interaction",
    owner: "tire-surface-interaction",
  },
  peakSlipAngleDegrees: {
    classification: "runtime-contact-interaction",
    owner: "tire-surface-interaction",
  },
  rollingResistanceCoefficient: {
    classification: "runtime-contact-interaction",
    owner: "tire-surface-interaction",
  },
  slidingGripCoefficient: {
    classification: "runtime-contact-interaction",
    owner: "tire-surface-interaction",
  },
  slidingSlipAngleDegrees: {
    classification: "runtime-contact-interaction",
    owner: "tire-surface-interaction",
  },
  suspensionBumpRate: {
    classification: "kart-derived-physical",
    owner: "suspension",
  },
  suspensionBumpStart: {
    classification: "kart-derived-physical",
    owner: "suspension",
  },
  suspensionDamperRate: {
    classification: "kart-derived-physical",
    owner: "suspension",
  },
  suspensionSpringRate: {
    classification: "kart-derived-physical",
    owner: "suspension",
  },
};

export const KART_DEVELOPMENT_VALUE_BOUNDS: Record<
  KartDevelopmentValueKey,
  KartDevelopmentValueBound
> = {
  aerodynamicDragArea: { maximum: 0.125, minimum: 0.003, step: 0.0025 },
  gravity: { maximum: 40, minimum: 0, step: 0.01 },
  maxForwardSpeed: { maximum: 40, minimum: 0.5, step: 0.5 },
  maximumBrakingForce: { maximum: 100, minimum: 1, step: 1 },
  maximumCenterSteerAngle: { maximum: 45, minimum: 1, step: 0.5 },
  maximumDriveForce: { maximum: 60, minimum: 1, step: 1 },
  maximumHandbrakeForce: { maximum: 50, minimum: 0, step: 0.5 },
  peakGripCoefficient: { maximum: 3, minimum: 0.1, step: 0.01 },
  peakSlipAngleDegrees: { maximum: 44.5, minimum: 0.5, step: 0.5 },
  rollingResistanceCoefficient: {
    maximum: 0.2,
    minimum: 0,
    step: 0.005,
  },
  slidingGripCoefficient: { maximum: 3, minimum: 0.1, step: 0.01 },
  slidingSlipAngleDegrees: { maximum: 45, minimum: 1, step: 0.5 },
  suspensionBumpRate: { maximum: 50_000, minimum: 0, step: 250 },
  suspensionBumpStart: { maximum: 0.1, minimum: 0, step: 0.0025 },
  suspensionDamperRate: { maximum: 100, minimum: 0, step: 0.5 },
  suspensionSpringRate: { maximum: 2_000, minimum: 50, step: 25 },
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

export function normalizeKartDevelopmentValues(
  values: Partial<KartDevelopmentValues>,
): KartDevelopmentValues {
  const next = { ...DEFAULT_KART_DEVELOPMENT_VALUES };

  (Object.keys(DEFAULT_KART_DEVELOPMENT_VALUES) as KartDevelopmentValueKey[])
    .forEach((key) => {
      const requestedValue = values[key];
      if (
        typeof requestedValue !== "number" ||
        !Number.isFinite(requestedValue)
      ) {
        return;
      }
      const bounds = KART_DEVELOPMENT_VALUE_BOUNDS[key];
      next[key] = clamp(requestedValue, bounds.minimum, bounds.maximum);
    });

  next.slidingGripCoefficient = Math.min(
    next.slidingGripCoefficient,
    next.peakGripCoefficient,
  );
  next.slidingSlipAngleDegrees = Math.max(
    next.slidingSlipAngleDegrees,
    next.peakSlipAngleDegrees + 0.5,
  );

  return next;
}

export function resolveKartDevelopmentValues(
  values: KartDevelopmentValues,
): {
  environment: WorldEnvironment;
  kart: KartPhysicalProfile;
  tireSurfaceInteraction: TireSurfaceInteractionProfile;
} {
  return {
    environment: { ...EARTH_WORLD_ENVIRONMENT, gravity: values.gravity },
    kart: {
      aerodynamics: { dragArea: values.aerodynamicDragArea },
      brakes: {
        maximumHandbrakeForce: values.maximumHandbrakeForce,
        maximumServiceBrakeForce: values.maximumBrakingForce,
      },
      drivetrain: {
        maximumDriveForce: values.maximumDriveForce,
        noLoadSpeed: values.maxForwardSpeed,
      },
      steering: { maximumCenterAngle: values.maximumCenterSteerAngle },
      suspension: {
        bumpRate: values.suspensionBumpRate,
        bumpStart: values.suspensionBumpStart,
        damperRate: values.suspensionDamperRate,
        springRate: values.suspensionSpringRate,
      },
    },
    tireSurfaceInteraction: {
      peakGripCoefficient: values.peakGripCoefficient,
      peakSlipAngleDegrees: values.peakSlipAngleDegrees,
      rollingResistanceCoefficient: values.rollingResistanceCoefficient,
      slidingGripCoefficient: values.slidingGripCoefficient,
      slidingSlipAngleDegrees: values.slidingSlipAngleDegrees,
    },
  };
}
