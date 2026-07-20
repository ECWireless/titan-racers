import { z } from "zod";

import { kartStableIdSchema } from "./kart-assembly-document";
import { deepFreeze, type DeepReadonly } from "./immutable-registry";

const constructionMaterialSchema = z.strictObject({
  density: z.number().finite().positive(),
  id: kartStableIdSchema,
  label: z.string().trim().min(1).max(80),
  role: z.enum(["structural", "bodywork", "protective"]),
  summary: z.string().trim().min(1).max(200),
  version: z.number().int().positive(),
});

const tireCompoundSchema = z.strictObject({
  id: kartStableIdSchema,
  label: z.string().trim().min(1).max(80),
  summary: z.string().trim().min(1).max(200),
  version: z.number().int().positive(),
});

const surfaceMaterialSchema = z.strictObject({
  id: kartStableIdSchema,
  label: z.string().trim().min(1).max(80),
  summary: z.string().trim().min(1).max(200),
  version: z.number().int().positive(),
});

const tireSurfaceInteractionSchema = z.strictObject({
  derivationVersion: z.number().int().positive(),
  peakGripCoefficient: z.number().finite().positive(),
  peakSlipAngleDegrees: z.number().finite().positive().max(90),
  rollingResistanceCoefficient: z.number().finite().nonnegative().max(1),
  slidingGripCoefficient: z.number().finite().positive(),
  slidingSlipAngleDegrees: z.number().finite().positive().max(90),
  surfaceMaterial: z.strictObject({
    id: kartStableIdSchema,
    version: z.number().int().positive(),
  }),
  tireCompound: z.strictObject({
    id: kartStableIdSchema,
    version: z.number().int().positive(),
  }),
});

export type ConstructionMaterialDefinition = z.infer<
  typeof constructionMaterialSchema
>;
export type TireCompoundDefinition = z.infer<typeof tireCompoundSchema>;
export type SurfaceMaterialDefinition = z.infer<typeof surfaceMaterialSchema>;
export type TireSurfaceInteractionDefinition = z.infer<
  typeof tireSurfaceInteractionSchema
>;

export const APPROVED_CONSTRUCTION_MATERIALS = deepFreeze(
  z.array(constructionMaterialSchema).parse([
    {
      density: 2_700,
      id: "material.structural-aluminum",
      label: "Structural aluminum",
      role: "structural",
      summary: "Light, stiff construction for chassis rails, plates, and mounts.",
      version: 1,
    },
    {
      density: 7_850,
      id: "material.steel",
      label: "Steel",
      role: "protective",
      summary: "Dense construction for compact mounts and protective guards.",
      version: 1,
    },
    {
      density: 1_050,
      id: "material.engineering-polymer",
      label: "Engineering polymer",
      role: "structural",
      summary: "Low-mass construction for flexible brackets and electronics trays.",
      version: 1,
    },
    {
      density: 1_200,
      id: "material.polycarbonate-shell",
      label: "Polycarbonate shell",
      role: "bodywork",
      summary: "Thin impact-resistant bodywork with low construction mass.",
      version: 1,
    },
  ]),
);

export const APPROVED_TIRE_COMPOUNDS = deepFreeze(
  z.array(tireCompoundSchema).parse([
    {
      id: "tire-compound.standard-rubber",
      label: "Standard rubber",
      summary: "The common sealed tire construction used by the initial wheel options.",
      version: 1,
    },
  ]),
);

export const APPROVED_SURFACE_MATERIALS = deepFreeze(
  z.array(surfaceMaterialSchema).parse([
    {
      id: "surface.standard-course",
      label: "Standard course surface",
      summary: "The baseline dry course surface used by the Demo v1 environment.",
      version: 1,
    },
  ]),
);

export const APPROVED_TIRE_SURFACE_INTERACTIONS = deepFreeze(
  z.array(tireSurfaceInteractionSchema).parse([
    {
      derivationVersion: 1,
      peakGripCoefficient: 1.42,
      peakSlipAngleDegrees: 5,
      rollingResistanceCoefficient: 0.025,
      slidingGripCoefficient: 0.98,
      slidingSlipAngleDegrees: 18,
      surfaceMaterial: { id: "surface.standard-course", version: 1 },
      tireCompound: { id: "tire-compound.standard-rubber", version: 1 },
    },
  ]),
);

function registryKey(definition: { id: string; version: number }) {
  return `${definition.id}@${definition.version}`;
}

const constructionMaterialByKey = new Map(
  APPROVED_CONSTRUCTION_MATERIALS.map((definition) => [
    registryKey(definition),
    definition,
  ]),
);

const tireCompoundByKey = new Map(
  APPROVED_TIRE_COMPOUNDS.map((definition) => [
    registryKey(definition),
    definition,
  ]),
);

const surfaceMaterialByKey = new Map(
  APPROVED_SURFACE_MATERIALS.map((definition) => [
    registryKey(definition),
    definition,
  ]),
);
const tireSurfaceInteractionByKey = new Map(
  APPROVED_TIRE_SURFACE_INTERACTIONS.map((definition) => [
    `${registryKey(definition.tireCompound)}:${registryKey(definition.surfaceMaterial)}@${definition.derivationVersion}`,
    definition,
  ]),
);

export function getApprovedConstructionMaterial(
  reference: { id: string; version: number },
): DeepReadonly<ConstructionMaterialDefinition> | undefined {
  return constructionMaterialByKey.get(registryKey(reference));
}

export function getApprovedTireCompound(
  reference: { id: string; version: number },
): DeepReadonly<TireCompoundDefinition> | undefined {
  return tireCompoundByKey.get(registryKey(reference));
}

export function getApprovedSurfaceMaterial(
  reference: { id: string; version: number },
): DeepReadonly<SurfaceMaterialDefinition> | undefined {
  return surfaceMaterialByKey.get(registryKey(reference));
}

export function getApprovedTireSurfaceInteraction(input: {
  derivationVersion: number;
  surfaceMaterial: { id: string; version: number };
  tireCompound: { id: string; version: number };
}): DeepReadonly<TireSurfaceInteractionDefinition> | undefined {
  const key = `${registryKey(input.tireCompound)}:${registryKey(input.surfaceMaterial)}@${input.derivationVersion}`;
  return tireSurfaceInteractionByKey.get(key);
}
