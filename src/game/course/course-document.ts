import { z } from "zod";

import {
  getApprovedEnclosure,
  getEnclosurePlacementIssues,
  ISLAND_THREE_ENCLOSURE,
  MIRROR_ANGLE_LIMITS,
} from "../enclosure/island-three";
import { getApprovedSurfaceMaterial } from "../kart/kart-material-registry";
import fallsViewParkDocumentJson from "./falls-view-park.v4.json";
import type { OfficialCourseId } from "./course-ids";
import roughCourseDocumentJson from "./rough-course.v4.json";

export const courseIdSchema = z
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
    "hazard",
    "steel",
    "ground",
    "lawn",
    "line",
    "obstacleBarrel",
    "obstacleBlock",
    "ramp",
    "verge",
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

const courseObjectV2Schema = z.strictObject({
  availability: z.enum(["standard", "collision-test"]),
  category: z.enum(["surface", "obstacle", "feature", "fixture", "marker"]),
  editable: z.boolean(),
  id: courseIdSchema,
  label: z.string().trim().min(1).max(80).optional(),
  transform: transformSchema,
  visual: visualSchema,
  collision: z
    .discriminatedUnion("shape", [boxCollisionSchema, cylinderCollisionSchema])
    .nullable(),
});

const surfaceMaterialSchema = z
  .strictObject({
    id: z.string().max(80),
    version: z.number().int().positive(),
  })
  .refine((reference) => Boolean(getApprovedSurfaceMaterial(reference)), {
    message: "Unsupported surface material version",
  });

const courseObjectSchema = courseObjectV2Schema.extend({
  collision: z
    .discriminatedUnion("shape", [
      boxCollisionSchema.extend({ surfaceMaterial: surfaceMaterialSchema }),
      cylinderCollisionSchema.extend({
        surfaceMaterial: surfaceMaterialSchema,
      }),
    ])
    .nullable(),
});

const courseStartV1Schema = transformSchema.extend({
  id: courseIdSchema,
});

const courseStartSchema = courseStartV1Schema.extend({
  gateHalfExtents: positiveVectorSchema,
});

const checkpointV1Schema = transformSchema.extend({
  halfExtents: positiveVectorSchema,
  id: courseIdSchema,
  order: z.number().int().positive(),
});

