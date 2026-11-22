import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

import {
  APPROVED_COMPONENTS_BY_CATEGORY,
  APPROVED_KART_COMPONENTS,
  approvedComponentDefinitionSchema,
  getApprovedKartComponent,
  getLatestApprovedKartComponent,
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
import { deriveKartSnapshot } from "../src/game/kart/kart-derivation";
import {
  getKartPartVisual,
  KART_PART_VISUALS,
} from "../src/game/kart/kart-part-visuals";
import { renderKartCatalogReference } from "../src/game/kart/kart-catalog-documentation";
import { getCadPoint, getKartCadMesh } from "../src/game/kart/kart-cad-meshes";
import {
  buildComponentMassElements,
  combineBounds,
} from "../src/game/kart/kart-construction-geometry";
import { createValidKartAssembly } from "./support/kart-assembly";

function readRepositoryFile(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

function exportedTypeNames(path: string) {
  return [...readRepositoryFile(path).matchAll(/^export type (\w+)/gm)].map(
    ([, name]) => name,
  );
}

function exportedConstantNames(path: string) {
  return [...readRepositoryFile(path).matchAll(/^export const (\w+)/gm)].map(
    ([, name]) => name,
  );
}

function leafFieldPaths(value: object, prefix: string): string[] {
  return Object.entries(value).flatMap(([key, nestedValue]) => {
    const path = `${prefix}.${key}`;
    return nestedValue !== null && typeof nestedValue === "object"
      ? leafFieldPaths(nestedValue, path)
      : [path];
  });
}

test("provides at least one component option in every required category", () => {
  for (const category of kartComponentCategorySchema.options) {
    expect(APPROVED_COMPONENTS_BY_CATEGORY[category].length).toBeGreaterThanOrEqual(
      1,
    );
  }

  expect(APPROVED_KART_COMPONENTS).toHaveLength(23);
});

test("limits additional component options to accepted physical tradeoffs", () => {
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
    transmission: 3,
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

test("retains historical component revisions while authoring the latest one", () => {
  expect(
    getApprovedKartComponent({
      id: "suspension.compliant-long",
      version: 1,
    }),
  ).toMatchObject({
    category: "suspension",
    suspension: { damperRate: 7 },
  });
  expect(
    getLatestApprovedKartComponent("suspension.compliant-long"),
  ).toMatchObject({
    suspension: { damperRate: 18.75 / Math.cos(Math.PI / 6) ** 2 },
    version: 3,
  });
  expect(
    APPROVED_COMPONENTS_BY_CATEGORY.suspension.filter(
      ({ id }) => id === "suspension.compliant-long",
    ),
  ).toHaveLength(1);
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

test("declares where every version-2 sealed part mounts, as its CAD model does", () => {
  const sealed = APPROVED_KART_COMPONENTS.filter(
    ({ category }) => category !== "suspension" && category !== "wheel-tire",
  );
  for (const definition of sealed) {
    const key = `${definition.id}@${definition.version}`;
    expect(Boolean(definition.mounts), key).toBe(definition.version >= 2);
    if (!definition.mounts) continue;
    // Placed at the origin, the construction shows where the part's faces
    // are: a footprint lies on its floor, within its outline, and a motor's
    // face is the can's drive end.
    const bounds = combineBounds(
      buildComponentMassElements(
        {
          definition,
          id: "part",
          kind: "component",
          mirrorOf: null,
          suspensionMount: null,
          transform: {
            position: { x: 0, y: 0, z: 0 },
            rotationDegrees: { x: 0, y: 0, z: 0 },
          },
          visualColor: "#000000",
        },
        definition,
      ).map((element) => element.bounds),
    );
    const mesh = getKartCadMesh(definition);
    const directions = {
      base: "-y",
      "motor-face": "-z",
      "motor-plate": "+x",
      "tower-pad": "+y",
    } as const;
    for (const mount of definition.mounts) {
      const label = `${key} ${mount.id}`;
      expect(mount.direction, label).toBe(directions[mount.type]);
      if (mesh) {
        const point = getCadPoint(mesh, `mount-${mount.id}`);
        expect(point, label).not.toBeNull();
        for (const [index, axis] of (["x", "y", "z"] as const).entries()) {
          expect(Math.abs(mount.position[axis] - point![index]), label).toBeLessThan(
            1e-6,
          );
        }
      }
      if (mount.type === "base") {
        expect(mount.position.y, label).toBeCloseTo(bounds.minimum.y, 9);
        expect(mount.position.x - mount.area!.x / 2, label).toBeGreaterThanOrEqual(
          bounds.minimum.x - 1e-9,
        );
        expect(mount.position.x + mount.area!.x / 2, label).toBeLessThanOrEqual(
          bounds.maximum.x + 1e-9,
        );
        expect(mount.position.z - mount.area!.z / 2, label).toBeGreaterThanOrEqual(
          bounds.minimum.z - 1e-9,
        );
        expect(mount.position.z + mount.area!.z / 2, label).toBeLessThanOrEqual(
          bounds.maximum.z + 1e-9,
        );
      }
      if (mount.type === "tower-pad") {
        // On the centreline over the outdrives, as wide as the case.
        const [housing] = definition.construction;
        expect(housing.shape === "cylinder" && housing.axis, label).toBe("x");
        expect(mount.position.x, label).toBe(0);
        expect(mount.position.z, label).toBe(0);
        expect(mount.area, label).toEqual({
          x: housing.shape === "cylinder" ? housing.height : 0,
          y: 0,
          z: 0.008,
        });
      }
      if (mount.type === "motor-face") {
        expect(mount.position.z, label).toBeCloseTo(bounds.minimum.z, 9);
      }
    }
  }
  expect(sealed.filter(({ mounts }) => mounts)).toHaveLength(8);
});

test("gives every approved part version a presentation visual", () => {
  const references = APPROVED_KART_COMPONENTS.map(
    ({ id, version }) => `${id}@${version}`,
  );
  expect(Object.keys(KART_PART_VISUALS).sort()).toEqual(references.sort());
  for (const definition of APPROVED_KART_COMPONENTS) {
    expect(getKartPartVisual(definition)?.kind).toBe(
      definition.category === "suspension" ? "coilover" : "pieces",
    );
  }
});

test("ships versioned construction, tire, and environment material registries", () => {
  expect(APPROVED_CONSTRUCTION_MATERIALS).toHaveLength(4);
  expect(APPROVED_TIRE_COMPOUNDS).toHaveLength(1);
  expect(APPROVED_SURFACE_MATERIALS).toHaveLength(3);
  expect(APPROVED_TIRE_SURFACE_INTERACTIONS).toHaveLength(3);

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

test("keeps registries and public kart-system types discoverable in documentation", () => {
  const catalogDocumentation = readRepositoryFile(
    "docs/kart-system/components-and-materials.md",
  );
  const documentedRegistryEntries = [
    ...APPROVED_KART_COMPONENTS,
    ...APPROVED_CONSTRUCTION_MATERIALS,
    ...APPROVED_TIRE_COMPOUNDS,
    ...APPROVED_SURFACE_MATERIALS,
  ];
  for (const definition of documentedRegistryEntries) {
    expect(catalogDocumentation).toContain(
      `${definition.id}@${definition.version}`,
    );
  }
  for (const interaction of APPROVED_TIRE_SURFACE_INTERACTIONS) {
    expect(catalogDocumentation).toContain(
      `${interaction.tireCompound.id}@${interaction.tireCompound.version} × ${interaction.surfaceMaterial.id}@${interaction.surfaceMaterial.version} / derivation ${interaction.derivationVersion}`,
    );
  }

  const derivedDocumentation = readRepositoryFile(
    "docs/kart-system/derivation-formulas.md",
  );
  for (const name of [
    ...exportedTypeNames("src/game/kart/kart-physical-profile.ts"),
    ...exportedTypeNames("src/game/kart/kart-derivation.ts"),
  ]) {
    expect(derivedDocumentation).toContain(name);
  }
  const resolvedSnapshot = deriveKartSnapshot(createValidKartAssembly());
  for (const path of [
    ...leafFieldPaths(resolvedSnapshot.physicalProfile, "physicalProfile"),
    ...leafFieldPaths(resolvedSnapshot.playerStats, "playerStats"),
  ]) {
    expect(derivedDocumentation).toContain(path);
  }

  const runtimeDocumentation = readRepositoryFile(
    "docs/kart-system/runtime-solver.md",
  );
  for (const name of exportedTypeNames(
    "src/game/kart/dynamic-kart-controller.ts",
  )) {
    expect(runtimeDocumentation).toContain(name);
  }

  const presentationDocumentation = readRepositoryFile(
    "docs/kart-system/presentation.md",
  );
  for (const name of exportedTypeNames("src/game/kart/kart-drift-smoke.ts")) {
    expect(presentationDocumentation).toContain(name);
  }

  const environmentDocumentation = readRepositoryFile(
    "docs/kart-system/environment.md",
  );
  for (const name of [
    ...exportedTypeNames("src/game/physics/world-environment.ts"),
    ...exportedConstantNames("src/game/physics/world-environment.ts"),
  ]) {
    expect(environmentDocumentation).toContain(name);
  }
});

test("keeps the exact generated catalog synchronized with every registry field", () => {
  expect(readRepositoryFile("docs/kart-system/generated-catalog.md")).toBe(
    renderKartCatalogReference(),
  );
});
