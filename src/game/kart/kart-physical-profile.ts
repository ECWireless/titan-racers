import {
  REFERENCE_KART_AREA_SCALE,
  REFERENCE_KART_LINEAR_SCALE,
  REFERENCE_KART_MASS_SCALE,
} from "./kart-reference-construction";

export type KartAerodynamicsProfile = {
  dragArea: number;
};

export type KartBrakesProfile = {
  maximumHandbrakeForce: number;
  maximumServiceBrakeForce: number;
};

export type KartDrivetrainProfile = {
  maximumDriveForce: number;
  noLoadSpeed: number;
};

export type KartSteeringProfile = {
  maximumCenterAngle: number;
};

export type KartSuspensionProfile = {
  bumpRate: number;
  bumpStart: number;
  damperRate: number;
  springRate: number;
};

export type KartPhysicalProfile = {
  aerodynamics: KartAerodynamicsProfile;
  brakes: KartBrakesProfile;
  drivetrain: KartDrivetrainProfile;
  steering: KartSteeringProfile;
  suspension: KartSuspensionProfile;
};

export const DEFAULT_KART_PHYSICAL_PROFILE: KartPhysicalProfile = {
  aerodynamics: {
    dragArea: 0.4 * REFERENCE_KART_AREA_SCALE,
  },
  brakes: {
    maximumHandbrakeForce: 756 * REFERENCE_KART_MASS_SCALE,
    maximumServiceBrakeForce: 1_680 * REFERENCE_KART_MASS_SCALE,
  },
  drivetrain: {
    maximumDriveForce: 1_140 * REFERENCE_KART_MASS_SCALE,
    noLoadSpeed: 17,
  },
  steering: {
    maximumCenterAngle: 18,
  },
  suspension: {
    // These preserve the rough fixture's static sag and approximate damping
    // ratio under geometric/Froude scaling. Phase 3B derives the same outputs
    // from suspension construction and mounting motion ratio.
    bumpRate: 62_000 * REFERENCE_KART_LINEAR_SCALE,
    bumpStart: 0.17 * REFERENCE_KART_LINEAR_SCALE,
    damperRate: 540 * REFERENCE_KART_LINEAR_SCALE ** 2.5,
    springRate: 13_000 * REFERENCE_KART_LINEAR_SCALE ** 2,
  },
};
