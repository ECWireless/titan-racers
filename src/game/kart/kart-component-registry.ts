import { z } from "zod";

import {
  kartDefinitionReferenceSchema,
  kartPositiveVectorSchema,
  kartStableIdSchema,
  kartTransformSchema,
  kartVectorSchema,
} from "./kart-assembly-document";
import { deepFreeze, type DeepReadonly } from "./immutable-registry";

export const kartComponentCategorySchema = z.enum([
  "battery",
  "receiver-speed-controller",
  "motor",
  "steering",
  "brakes",
  "transmission",
  "suspension",
  "wheel-tire",
]);

export type KartComponentCategory = z.infer<typeof kartComponentCategorySchema>;

const componentPortSchema = z.strictObject({
  direction: z.enum(["input", "output", "bidirectional"]),
  id: kartStableIdSchema,
  interface: z.enum([
    "battery-power",
    "brake-control",
    "motor-power",
    "motor-shaft",
    "service-brake",
    "steering-control",
    "steering-link",
    "suspension-chassis",
    "suspension-hub",
    "wheel-drive",
    "wheel-handbrake",
  ]),
  multiple: z.boolean(),
  position: kartVectorSchema.default({ x: 0, y: 0, z: 0 }),
});

const internalBoxSchema = z.strictObject({
  material: kartDefinitionReferenceSchema,
  shape: z.literal("box"),
  size: kartPositiveVectorSchema,
  transform: kartTransformSchema,
});

const internalCylinderSchema = z.strictObject({
  axis: z.enum(["x", "y", "z"]),
  height: z.number().finite().positive().max(1),
  material: kartDefinitionReferenceSchema,
  radius: z.number().finite().positive().max(0.5),
  shape: z.literal("cylinder"),
  transform: kartTransformSchema,
});

/**
 * Where a part mounts, in its own frame: a point, the outward direction of
 * the face it lies on (one of the part's axes), and its type. A footprint
 * or pad also has a rectangular area on that face, centred on the point,
 * its size along the two other axes (zero along the direction's). Ids are
 * unique within a part; assembly documents name mounts by id.
 *
 * - `base`: a footprint that sits, and may slide, on a flat structural
 *   face; all of it rests on that face.
 * - `motor-face`: a motor's drive-end face, centred on its shaft, which
 *   bolts to a `motor-plate`. The motor may turn about its shaft: the bolt
 *   pattern is not modelled.
 * - `motor-plate`: the face of a gearbox's plate that a motor bolts to,
 *   centred on the pinion's axis.
 * - `tower-pad`: a gearbox pad that a shock tower's face stands on; the
 *   two touch where the attachment point lies, within both.
 */
export const kartMountingPointTypeSchema = z.enum([
  "base",
  "motor-face",
  "motor-plate",
  "tower-pad",
]);

export const kartMountingDirectionSchema = z.enum([
  "+x",
  "-x",
  "+y",
  "-y",
  "+z",
  "-z",
]);

const mountingPointSchema = z
  .strictObject({
    area: z
      .strictObject({
        x: z.number().finite().min(0).max(1),
        y: z.number().finite().min(0).max(1),
        z: z.number().finite().min(0).max(1),
      })
      .nullable(),
    direction: kartMountingDirectionSchema,
    id: kartStableIdSchema,
    position: kartVectorSchema,
    type: kartMountingPointTypeSchema,
  })
  .superRefine((mount, context) => {
    const hasArea = mount.type === "base" || mount.type === "tower-pad";
    const axis = mount.direction[1] as "x" | "y" | "z";
    if (hasArea !== (mount.area !== null)) {
      context.addIssue({
        code: "custom",
        message: "Base footprints and tower pads, and only they, have an area.",
      });
    } else if (mount.area && mount.area[axis] !== 0) {
      context.addIssue({
        code: "custom",
        message: "A mounting area lies on its face: zero along its direction.",
      });
    }
  });

export type KartMountingPoint = z.infer<typeof mountingPointSchema>;

const componentBaseSchema = z.strictObject({
  assembly: z.strictObject({
    maximumInstances: z.number().int().positive().max(8),
    mirrorable: z.boolean(),
    rotationAxes: z
      .array(z.enum(["x", "y", "z"]))
      .min(1)
      .max(3),
  }),
  category: kartComponentCategorySchema,
  construction: z
    .array(
      z.discriminatedUnion("shape", [
        internalBoxSchema,
        internalCylinderSchema,
      ]),
    )
    .min(1)
    .max(16),
  id: kartStableIdSchema,
  label: z.string().trim().min(1).max(80),
  mass: z.number().finite().positive().max(5),
  /** Absent before mounting points (version 1 parts). */
  mounts: z
    .array(mountingPointSchema)
    .min(1)
    .max(8)
    .refine(
      (mounts) => new Set(mounts.map(({ id }) => id)).size === mounts.length,
      "Mounting point ids are unique within a part.",
    )
    .optional(),
  massCenter: kartVectorSchema,
  ports: z.array(componentPortSchema).max(12),
  summary: z.string().trim().min(1).max(200),
  tradeoff: z.string().trim().min(1).max(200),
  version: z.number().int().positive(),
});

const batterySchema = componentBaseSchema.extend({
  category: z.literal("battery"),
  electrical: z.strictObject({
    maximumCurrent: z.number().finite().positive(),
    voltage: z.number().finite().positive(),
  }),
});

const controllerSchema = componentBaseSchema.extend({
  category: z.literal("receiver-speed-controller"),
  electrical: z.strictObject({
    maximumMotorCurrent: z.number().finite().positive(),
    maximumVoltage: z.number().finite().positive(),
  }),
});

