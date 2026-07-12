import { z } from "zod";

import roughCourseDocumentJson from "./rough-course.v1.json";

const courseIdSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

const finiteVectorSchema = z.strictObject({
  x: z.number().finite().min(-10_000).max(10_000),
  y: z.number().finite().min(-10_000).max(10_000),
  z: z.number().finite().min(-10_000).max(10_000),
});

const colorSchema = z.strictObject({
  b: z.number().finite().min(0).max(1),
  g: z.number().finite().min(0).max(1),
  r: z.number().finite().min(0).max(1),
});

const positiveVectorSchema = z.strictObject({
  x: z.number().finite().positive().max(10_000),
  y: z.number().finite().positive().max(10_000),
  z: z.number().finite().positive().max(10_000),
});

const transformSchema = z.strictObject({
  position: finiteVectorSchema,
  rotation: finiteVectorSchema,
});

const visualSchema = z.strictObject({
  material: z.enum([
    "asphalt",
    "ground",
    "line",
    "obstacleBarrel",
    "obstacleBlock",
    "ramp",
  ]),
  scale: positiveVectorSchema,
  shape: z.enum(["box", "cylinder"]),
});

const collisionBaseSchema = z.strictObject({
  friction: z.number().finite().min(0).max(2),
  offset: transformSchema,
  restitution: z.number().finite().min(0).max(1),
  role: z.enum(["drivable-surface", "solid-obstacle"]),
});

const boxCollisionSchema = collisionBaseSchema.extend({
  halfExtents: positiveVectorSchema,
  shape: z.literal("box"),
});

const cylinderCollisionSchema = collisionBaseSchema.extend({
  axis: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  height: z.number().finite().positive().max(10_000),
  radius: z.number().finite().positive().max(10_000),
  shape: z.literal("cylinder"),
});

const courseObjectSchema = z.strictObject({
  availability: z.enum(["standard", "collision-test"]),
  category: z.enum(["surface", "obstacle", "feature", "fixture", "marker"]),
  editable: z.boolean(),
  id: courseIdSchema,
  transform: transformSchema,
  visual: visualSchema,
  collision: z
    .discriminatedUnion("shape", [boxCollisionSchema, cylinderCollisionSchema])
    .nullable(),
});

const courseStartSchema = transformSchema.extend({
  id: courseIdSchema,
});

const checkpointSchema = transformSchema.extend({
  halfExtents: positiveVectorSchema,
  id: courseIdSchema,
  order: z.number().int().positive(),
});

const ambientLightSchema = z.strictObject({
  color: colorSchema,
  intensity: z.number().finite().min(0).max(4),
});

const directionalLightSchema = z.strictObject({
  color: colorSchema,
  id: courseIdSchema,
  intensity: z.number().finite().min(0).max(8),
  rotation: finiteVectorSchema,
  shadowQuality: z.enum(["off", "low", "medium", "high"]),
});

const lightingSchema = z.strictObject({
  ambient: ambientLightSchema,
  directionalLights: z.array(directionalLightSchema).min(1).max(2),
});

export const courseDocumentSchema = z
  .strictObject({
    checkpoints: z.array(checkpointSchema).min(1).max(256),
    courseId: courseIdSchema,
    lighting: lightingSchema,
    name: z.string().trim().min(1).max(120),
    objects: z.array(courseObjectSchema).min(1).max(5_000),
    schemaVersion: z.literal(1),
    start: courseStartSchema,
    units: z.literal("meters"),
  })
  .superRefine((document, context) => {
    const seenIds = new Map<string, (string | number)[]>();
    const registerId = (id: string, path: (string | number)[]) => {
      const firstPath = seenIds.get(id);

      if (firstPath) {
        context.addIssue({
          code: "custom",
          message: `Duplicate stable ID "${id}"; first declared at ${firstPath.join(".")}`,
          path,
        });
        return;
      }

      seenIds.set(id, path);
    };

    registerId(document.start.id, ["start", "id"]);
    document.objects.forEach((object, index) =>
      registerId(object.id, ["objects", index, "id"]),
    );
    document.checkpoints.forEach((checkpoint, index) => {
      registerId(checkpoint.id, ["checkpoints", index, "id"]);

      const expectedOrder = index + 1;

      if (checkpoint.order !== expectedOrder) {
        context.addIssue({
          code: "custom",
          message: `Checkpoint order must be contiguous and match array order; expected ${expectedOrder}`,
          path: ["checkpoints", index, "order"],
        });
      }
    });

    document.lighting.directionalLights.forEach((light, index) =>
      registerId(light.id, ["lighting", "directionalLights", index, "id"]),
    );
  });

export type CourseDocument = z.infer<typeof courseDocumentSchema>;
export type CourseObject = CourseDocument["objects"][number];
export type CourseVisualMaterial = CourseObject["visual"]["material"];

export function parseCourseDocument(input: unknown): CourseDocument {
  return courseDocumentSchema.parse(input);
}

export function getCourseStartTransform(document: CourseDocument) {
  return {
    position: { ...document.start.position },
    rotation: { ...document.start.rotation },
  };
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJsonValue);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([leftKey], [rightKey]) =>
          leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0,
        )
        .map(([key, childValue]) => [key, sortJsonValue(childValue)]),
    );
  }

  return value;
}

export function serializeCourseDocument(input: unknown) {
  return `${JSON.stringify(sortJsonValue(parseCourseDocument(input)), null, 2)}\n`;
}

export const ROUGH_COURSE_DOCUMENT = parseCourseDocument(
  roughCourseDocumentJson,
);
