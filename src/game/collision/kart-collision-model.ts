import { REFERENCE_KART_CONSTRUCTION } from "../kart/kart-reference-construction";

export type KartBodyContactMaterial = {
  friction: number;
  restitution: number;
};

export type KartCollisionEnvelope = {
  smallestRelevantCrossSection: number;
};

export type KartCollisionConstruction = {
  bodyContactMaterial: KartBodyContactMaterial;
  envelope: KartCollisionEnvelope;
};

export type KartCollisionSolverPolicy = {
  angularDamping: number;
  ccdMotionThresholdToRadiusRatio: number;
  ccdSweptRadiusToCrossSectionRatio: number;
};

export const DEFAULT_KART_COLLISION_CONSTRUCTION: KartCollisionConstruction = {
  bodyContactMaterial: {
    friction: 0.12,
    restitution: 0.04,
  },
  // The accepted compound envelope's narrow protective section is the
  // miniature RC fixture's lateral wheel-guard capsule.
  envelope: {
    smallestRelevantCrossSection:
      REFERENCE_KART_CONSTRUCTION.collision.smallestRelevantCrossSection,
  },
};

export const KART_COLLISION_SOLVER_POLICY: KartCollisionSolverPolicy = {
  angularDamping: 0.08,
  ccdMotionThresholdToRadiusRatio: 0.75,
  ccdSweptRadiusToCrossSectionRatio: 0.5,
};

export function deriveKartCcdConfiguration(
  envelope: KartCollisionEnvelope,
  policy: KartCollisionSolverPolicy = KART_COLLISION_SOLVER_POLICY,
) {
  if (
    !Number.isFinite(envelope.smallestRelevantCrossSection) ||
    envelope.smallestRelevantCrossSection <= 0 ||
    !Number.isFinite(policy.ccdSweptRadiusToCrossSectionRatio) ||
    policy.ccdSweptRadiusToCrossSectionRatio <= 0 ||
    !Number.isFinite(policy.ccdMotionThresholdToRadiusRatio) ||
    policy.ccdMotionThresholdToRadiusRatio < 0
  ) {
    throw new Error(
      "Kart CCD derivation requires a positive cross-section and radius ratio plus a non-negative threshold ratio",
    );
  }

  const sweptSphereRadius =
    envelope.smallestRelevantCrossSection *
    policy.ccdSweptRadiusToCrossSectionRatio;

  return {
    motionThreshold:
      sweptSphereRadius * policy.ccdMotionThresholdToRadiusRatio,
    sweptSphereRadius,
  };
}
