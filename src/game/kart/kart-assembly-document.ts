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

const instanceBaseSchema = z.strictObject({
  id: kartStableIdSchema,
  mirrorOf: kartStableIdSchema.nullable(),
  transform: kartTransformSchema,
});

const componentInstanceSchema = instanceBaseSchema.extend({
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

const primitiveBaseSchema = instanceBaseSchema.extend({
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

const kartAssemblyDocumentBaseSchema = z.strictObject({
  componentInstances: z.array(componentInstanceSchema).min(1).max(32),
  connections: z.array(connectionSchema).max(64),
  kartId: kartStableIdSchema,
  name: z.string().trim().min(1).max(80),
  practicalDescriptor: z.string().trim().min(1).max(160),
  primitiveInstances: z
    .array(z.discriminatedUnion("shape", [boxPrimitiveSchema, cylinderPrimitiveSchema]))
    .min(1)
    .max(64),
  units: z.strictObject({
    angle: z.literal("degrees"),
    length: z.literal("meters"),
  }),
  visualIdentity: z.strictObject({
    accentColor: z.string().regex(/^#[0-9a-f]{6}$/),
    primaryColor: z.string().regex(/^#[0-9a-f]{6}$/),
  }),
});

export const kartAssemblyDocumentSchema = kartAssemblyDocumentBaseSchema.extend({
  schemaVersion: z.literal(1),
  structuralAttachments: z.array(structuralAttachmentSchema).max(95),
});

export type KartAssemblyDocument = z.infer<typeof kartAssemblyDocumentSchema>;
export type KartAssemblyComponentInstance =
  KartAssemblyDocument["componentInstances"][number];
export type KartAssemblyPrimitiveInstance =
  KartAssemblyDocument["primitiveInstances"][number];

export function parseKartAssemblyDocument(input: unknown): KartAssemblyDocument {
  return kartAssemblyDocumentSchema.parse(input);
}

export function serializeKartAssemblyDocument(input: unknown) {
  return `${JSON.stringify(parseKartAssemblyDocument(input), null, 2)}\n`;
}