const motorSchema = componentBaseSchema.extend({
  category: z.literal("motor"),
  electrical: z.strictObject({
    safeCurrent: z.number().finite().positive(),
    speedConstantRpmPerVolt: z.number().finite().positive(),
    windingResistance: z.number().finite().positive(),
  }),
});

const steeringSchema = componentBaseSchema.extend({
  category: z.literal("steering"),
  steering: z.strictObject({
    maximumTravelDegrees: z.number().finite().positive().max(90),
    maximumTorque: z.number().finite().positive(),
  }),
});

const brakesSchema = componentBaseSchema.extend({
  brakes: z.strictObject({
    totalHandbrakeTorque: z.number().finite().positive(),
    totalServiceBrakeTorque: z.number().finite().positive(),
  }),
  category: z.literal("brakes"),
});

const transmissionSchema = componentBaseSchema.extend({
  category: z.literal("transmission"),
  transmission: z.strictObject({
    efficiency: z.number().finite().positive().max(1),
    motorRotationsPerWheelRotation: z.number().finite().positive(),
  }),
});

const suspensionSchema = componentBaseSchema.extend({
  category: z.literal("suspension"),
  suspension: z.strictObject({
    bumpStart: z.number().finite().positive(),
    damperRate: z.number().finite().positive(),
    extendedLength: z.number().finite().positive(),
    mounting: z.strictObject({
      armPivot: kartVectorSchema,
      chassisAnchor: kartVectorSchema,
      hubAnchor: kartVectorSchema,
      springArmAnchor: kartVectorSchema,
    }),
    maximumStroke: z.number().finite().positive(),
    quadraticBumpRate: z.number().finite().positive(),
    springRate: z.number().finite().positive(),
  }),
});

const wheelTireSchema = componentBaseSchema.extend({
  category: z.literal("wheel-tire"),
  wheelTire: z.strictObject({
    radius: z.number().finite().positive().max(0.25),
    tireCompound: kartDefinitionReferenceSchema,
    width: z.number().finite().positive().max(0.2),
  }),
});

export const approvedComponentDefinitionSchema = z.discriminatedUnion(
  "category",
  [
    batterySchema,
    controllerSchema,
    motorSchema,
    steeringSchema,
    brakesSchema,
    transmissionSchema,
    suspensionSchema,
    wheelTireSchema,
  ],
);

export type ApprovedComponentDefinition = z.infer<
  typeof approvedComponentDefinitionSchema
>;

const aluminum = { id: "material.structural-aluminum", version: 1 } as const;
const polymer = { id: "material.engineering-polymer", version: 1 } as const;
const steel = { id: "material.steel", version: 1 } as const;
// Coilover versions rated for a 30° installation: their spring, damper,
// stroke, and bump values give the wheel the same rates and travel as the
// version they follow did when derivation ignored shock tilt, and their
// default mounts lean 30° inward.
export const RATED_SHOCK_INSTALLATION_RADIANS = Math.PI / 6;
const RATED_SHOCK_COSINE = Math.cos(RATED_SHOCK_INSTALLATION_RADIANS);
const zeroTransform = {
  position: { x: 0, y: 0, z: 0 },
  rotationDegrees: { x: 0, y: 0, z: 0 },
} as const;

function box(
  material: typeof aluminum | typeof polymer | typeof steel,
  size: { x: number; y: number; z: number },
) {
  return { material, shape: "box" as const, size, transform: zeroTransform };
}

function cylinder(
  material: typeof aluminum | typeof polymer | typeof steel,
  radius: number,
  height: number,
  axis: "x" | "y" | "z" = "z",
) {
  return {
    axis,
    height,
    material,
    radius,
    shape: "cylinder" as const,
    transform: zeroTransform,
  };
}

function placed<T extends { transform: typeof zeroTransform }>(
  element: T,
  position: { x: number; y: number; z: number },
) {
  return { ...element, transform: { ...zeroTransform, position } };
}

/** A footprint on a part's floor, centred under it. */
function base(size: { x: number; z: number }, floorY: number) {
  return {
    area: { x: size.x, y: 0, z: size.z },
    direction: "-y" as const,
    id: "base",
    position: { x: 0, y: floorY, z: 0 },
    type: "base" as const,
  };
}

const sealedPorts = {
  battery: [
    {
      direction: "output" as const,
      id: "power",
      interface: "battery-power" as const,
      multiple: false,
    },
  ],
  transmission: [
    {
      direction: "input" as const,
      id: "shaft-input",
      interface: "motor-shaft" as const,
      multiple: false,
    },
    {
      direction: "output" as const,
      id: "drive-output",
      interface: "wheel-drive" as const,
      multiple: true,
    },
  ],
};

/**
 * A version-2 laydown transmission (`cad/parts/_plate_gearbox.py`), in its
 * CAD frame: the outdrives lie along X through the origin and the case
 * stands on `floor` (its differential housing's radius is `caseRear`). Its
 * construction is the case, the spur, the motor plate, and the two outdrive
 * cups; the dimensions are the CAD model's.
 */
