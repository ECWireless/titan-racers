import { z } from "zod";

import {
  getApprovedEnclosure,
  getEnclosurePlacementIssues,
  ISLAND_THREE_ENCLOSURE,
  MIRROR_ANGLE_LIMITS,
} from "../enclosure/island-three";
import { getApprovedSurfaceMaterial } from "../kart/kart-material-registry";
import { COURSE_ARC_MAXIMUM_WIDTH_RATIO } from "./course-arc";
import fallsViewParkDocumentJson from "./falls-view-park.v10.json";
import type { OfficialCourseId } from "./course-ids";
import roughCourseDocumentJson from "./rough-course.v10.json";

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

// An arc sweeps a rectangular section about its object's origin; see
// course-arc.ts. Its outer edge stays within the course's ±200 m.
const arcSchema = z
  .strictObject({
    height: z.number().finite().positive().max(100),
    innerRadius: z.number().finite().min(0.05).max(200),
    sweep: z.number().finite().positive().max(360),
    width: z.number().finite().min(0.1).max(100),
  })
  .refine((arc) => arc.innerRadius + arc.width <= 200, {
    message: "An arc's outer radius is at most 200 m",
    path: ["width"],
  })
  .refine(
    (arc) => arc.width <= COURSE_ARC_MAXIMUM_WIDTH_RATIO * arc.innerRadius,
    {
      message: `An arc is at most ${COURSE_ARC_MAXIMUM_WIDTH_RATIO} times as wide as its inner radius`,
      path: ["width"],
    },
  );

const arcVisualSchema = z.strictObject({
  arc: arcSchema,
  material: visualSchema.shape.material,
  shape: z.literal("arc"),
});

