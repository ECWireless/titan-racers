import { getApprovedTireSurfaceInteraction } from "./kart-material-registry";

export type SurfaceMaterialReference = Readonly<{
  id: string;
  version: number;
}>;

// All currently approved tires use standard rubber. This is contact evidence,
// never a modification to a kart revision's resolved physical snapshot.
export function resolveTireSurfaceInteraction(
  surfaceMaterial: SurfaceMaterialReference,
) {
  const interaction = getApprovedTireSurfaceInteraction({
    derivationVersion: 1,
    surfaceMaterial,
    tireCompound: { id: "tire-compound.standard-rubber", version: 1 },
  });
  if (!interaction)
    throw new Error("The tire and surface interaction is unavailable.");
  return interaction;
}

export type TireSurfaceInteractionProfile = {
  peakGripCoefficient: number;
  peakSlipAngleDegrees: number;
  rollingResistanceCoefficient: number;
  slidingGripCoefficient: number;
  slidingSlipAngleDegrees: number;
};

const defaultInteraction = getApprovedTireSurfaceInteraction({
  derivationVersion: 1,
  surfaceMaterial: { id: "surface.standard-course", version: 1 },
  tireCompound: { id: "tire-compound.standard-rubber", version: 1 },
});

if (!defaultInteraction) {
  throw new Error("The default tire and surface interaction is unavailable.");
}

export const DEFAULT_TIRE_SURFACE_INTERACTION: TireSurfaceInteractionProfile =
  Object.freeze({
    peakGripCoefficient: defaultInteraction.peakGripCoefficient,
    peakSlipAngleDegrees: defaultInteraction.peakSlipAngleDegrees,
    rollingResistanceCoefficient:
      defaultInteraction.rollingResistanceCoefficient,
    slidingGripCoefficient: defaultInteraction.slidingGripCoefficient,
    slidingSlipAngleDegrees: defaultInteraction.slidingSlipAngleDegrees,
  });