function plateGearbox(gearbox: {
  caseHalfWidth: number;
  caseRear: number;
  cupMouth: number;
  floor: number;
  gearX: number;
  metal: typeof aluminum | typeof steel;
  motorAxis: { y: number; z: number };
  padTop: number;
  plateX: { inner: number; outer: number };
  spurTip: number;
  topShaft: { y: number; z: number };
}) {
  const width = 2 * gearbox.caseHalfWidth;
  const differentialRadius = gearbox.caseRear;
  const topHousing = 0.0075;
  const plateFront = gearbox.motorAxis.z - 0.016;
  const plateTop = gearbox.motorAxis.y + 0.016;
  const plateRear = gearbox.topShaft.z + 0.006;
  const plateThickness = gearbox.plateX.outer - gearbox.plateX.inner;
  const padBottom = differentialRadius - 0.003;
  const span = (low: number, high: number) => ({
    center: (low + high) / 2,
    size: high - low,
  });
  // The case: both housings round about X, a foot block on the floor
  // beneath them, a block between them up to the differential housing's
  // top, and the tower pad; all inside the CAD case's outline.
  const footZ = span(gearbox.topShaft.z - 0.0055, gearbox.caseRear - 0.004);
  const caseBlock = (
    y: { center: number; size: number },
    z: { center: number; size: number },
  ) =>
    placed(box(gearbox.metal, { x: width, y: y.size, z: z.size }), {
      x: 0,
      y: y.center,
      z: z.center,
    });
  const housing = (radius: number, y: number, z: number) =>
    placed(cylinder(gearbox.metal, radius, width, "x"), { x: 0, y, z });
  const plate = {
    y: span(gearbox.floor, plateTop),
    z: span(plateFront, plateRear),
  };
  return {
    construction: [
      housing(differentialRadius, 0, 0),
      housing(topHousing, gearbox.topShaft.y, gearbox.topShaft.z),
      caseBlock(span(gearbox.floor, 0), footZ),
      caseBlock(
        span(0, differentialRadius),
        span(gearbox.topShaft.z, 0),
      ),
      caseBlock(span(padBottom, gearbox.padTop), span(-0.004, 0.004)),
      placed(cylinder(polymer, gearbox.spurTip, 0.0045, "x"), {
        x: gearbox.gearX,
        y: gearbox.topShaft.y,
        z: gearbox.topShaft.z,
      }),
      placed(
        box(aluminum, { x: plateThickness, y: plate.y.size, z: plate.z.size }),
        {
          x: (gearbox.plateX.inner + gearbox.plateX.outer) / 2,
          y: plate.y.center,
          z: plate.z.center,
        },
      ),
      ...[-1, 1].map((side) =>
        placed(cylinder(steel, 0.0055, 0.011, "x"), {
          x: side * (gearbox.cupMouth - 0.0055),
          y: 0,
          z: 0,
        }),
      ),
    ],
    mounts: [
      // The footprint spans the case's foot and the plate's: an outer bound
      // of what stands on the floor, which is open between them.
      {
        area: {
          x: gearbox.plateX.outer + gearbox.caseHalfWidth,
          y: 0,
          z: gearbox.caseRear - plateFront,
        },
        direction: "-y" as const,
        id: "base",
        position: {
          x: (gearbox.plateX.outer - gearbox.caseHalfWidth) / 2,
          y: gearbox.floor,
          z: (plateFront + gearbox.caseRear) / 2,
        },
        type: "base" as const,
      },
      {
        area: null,
        direction: "+x" as const,
        id: "motor-plate",
        position: {
          x: gearbox.plateX.outer,
          y: gearbox.motorAxis.y,
          z: gearbox.motorAxis.z,
        },
        type: "motor-plate" as const,
      },
      {
        area: { x: width, y: 0, z: 0.008 },
        direction: "+y" as const,
        id: "tower-pad",
        position: { x: 0, y: gearbox.padTop, z: 0 },
        type: "tower-pad" as const,
      },
    ],
  };
}