// Arcs collide only as walls: their boxes never support a kart.
const arcCollisionSchema = z.strictObject({
  friction: collisionBaseSchema.shape.friction,
  restitution: collisionBaseSchema.shape.restitution,
  role: z.literal("solid-obstacle"),
  shape: z.literal("arc"),
  surfaceMaterial: surfaceMaterialSchema,
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
/** Course lamps each add a light, so a course has at most this many floodlights. */
export const COURSE_LAMP_LIMIT = 12;
// Courses before schema version seven had at most this many floodlights.
const LEGACY_COURSE_LAMP_LIMIT = 8;
/** Planted beds' trees are drawn and collide, so a course has at most this many. */
export const COURSE_TREE_LIMIT = 2_000;
/**
 * Indoor lamps (tunnel luminaires and, from schema version eight, the
 * youth's work lights) light only indoor objects, and share their own limit.
 */
export const COURSE_INDOOR_LAMP_LIMIT = 20;
// Courses before schema version eight had at most this many tunnel lamps.
const LEGACY_COURSE_INDOOR_LAMP_LIMIT = 16;
export const COURSE_STREET_LAMP_LIMIT = 8;
// A course's footprint stays this close to its placement, inside the
// clearing's fence.
const COURSE_CLEARING_FOOTPRINT_REACH = 200;
export type CourseLampKind = "floodlight" | "tunnel" | "work" | "street";
export const COURSE_INDOOR_LAMP_KINDS = ["tunnel", "work"] as const;
/** The bicycles a course can park. */
export const COURSE_BICYCLES = ["hardtail", "bmx"] as const;
export type CourseBicycle = (typeof COURSE_BICYCLES)[number];
export function countCourseLamps(
  document: { objects: { lamp?: string }[] },
  kind: CourseLampKind,
) {
  return document.objects.filter((object) => object.lamp === kind).length;
}
export function countCourseIndoorLamps(document: { objects: { lamp?: string }[] }) {
  return COURSE_INDOOR_LAMP_KINDS.reduce(
    (total, kind) => total + countCourseLamps(document, kind),
    0,
  );
}
// Courses before schema version five opened their mirrors at most this far.
const LEGACY_MIRROR_ANGLE_MAX = 85;

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

const enclosureObjectSchema = (mirrorAngleMax: number) =>
  z.strictObject({
    id: z.string().max(80),
    mirrorAngle: z
      .number()
      .finite()
      .min(MIRROR_ANGLE_LIMITS.min)
      .max(mirrorAngleMax),
    placement: z.strictObject({
      axial: z.number().finite(),
      azimuth: z.number().finite().min(0).lt(360),
      heading: z.number().finite().min(-180).max(180),
      height: z.number().finite().min(0),
    }),
    version: z.number().int().positive(),
  });

function validateEnclosure(
  enclosure: z.infer<ReturnType<typeof enclosureObjectSchema>>,
  context: z.RefinementCtx,
) {
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
}

const enclosureSchema = (mirrorAngleMax: number) =>
  enclosureObjectSchema(mirrorAngleMax).superRefine(validateEnclosure);

const footprintCornerSchema = z.strictObject({
  x: z.number().finite(),
  z: z.number().finite(),
});

// Version ten lets a course stand in its habitat clearing: outside its
// footprint, out to the clearing's fence, the habitat floor is drawn and
// drivable (course-clearing.ts).
const enclosureV10Schema = enclosureObjectSchema(MIRROR_ANGLE_LIMITS.max)
  .extend({
    clearing: z
      .strictObject({
        footprint: z.strictObject({
          max: footprintCornerSchema,
          min: footprintCornerSchema,
        }),
      })
      .optional(),
  })
  .superRefine((enclosure, context) => {
    validateEnclosure(enclosure, context);
    if (!enclosure.clearing) return;
    const { max, min } = enclosure.clearing.footprint;
    if (!(min.x < max.x && min.z < max.z)) {
      context.addIssue({
        code: "custom",
        message: "A clearing footprint's minimum must lie below its maximum",
        path: ["clearing", "footprint"],
      });
    }
    // The floor runs straight along the axis and curves around it, so a
    // footprint square to the axis meets it along straight edges.
    if (enclosure.placement.heading % 90 !== 0) {
      context.addIssue({
        code: "custom",
        message: "A course in a clearing must be turned square to the axis",
        path: ["placement", "heading"],
      });
    }
    if (
      [min.x, max.x].some((x) =>
        [min.z, max.z].some(
          (z) => Math.hypot(x, z) > COURSE_CLEARING_FOOTPRINT_REACH,
        ),
      )
    ) {
      context.addIssue({
        code: "custom",
        message: `A clearing footprint must lie within ${COURSE_CLEARING_FOOTPRINT_REACH} m of the placement`,
        path: ["clearing", "footprint"],
      });
    }
  });

// Version four places the course in its habitat enclosure, whose sunlight
// replaces authored directional lights.
const courseDocumentV4BaseSchema = courseDocumentV3BaseSchema
  .omit({ lighting: true })
  .extend({
    enclosure: enclosureSchema(LEGACY_MIRROR_ANGLE_MAX),
    schemaVersion: z.literal(4),
  });

const courseDocumentV4Schema =
  courseDocumentV4BaseSchema.superRefine(validateCourseRoute);

// Version five adds course lamps, a light on a full-size mast, and lets a
// mirror open fully for night.
const courseDocumentV5BaseSchema = courseDocumentV4BaseSchema.extend({
  enclosure: enclosureSchema(MIRROR_ANGLE_LIMITS.max),
  objects: courseDocumentV3BaseSchema.shape.objects.element
    .extend({
      // A floodlight: its luminaire and light stand on top of the object,
      // reaching along its local -Z.
      lamp: z.literal("floodlight").optional(),
    })
    .array()
    .min(1)
    .max(5_000),
  schemaVersion: z.literal(5),
});

const courseDocumentV5Schema = courseDocumentV5BaseSchema.superRefine(
  (document, context) => {
    validateCourseRoute(document, context);
    if (countCourseLamps(document, "floodlight") > LEGACY_COURSE_LAMP_LIMIT) {
      context.addIssue({
        code: "custom",
        message: `A course has at most ${LEGACY_COURSE_LAMP_LIMIT} lamps`,
        path: ["objects"],
      });
    }
  },
);

// Version six adds indoor objects, lit only by tunnel lamps and an interior
// environment, overhead objects the editor can cut away, tunnel lamps, and
// smooth arcs.
const courseDocumentV6BaseSchema = courseDocumentV5BaseSchema.extend({
  objects: courseDocumentV3BaseSchema.shape.objects.element
    .extend({
      collision: z
        .discriminatedUnion("shape", [
          ...courseObjectSchema.shape.collision.unwrap().options,
          arcCollisionSchema,
        ])
        .nullable(),
      indoors: z.literal(true).optional(),
      // A tunnel lamp's luminaire and light hang beneath the object.
      lamp: z.enum(["floodlight", "tunnel"]).optional(),
      overhead: z.literal(true).optional(),
      visual: z.discriminatedUnion("shape", [visualSchema, arcVisualSchema]),
    })
    .array()
    .min(1)
    .max(5_000),
  schemaVersion: z.literal(6),
});

function validateCourseObjectsV6(
  document: Omit<Parameters<typeof validateCourseRoute>[0], "objects"> & {
    objects: Array<{
      id: string;
      collision: { role: string; shape: string } | null;
      indoors?: true;
      lamp?: CourseLampKind;
      overhead?: true;
      visual: { shape: string };
    }>;
  },
  context: z.RefinementCtx,
  lampLimit: number,
  indoorLampLimit: number,
) {
  validateCourseRoute(document, context);
  if (countCourseLamps(document, "floodlight") > lampLimit) {
    context.addIssue({
      code: "custom",
      message: `A course has at most ${lampLimit} floodlights`,
      path: ["objects"],
    });
  }
  if (countCourseIndoorLamps(document) > indoorLampLimit) {
    context.addIssue({
      code: "custom",
      message: `A course has at most ${indoorLampLimit} tunnel and work lamps`,
      path: ["objects"],
    });
  }
  document.objects.forEach((object, index) => {
    if (
      object.lamp &&
      (COURSE_INDOOR_LAMP_KINDS as readonly string[]).includes(object.lamp) !==
        Boolean(object.indoors)
    ) {
      context.addIssue({
        code: "custom",
        message: "Tunnel and work lamps stand indoors and floodlights outdoors",
        path: ["objects", index, "indoors"],
      });
    }
    // A drivable roof would catch karts and checkpoint recovery above it.
    if (object.overhead && object.collision?.role === "drivable-surface") {
      context.addIssue({
        code: "custom",
        message: "Overhead objects collide only as solid obstacles",
        path: ["objects", index, "collision", "role"],
      });
    }
    if (
      object.collision &&
      (object.collision.shape === "arc") !== (object.visual.shape === "arc")
    ) {
      context.addIssue({
        code: "custom",
        message: "Arcs collide as arcs, and only arcs do",
        path: ["objects", index, "collision", "shape"],
      });
    }
    // The race finds a kart indoors beneath an indoor roof's rectangle.
    if (object.overhead && object.indoors && object.visual.shape !== "box") {
      context.addIssue({
        code: "custom",
        message: "Indoor roofs are boxes",
        path: ["objects", index, "visual", "shape"],
      });
    }
    if (object.lamp && object.visual.shape === "arc") {
      context.addIssue({
        code: "custom",
        message: "Lamps stand on boxes or cylinders",
        path: ["objects", index, "visual", "shape"],
      });
    }
  });
}

const courseDocumentV6Schema = courseDocumentV6BaseSchema.superRefine(
  (document, context) =>
    validateCourseObjectsV6(
      document,
      context,
      LEGACY_COURSE_LAMP_LIMIT,
      LEGACY_COURSE_INDOOR_LAMP_LIMIT,
    ),
);

// Version seven adds the nursery's finishes, planted beds of young trees,
// and twelve floodlights.
const visualMaterialV7Schema = z.enum([
  ...visualSchema.shape.material.options,
  "hedge",
  "mulch",
  "timber",
]);

// A planted bed: young trees stand on its top in rows along its local X,
// `along` apart, the rows `across` apart along its local Z.
const plantingSchema = z.strictObject({
  across: z.number().finite().min(0.5).max(20),
  along: z.number().finite().min(0.5).max(20),
});

/** A planted bed's trees: how many along its rows, and how many rows. */
export function getCoursePlantingGrid(object: {
  planting?: { across: number; along: number };
  visual: { scale?: { x: number; z: number }; shape: string };
}) {
  const { planting, visual } = object;
  if (!planting || !visual.scale) return { across: 0, along: 0 };
  // A sliver over whole rows still fits them: 4.8 / 0.8 is 5.999….
  const fit = (size: number, spacing: number) =>
    Math.max(1, Math.floor(size / spacing + 1e-6));
  return {
    across: fit(visual.scale.z, planting.across),
    along: fit(visual.scale.x, planting.along),
  };
}

export function countCourseTrees(document: {
  objects: Parameters<typeof getCoursePlantingGrid>[0][];
}) {
  return document.objects.reduce((total, object) => {
    const grid = getCoursePlantingGrid(object);
    return total + grid.across * grid.along;
  }, 0);
}

// A clipped hedge's sides and top carry leaf sprays by area.
const HEDGE_SPRAYS_PER_SQUARE_METRE = 24;
/** Hedge leaves are drawn, so a course has at most this many sprays. */
export const COURSE_HEDGE_SPRAY_LIMIT = 40_000;

/** A hedge box's sprays on its +X, -X, +Z, and -Z sides and its top. */
export function getCourseHedgeSprayCounts(size: { x: number; y: number; z: number }) {
  return [
    size.z * size.y,
    size.z * size.y,
    size.x * size.y,
    size.x * size.y,
    size.x * size.z,
  ].map((area) => Math.round(area * HEDGE_SPRAYS_PER_SQUARE_METRE));
}

export function countCourseHedgeSprays(document: {
  objects: Array<{ visual: { material: string; scale?: { x: number; y: number; z: number }; shape: string } }>;
}) {
  return document.objects.reduce(
    (total, { visual }) =>
      visual.material === "hedge" && visual.shape === "box" && visual.scale
        ? total + getCourseHedgeSprayCounts(visual.scale).reduce((sum, count) => sum + count, 0)
        : total,
    0,
  );
}

const courseDocumentV7BaseSchema = courseDocumentV6BaseSchema
  .extend({
    objects: courseDocumentV6BaseSchema.shape.objects.element
      .extend({
        planting: plantingSchema.optional(),
        visual: z.discriminatedUnion("shape", [
          visualSchema.extend({ material: visualMaterialV7Schema }),
          arcVisualSchema.extend({ material: visualMaterialV7Schema }),
        ]),
      })
      .array()
      .min(1)
      .max(5_000),
    schemaVersion: z.literal(7),
  });

function validateCourseObjectsV7(
  document: Omit<Parameters<typeof validateCourseObjectsV6>[0], "objects"> & {
    objects: Array<
      Parameters<typeof validateCourseObjectsV6>[0]["objects"][number] & {
        planting?: { across: number; along: number };
        visual: {
          material: string;
          scale?: { x: number; y: number; z: number };
          shape: string;
        };
      }
    >;
  },
  context: z.RefinementCtx,
  indoorLampLimit = LEGACY_COURSE_INDOOR_LAMP_LIMIT,
) {
  validateCourseObjectsV6(document, context, COURSE_LAMP_LIMIT, indoorLampLimit);
  if (countCourseTrees(document) > COURSE_TREE_LIMIT) {
    context.addIssue({
      code: "custom",
      message: `A course has at most ${COURSE_TREE_LIMIT} trees`,
      path: ["objects"],
    });
  }
  if (countCourseHedgeSprays(document) > COURSE_HEDGE_SPRAY_LIMIT) {
    context.addIssue({
      code: "custom",
      message: "A course's hedges are too large",
      path: ["objects"],
    });
  }
  document.objects.forEach((object, index) => {
    // Trees stand outdoors on a bed's flat top.
    if (
      object.planting &&
      (object.visual.shape !== "box" ||
        object.indoors ||
        object.overhead ||
        object.lamp)
    ) {
      context.addIssue({
        code: "custom",
        message: "Trees grow on outdoor boxes that are not lamps or roofs",
        path: ["objects", index, "planting"],
      });
    }
    // Hedges are outdoor boxes, which their leaves cover.
    if (
      object.visual.material === "hedge" &&
      (object.visual.shape !== "box" ||
        object.indoors ||
        object.overhead ||
        object.lamp)
    ) {
      context.addIssue({
        code: "custom",
        message: "Hedges are outdoor boxes that are not lamps or roofs",
        path: ["objects", index, "visual", "material"],
      });
    }
  });
}

const courseDocumentV7Schema = courseDocumentV7BaseSchema.superRefine(
  (document, context) => validateCourseObjectsV7(document, context),
);

// Version eight adds water, its river-gravel bed, brushed concrete, the
// youth's work lights, and their parked bicycles. Work lights are battery
// LED lamps they bring for places the park never lit, such as a culvert,
// with room for twenty indoor lamps.
const visualMaterialV8Schema = z.enum([
  ...visualMaterialV7Schema.options,
  "concrete",
  "gravel",
  "water",
]);

const courseDocumentV8BaseSchema = courseDocumentV7BaseSchema
  .extend({
    objects: courseDocumentV7BaseSchema.shape.objects.element
      .extend({
        // A parked bicycle stands centred in its box, on its floor.
        bicycle: z.enum(COURSE_BICYCLES).optional(),
        lamp: z.enum(["floodlight", "tunnel", "work"]).optional(),
        visual: z.discriminatedUnion("shape", [
          visualSchema.extend({ material: visualMaterialV8Schema }),
          arcVisualSchema.extend({ material: visualMaterialV8Schema }),
        ]),
      })
      .array()
      .min(1)
      .max(5_000),
    schemaVersion: z.literal(8),
  });

const courseDocumentV9BaseSchema = courseDocumentV8BaseSchema.extend({
  schemaVersion: z.literal(9),
  objects: courseDocumentV8BaseSchema.shape.objects.element
    .extend({
      lamp: z.enum(["floodlight", "tunnel", "work", "street"]).optional(),
    })
    .array()
    .min(1)
    .max(5_000),
});

function validateCourseObjectsV8(
  document: Omit<z.infer<typeof courseDocumentV9BaseSchema>, "schemaVersion">,
  context: z.RefinementCtx,
) {
  validateCourseObjectsV7(document, context, COURSE_INDOOR_LAMP_LIMIT);
  document.objects.forEach((object, index) => {
    // Water is a level box of open water under the sky: its top is the
    // surface and its volume the water a kart can drown in. Karts pass
    // through it to the bed beneath, which collides.
    if (
      object.visual.material === "water" &&
      (object.visual.shape !== "box" ||
        object.collision !== null ||
        object.indoors ||
        object.overhead ||
        object.lamp ||
        object.planting)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Water is an outdoor box without collision that is not a lamp, roof, or bed",
        path: ["objects", index, "visual", "material"],
      });
    }
    // A bicycle's box is upright, outdoors, and never collides: in a race
    // the bicycle collides as its own shape.
    if (
      object.bicycle &&
      (object.visual.shape !== "box" ||
        object.visual.material === "water" ||
        object.visual.material === "hedge" ||
        object.collision !== null ||
        object.transform.rotation.x !== 0 ||
        object.transform.rotation.z !== 0 ||
        object.indoors ||
        object.overhead ||
        object.lamp ||
        object.planting)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "A bicycle is an upright outdoor box without collision that is not a lamp, roof, bed, hedge, or water",
        path: ["objects", index, "bicycle"],
      });
    }
  });
}

