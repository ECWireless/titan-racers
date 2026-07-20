import { expect, test } from "@playwright/test";

import {
  APPROVED_COMPONENTS_BY_CATEGORY,
  APPROVED_KART_COMPONENTS,
  approvedComponentDefinitionSchema,
  getApprovedKartComponent,
  kartComponentCategorySchema,
} from "../src/game/kart/kart-component-registry";
import {
  APPROVED_CONSTRUCTION_MATERIALS,
  APPROVED_SURFACE_MATERIALS,
  APPROVED_TIRE_COMPOUNDS,
  APPROVED_TIRE_SURFACE_INTERACTIONS,
  getApprovedConstructionMaterial,
  getApprovedSurfaceMaterial,
  getApprovedTireCompound,
} from "../src/game/kart/kart-material-registry";

test("provides at least one component option in every required category", () => {
  for (const category of kartComponentCategorySchema.options) {
    expect(APPROVED_COMPONENTS_BY_CATEGORY[category].length).toBeGreaterThanOrEqual(
      1,
    );
  }

  expect(APPROVED_KART_COMPONENTS).toHaveLength(11);
});

test("limits second component options to accepted physical tradeoffs", () => {
  const counts = Object.fromEntries(
    kartComponentCategorySchema.options.map((category) => [
      category,
      APPROVED_COMPONENTS_BY_CATEGORY[category].length,
    ]),
  );

  expect(counts).toEqual({
    battery: 1,
    brakes: 1,
    motor: 1,
    "receiver-speed-controller": 1,
    steering: 1,
    suspension: 2,
    transmission: 2,
    "wheel-tire": 2,
  });
});

test("uses unique immutable component identities with no progression fields", () => {
  const keys = APPROVED_KART_COMPONENTS.map(
    (definition) => `${definition.id}@${definition.version}`,
  );

  expect(new Set(keys).size).toBe(keys.length);
  for (const definition of APPROVED_KART_COMPONENTS) {
    expect(approvedComponentDefinitionSchema.parse(definition)).toEqual(
      definition,
    );
    expect(definition).not.toHaveProperty("tier");
    expect(definition).not.toHaveProperty("unlock");
    expect(definition).not.toHaveProperty("entitlement");
    expect(getApprovedKartComponent(definition)).toBe(definition);
  }
});

test("resolves every component-owned material and tire compound reference", () => {
  for (const definition of APPROVED_KART_COMPONENTS) {
    for (const primitive of definition.construction) {
      expect(getApprovedConstructionMaterial(primitive.material)).toBeDefined();
    }

    if (definition.category === "wheel-tire") {
      const { tireCompound } = definition.wheelTire;
      expect(getApprovedTireCompound(tireCompound)).toBeDefined();
    }
  }
});

test("ships versioned construction, tire, and environment material registries", () => {
  expect(APPROVED_CONSTRUCTION_MATERIALS).toHaveLength(4);
  expect(APPROVED_TIRE_COMPOUNDS).toHaveLength(1);
  expect(APPROVED_SURFACE_MATERIALS).toHaveLength(1);
  expect(APPROVED_TIRE_SURFACE_INTERACTIONS).toHaveLength(1);

  for (const material of APPROVED_CONSTRUCTION_MATERIALS) {
    expect(material.density).toBeGreaterThan(0);
    expect(material.version).toBe(1);
  }

  const interaction = APPROVED_TIRE_SURFACE_INTERACTIONS[0];
  expect(getApprovedTireCompound(interaction.tireCompound)).toBeDefined();
  expect(getApprovedSurfaceMaterial(interaction.surfaceMaterial)).toBeDefined();
  expect(interaction).toMatchObject({
    derivationVersion: 1,
    peakGripCoefficient: 1.42,
    peakSlipAngleDegrees: 5,
    rollingResistanceCoefficient: 0.025,
    slidingGripCoefficient: 0.98,
    slidingSlipAngleDegrees: 18,
  });
});

test("deep-freezes registry identities and physical values", () => {
  const component = APPROVED_KART_COMPONENTS[0];
  const originalMass = component.mass;

  expect(() => {
    (component as { mass: number }).mass = originalMass + 1;
  }).toThrow(TypeError);
  expect(() => {
    (component.construction[0].material as { id: string }).id = "changed";
  }).toThrow(TypeError);
  expect(component.mass).toBe(originalMass);
});