const checkpointSchema = checkpointV1Schema.extend({
  forward: finiteVectorSchema,
  recovery: transformSchema,
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

export const COURSE_CHECKPOINT_LIMIT = 256;

const courseDocumentBaseSchema = z.strictObject({
  courseId: courseIdSchema,
  lighting: lightingSchema,
  name: z.string().trim().min(1).max(120),
  objects: z.array(courseObjectV2Schema).min(1).max(5_000),
  units: z.literal("meters"),
});

type DocumentIdentityShape = {
  checkpoints: Array<{ id: string; order: number }>;
  lighting?: { directionalLights: Array<{ id: string }> };
  objects: Array<{ id: string }>;
  start: { id: string };
};

function validateDocumentIdentityAndOrder(
  document: DocumentIdentityShape,
  context: z.RefinementCtx,
) {
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

  document.lighting?.directionalLights.forEach((light, index) =>
    registerId(light.id, ["lighting", "directionalLights", index, "id"]),
  );
}

export const courseDocumentV1Schema = courseDocumentBaseSchema
  .extend({
    checkpoints: z.array(checkpointV1Schema).min(1).max(COURSE_CHECKPOINT_LIMIT),
    schemaVersion: z.literal(1),
    start: courseStartV1Schema,
  })
  .superRefine(validateDocumentIdentityAndOrder);

const courseDocumentV2BaseSchema = courseDocumentBaseSchema.extend({
  checkpoints: z.array(checkpointSchema).min(1).max(COURSE_CHECKPOINT_LIMIT),
  schemaVersion: z.literal(2),
  start: courseStartSchema,
});

function validateCourseRoute(
  document: Omit<DocumentIdentityShape, "checkpoints"> & {
    checkpoints: Array<{
      forward: { x: number; y: number; z: number };
      id: string;
      order: number;
    }>;
  },
  context: z.RefinementCtx,
) {
  validateDocumentIdentityAndOrder(document, context);

  document.checkpoints.forEach((checkpoint, index) => {
    const forwardLength = Math.hypot(
      checkpoint.forward.x,
      checkpoint.forward.y,
      checkpoint.forward.z,
    );

    if (Math.abs(forwardLength - 1) > 1e-6) {
      context.addIssue({
        code: "custom",
        message: "Checkpoint forward direction must be normalized",
        path: ["checkpoints", index, "forward"],
      });
    }
  });
}

const courseDocumentV2Schema =
  courseDocumentV2BaseSchema.superRefine(validateCourseRoute);

const courseDocumentV3BaseSchema = courseDocumentV2BaseSchema.extend({
  objects: z.array(courseObjectSchema).min(1).max(5_000),
  schemaVersion: z.literal(3),
  // The kart spawns this far behind the start gate, along its heading.
  start: courseStartSchema.extend({
    spawnDistance: z.number().finite().min(0).max(10),
  }),
});

const courseDocumentV3Schema =
  courseDocumentV3BaseSchema.superRefine(validateCourseRoute);

const enclosureSchema = z
  .strictObject({
    id: z.string().max(80),
    mirrorAngle: z
      .number()
      .finite()
      .min(MIRROR_ANGLE_LIMITS.min)
      .max(MIRROR_ANGLE_LIMITS.max),
    placement: z.strictObject({
      axial: z.number().finite(),
      azimuth: z.number().finite().min(0).lt(360),
      heading: z.number().finite().min(-180).max(180),
      height: z.number().finite().min(0),
    }),
    version: z.number().int().positive(),
  })
  .superRefine((enclosure, context) => {
    const definition = getApprovedEnclosure(enclosure);
    if (!definition) {
      context.addIssue({
        code: "custom",
        message: "Unsupported enclosure",
        path: ["id"],
      });
      return;
    }
    getEnclosurePlacementIssues(definition, enclosure.placement).forEach(
      ({ message, path }) =>
        context.addIssue({ code: "custom", message, path: ["placement", path] }),
    );
  });

// Version four places the course in its habitat enclosure, whose sunlight
// replaces authored directional lights.
export const courseDocumentSchema = courseDocumentV3BaseSchema
  .omit({ lighting: true })
  .extend({
    enclosure: enclosureSchema,
    schemaVersion: z.literal(4),
  })
  .superRefine(validateCourseRoute);

export type CourseDocumentV1 = z.infer<typeof courseDocumentV1Schema>;
type CourseDocumentV3 = z.infer<typeof courseDocumentV3Schema>;
export type CourseDocument = z.infer<typeof courseDocumentSchema>;
export type CourseObject = CourseDocument["objects"][number];
export type CourseVisualMaterial = CourseObject["visual"]["material"];

const DEFAULT_START_GATE_HALF_EXTENTS = {
  x: 4,
  y: 1.5,
  z: 0.4,
} as const;

function normalizeDirection(
  from: { x: number; y: number; z: number },
  to: { x: number; y: number; z: number },
) {
  const x = to.x - from.x;
  const y = to.y - from.y;
  const z = to.z - from.z;
  const length = Math.hypot(x, y, z);

  if (length <= 1e-9) {
    throw new Error("Course route anchors must not occupy the same position");
  }

  return { x: x / length, y: y / length, z: z / length };
}

function quaternionFromEulerAngles(rotation: {
  x: number;
  y: number;
  z: number;
}) {
  const halfToRadians = Math.PI / 360;
  const ex = rotation.x * halfToRadians;
  const ey = rotation.y * halfToRadians;
  const ez = rotation.z * halfToRadians;
  const sx = Math.sin(ex);
  const cx = Math.cos(ex);
  const sy = Math.sin(ey);
  const cy = Math.cos(ey);
  const sz = Math.sin(ez);
  const cz = Math.cos(ez);
  return {
    w: cx * cy * cz + sx * sy * sz,
    x: sx * cy * cz - cx * sy * sz,
    y: cx * sy * cz + sx * cy * sz,
    z: cx * cy * sz - sx * sy * cz,
  };
}

function rotateByQuaternion(
  quaternion: { w: number; x: number; y: number; z: number },
  vector: { x: number; y: number; z: number },
) {
  const tx = 2 * (quaternion.y * vector.z - quaternion.z * vector.y);
  const ty = 2 * (quaternion.z * vector.x - quaternion.x * vector.z);
  const tz = 2 * (quaternion.x * vector.y - quaternion.y * vector.x);

  return {
    x:
      vector.x +
      quaternion.w * tx +
      (quaternion.y * tz - quaternion.z * ty),
    y:
      vector.y +
      quaternion.w * ty +
      (quaternion.z * tx - quaternion.x * tz),
    z:
      vector.z +
      quaternion.w * tz +
      (quaternion.x * ty - quaternion.y * tx),
  };
}

function cleanDirectionComponent(value: number) {
  if (Math.abs(value) <= 1e-12) {
    return 0;
  }

  if (Math.abs(Math.abs(value) - 1) <= 1e-12) {
    return Math.sign(value);
  }

  return value;
}

function rotateByEulerAngles(
  rotation: { x: number; y: number; z: number },
  vector: { x: number; y: number; z: number },
) {
  return rotateByQuaternion(quaternionFromEulerAngles(rotation), vector);
}

export function rotateCourseDirection(
  direction: { x: number; y: number; z: number },
  previousRotation: { x: number; y: number; z: number },
  nextRotation: { x: number; y: number; z: number },
) {
  const previousQuaternion = quaternionFromEulerAngles(previousRotation);
  const localDirection = rotateByQuaternion(
    {
      w: previousQuaternion.w,
      x: -previousQuaternion.x,
      y: -previousQuaternion.y,
      z: -previousQuaternion.z,
    },
    direction,
  );
  const nextDirection = rotateByEulerAngles(nextRotation, localDirection);

  return {
    x: cleanDirectionComponent(nextDirection.x),
    y: cleanDirectionComponent(nextDirection.y),
    z: cleanDirectionComponent(nextDirection.z),
  };
}

function alignCheckpointForwardToGate(
  checkpoint: {
    rotation: { x: number; y: number; z: number };
  },
  directionHint: { x: number; y: number; z: number },
) {
  const localAxes = [
    { x: 1, y: 0, z: 0 },
    { x: 0, y: 1, z: 0 },
    { x: 0, y: 0, z: 1 },
  ];
  const selected = localAxes
    .map((axis) => {
      const worldAxis = rotateByEulerAngles(checkpoint.rotation, axis);
      const alignment =
        worldAxis.x * directionHint.x +
        worldAxis.y * directionHint.y +
        worldAxis.z * directionHint.z;
      return { alignment, worldAxis };
    })
    .sort(
      (left, right) =>
        Math.abs(right.alignment) - Math.abs(left.alignment),
    )[0]!;

  const sign = selected.alignment < 0 ? -1 : 1;

  return {
    x: cleanDirectionComponent(selected.worldAxis.x * sign),
    y: cleanDirectionComponent(selected.worldAxis.y * sign),
    z: cleanDirectionComponent(selected.worldAxis.z * sign),
  };
}

function yawForDirection(direction: { x: number; z: number }) {
  if (Math.hypot(direction.x, direction.z) <= 1e-9) {
    throw new Error("Course recovery direction must have a horizontal component");
  }

  return (Math.atan2(-direction.x, -direction.z) * 180) / Math.PI;
}

export function migrateCourseDocumentV1(input: unknown): CourseDocument {
  const document = courseDocumentV1Schema.parse(input);
  const startGateCenter = {
    x: document.start.position.x,
    y: document.start.position.y + DEFAULT_START_GATE_HALF_EXTENTS.y,
    z: document.start.position.z,
  };

  return parseCourseDocument({
    ...document,
    checkpoints: document.checkpoints.map((checkpoint, index) => {
      const previousPosition =
        index === 0
          ? startGateCenter
          : document.checkpoints[index - 1].position;
      const nextPosition =
        index === document.checkpoints.length - 1
          ? startGateCenter
          : document.checkpoints[index + 1].position;
      const departureDirection = normalizeDirection(
        checkpoint.position,
        nextPosition,
      );
      const routeDirection =
        document.checkpoints.length === 1
          ? normalizeDirection(startGateCenter, checkpoint.position)
          : normalizeDirection(previousPosition, nextPosition);

      return {
        ...checkpoint,
        forward: alignCheckpointForwardToGate(checkpoint, routeDirection),
        recovery: {
          position: {
            x: checkpoint.position.x,
            y: checkpoint.position.y - checkpoint.halfExtents.y,
            z: checkpoint.position.z,
          },
          rotation: {
            x: 0,
            y: yawForDirection(departureDirection),
            z: 0,
          },
        },
      };
    }),
    schemaVersion: 2,
    start: {
      ...document.start,
      gateHalfExtents: { ...DEFAULT_START_GATE_HALF_EXTENTS },
    },
  });
}

function hasSchemaVersion(input: unknown, version: number) {
  return (
    Boolean(input) &&
    typeof input === "object" &&
    "schemaVersion" in (input as object) &&
    (input as { schemaVersion: unknown }).schemaVersion === version
  );
}

function alignCheckpoints<
  T extends {
    forward: { x: number; y: number; z: number };
    rotation: { x: number; y: number; z: number };
  },
>(checkpoints: T[]) {
  return checkpoints.map((checkpoint) => ({
    ...checkpoint,
    forward: alignCheckpointForwardToGate(checkpoint, checkpoint.forward),
  }));
}

function parseCourseDocumentV3(input: unknown): CourseDocumentV3 {
  const isVersionTwo = hasSchemaVersion(input, 2);
  const document = isVersionTwo
    ? courseDocumentV2Schema.parse(input)
    : courseDocumentV3Schema.parse(input);

  return courseDocumentV3Schema.parse({
    ...document,
    schemaVersion: 3,
    start: isVersionTwo ? { ...document.start, spawnDistance: 0 } : document.start,
    objects: isVersionTwo
      ? document.objects.map((object) => ({
          ...object,
          collision: object.collision
            ? {
                ...object.collision,
                surfaceMaterial: { id: "surface.standard-course", version: 1 },
              }
            : null,
        }))
      : document.objects,
    checkpoints: alignCheckpoints(document.checkpoints),
  });
}

const roundHundredth = (value: number) => Math.round(value * 100) / 100 || 0;

/**
 * Places a pre-enclosure course at the middle of the first valley, turned
 * and timed so the habitat sun shines from its old key light's direction.
 * It uses the evening side, the sun's image toward the anti-sun cap, whose
 * light reaches the middle of the habitat for elevations above about 27°
 * (see `getEnclosureFrame`). Other lights and ambient color are dropped.
 */
function upgradeCourseDocumentV3({
  lighting,
  ...document
}: CourseDocumentV3): CourseDocument {
  const keyLight = lighting.directionalLights[0]!;
  const lightDirection = rotateByEulerAngles(keyLight.rotation, {
    x: 0,
    y: -1,
    z: 0,
  });
  const elevation =
    (Math.asin(Math.max(-1, Math.min(1, -lightDirection.y))) * 180) / Math.PI;
  const horizontal = Math.hypot(lightDirection.x, lightDirection.z);

  return {
    ...document,
    enclosure: {
      ...ISLAND_THREE_ENCLOSURE,
      mirrorAngle: Math.min(
        MIRROR_ANGLE_LIMITS.max,
        Math.max(45, roundHundredth(90 - elevation / 2)),
      ),
      placement: {
        axial: 0,
        azimuth: 0,
        // The rays run toward the sunward cap.
        heading:
          horizontal > 1e-9
            ? roundHundredth(
                (Math.atan2(-lightDirection.x, -lightDirection.z) * 180) /
                  Math.PI,
              )
            : 0,
        height: 0,
      },
    },
    schemaVersion: 4,
  };
}

export function parseCourseDocument(input: unknown): CourseDocument {
  if (hasSchemaVersion(input, 1)) {
    return migrateCourseDocumentV1(input);
  }

  if (hasSchemaVersion(input, 2) || hasSchemaVersion(input, 3)) {
    return courseDocumentSchema.parse(
      upgradeCourseDocumentV3(parseCourseDocumentV3(input)),
    );
  }

  const document = courseDocumentSchema.parse(input);
  return courseDocumentSchema.parse({
    ...document,
    checkpoints: alignCheckpoints(document.checkpoints),
  });
}

/** The kart spawn: behind the start gate (local +z) by the authored distance. */
export function getCourseStartTransform(document: CourseDocument) {
  const { position, rotation, spawnDistance } = document.start;
  const back = rotateByEulerAngles(rotation, { x: 0, y: 0, z: spawnDistance });
  return {
    position: {
      x: position.x + back.x,
      y: position.y + back.y,
      z: position.z + back.z,
    },
    rotation: { ...rotation },
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

export const FALLS_VIEW_PARK_DOCUMENT = parseCourseDocument(
  fallsViewParkDocumentJson,
);

/** Validated source seeds, used when no publication is available. */
export const BUNDLED_COURSE_DOCUMENTS: Record<OfficialCourseId, CourseDocument> =
  {
    "falls-view-park": FALLS_VIEW_PARK_DOCUMENT,
    "rough-course": ROUGH_COURSE_DOCUMENT,
  };