const courseDocumentV8Schema = courseDocumentV8BaseSchema.superRefine(
  validateCourseObjectsV8,
);

// Park street lamps have their own bounded outdoor light budget.
function validateCourseObjectsV9(
  document: Omit<z.infer<typeof courseDocumentV9BaseSchema>, "schemaVersion">,
  context: z.RefinementCtx,
) {
  validateCourseObjectsV8(document, context);
  if (countCourseLamps(document, "street") > COURSE_STREET_LAMP_LIMIT) {
    context.addIssue({
      code: "custom",
      message: `A course has at most ${COURSE_STREET_LAMP_LIMIT} street lamps`,
      path: ["objects"],
    });
  }
  document.objects.forEach((object, index) => {
    if (
      object.lamp === "street" &&
      (object.visual.shape !== "cylinder" || object.overhead)
    ) {
      context.addIssue({
        code: "custom",
        message: "Street lamps stand on outdoor cylinder columns, never roofs",
        path: ["objects", index, "lamp"],
      });
    }
  });
}

const courseDocumentV9Schema = courseDocumentV9BaseSchema.superRefine(
  validateCourseObjectsV9,
);

export const courseDocumentSchema = courseDocumentV9BaseSchema
  .extend({ enclosure: enclosureV10Schema, schemaVersion: z.literal(10) })
  .superRefine(validateCourseObjectsV9);

