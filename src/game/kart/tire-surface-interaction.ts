export type TireSurfaceInteractionProfile = {
  peakGripCoefficient: number;
  peakSlipAngleDegrees: number;
  rollingResistanceCoefficient: number;
  slidingGripCoefficient: number;
  slidingSlipAngleDegrees: number;
};

// Transitional rough-course contact fixture. Phase 3B replaces this single
// interaction with a versioned tire-component x surface-material registry.
export const DEFAULT_TIRE_SURFACE_INTERACTION: TireSurfaceInteractionProfile =
  Object.freeze({
    peakGripCoefficient: 1.42,
    peakSlipAngleDegrees: 5,
    rollingResistanceCoefficient: 0.025,
    slidingGripCoefficient: 0.98,
    slidingSlipAngleDegrees: 18,
  });
