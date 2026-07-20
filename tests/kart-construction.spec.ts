import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

import {
  KART_COMPONENT_CATALOG,
  KART_COMPONENT_CATEGORIES,
  kartComponentCatalogSchema,
  type KartComponentCatalog,
} from "../src/game/kart/kart-component-catalog";
import {
  BALANCED_KART_CONSTRUCTION,
  kartConstructionDocumentSchema,
  parseKartConstructionDocument,
  serializeKartConstructionDocument,
  type KartConstructionDocument,
} from "../src/game/kart/kart-construction";

function cloneBalancedKart(): KartConstructionDocument {
  return structuredClone(
    BALANCED_KART_CONSTRUCTION,
  ) as KartConstructionDocument;
}

function cloneCatalog(): KartComponentCatalog {
  return structuredClone(KART_COMPONENT_CATALOG) as KartComponentCatalog;
}

test("loads one valid default component for every required category", () => {
  expect(KART_COMPONENT_CATALOG.catalogVersion).toBe(1);
  expect(KART_COMPONENT_CATALOG.units).toBe("meters-kilograms-seconds");
  expect(
    KART_COMPONENT_CATALOG.components.map(
      (component) => component.properties.kind,
    ),
  ).toEqual(KART_COMPONENT_CATEGORIES);
  expect(
    new Set(
      KART_COMPONENT_CATALOG.components.map(
        (component) => `${component.componentId}@${component.revision}`,
      ),
    ).size,
  ).toBe(KART_COMPONENT_CATEGORIES.length);

  const wheelSet = KART_COMPONENT_CATALOG.components.find(
    (component) => component.properties.kind === "wheel-set",
  );
  expect(wheelSet?.massElements.map((element) => element.wheelMount)).toEqual([
    { axle: "front", side: "left" },
    { axle: "front", side: "right" },
    { axle: "rear", side: "left" },
    { axle: "rear", side: "right" },
  ]);
  wheelSet?.massElements.forEach((element) =>
    expect(element.center).toEqual({ x: 0, y: 0, z: 0 }),
  );
  wheelSet?.visualPrimitives.forEach((primitive) =>
    expect(primitive.transform.position).toEqual({ x: 0, y: 0, z: 0 }),
  );

  const catalogWithWheelHubs = cloneCatalog();
  const mutableWheelSet = catalogWithWheelHubs.components.find(
    (component) => component.properties.kind === "wheel-set",
  );
  if (!mutableWheelSet) throw new Error("Expected mutable wheel set");
  const wheelHub = structuredClone(mutableWheelSet.visualPrimitives[0]);
  wheelHub.id = "front-left-wheel-hub";
  wheelHub.material = "wheel-hub";
  mutableWheelSet.visualPrimitives.push(wheelHub);
  expect(kartComponentCatalogSchema.safeParse(catalogWithWheelHubs).success).toBe(
    true,
  );
});

test("rejects incomplete and physically incoherent component catalogs", () => {
  const incomplete = cloneCatalog();
  incomplete.components = incomplete.components.filter(
    (component) => component.properties.kind !== "battery",
  );
  const incompleteResult = kartComponentCatalogSchema.safeParse(incomplete);

  expect(incompleteResult.success).toBe(false);
  expect(incompleteResult.error?.issues).toContainEqual(
    expect.objectContaining({
      message: "Catalog requires at least one battery component",
      path: ["components"],
    }),
  );

  const incoherent = cloneCatalog();
  const wheels = incoherent.components.find(
    (component) => component.properties.kind === "wheel-set",
  );
  if (!wheels || wheels.properties.kind !== "wheel-set") {
    throw new Error("Expected the default wheel set");
  }
  wheels.properties.slidingGripCoefficient = 2;

  expect(kartComponentCatalogSchema.safeParse(incoherent).success).toBe(false);
});

test("rejects malformed frame mounts and duplicate wheel-template targets", () => {
  const malformedCatalogs = [
    (catalog: KartComponentCatalog) => {
      const frame = catalog.components[0];
      if (frame.properties.kind !== "frame") throw new Error("Expected frame");
      frame.properties.wheelMounts[1].id = frame.properties.wheelMounts[0].id;
    },
    (catalog: KartComponentCatalog) => {
      const frame = catalog.components[0];
      if (frame.properties.kind !== "frame") throw new Error("Expected frame");
      frame.properties.wheelMounts[1].position.z += 0.01;
    },
    (catalog: KartComponentCatalog) => {
      const frame = catalog.components[0];
      if (frame.properties.kind !== "frame") throw new Error("Expected frame");
      frame.properties.wheelMounts[0].position.x = 0.8;
    },
    (catalog: KartComponentCatalog) => {
      const frame = catalog.components[0];
      if (frame.properties.kind !== "frame") throw new Error("Expected frame");
      frame.properties.wheelMounts[2].position.x = -0.7;
    },
    (catalog: KartComponentCatalog) => {
      const wheels = catalog.components.find(
        (component) => component.properties.kind === "wheel-set",
      );
      if (!wheels) throw new Error("Expected wheel set");
      wheels.massElements[1].wheelMount = { axle: "front", side: "left" };
    },
  ];

  malformedCatalogs.forEach((malform) => {
    const catalog = cloneCatalog();
    malform(catalog);
    expect(kartComponentCatalogSchema.safeParse(catalog).success).toBe(false);
  });
});

