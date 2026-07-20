import { z } from "zod";

import balancedKartJson from "./balanced-kart.v1.json";
import {
  deepFreeze,
  getKartComponent,
  KART_COMPONENT_CATEGORIES,
  kartStableIdSchema,
  kartTransformSchema,
  type KartComponentCategory,
} from "./kart-component-catalog";

const colorSchema = z
  .string()
  .regex(/^#[0-9a-f]{6}$/, "Color must be a lowercase six-digit hex value");

const componentInstanceSchema = z.strictObject({
  componentId: kartStableIdSchema,
  componentRevision: z.number().int().positive(),
  instanceId: kartStableIdSchema,
  slotId: kartStableIdSchema,
  transformAdjustment: kartTransformSchema,
});

function addIssue(
  context: z.RefinementCtx,
  message: string,
  path: (string | number)[],
) {
  context.addIssue({ code: "custom", message, path });
}

function categoryForInstance(
  instance: z.infer<typeof componentInstanceSchema>,
) {
  return getKartComponent(instance.componentId, instance.componentRevision)
    ?.properties.kind;
}

export const kartConstructionDocumentSchema = z
  .strictObject({
    appearance: z.strictObject({
      accentColor: colorSchema,
      primaryColor: colorSchema,
      secondaryColor: colorSchema,
    }),
    assemblerCredit: z.string().trim().min(1).max(80),
    components: z.array(componentInstanceSchema).length(7),
    derivationVersion: z.literal(1),
    descriptor: z.string().trim().min(1).max(120),
    kartId: kartStableIdSchema,
    name: z.string().trim().min(1).max(80),
    schemaVersion: z.literal(1),
    units: z.literal("meters-kilograms-seconds"),
  })
  .superRefine((document, context) => {
    const seenInstanceIds = new Set<string>();
    const seenSlotIds = new Set<string>();
    const categoryInstances = new Map<
      KartComponentCategory,
      Array<{ index: number; slotId: string }>
    >();

    document.components.forEach((instance, index) => {
      if (seenInstanceIds.has(instance.instanceId)) {
        addIssue(context, "Component instance IDs must be unique", [
          "components",
          index,
          "instanceId",
        ]);
      }
      seenInstanceIds.add(instance.instanceId);

      if (seenSlotIds.has(instance.slotId)) {
        addIssue(context, "Each attachment slot can be occupied only once", [
          "components",
          index,
          "slotId",
        ]);
      }
      seenSlotIds.add(instance.slotId);

      const category = categoryForInstance(instance);
      if (!category) {
        addIssue(context, "Unknown component ID or revision", [
          "components",
          index,
          "componentRevision",
        ]);
        return;
      }

      const instances = categoryInstances.get(category) ?? [];
      instances.push({ index, slotId: instance.slotId });
      categoryInstances.set(category, instances);
    });

    KART_COMPONENT_CATEGORIES.forEach((category) => {
      const instances = categoryInstances.get(category) ?? [];
      if (instances.length !== 1) {
        addIssue(
          context,
          `Kart requires exactly one ${category} component`,
          ["components"],
        );
      }
    });

    const frameEntry = categoryInstances.get("frame")?.[0];
    if (!frameEntry) {
      return;
    }

    const frameInstance = document.components[frameEntry.index];
    const frame = getKartComponent(
      frameInstance.componentId,
      frameInstance.componentRevision,
    );

    if (!frame || frame.properties.kind !== "frame") {
      return;
    }
    const frameProperties = frame.properties;

    if (frameInstance.slotId !== "root") {
      addIssue(context, "Frame must occupy the root slot", [
        "components",
        frameEntry.index,
        "slotId",
      ]);
    }

    (["position", "rotation"] as const).forEach((transformKey) => {
      (["x", "y", "z"] as const).forEach((axis) => {
        if (frameInstance.transformAdjustment[transformKey][axis] !== 0) {
          addIssue(context, "Frame root adjustment must be zero", [
            "components",
            frameEntry.index,
            "transformAdjustment",
            transformKey,
            axis,
          ]);
        }
      });
    });

    document.components.forEach((instance, index) => {
      const category = categoryForInstance(instance);
      if (!category || category === "frame") {
        return;
      }

      const slot = frameProperties.slots.find(
        (candidate) => candidate.slotId === instance.slotId,
      );
      if (!slot) {
        addIssue(context, "Attachment slot does not exist on the selected frame", [
          "components",
          index,
          "slotId",
        ]);
        return;
      }

      if (slot.acceptsCategory !== category) {
        addIssue(
          context,
          `Attachment slot accepts ${slot.acceptsCategory}, not ${category}`,
          ["components", index, "slotId"],
        );
      }

      (["position", "rotation"] as const).forEach((transformKey) => {
        (["x", "y", "z"] as const).forEach((axis) => {
          const value = instance.transformAdjustment[transformKey][axis];
          const minimum = slot.bounds.minimum[transformKey][axis];
          const maximum = slot.bounds.maximum[transformKey][axis];
          if (value < minimum || value > maximum) {
            addIssue(
              context,
              `Adjustment must be between ${minimum} and ${maximum}`,
              [
                "components",
                index,
                "transformAdjustment",
                transformKey,
                axis,
              ],
            );
          }
        });
      });
    });
  });

export type KartConstructionDocument = z.infer<
  typeof kartConstructionDocumentSchema
>;
export type KartComponentInstance = KartConstructionDocument["components"][number];

const categoryOrder = new Map(
  KART_COMPONENT_CATEGORIES.map((category, index) => [category, index]),
);

export function parseKartConstructionDocument(
  input: unknown,
): KartConstructionDocument {
  const document = kartConstructionDocumentSchema.parse(input);
  document.components.sort((left, right) => {
    const leftCategory = categoryForInstance(left)!;
    const rightCategory = categoryForInstance(right)!;
    return (
      categoryOrder.get(leftCategory)! - categoryOrder.get(rightCategory)! ||
      left.instanceId.localeCompare(right.instanceId)
    );
  });
  return document;
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

export function serializeKartConstructionDocument(input: unknown) {
  return `${JSON.stringify(
    sortJsonValue(parseKartConstructionDocument(input)),
    null,
    2,
  )}\n`;
}

export const BALANCED_KART_CONSTRUCTION = deepFreeze(
  parseKartConstructionDocument(balancedKartJson),
);