export const APPROVED_KART_COMPONENTS = deepFreeze(
  z.array(approvedComponentDefinitionSchema).parse([
    {
      assembly: {
        maximumInstances: 1,
        mirrorable: false,
        rotationAxes: ["x", "y", "z"],
      },
      category: "battery",
      construction: [box(polymer, { x: 0.095, y: 0.026, z: 0.048 })],
      electrical: { maximumCurrent: 60, voltage: 7.4 },
      id: "battery.lipo-standard",
      label: "Standard battery",
      mass: 0.24,
      massCenter: { x: 0, y: 0, z: 0 },
      ports: [
        {
          direction: "output",
          id: "power",
          interface: "battery-power",
          multiple: false,
        },
      ],
      summary: "A sealed two-cell battery sized for the initial kart roster.",
      tradeoff:
        "The shared baseline supply keeps performance differences in gearing and construction.",
      version: 1,
    },
    {
      assembly: {
        maximumInstances: 1,
        mirrorable: false,
        rotationAxes: ["x", "y", "z"],
      },
      category: "receiver-speed-controller",
      construction: [box(polymer, { x: 0.052, y: 0.024, z: 0.038 })],
      electrical: { maximumMotorCurrent: 60, maximumVoltage: 8.4 },
      id: "control.receiver-esc-standard",
      label: "Standard receiver and controller",
      mass: 0.065,
      massCenter: { x: 0, y: 0, z: 0 },
      ports: [
        {
          direction: "input",
          id: "battery-input",
          interface: "battery-power",
          multiple: false,
        },
        {
          direction: "output",
          id: "motor-output",
          interface: "motor-power",
          multiple: false,
        },
        {
          direction: "output",
          id: "steering-output",
          interface: "steering-control",
          multiple: false,
        },
        {
          direction: "output",
          id: "brake-output",
          interface: "brake-control",
          multiple: false,
        },
      ],
      summary: "A sealed radio receiver and electronic speed controller.",
      tradeoff:
        "One shared controller makes motor and construction choices legible.",
      version: 1,
    },
    {
      assembly: {
        maximumInstances: 1,
        mirrorable: false,
        rotationAxes: ["x", "y", "z"],
      },
      category: "motor",
      construction: [cylinder(steel, 0.018, 0.045)],
      electrical: {
        safeCurrent: 50,
        speedConstantRpmPerVolt: 1_500,
        windingResistance: 0.08,
      },
      id: "motor.brushless-standard",
      label: "Standard brushless motor",
      mass: 0.19,
      massCenter: { x: 0, y: 0, z: 0 },
      ports: [
        {
          direction: "input",
          id: "power-input",
          interface: "motor-power",
          multiple: false,
        },
        {
          direction: "output",
          id: "shaft-output",
          interface: "motor-shaft",
          multiple: false,
        },
      ],
      summary: "The sealed baseline motor used by all three official builds.",
      tradeoff:
        "Gearing, wheel size, and mass determine how its fixed capability feels.",
      version: 1,
    },
    {
      assembly: {
        maximumInstances: 1,
        mirrorable: false,
        rotationAxes: ["x", "y", "z"],
      },
      category: "steering",
      construction: [box(polymer, { x: 0.041, y: 0.03, z: 0.042 })],
      id: "steering.servo-standard",
      label: "Standard steering servo",
      mass: 0.07,
      massCenter: { x: 0, y: 0, z: 0 },
      ports: [
        {
          direction: "input",
          id: "control-input",
          interface: "steering-control",
          multiple: false,
        },
        {
          direction: "output",
          id: "link-output",
          interface: "steering-link",
          multiple: true,
        },
      ],
      steering: { maximumTorque: 1.8, maximumTravelDegrees: 30 },
      summary:
        "A sealed servo with enough travel for the supported steering geometry.",
      tradeoff:
        "Final steering lock still derives from linkage and wheel clearance.",
      version: 1,
    },
    {
      assembly: {
        maximumInstances: 1,
        mirrorable: false,
        rotationAxes: ["x", "y", "z"],
      },
      brakes: {
        totalHandbrakeTorque: 0.685125,
        totalServiceBrakeTorque: 1.5225,
      },
      category: "brakes",
      construction: [box(aluminum, { x: 0.052, y: 0.018, z: 0.04 })],
      id: "brakes.combined-standard",
      label: "Standard combined brakes",
      mass: 0.1,
      massCenter: { x: 0, y: 0, z: 0 },
      ports: [
        {
          direction: "input",
          id: "control-input",
          interface: "brake-control",
          multiple: false,
        },
        {
          direction: "output",
          id: "service-output",
          interface: "service-brake",
          multiple: true,
        },
        {
          direction: "output",
          id: "handbrake-output",
          interface: "wheel-handbrake",
          multiple: true,
        },
      ],
      summary:
        "One sealed system for four-wheel service braking and rear handbraking.",
      tradeoff:
        "Wheel radius changes the ground force produced by its fixed torque.",
      version: 1,
    },
    {
      assembly: {
        maximumInstances: 1,
        mirrorable: false,
        rotationAxes: ["x", "y", "z"],
      },
      category: "transmission",
      construction: [box(aluminum, { x: 0.06, y: 0.03, z: 0.055 })],
      id: "transmission.tall-4to1",
      label: "Tall 4:1 transmission",
      mass: 0.12,
      massCenter: { x: 0, y: 0, z: 0 },
      ports: [
        {
          direction: "input",
          id: "shaft-input",
          interface: "motor-shaft",
          multiple: false,
        },
        {
          direction: "output",
          id: "drive-output",
          interface: "wheel-drive",
          multiple: true,
        },
      ],
      summary: "A tall reduction for higher theoretical road speed.",
      tradeoff:
        "Higher no-load speed with less wheel force than the short transmission.",
      transmission: {
        efficiency: 0.8114144775599887,
        motorRotationsPerWheelRotation: 4,
      },
      version: 1,
    },
    {
      assembly: {
        maximumInstances: 1,
        mirrorable: false,
        rotationAxes: ["x", "y", "z"],
      },
      category: "transmission",
      construction: [box(aluminum, { x: 0.06, y: 0.03, z: 0.055 })],
      id: "transmission.balanced-5to1",
      label: "Balanced 5:1 transmission",
      mass: 0.12,
      massCenter: { x: 0, y: 0, z: 0 },
      ports: [
        {
          direction: "input",
          id: "shaft-input",
          interface: "motor-shaft",
          multiple: false,
        },
        {
          direction: "output",
          id: "drive-output",
          interface: "wheel-drive",
          multiple: true,
        },
      ],
      summary: "A moderate reduction balancing launch force and road speed.",
      tradeoff:
        "Less road speed than the tall transmission and less wheel force than the short transmission.",
      transmission: {
        efficiency: 0.8,
        motorRotationsPerWheelRotation: 5,
      },
      version: 1,
    },
    {
      assembly: {
        maximumInstances: 1,
        mirrorable: false,
        rotationAxes: ["x", "y", "z"],
      },
      category: "transmission",
      construction: [box(steel, { x: 0.064, y: 0.034, z: 0.06 })],
      id: "transmission.short-8to1",
      label: "Short 8:1 transmission",
      mass: 0.15,
      massCenter: { x: 0, y: 0, z: 0 },
      ports: [
        {
          direction: "input",
          id: "shaft-input",
          interface: "motor-shaft",
          multiple: false,
        },
        {
          direction: "output",
          id: "drive-output",
          interface: "wheel-drive",
          multiple: true,
        },
      ],
      summary:
        "A short reduction for strong launch force and lower road speed.",
      tradeoff:
        "More wheel force with lower no-load speed and slightly more mass.",
      transmission: { efficiency: 0.78, motorRotationsPerWheelRotation: 8 },
      version: 1,
    },
    {
      assembly: {
        maximumInstances: 4,
        mirrorable: true,
        rotationAxes: ["x", "y", "z"],
      },
      category: "suspension",
      construction: [cylinder(steel, 0.007, 0.12, "y")],
      id: "suspension.firm-short",
      label: "Firm short-travel suspension",
      mass: 0.045,
      massCenter: { x: 0, y: 0, z: 0 },
      ports: [
        {
          direction: "bidirectional",
          id: "chassis-mount",
          interface: "suspension-chassis",
          multiple: false,
        },
        {
          direction: "bidirectional",
          id: "hub-mount",
          interface: "suspension-hub",
          multiple: false,
        },
      ],
      summary: "A compact coilover with firm response and short travel.",
      suspension: {
        bumpStart: 0.027,
        damperRate: 33.23076923076923,
        extendedLength: 0.115,
        mounting: {
          armPivot: {
            x: 0.08 * Math.sqrt(812.5 / 1_600),
            y: -0.051,
            z: 0,
          },
          chassisAnchor: { x: 0, y: 0.051, z: 0 },
          hubAnchor: {
            x: -0.08 * (1 - Math.sqrt(812.5 / 1_600)),
            y: -0.051,
            z: 0,
          },
          springArmAnchor: { x: 0, y: -0.051, z: 0 },
        },
        maximumStroke: 0.035,
        quadraticBumpRate: 18_000,
        springRate: 1_600,
      },
      tradeoff: "Sharper support and less travel over large bumps.",
      version: 1,
    },
    {
      assembly: {
        maximumInstances: 4,
        mirrorable: true,
        rotationAxes: ["x", "y", "z"],
      },
      category: "suspension",
      construction: [cylinder(steel, 0.007, 0.12, "y")],
      id: "suspension.firm-short",
      label: "Firm short-travel suspension",
      mass: 0.045,
      massCenter: { x: 0, y: 0, z: 0 },
      ports: [
        {
          direction: "bidirectional",
          id: "chassis-mount",
          interface: "suspension-chassis",
          multiple: false,
        },
        {
          direction: "bidirectional",
          id: "hub-mount",
          interface: "suspension-hub",
          multiple: false,
        },
      ],
      summary:
        "A compact coilover with firm response and short travel, rated for a 30° installation.",
      suspension: {
        bumpStart: 0.027 * RATED_SHOCK_COSINE,
        damperRate: 33.23076923076923 / RATED_SHOCK_COSINE ** 2,
        extendedLength: 0.115,
        mounting: {
          armPivot: {
            x: 0.08 * Math.sqrt(812.5 / 1_600),
            y: -0.051,
            z: 0,
          },
          // 30° inward from the arm eye, at the 0.102 m eye-to-eye length.
          chassisAnchor: {
            x: 0.102 * Math.sin(RATED_SHOCK_INSTALLATION_RADIANS),
            y: -0.051 + 0.102 * RATED_SHOCK_COSINE,
            z: 0,
          },
          hubAnchor: {
            x: -0.08 * (1 - Math.sqrt(812.5 / 1_600)),
            y: -0.051,
            z: 0,
          },
          springArmAnchor: { x: 0, y: -0.051, z: 0 },
        },
        maximumStroke: 0.035 * RATED_SHOCK_COSINE,
        quadraticBumpRate: 18_000 / RATED_SHOCK_COSINE ** 3,
        springRate: 1_600 / RATED_SHOCK_COSINE ** 2,
      },
      tradeoff:
        "Sharper support and less travel over large bumps.",
      version: 2,
    },
    {
      assembly: {
        maximumInstances: 4,
        mirrorable: true,
        rotationAxes: ["x", "y", "z"],
      },
      category: "suspension",
      construction: [cylinder(aluminum, 0.008, 0.145, "y")],
      id: "suspension.compliant-long",
      label: "Compliant long-travel suspension",
      mass: 0.052,
      massCenter: { x: 0, y: 0, z: 0 },
      ports: [
        {
          direction: "bidirectional",
          id: "chassis-mount",
          interface: "suspension-chassis",
          multiple: false,
        },
        {
          direction: "bidirectional",
          id: "hub-mount",
          interface: "suspension-hub",
          multiple: false,
        },
      ],
      summary: "A longer coilover that gives the wheel more compliant travel.",
      suspension: {
        bumpStart: 0.04,
        damperRate: 7,
        extendedLength: 0.14,
        mounting: {
          armPivot: {
            x: 0.08 * Math.sqrt(812.5 / 1_600),
            y: -0.051,
            z: 0,
          },
          chassisAnchor: { x: 0, y: 0.051, z: 0 },
          hubAnchor: {
            x: -0.08 * (1 - Math.sqrt(812.5 / 1_600)),
            y: -0.051,
            z: 0,
          },
          springArmAnchor: { x: 0, y: -0.051, z: 0 },
        },
        maximumStroke: 0.052,
        quadraticBumpRate: 12_000,
        springRate: 900,
      },
      tradeoff:
        "More bump compliance with softer platform response and slightly more mass.",
      version: 1,
    },
    {
      assembly: {
        maximumInstances: 4,
        mirrorable: true,
        rotationAxes: ["x", "y", "z"],
      },
      category: "suspension",
      construction: [cylinder(aluminum, 0.008, 0.145, "y")],
      id: "suspension.compliant-long",
      label: "Compliant long-travel suspension",
      mass: 0.052,
      massCenter: { x: 0, y: 0, z: 0 },
      ports: [
        {
          direction: "bidirectional",
          id: "chassis-mount",
          interface: "suspension-chassis",
          multiple: false,
        },
        {
          direction: "bidirectional",
          id: "hub-mount",
          interface: "suspension-hub",
          multiple: false,
        },
      ],
      summary:
        "A longer coilover with matched damping for compliant, controlled travel.",
      suspension: {
        bumpStart: 0.04,
        damperRate: 18.75,
        extendedLength: 0.14,
        mounting: {
          armPivot: {
            x: 0.08 * Math.sqrt(812.5 / 1_600),
            y: -0.051,
            z: 0,
          },
          chassisAnchor: { x: 0, y: 0.051, z: 0 },
          hubAnchor: {
            x: -0.08 * (1 - Math.sqrt(812.5 / 1_600)),
            y: -0.051,
            z: 0,
          },
          springArmAnchor: { x: 0, y: -0.051, z: 0 },
        },
        maximumStroke: 0.052,
        quadraticBumpRate: 12_000,
        springRate: 900,
      },
      tradeoff:
        "More bump compliance with controlled rebound and slightly more mass.",
      version: 2,
    },
    {
      assembly: {
        maximumInstances: 4,
        mirrorable: true,
        rotationAxes: ["x", "y", "z"],
      },
      category: "suspension",
      construction: [cylinder(aluminum, 0.008, 0.145, "y")],
      id: "suspension.compliant-long",
      label: "Compliant long-travel suspension",
      mass: 0.052,
      massCenter: { x: 0, y: 0, z: 0 },
      ports: [
        {
          direction: "bidirectional",
          id: "chassis-mount",
          interface: "suspension-chassis",
          multiple: false,
        },
        {
          direction: "bidirectional",
          id: "hub-mount",
          interface: "suspension-hub",
          multiple: false,
        },
      ],
      summary:
        "A longer coilover with matched damping for compliant, controlled travel, rated for a 30° installation.",
      suspension: {
        bumpStart: 0.04 * RATED_SHOCK_COSINE,
        damperRate: 18.75 / RATED_SHOCK_COSINE ** 2,
        extendedLength: 0.14,
        mounting: {
          armPivot: {
            x: 0.08 * Math.sqrt(812.5 / 1_600),
            y: -0.051,
            z: 0,
          },
          // 30° inward from the arm eye, at the 0.102 m eye-to-eye length.
          chassisAnchor: {
            x: 0.102 * Math.sin(RATED_SHOCK_INSTALLATION_RADIANS),
            y: -0.051 + 0.102 * RATED_SHOCK_COSINE,
            z: 0,
          },
          hubAnchor: {
            x: -0.08 * (1 - Math.sqrt(812.5 / 1_600)),
            y: -0.051,
            z: 0,
          },
          springArmAnchor: { x: 0, y: -0.051, z: 0 },
        },
        maximumStroke: 0.052 * RATED_SHOCK_COSINE,
        quadraticBumpRate: 12_000 / RATED_SHOCK_COSINE ** 3,
        springRate: 900 / RATED_SHOCK_COSINE ** 2,
      },
      tradeoff:
        "More bump compliance with controlled rebound and slightly more mass.",
      version: 3,
    },
    {
      assembly: {
        maximumInstances: 4,
        mirrorable: true,
        rotationAxes: ["x", "y", "z"],
      },
      category: "wheel-tire",
      construction: [cylinder(polymer, 0.058, 0.04, "x")],
      id: "wheel-tire.small-standard",
      label: "Small wheel and tire",
      mass: 0.085,
      massCenter: { x: 0, y: 0, z: 0 },
      ports: [
        {
          direction: "bidirectional",
          id: "hub-mount",
          interface: "suspension-hub",
          multiple: false,
        },
        {
          direction: "input",
          id: "drive-input",
          interface: "wheel-drive",
          multiple: false,
        },
        {
          direction: "input",
          id: "steering-input",
          interface: "steering-link",
          multiple: false,
        },
        {
          direction: "input",
          id: "service-brake-input",
          interface: "service-brake",
          multiple: false,
        },
        {
          direction: "input",
          id: "handbrake-input",
          interface: "wheel-handbrake",
          multiple: false,
        },
      ],
      summary: "A compact, low-inertia wheel using the standard tire compound.",
      tradeoff:
        "More ground force and quicker response with lower obstacle clearance.",
      version: 1,
      wheelTire: {
        radius: 0.058,
        tireCompound: { id: "tire-compound.standard-rubber", version: 1 },
        width: 0.04,
      },
    },
    {
      assembly: {
        maximumInstances: 4,
        mirrorable: true,
        rotationAxes: ["x", "y", "z"],
      },
      category: "wheel-tire",
      construction: [cylinder(polymer, 0.0725, 0.05, "x")],
      id: "wheel-tire.large-standard",
      label: "Large wheel and tire",
      mass: 0.13,
      massCenter: { x: 0, y: 0, z: 0 },
      ports: [
        {
          direction: "bidirectional",
          id: "hub-mount",
          interface: "suspension-hub",
          multiple: false,
        },
        {
          direction: "input",
          id: "drive-input",
          interface: "wheel-drive",
          multiple: false,
        },
        {
          direction: "input",
          id: "steering-input",
          interface: "steering-link",
          multiple: false,
        },
        {
          direction: "input",
          id: "service-brake-input",
          interface: "service-brake",
          multiple: false,
        },
        {
          direction: "input",
          id: "handbrake-input",
          interface: "wheel-handbrake",
          multiple: false,
        },
      ],
      summary: "A larger wheel with more clearance and rotational inertia.",
      tradeoff:
        "Higher road speed and clearance with less ground force and slower response.",
      version: 1,
      wheelTire: {
        radius: 0.0725,
        tireCompound: { id: "tire-compound.standard-rubber", version: 1 },
        width: 0.05,
      },
    },
    // Version 2 of the sealed parts: each declares where it mounts. The
    // motor, servo, and transmissions also take their CAD models' shape and
    // centre of mass, and the published weight of the real part each
    // copies, or else the CAD-measured mass.
    {
      assembly: {
        maximumInstances: 1,
        mirrorable: false,
        rotationAxes: ["x", "y", "z"],
      },
      category: "battery",
      construction: [box(polymer, { x: 0.095, y: 0.026, z: 0.048 })],
      electrical: { maximumCurrent: 60, voltage: 7.4 },
      id: "battery.lipo-standard",
      label: "Standard battery",
      mass: 0.24,
      massCenter: { x: 0, y: 0, z: 0 },
      mounts: [base({ x: 0.095, z: 0.048 }, -0.013)],
      ports: sealedPorts.battery,
      summary: "A sealed two-cell battery sized for the initial kart roster.",
      tradeoff:
        "The shared baseline supply keeps performance differences in gearing and construction.",
      version: 2,
    },
    {
      assembly: {
        maximumInstances: 1,
        mirrorable: false,
        rotationAxes: ["x", "y", "z"],
      },
      category: "receiver-speed-controller",
      construction: [box(polymer, { x: 0.052, y: 0.024, z: 0.038 })],
      electrical: { maximumMotorCurrent: 60, maximumVoltage: 8.4 },
      id: "control.receiver-esc-standard",
      label: "Standard receiver and controller",
      mass: 0.065,
      massCenter: { x: 0, y: 0, z: 0 },
      mounts: [base({ x: 0.052, z: 0.038 }, -0.012)],
      ports: [
        {
          direction: "input",
          id: "battery-input",
          interface: "battery-power",
          multiple: false,
        },
        {
          direction: "output",
          id: "motor-output",
          interface: "motor-power",
          multiple: false,
        },
        {
          direction: "output",
          id: "steering-output",
          interface: "steering-control",
          multiple: false,
        },
        {
          direction: "output",
          id: "brake-output",
          interface: "brake-control",
          multiple: false,
        },
      ],
      summary: "A sealed radio receiver and electronic speed controller.",
      tradeoff:
        "One shared controller makes motor and construction choices legible.",
      version: 2,
    },
    {
      assembly: {
        maximumInstances: 1,
        mirrorable: false,
        rotationAxes: ["x", "y", "z"],
      },
      category: "motor",
      // The 50 mm can, mount face to rear face.
      construction: [cylinder(steel, 0.018, 0.05)],
      electrical: {
        safeCurrent: 50,
        speedConstantRpmPerVolt: 1_500,
        windingResistance: 0.08,
      },
      id: "motor.brushless-standard",
      label: "Standard brushless motor",
      // A 3650-class motor's published weight (186–194 g).
      mass: 0.19,
      massCenter: { x: 0, y: 0.00002, z: -0.00116 },
      mounts: [
        {
          area: null,
          direction: "-z",
          id: "motor-face",
          position: { x: 0, y: 0, z: -0.025 },
          type: "motor-face",
        },
      ],
      ports: [
        {
          direction: "input",
          id: "power-input",
          interface: "motor-power",
          multiple: false,
        },
        {
          direction: "output",
          id: "shaft-output",
          interface: "motor-shaft",
          multiple: false,
        },
      ],
      summary: "The sealed baseline motor used by all three official builds.",
      tradeoff:
        "Gearing, wheel size, and mass determine how its fixed capability feels.",
      version: 2,
    },
    {
      assembly: {
        maximumInstances: 1,
        mirrorable: false,
        rotationAxes: ["x", "y", "z"],
      },
      category: "steering",
      // The case on its floor and the mounting tabs at each end.
      construction: [
        placed(box(polymer, { x: 0.0202, y: 0.024, z: 0.0408 }), {
          x: 0,
          y: -0.003,
          z: 0,
        }),
        placed(box(polymer, { x: 0.018, y: 0.0025, z: 0.0545 }), {
          x: 0,
          y: -0.00025,
          z: 0,
        }),
      ],
      id: "steering.servo-standard",
      label: "Standard steering servo",
      // The Savox SC-1251MG's published weight.
      mass: 0.0445,
      massCenter: { x: 0, y: -0.001, z: 0.00125 },
      mounts: [base({ x: 0.0202, z: 0.0408 }, -0.015)],
      ports: [
        {
          direction: "input",
          id: "control-input",
          interface: "steering-control",
          multiple: false,
        },
        {
          direction: "output",
          id: "link-output",
          interface: "steering-link",
          multiple: true,
        },
      ],
      steering: { maximumTorque: 1.8, maximumTravelDegrees: 30 },
      summary:
        "A sealed servo with enough travel for the supported steering geometry.",
      tradeoff:
        "Final steering lock still derives from linkage and wheel clearance.",
      version: 2,
    },
    {
      assembly: {
        maximumInstances: 1,
        mirrorable: false,
        rotationAxes: ["x", "y", "z"],
      },
      brakes: {
        totalHandbrakeTorque: 0.685125,
        totalServiceBrakeTorque: 1.5225,
      },
      category: "brakes",
      construction: [box(aluminum, { x: 0.052, y: 0.018, z: 0.04 })],
      id: "brakes.combined-standard",
      label: "Standard combined brakes",
      mass: 0.1,
      massCenter: { x: 0, y: 0, z: 0 },
      mounts: [base({ x: 0.052, z: 0.04 }, -0.009)],
      ports: [
        {
          direction: "input",
          id: "control-input",
          interface: "brake-control",
          multiple: false,
        },
        {
          direction: "output",
          id: "service-output",
          interface: "service-brake",
          multiple: true,
        },
        {
          direction: "output",
          id: "handbrake-output",
          interface: "wheel-handbrake",
          multiple: true,
        },
      ],
      summary:
        "One sealed system for four-wheel service braking and rear handbraking.",
      tradeoff:
        "Wheel radius changes the ground force produced by its fixed torque.",
      version: 2,
    },
    {
      assembly: {
        maximumInstances: 1,
        mirrorable: false,
        rotationAxes: ["x", "y", "z"],
      },
      category: "transmission",
      ...plateGearbox({
        caseHalfWidth: 0.0095,
        caseRear: 0.0125,
        cupMouth: 0.03,
        floor: -0.015,
        gearX: 0.014,
        metal: aluminum,
        motorAxis: { y: 0.004, z: -0.056457 },
        padTop: 0.014,
        plateX: { inner: 0.0175, outer: 0.02 },
        spurTip: 0.0224,
        topShaft: { y: 0.0089, z: -0.024429 },
      }),
      id: "transmission.tall-4to1",
      label: "Tall 4:1 transmission",
      // CAD-measured: no real part to weigh.
      mass: 0.1034,
      massCenter: { x: 0.0056, y: 0.003, z: -0.02187 },
      ports: sealedPorts.transmission,
      summary: "A tall reduction for higher theoretical road speed.",
      tradeoff:
        "Higher no-load speed with less wheel force than the short transmission.",
      transmission: {
        efficiency: 0.8114144775599887,
        motorRotationsPerWheelRotation: 4,
      },
      version: 2,
    },
    {
      assembly: {
        maximumInstances: 1,
        mirrorable: false,
        rotationAxes: ["x", "y", "z"],
      },
      category: "transmission",
      ...plateGearbox({
        caseHalfWidth: 0.0095,
        caseRear: 0.0125,
        cupMouth: 0.03,
        floor: -0.015,
        gearX: 0.014,
        metal: aluminum,
        motorAxis: { y: 0.004, z: -0.058853 },
        padTop: 0.014,
        plateX: { inner: 0.0175, outer: 0.02 },
        spurTip: 0.0248,
        topShaft: { y: 0.0113, z: -0.026055 },
      }),
      id: "transmission.balanced-5to1",
      label: "Balanced 5:1 transmission",
      // CAD-measured: no real part to weigh.
      mass: 0.1041,
      massCenter: { x: 0.00544, y: 0.00388, z: -0.02182 },
      ports: sealedPorts.transmission,
      summary: "A moderate reduction balancing launch force and road speed.",
      tradeoff:
        "Less road speed than the tall transmission and less wheel force than the short transmission.",
      transmission: {
        efficiency: 0.8,
        motorRotationsPerWheelRotation: 5,
      },
      version: 2,
    },
    {
      assembly: {
        maximumInstances: 1,
        mirrorable: false,
        rotationAxes: ["x", "y", "z"],
      },
      category: "transmission",
      ...plateGearbox({
        caseHalfWidth: 0.0105,
        caseRear: 0.014,
        cupMouth: 0.032,
        floor: -0.017,
        gearX: 0.015,
        metal: steel,
        motorAxis: { y: 0.002, z: -0.061361 },
        padTop: 0.0155,
        plateX: { inner: 0.0185, outer: 0.021 },
        spurTip: 0.028,
        topShaft: { y: 0.0125, z: -0.029023 },
      }),
      id: "transmission.short-8to1",
      label: "Short 8:1 transmission",
      // CAD-measured: no real part to weigh.
      mass: 0.1829,
      massCenter: { x: 0.00305, y: 0.00082, z: -0.017 },
      ports: sealedPorts.transmission,
      summary:
        "A short reduction for strong launch force and lower road speed.",
      tradeoff:
        "More wheel force with lower no-load speed and slightly more mass.",
      transmission: { efficiency: 0.78, motorRotationsPerWheelRotation: 8 },
      version: 2,
    },
  ]),
);

