import { z } from "zod";

export const kartStableIdSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/);

export const kartDefinitionReferenceSchema = z.strictObject({
  id: kartStableIdSchema,
  version: z.number().int().positive(),
});

export const kartVectorSchema = z.strictObject({
  x: z.number().finite().min(-2).max(2),
  y: z.number().finite().min(-2).max(2),
  z: z.number().finite().min(-2).max(2),
});

export const kartPositiveVectorSchema = z.strictObject({
  x: z.number().finite().min(0.001).max(1),
  y: z.number().finite().min(0.001).max(1),
  z: z.number().finite().min(0.001).max(1),
});

export const kartTransformSchema = z.strictObject({
  position: kartVectorSchema,
  rotationDegrees: z.strictObject({
    x: z.number().finite().min(-360).max(360),
    y: z.number().finite().min(-360).max(360),
    z: z.number().finite().min(-360).max(360),
  }),
});

const kartVisualColorSchema = z.string().regex(/^#[0-9a-f]{6}$/);

const instanceBaseV1Schema = z.strictObject({
  id: kartStableIdSchema,
  mirrorOf: kartStableIdSchema.nullable(),
  transform: kartTransformSchema,
});

const componentInstanceV1Schema = instanceBaseV1Schema.extend({
  definition: kartDefinitionReferenceSchema,
  kind: z.literal("component"),
  suspensionMount: z
    .strictObject({
      armPivot: kartVectorSchema,
      chassisAnchor: kartVectorSchema,
      hubAnchor: kartVectorSchema,
      springArmAnchor: kartVectorSchema,
    })
    .nullable(),
});

const primitiveBaseV1Schema = instanceBaseV1Schema.extend({
  collision: z.enum(["solid", "none"]),
  construction: z.discriminatedUnion("mode", [
    z.strictObject({ mode: z.literal("solid") }),
    z.strictObject({
      mode: z.literal("shell"),
      thickness: z.number().finite().min(0.0005).max(0.05),
    }),
  ]),
  kind: z.literal("primitive"),
  material: kartDefinitionReferenceSchema,
  role: z.enum(["structure", "bodywork", "guard", "trim"]),
});

const boxPrimitiveV1Schema = primitiveBaseV1Schema.extend({
  shape: z.literal("box"),
  size: kartPositiveVectorSchema,
});

const cylinderPrimitiveV1Schema = primitiveBaseV1Schema.extend({
  axis: z.enum(["x", "y", "z"]),
  height: z.number().finite().min(0.001).max(1),
  radius: z.number().finite().min(0.001).max(0.5),
  shape: z.literal("cylinder"),
});

const connectionEndpointSchema = z.strictObject({
  instanceId: kartStableIdSchema,
  portId: kartStableIdSchema,
});

const connectionSchema = z.strictObject({
  from: connectionEndpointSchema,
  id: kartStableIdSchema,
  to: connectionEndpointSchema,
});

const structuralAttachmentSchema = z.strictObject({
  child: z.strictObject({
    anchor: kartVectorSchema,
    instanceId: kartStableIdSchema,
  }),
  id: kartStableIdSchema,
  parent: z.strictObject({
    anchor: kartVectorSchema,
    instanceId: kartStableIdSchema,
  }),
});

const componentInstanceSchema = componentInstanceV1Schema.extend({
  visualColor: kartVisualColorSchema,
});

const primitiveBaseSchema = primitiveBaseV1Schema.extend({
  visualColor: kartVisualColorSchema,
});

const boxPrimitiveSchema = primitiveBaseSchema.extend({
  shape: z.literal("box"),
  size: kartPositiveVectorSchema,
});

const cylinderPrimitiveSchema = primitiveBaseSchema.extend({
  axis: z.enum(["x", "y", "z"]),
  height: z.number().finite().min(0.001).max(1),
  radius: z.number().finite().min(0.001).max(0.5),
  shape: z.literal("cylinder"),
});

const kartAssemblyDocumentV1BaseSchema = z.strictObject({
  componentInstances: z.array(componentInstanceV1Schema).min(1).max(32),
  connections: z.array(connectionSchema).max(64),
  kartId: kartStableIdSchema,
  name: z.string().trim().min(1).max(80),
  practicalDescriptor: z.string().trim().min(1).max(160),
  primitiveInstances: z
    .array(
      z.discriminatedUnion("shape", [
        boxPrimitiveV1Schema,
        cylinderPrimitiveV1Schema,
      ]),
    )
    .min(1)
    .max(64),
  units: z.strictObject({
    angle: z.literal("degrees"),
    length: z.literal("meters"),
  }),
  visualIdentity: z.strictObject({
    accentColor: kartVisualColorSchema,
    primaryColor: kartVisualColorSchema,
  }),
});

export const kartAssemblyDocumentV1Schema =
  kartAssemblyDocumentV1BaseSchema.extend({
    schemaVersion: z.literal(1),
    structuralAttachments: z.array(structuralAttachmentSchema).max(95),
  });

export const kartAssemblyDocumentSchema =
  kartAssemblyDocumentV1BaseSchema.extend({
    componentInstances: z.array(componentInstanceSchema).min(1).max(32),
    primitiveInstances: z
      .array(
        z.discriminatedUnion("shape", [
          boxPrimitiveSchema,
          cylinderPrimitiveSchema,
        ]),
      )
      .min(1)
      .max(64),
    schemaVersion: z.literal(2),
    structuralAttachments: z.array(structuralAttachmentSchema).max(95),
  });

export const KART_DEFAULT_COMPONENT_VISUAL_COLOR = "#475763";
export const KART_DEFAULT_SUSPENSION_VISUAL_COLOR = "#ff9e14";

type KartVisualIdentity = z.infer<
  typeof kartAssemblyDocumentV1BaseSchema
>["visualIdentity"];
type KartPrimitiveRole = z.infer<typeof primitiveBaseV1Schema>["role"];

export function defaultKartComponentVisualColor(
  definitionId: string,
  visualIdentity: KartVisualIdentity,
) {
  if (definitionId.startsWith("wheel-tire.")) {
    return visualIdentity.primaryColor;
  }
  if (definitionId.startsWith("suspension.")) {
    return KART_DEFAULT_SUSPENSION_VISUAL_COLOR;
  }
  return KART_DEFAULT_COMPONENT_VISUAL_COLOR;
}

export function defaultKartPrimitiveVisualColor(
  role: KartPrimitiveRole,
  visualIdentity: KartVisualIdentity,
) {
  if (role === "bodywork") return visualIdentity.primaryColor;
  if (role === "trim") return visualIdentity.accentColor;
  return KART_DEFAULT_COMPONENT_VISUAL_COLOR;
}

function migrateKartAssemblyDocumentV1(
  input: z.infer<typeof kartAssemblyDocumentV1Schema>,
) {
  return {
    ...input,
    componentInstances: input.componentInstances.map((instance) => ({
      ...instance,
      visualColor: defaultKartComponentVisualColor(
        instance.definition.id,
        input.visualIdentity,
      ),
    })),
    primitiveInstances: input.primitiveInstances.map((instance) => ({
      ...instance,
      visualColor: defaultKartPrimitiveVisualColor(
        instance.role,
        input.visualIdentity,
      ),
    })),
    schemaVersion: 2 as const,
  };
}

export type KartAssemblyDocumentV1 = z.infer<
  typeof kartAssemblyDocumentV1Schema
>;

export const kartAssemblyDocumentVersionSchema = z.union([
  kartAssemblyDocumentV1Schema,
  kartAssemblyDocumentSchema,
]);

export type KartAssemblyDocument = z.infer<typeof kartAssemblyDocumentSchema>;
export type KartAssemblyComponentInstance =
  KartAssemblyDocument["componentInstances"][number];
export type KartAssemblyPrimitiveInstance =
  KartAssemblyDocument["primitiveInstances"][number];

export function parseKartAssemblyDocument(input: unknown): KartAssemblyDocument {
  const version = z
    .object({ schemaVersion: z.number().int() })
    .passthrough()
    .safeParse(input);
  if (version.success && version.data.schemaVersion === 1) {
    return kartAssemblyDocumentSchema.parse(
      migrateKartAssemblyDocumentV1(kartAssemblyDocumentV1Schema.parse(input)),
    );
  }
  return kartAssemblyDocumentSchema.parse(input);
}

export function serializeKartAssemblyDocument(input: unknown) {
  return `${JSON.stringify(parseKartAssemblyDocument(input), null, 2)}\n`;
}
