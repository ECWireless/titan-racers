import { expect, test } from "@playwright/test";

import {
  kartAssemblyDocumentSchema,
  parseKartAssemblyDocument,
  serializeKartAssemblyDocument,
} from "../src/game/kart/kart-assembly-document";

function createDocument() {
  return {
    componentInstances: [
      {
        definition: { id: "battery.lipo-standard", version: 1 },
        id: "battery-main",
        kind: "component" as const,
        mirrorOf: null,
        suspensionMount: null,
        transform: {
          position: { x: 0, y: 0.03, z: 0.04 },
          rotationDegrees: { x: 0, y: 0, z: 0 },
        },
        visualColor: "#475763",
      },
    ],
    connections: [],
    kartId: "contract-fixture",
    name: "Contract fixture",
    practicalDescriptor: "A minimal syntax fixture for the portable contract.",
    primitiveInstances: [
      {
        collision: "solid" as const,
        construction: { mode: "shell" as const, thickness: 0.002 },
        id: "chassis-plate",
        kind: "primitive" as const,
        material: { id: "material.structural-aluminum", version: 1 },
        mirrorOf: null,
        role: "structure" as const,
        shape: "box" as const,
        size: { x: 0.32, y: 0.02, z: 0.42 },
        transform: {
          position: { x: 0, y: 0, z: 0 },
          rotationDegrees: { x: 0, y: 0, z: 0 },
        },
        visualColor: "#475763",
      },
    ],
    schemaVersion: 3 as const,
    structuralAttachments: [
      {
        child: {
          anchor: { x: 0, y: -0.013, z: 0 },
          instanceId: "battery-main",
          mount: null as string | null,
        },
        id: "attach-battery-main",
        parent: {
          anchor: { x: 0, y: 0.01, z: 0.04 },
          instanceId: "chassis-plate",
          mount: null as string | null,
        },
      },
    ],
    units: { angle: "degrees" as const, length: "meters" as const },
    visualIdentity: { accentColor: "#f4b942", primaryColor: "#203040" },
  };
}

test("parses a bounded versioned kart assembly document", () => {
  const document = parseKartAssemblyDocument(createDocument());

  expect(document.schemaVersion).toBe(3);
  expect(document.units).toEqual({ angle: "degrees", length: "meters" });
  expect(document.componentInstances[0].definition).toEqual({
    id: "battery.lipo-standard",
    version: 1,
  });
});

test("migrates legacy global colors to explicit instance colors", () => {
  const current = createDocument();
  const legacy = {
    ...current,
    componentInstances: current.componentInstances.map(
      ({ visualColor, ...instance }) => {
        void visualColor;
        return instance;
      },
    ),
    primitiveInstances: current.primitiveInstances.map(
      ({ visualColor, ...instance }) => {
        void visualColor;
        return instance;
      },
    ),
    schemaVersion: 1 as const,
    structuralAttachments: withoutMountNames(current),
    visualIdentity: { accentColor: "#abcdef", primaryColor: "#123456" },
  };
  legacy.componentInstances[0].definition.id = "wheel-tire.small-standard";

  const migrated = parseKartAssemblyDocument(legacy);

  expect(migrated.schemaVersion).toBe(3);
  expect(migrated.componentInstances[0].visualColor).toBe("#123456");
  expect(migrated.primitiveInstances[0].visualColor).toBe("#475763");
});

function withoutMountNames(document: ReturnType<typeof createDocument>) {
  return document.structuralAttachments.map(({ child, id, parent }) => ({
    child: { anchor: child.anchor, instanceId: child.instanceId },
    id,
    parent: { anchor: parent.anchor, instanceId: parent.instanceId },
  }));
}

test("migrates schema 2 attachments with no mounting points named", () => {
  const current = createDocument();
  const version2 = {
    ...current,
    schemaVersion: 2 as const,
    structuralAttachments: withoutMountNames(current),
  };

  const migrated = parseKartAssemblyDocument(version2);

  expect(migrated.schemaVersion).toBe(3);
  expect(migrated.structuralAttachments).toEqual(
    current.structuralAttachments,
  );
  // Schema 2 knows no mounting points, and schema 3 needs them stated.
  expect(() =>
    parseKartAssemblyDocument({
      ...version2,
      structuralAttachments: current.structuralAttachments,
    }),
  ).toThrow();
  expect(() =>
    parseKartAssemblyDocument({
      ...current,
      structuralAttachments: withoutMountNames(current),
    }),
  ).toThrow();
});

test("keeps the mounting point each attachment end names", () => {
  const document = createDocument();
  document.structuralAttachments[0].child.mount = "base";
  document.structuralAttachments[0].parent.mount = "top";

  const parsed = parseKartAssemblyDocument(document);

  expect(parsed.structuralAttachments[0].child.mount).toBe("base");
  expect(parsed.structuralAttachments[0].parent.mount).toBe("top");
  document.structuralAttachments[0].parent.mount = "Top Face";
  expect(() => parseKartAssemblyDocument(document)).toThrow();
});

test("serializes kart documents canonically without database or derived state", () => {
  const document = createDocument();
  const serialized = serializeKartAssemblyDocument(document);

  expect(serializeKartAssemblyDocument(JSON.parse(serialized))).toBe(serialized);
  expect(serialized.endsWith("\n")).toBe(true);
  expect(serialized).not.toContain("ownerUserId");
  expect(serialized).not.toContain("resolvedSnapshot");
  expect(serialized).not.toContain("publication");
});

test("rejects unknown fields and authored derived values", () => {
  const document = createDocument() as Record<string, unknown>;
  document.maximumDriveForce = 50;

  const result = kartAssemblyDocumentSchema.safeParse(document);

  expect(result.success).toBe(false);
  expect(result.error?.issues).toContainEqual(
    expect.objectContaining({ path: [] }),
  );
});

test("rejects external asset references and unbounded primitive geometry", () => {
  const externalAsset = structuredClone(createDocument()) as Record<
    string,
    unknown
  >;
  externalAsset.modelUrl = "https://example.com/kart.glb";
  expect(kartAssemblyDocumentSchema.safeParse(externalAsset).success).toBe(
    false,
  );

  const oversized = createDocument();
  oversized.primitiveInstances[0].size.x = 2;
  const result = kartAssemblyDocumentSchema.safeParse(oversized);

  expect(result.success).toBe(false);
  expect(result.error?.issues).toContainEqual(
    expect.objectContaining({
      path: ["primitiveInstances", 0, "size", "x"],
    }),
  );
});