export type CourseDocumentV1 = z.infer<typeof courseDocumentV1Schema>;
type CourseDocumentV3 = z.infer<typeof courseDocumentV3Schema>;
type CourseDocumentV4 = z.infer<typeof courseDocumentV4Schema>;
export type CourseDocument = z.infer<typeof courseDocumentSchema>;
export type CourseObject = CourseDocument["objects"][number];
export type CourseVisualMaterial = CourseObject["visual"]["material"];
/** A box or cylinder, scaled from a unit primitive; arcs are built to size. */
export type CoursePrimitiveObject = CourseObject & {
  collision: Exclude<CourseObject["collision"], { shape: "arc" }>;
  visual: Exclude<CourseObject["visual"], { shape: "arc" }>;
};

export function isCoursePrimitiveObject(
  object: CourseObject,
): object is CoursePrimitiveObject {
  return object.visual.shape !== "arc" && object.collision?.shape !== "arc";
}

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
}: CourseDocumentV3): CourseDocumentV4 {
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
        LEGACY_MIRROR_ANGLE_MAX,
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
    return parseCourseDocument(
      upgradeCourseDocumentV3(parseCourseDocumentV3(input)),
    );
  }

  if (hasSchemaVersion(input, 4)) {
    return parseCourseDocument({
      ...courseDocumentV4Schema.parse(input),
      schemaVersion: 5,
    });
  }

  // Versions five and six upgrade unchanged.
  if (hasSchemaVersion(input, 5)) {
    return parseCourseDocument({
      ...courseDocumentV5Schema.parse(input),
      schemaVersion: 6,
    });
  }

  if (hasSchemaVersion(input, 6)) {
    return parseCourseDocument({
      ...courseDocumentV6Schema.parse(input),
      schemaVersion: 7,
    });
  }

  // Versions seven and eight upgrade unchanged to the current schema.
  if (hasSchemaVersion(input, 7)) {
    return parseCourseDocument({
      ...courseDocumentV7Schema.parse(input),
      schemaVersion: 8,
    });
  }

  // Versions eight, nine, and ten upgrade unchanged.
  if (hasSchemaVersion(input, 8)) {
    return parseCourseDocument({ ...courseDocumentV8Schema.parse(input), schemaVersion: 9 });
  }

  if (hasSchemaVersion(input, 9)) {
    return parseCourseDocument({ ...courseDocumentV9Schema.parse(input), schemaVersion: 10 });
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
