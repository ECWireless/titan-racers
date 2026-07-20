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
      },
    ],
    schemaVersion: 1 as const,
    structuralAttachments: [
      {
        child: {
          anchor: { x: 0, y: -0.013, z: 0 },
          instanceId: "battery-main",
        },
        id: "attach-battery-main",
        parent: {
          anchor: { x: 0, y: 0.01, z: 0.04 },
          instanceId: "chassis-plate",
        },
      },
    ],
    units: { angle: "degrees" as const, length: "meters" as const },
    visualIdentity: { accentColor: "#f4b942", primaryColor: "#203040" },
  };
}

test("parses a bounded versioned kart assembly document", () => {
  const document = parseKartAssemblyDocument(createDocument());

  expect(document.schemaVersion).toBe(1);
  expect(document.units).toEqual({ angle: "degrees", length: "meters" });
  expect(document.componentInstances[0].definition).toEqual({
    id: "battery.lipo-standard",
    version: 1,
  });
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
