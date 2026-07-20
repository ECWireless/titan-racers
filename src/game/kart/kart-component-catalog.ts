import { z } from "zod";

import catalogJson from "./kart-components.v1.json";

export const KART_COMPONENT_CATEGORIES = [
  "frame",
  "body",
  "motor",
  "battery",
  "wheel-set",
  "suspension",
  "bumper-set",
] as const;

export type KartComponentCategory =
  (typeof KART_COMPONENT_CATEGORIES)[number];

export const kartStableIdSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

export const kartVectorSchema = z.strictObject({
  x: z.number().finite().min(-10).max(10),
  y: z.number().finite().min(-10).max(10),
  z: z.number().finite().min(-10).max(10),
});

const kartRotationSchema = z.strictObject({
  x: z.number().finite().min(-360).max(360),
  y: z.number().finite().min(-360).max(360),
  z: z.number().finite().min(-360).max(360),
});

const positiveVectorSchema = z.strictObject({
  x: z.number().finite().positive().max(10),
  y: z.number().finite().positive().max(10),
  z: z.number().finite().positive().max(10),
});

const wheelMountKeySchema = z.strictObject({
  axle: z.enum(["front", "rear"]),
  side: z.enum(["left", "right"]),
});

export const kartTransformSchema = z.strictObject({
  position: kartVectorSchema,
  rotation: kartRotationSchema,
});

const transformBoundsSchema = z
  .strictObject({
    maximum: kartTransformSchema,
    minimum: kartTransformSchema,
  })
  .superRefine((bounds, context) => {
    (["position", "rotation"] as const).forEach((transformKey) => {
      (["x", "y", "z"] as const).forEach((axis) => {
        if (
          bounds.minimum[transformKey][axis] >
          bounds.maximum[transformKey][axis]
        ) {
          context.addIssue({
            code: "custom",
            message: "Minimum transform bound must not exceed maximum",
            path: ["minimum", transformKey, axis],
          });
        }
      });
    });
  });

const massElementSchema = z.strictObject({
  center: kartVectorSchema,
  dimensions: positiveVectorSchema,
  id: kartStableIdSchema,
  massKg: z.number().finite().positive().max(500),
  wheelMount: wheelMountKeySchema.optional(),
});

const visualPrimitiveSchema = z.strictObject({
  dimensions: positiveVectorSchema,
  id: kartStableIdSchema,
  material: z.enum([
    "frame",
    "body-primary",
    "body-secondary",
    "motor",
    "battery",
    "tire",
    "wheel-hub",
    "suspension",
    "bumper",
  ]),
  shape: z.enum(["box", "cylinder"]),
  transform: kartTransformSchema,
  wheelMount: wheelMountKeySchema.optional(),
});

const collisionPrimitiveSchema = z.discriminatedUnion("shape", [
  z.strictObject({
    halfExtents: positiveVectorSchema,
    id: kartStableIdSchema,
    shape: z.literal("box"),
    transform: kartTransformSchema,
  }),
  z.strictObject({
    axis: z.union([z.literal(0), z.literal(1), z.literal(2)]),
    height: z.number().finite().positive().max(10),
    id: kartStableIdSchema,
    radius: z.number().finite().positive().max(5),
    shape: z.literal("capsule"),
    transform: kartTransformSchema,
  }),
]);

const attachmentSlotSchema = z.strictObject({
  acceptsCategory: z.enum(KART_COMPONENT_CATEGORIES),
  bounds: transformBoundsSchema,
  defaultTransform: kartTransformSchema,
  slotId: kartStableIdSchema,
});

const wheelMountSchema = wheelMountKeySchema.extend({
  id: kartStableIdSchema,
  position: kartVectorSchema,
});

function wheelMountKey(mount: z.infer<typeof wheelMountKeySchema>) {
  return `${mount.axle}-${mount.side}`;
}

const componentPropertiesSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("frame"),
    maximumSteerAngleDegrees: z.number().finite().min(1).max(45),
    minimumHighSpeedSteerAngleDegrees: z.number().finite().min(1).max(45),
    slots: z.array(attachmentSlotSchema).length(6),
    wheelMounts: z.array(wheelMountSchema).length(4),
  }),
  z.strictObject({ kind: z.literal("body") }),
  z.strictObject({
    driveForceNewtons: z.number().finite().positive().max(10_000),
    kind: z.literal("motor"),
    maximumWheelAngularSpeed: z.number().finite().positive().max(500),
    reverseSpeedRatio: z.number().finite().positive().max(1),
  }),
  z.strictObject({
    kind: z.literal("battery"),
    maximumDriveForceNewtons: z.number().finite().positive().max(10_000),
  }),
  z.strictObject({
    kind: z.literal("wheel-set"),
    peakGripCoefficient: z.number().finite().positive().max(3),
    radius: z.number().finite().positive().max(1),
    rearGripMultiplier: z.number().finite().positive().max(2),
    serviceBrakeForceNewtons: z.number().finite().positive().max(10_000),
    slidingGripCoefficient: z.number().finite().positive().max(3),
    width: z.number().finite().positive().max(1),
  }),
  z.strictObject({
    bumpRate: z.number().finite().nonnegative().max(200_000),
    bumpStart: z.number().finite().nonnegative().max(1),
    damperRate: z.number().finite().nonnegative().max(5_000),
    kind: z.literal("suspension"),
    maximumCompressionY: z.number().finite().min(-1).max(1),
    maximumLoad: z.number().finite().positive().max(20_000),
    restTravel: z.number().finite().nonnegative().max(1),
    springRate: z.number().finite().positive().max(100_000),
    travel: z.number().finite().positive().max(1),
  }),
  z.strictObject({ kind: z.literal("bumper-set") }),
]);

export const kartComponentDefinitionSchema = z
  .strictObject({
    collisionPrimitives: z.array(collisionPrimitiveSchema).max(16),
    componentId: kartStableIdSchema,
    label: z.string().trim().min(1).max(80),
    massElements: z.array(massElementSchema).min(1).max(16),
    properties: componentPropertiesSchema,
    revision: z.number().int().positive(),
    visualPrimitives: z.array(visualPrimitiveSchema).min(1).max(24),
  })
  .superRefine((component, context) => {
    const ids = [
      ...component.massElements.map((element) => element.id),
      ...component.visualPrimitives.map((primitive) => primitive.id),
      ...component.collisionPrimitives.map((primitive) => primitive.id),
    ];

    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: "custom",
        message: "Component-local primitive IDs must be unique",
        path: [],
      });
    }

    if (component.properties.kind !== "frame") {
      if (
        component.properties.kind === "wheel-set" &&
        component.properties.slidingGripCoefficient >
          component.properties.peakGripCoefficient
      ) {
        context.addIssue({
          code: "custom",
          message: "Sliding grip must not exceed peak grip",
          path: ["properties", "slidingGripCoefficient"],
        });
      }

      if (
        component.properties.kind === "suspension" &&
        (component.properties.restTravel > component.properties.travel ||
          component.properties.bumpStart > component.properties.travel)
      ) {
        context.addIssue({
          code: "custom",
          message: "Suspension rest travel and bump start must fit within travel",
          path: ["properties"],
        });
      }

      const mountedMassElements = component.massElements.filter(
        (element) => element.wheelMount,
      );
      const mountedVisualPrimitives = component.visualPrimitives.filter(
        (primitive) => primitive.wheelMount,
      );
      if (component.properties.kind === "wheel-set") {
        const massMountKeys = mountedMassElements.map((element) =>
          wheelMountKey(element.wheelMount!),
        );
        if (
          mountedMassElements.length !== component.massElements.length ||
          massMountKeys.length !== 4 ||
          new Set(massMountKeys).size !== 4
        ) {
          context.addIssue({
            code: "custom",
            message:
              "Wheel-set mass elements require one template for each axle and side",
            path: ["massElements"],
          });
        }

        const visualMountKeys = mountedVisualPrimitives.map((primitive) =>
          wheelMountKey(primitive.wheelMount!),
        );
        if (
          mountedVisualPrimitives.length !== component.visualPrimitives.length ||
          ["front-left", "front-right", "rear-left", "rear-right"].some(
            (key) => !visualMountKeys.includes(key),
          )
        ) {
          context.addIssue({
            code: "custom",
            message:
              "Wheel-set visual primitives require at least one template for each axle and side",
            path: ["visualPrimitives"],
          });
        }
      } else if (
        mountedMassElements.length > 0 ||
        mountedVisualPrimitives.length > 0
      ) {
        context.addIssue({
          code: "custom",
          message: "Only wheel-set templates may target frame wheel mounts",
          path: [],
        });
      }
      return;
    }

    const { slots, wheelMounts } = component.properties;
    if (
      component.properties.minimumHighSpeedSteerAngleDegrees >
      component.properties.maximumSteerAngleDegrees
    ) {
      context.addIssue({
        code: "custom",
        message: "High-speed steering angle must not exceed low-speed steering",
        path: ["properties", "minimumHighSpeedSteerAngleDegrees"],
      });
    }
    const expectedCategories = KART_COMPONENT_CATEGORIES.filter(
      (category) => category !== "frame",
    );

    if (
      new Set(slots.map((slot) => slot.slotId)).size !== slots.length ||
      new Set(slots.map((slot) => slot.acceptsCategory)).size !== slots.length
    ) {
      context.addIssue({
        code: "custom",
        message: "Frame slots must have unique IDs and categories",
        path: ["properties", "slots"],
      });
    }

    expectedCategories.forEach((category) => {
      if (!slots.some((slot) => slot.acceptsCategory === category)) {
        context.addIssue({
          code: "custom",
          message: `Frame requires a ${category} slot`,
          path: ["properties", "slots"],
        });
      }
    });

    const wheelKeys = wheelMounts.map(wheelMountKey);
    const wheelIds = wheelMounts.map((mount) => mount.id);
    if (
      new Set(wheelKeys).size !== 4 ||
      new Set(wheelIds).size !== wheelIds.length
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Frame requires uniquely identified wheel mounts for each axle and side",
        path: ["properties", "wheelMounts"],
      });
    }

    const axleGeometry = (["front", "rear"] as const).map((axle) => {
      const left = wheelMounts.find(
        (mount) => mount.axle === axle && mount.side === "left",
      );
      const right = wheelMounts.find(
        (mount) => mount.axle === axle && mount.side === "right",
      );
      if (!left || !right) {
        return undefined;
      }
      if (
        left.position.x >= right.position.x ||
        left.position.y !== right.position.y ||
        left.position.z !== right.position.z
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Each axle requires aligned left/right mounts with usable separation",
          path: ["properties", "wheelMounts"],
        });
      }
      return {
        centerZ: (left.position.z + right.position.z) / 2,
        trackWidth: right.position.x - left.position.x,
      };
    });
    const [frontGeometry, rearGeometry] = axleGeometry;
    if (
      frontGeometry &&
      rearGeometry &&
      (Math.abs(frontGeometry.centerZ - rearGeometry.centerZ) < 0.1 ||
        Math.abs(frontGeometry.trackWidth - rearGeometry.trackWidth) > 1e-9)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Frame axles require separation and matching front/rear track widths",
        path: ["properties", "wheelMounts"],
      });
    }
  });

