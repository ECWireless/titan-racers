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

export type KartComponentCategory = z.infer<
  typeof kartComponentCategorySchema
>;

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

const componentBaseSchema = z.strictObject({
  assembly: z.strictObject({
    maximumInstances: z.number().int().positive().max(8),
    mirrorable: z.boolean(),
    rotationAxes: z.array(z.enum(["x", "y", "z"])).min(1).max(3),
  }),
  category: kartComponentCategorySchema,
  construction: z
    .array(z.discriminatedUnion("shape", [internalBoxSchema, internalCylinderSchema]))
    .min(1)
    .max(16),
  id: kartStableIdSchema,
  label: z.string().trim().min(1).max(80),
  mass: z.number().finite().positive().max(5),
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
      tradeoff: "The shared baseline supply keeps performance differences in gearing and construction.",
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
      tradeoff: "One shared controller makes motor and construction choices legible.",
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
      tradeoff: "Gearing, wheel size, and mass determine how its fixed capability feels.",
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
      summary: "A sealed servo with enough travel for the supported steering geometry.",
      tradeoff: "Final steering lock still derives from linkage and wheel clearance.",
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
      summary: "One sealed system for four-wheel service braking and rear handbraking.",
      tradeoff: "Wheel radius changes the ground force produced by its fixed torque.",
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
      tradeoff: "Higher no-load speed with less wheel force than the short transmission.",
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
      summary: "A short reduction for strong launch force and lower road speed.",
      tradeoff: "More wheel force with lower no-load speed and slightly more mass.",
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
        damperRate: 10,
        extendedLength: 0.115,
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
        maximumStroke: 0.052,
        quadraticBumpRate: 12_000,
        springRate: 900,
      },
      tradeoff: "More bump compliance with softer platform response and slightly more mass.",
      version: 1,
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
      tradeoff: "More ground force and quicker response with lower obstacle clearance.",
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
      tradeoff: "Higher road speed and clearance with less ground force and slower response.",
      version: 1,
      wheelTire: {
        radius: 0.0725,
        tireCompound: { id: "tire-compound.standard-rubber", version: 1 },
        width: 0.05,
      },
    },
  ]),
);

const approvedComponentByKey = new Map(
  APPROVED_KART_COMPONENTS.map((definition) => [
    `${definition.id}@${definition.version}`,
    definition,
  ]),
);

export const APPROVED_COMPONENTS_BY_CATEGORY = deepFreeze(
  Object.fromEntries(
    kartComponentCategorySchema.options.map((category) => [
      category,
      APPROVED_KART_COMPONENTS.filter(
        (definition) => definition.category === category,
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