test("keeps catalog and source construction exports deeply immutable", () => {
  expect(Object.isFrozen(KART_COMPONENT_CATALOG)).toBe(true);
  expect(Object.isFrozen(KART_COMPONENT_CATALOG.components[0].massElements)).toBe(
    true,
  );
  expect(Object.isFrozen(BALANCED_KART_CONSTRUCTION.components[0])).toBe(true);

  const mutableCatalog =
    KART_COMPONENT_CATALOG as unknown as KartComponentCatalog;
  const mutableConstruction =
    BALANCED_KART_CONSTRUCTION as unknown as KartConstructionDocument;
  expect(() => {
    mutableCatalog.components[0].revision = 2;
  }).toThrow(TypeError);
  expect(() => {
    mutableConstruction.components[0].componentRevision = 2;
  }).toThrow(TypeError);
});

test("parses the complete Balanced Kart without authored physical values", () => {
  expect(BALANCED_KART_CONSTRUCTION).toMatchObject({
    derivationVersion: 1,
    kartId: "balanced-kart",
    name: "Balanced Kart",
    schemaVersion: 1,
    units: "meters-kilograms-seconds",
  });
  expect(BALANCED_KART_CONSTRUCTION.components).toHaveLength(7);
  expect(
    BALANCED_KART_CONSTRUCTION.components.map(({ componentId }) => componentId),
  ).toEqual([
    "standard-frame",
    "balanced-body",
    "standard-motor",
    "standard-battery",
    "road-wheel-set",
    "balanced-suspension",
    "standard-bumper-set",
  ]);
  expect(JSON.stringify(BALANCED_KART_CONSTRUCTION)).not.toMatch(
    /mass|inertia|grip|speed|stat|override/i,
  );
});

test("serializes the Balanced Kart canonically and round trips byte-for-byte", () => {
  const serialized = serializeKartConstructionDocument(
    BALANCED_KART_CONSTRUCTION,
  );
  const source = readFileSync(
    join(process.cwd(), "src/game/kart/balanced-kart.v1.json"),
    "utf8",
  );

  expect(serialized).toBe(source);
  expect(serializeKartConstructionDocument(JSON.parse(serialized))).toBe(
    serialized,
  );
  expect(parseKartConstructionDocument(JSON.parse(serialized))).toEqual(
    BALANCED_KART_CONSTRUCTION,
  );

  const reordered = cloneBalancedKart();
  reordered.components.reverse();
  expect(serializeKartConstructionDocument(reordered)).toBe(serialized);
  expect(parseKartConstructionDocument(reordered)).toEqual(
    BALANCED_KART_CONSTRUCTION,
  );
});

test("rejects unknown fields instead of accepting a stat override", () => {
  const input = cloneBalancedKart() as typeof BALANCED_KART_CONSTRUCTION & {
    stats?: { speed: number };
  };
  input.stats = { speed: 100 };

  const result = kartConstructionDocumentSchema.safeParse(input);

  expect(result.success).toBe(false);
  expect(result.error?.issues).toContainEqual(
    expect.objectContaining({
      code: "unrecognized_keys",
      keys: ["stats"],
      path: [],
    }),
  );
});

test("rejects missing, duplicate, and stale component references", () => {
  const missing = cloneBalancedKart();
  missing.components.pop();
  expect(kartConstructionDocumentSchema.safeParse(missing).success).toBe(false);

  const duplicate = cloneBalancedKart();
  duplicate.components[1].instanceId = duplicate.components[0].instanceId;
  const duplicateResult = kartConstructionDocumentSchema.safeParse(duplicate);
  expect(duplicateResult.success).toBe(false);
  expect(duplicateResult.error?.issues).toContainEqual(
    expect.objectContaining({
      message: "Component instance IDs must be unique",
      path: ["components", 1, "instanceId"],
    }),
  );

  const stale = cloneBalancedKart();
  stale.components[3].componentRevision = 99;
  const staleResult = kartConstructionDocumentSchema.safeParse(stale);
  expect(staleResult.success).toBe(false);
  expect(staleResult.error?.issues).toContainEqual(
    expect.objectContaining({
      message: "Unknown component ID or revision",
      path: ["components", 3, "componentRevision"],
    }),
  );
});

test("rejects incompatible slots and adjustments outside frame bounds", () => {
  const incompatible = cloneBalancedKart();
  incompatible.components[1].slotId = "motor-mount";
  incompatible.components[2].slotId = "body-mount";
  const incompatibleResult =
    kartConstructionDocumentSchema.safeParse(incompatible);

  expect(incompatibleResult.success).toBe(false);
  expect(incompatibleResult.error?.issues).toContainEqual(
    expect.objectContaining({
      message: "Attachment slot accepts motor, not body",
      path: ["components", 1, "slotId"],
    }),
  );

  const outOfBounds = cloneBalancedKart();
  outOfBounds.components[3].transformAdjustment.position.z = 0.251;
  const boundsResult = kartConstructionDocumentSchema.safeParse(outOfBounds);

  expect(boundsResult.success).toBe(false);
  expect(boundsResult.error?.issues).toContainEqual(
    expect.objectContaining({
      message: "Adjustment must be between -0.25 and 0.25",
      path: [
        "components",
        3,
        "transformAdjustment",
        "position",
        "z",
      ],
    }),
  );
});

test("parsing does not mutate caller-owned construction data", () => {
  const input = cloneBalancedKart();
  input.components[3].transformAdjustment.position.x = 0.12;
  const storedInput = structuredClone(input);

  parseKartConstructionDocument(input);

  expect(input).toEqual(storedInput);
});