export type KartComponentDefinition = z.infer<
  typeof kartComponentDefinitionSchema
>;
export type KartTransform = z.infer<typeof kartTransformSchema>;

export const kartComponentCatalogSchema = z
  .strictObject({
    catalogVersion: z.literal(1),
    components: z.array(kartComponentDefinitionSchema).min(7).max(1_000),
    units: z.literal("meters-kilograms-seconds"),
  })
  .superRefine((catalog, context) => {
    const references = catalog.components.map(
      (component) => `${component.componentId}@${component.revision}`,
    );
    if (new Set(references).size !== references.length) {
      context.addIssue({
        code: "custom",
        message: "Component ID and revision pairs must be unique",
        path: ["components"],
      });
    }

    KART_COMPONENT_CATEGORIES.forEach((category) => {
      if (
        !catalog.components.some(
          (component) => component.properties.kind === category,
        )
      ) {
        context.addIssue({
          code: "custom",
          message: `Catalog requires at least one ${category} component`,
          path: ["components"],
        });
      }
    });
  });

export type KartComponentCatalog = z.infer<
  typeof kartComponentCatalogSchema
>;

export type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T;

export type ReadonlyKartComponentDefinition =
  DeepReadonly<KartComponentDefinition>;
export type ReadonlyKartComponentCatalog = DeepReadonly<KartComponentCatalog>;

export function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach((child) => deepFreeze(child));
    Object.freeze(value);
  }
  return value as DeepReadonly<T>;
}

export const KART_COMPONENT_CATALOG =
  deepFreeze(kartComponentCatalogSchema.parse(catalogJson));

export function getKartComponent(
  componentId: string,
  revision: number,
  catalog: ReadonlyKartComponentCatalog = KART_COMPONENT_CATALOG,
): ReadonlyKartComponentDefinition | undefined {
  return catalog.components.find(
    (component) =>
      component.componentId === componentId && component.revision === revision,
  );
}