const approvedComponentByKey = new Map(
  APPROVED_KART_COMPONENTS.map((definition) => [
    `${definition.id}@${definition.version}`,
    definition,
  ]),
);

const latestApprovedComponentById = new Map<
  string,
  DeepReadonly<ApprovedComponentDefinition>
>();
for (const definition of APPROVED_KART_COMPONENTS) {
  const current = latestApprovedComponentById.get(definition.id);
  if (!current || definition.version > current.version) {
    latestApprovedComponentById.set(definition.id, definition);
  }
}

export const APPROVED_COMPONENTS_BY_CATEGORY = deepFreeze(
  Object.fromEntries(
    kartComponentCategorySchema.options.map((category) => [
      category,
      APPROVED_KART_COMPONENTS.filter(
        (definition) =>
          definition.category === category &&
          latestApprovedComponentById.get(definition.id) === definition,
      ),
    ]),
  ) as Record<
    KartComponentCategory,
    DeepReadonly<ApprovedComponentDefinition>[]
  >,
);

export function getApprovedKartComponent(reference: {
  id: string;
  version: number;
}): DeepReadonly<ApprovedComponentDefinition> | undefined {
  return approvedComponentByKey.get(`${reference.id}@${reference.version}`);
}

export function getLatestApprovedKartComponent(
  id: string,
): DeepReadonly<ApprovedComponentDefinition> | undefined {
  return latestApprovedComponentById.get(id);
}
