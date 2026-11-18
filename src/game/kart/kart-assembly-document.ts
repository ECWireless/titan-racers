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

const structuralAttachmentV1Schema = z.strictObject({
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

/**
 * Schema 3 names the mounting point each end of a structural attachment
 * uses (`kart-mounting.ts`), or null where none is named: documents from
 * schemas 1 and 2 migrate with none.
 */
const structuralAttachmentEndpointSchema = z.strictObject({
  anchor: kartVectorSchema,
  instanceId: kartStableIdSchema,
  mount: kartStableIdSchema.nullable(),
});

const structuralAttachmentSchema = z.strictObject({
  child: structuralAttachmentEndpointSchema,
  id: kartStableIdSchema,
  parent: structuralAttachmentEndpointSchema,
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
    structuralAttachments: z.array(structuralAttachmentV1Schema).max(95),
  });

const kartAssemblyDocumentV2BaseSchema =
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
  });

export const kartAssemblyDocumentV2Schema =
  kartAssemblyDocumentV2BaseSchema.extend({
    schemaVersion: z.literal(2),
    structuralAttachments: z.array(structuralAttachmentV1Schema).max(95),
  });

export const kartAssemblyDocumentSchema =
  kartAssemblyDocumentV2BaseSchema.extend({
    schemaVersion: z.literal(3),
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

function migrateKartAssemblyDocumentV2(
  input: z.infer<typeof kartAssemblyDocumentV2Schema>,
) {
  return {
    ...input,
    schemaVersion: 3 as const,
    structuralAttachments: input.structuralAttachments.map(
      ({ child, id, parent }) => ({
        child: { ...child, mount: null },
        id,
        parent: { ...parent, mount: null },
      }),
    ),
  };
}

export type KartAssemblyDocumentV1 = z.infer<
  typeof kartAssemblyDocumentV1Schema
>;

export const kartAssemblyDocumentVersionSchema = z.union([
  kartAssemblyDocumentV1Schema,
  kartAssemblyDocumentV2Schema,
  kartAssemblyDocumentSchema,
]);

export type KartAssemblyDocument = z.infer<typeof kartAssemblyDocumentSchema>;
export type KartAssemblyComponentInstance =
  KartAssemblyDocument["componentInstances"][number];
export type KartAssemblyPrimitiveInstance =
  KartAssemblyDocument["primitiveInstances"][number];
export type KartStructuralAttachment =
  KartAssemblyDocument["structuralAttachments"][number];

/**
 * Parses a document of any schema version, migrating it to the current one;
 * a failure reports the issues against the version the input declares.
 */
export function safeParseKartAssemblyDocument(input: unknown) {
  const version = z
    .object({ schemaVersion: z.number().int() })
    .passthrough()
    .safeParse(input);
  const declared = version.success ? version.data.schemaVersion : null;
  if (declared === 1 || declared === 2) {
    const older =
      declared === 1
        ? kartAssemblyDocumentV1Schema
            .transform(migrateKartAssemblyDocumentV1)
            .safeParse(input)
        : kartAssemblyDocumentV2Schema.safeParse(input);
    if (!older.success) return older;
    return kartAssemblyDocumentSchema.safeParse(
      migrateKartAssemblyDocumentV2(older.data),
    );
  }
  return kartAssemblyDocumentSchema.safeParse(input);
}

/**
 * A document of any schema version, migrated to the current one: for
 * documents kept from before a schema change, such as a stored ghost's.
 */
export const kartAssemblyDocumentAnyVersionSchema = z
  .unknown()
  .transform((input, context) => {
    const result = safeParseKartAssemblyDocument(input);
    if (result.success) return result.data;
    for (const issue of result.error.issues) {
      context.addIssue({
        code: "custom",
        message: issue.message,
        path: issue.path,
      });
    }
    return z.NEVER;
  });

export function parseKartAssemblyDocument(input: unknown): KartAssemblyDocument {
  const result = safeParseKartAssemblyDocument(input);
  if (!result.success) throw result.error;
  return result.data;
}

export function serializeKartAssemblyDocument(input: unknown) {
  return `${JSON.stringify(parseKartAssemblyDocument(input), null, 2)}\n`;
}
