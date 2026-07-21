import { expect, test } from "@playwright/test";

import {
  KartAssemblyValidationError,
  parseValidatedKartAssembly,
  validateKartAssembly,
} from "../src/game/kart/kart-assembly-validation";
import { createValidKartAssembly } from "./support/kart-assembly";

test("accepts a complete connected kart assembly", () => {
  const document = createValidKartAssembly();
  const result = validateKartAssembly(document);

  expect(result.success).toBe(true);
  if (result.success) {
    expect(result.assembly.components.size).toBe(14);
    expect(result.assembly.document).toEqual(document);
  }
});

test("reports unknown immutable component references at their exact path", () => {
  const document = createValidKartAssembly();
  document.componentInstances[0].definition.id = "battery.unknown";
  const result = validateKartAssembly(document);

  expect(result.success).toBe(false);
  if (!result.success) {
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: "unknown-component",
        path: ["componentInstances", 0, "definition"],
      }),
    );
  }
});

test("rejects missing required categories and component count excess", () => {
  const document = createValidKartAssembly();
  document.componentInstances = document.componentInstances.filter(
    ({ id }) => id !== "motor-main",
  );
  const result = validateKartAssembly(document);

  expect(result.success).toBe(false);
  if (!result.success) {
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: "component-count" }),
    );
  }
});

test("rejects a physically floating instance", () => {
  const document = createValidKartAssembly();
  document.structuralAttachments = document.structuralAttachments.filter(
    ({ child }) => child.instanceId !== "battery-main",
  );
  const result = validateKartAssembly(document);

  expect(result.success).toBe(false);
  if (!result.success) {
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: "structural-root-count" }),
    );
  }
});

test("rejects structural anchors that do not meet in assembly space", () => {
  const document = createValidKartAssembly();
  document.structuralAttachments[0].parent.anchor.x += 0.01;
  const result = validateKartAssembly(document);

  expect(result.success).toBe(false);
  if (!result.success) {
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: "separated-structural-attachment" }),
    );
  }
});

test("rejects coincident structural anchors outside both part envelopes", () => {
  const document = createValidKartAssembly();
  const attachment = document.structuralAttachments[0];
  attachment.parent.anchor.x += 1.5;
  attachment.child.anchor.x += 1.5;
  const result = validateKartAssembly(document);

  expect(result.success).toBe(false);
  if (!result.success) {
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: "attachment-anchor-outside-envelope" }),
    );
  }
});

test("rejects incomplete wheel service connections", () => {
  const document = createValidKartAssembly();
  document.connections = document.connections.filter(
    ({ id }) => id !== "service-brake-front-left",
  );
  const result = validateKartAssembly(document);

  expect(result.success).toBe(false);
  if (!result.success) {
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: "functional-connection-count" }),
    );
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: "incomplete-wheel-station" }),
    );
  }
});

test("rejects an assembly without solid collision geometry", () => {
  const document = createValidKartAssembly();
  for (const primitive of document.primitiveInstances) {
    primitive.collision = "none";
  }
  const result = validateKartAssembly(document);

  expect(result.success).toBe(false);
  if (!result.success) {
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: "missing-collision-geometry" }),
    );
  }
});

test("rejects wheel orientation unsupported by the runtime wheel axis", () => {
  const document = createValidKartAssembly({ trackWidth: 0.5 });
  const wheel = document.componentInstances.find(
    ({ id }) => id === "wheel-front-left",
  )!;
  wheel.transform.rotationDegrees.y = 90;
  const result = validateKartAssembly(document);

  expect(result.success).toBe(false);
  if (!result.success) {
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: "unsupported-wheel-orientation" }),
    );
  }
});

test("rejects suspension leverage outside the supported geometry", () => {
  const document = createValidKartAssembly({ motionRatio: 0.2 });
  const result = validateKartAssembly(document);

  expect(result.success).toBe(false);
  if (!result.success) {
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: "invalid-suspension-motion-ratio",
      }),
    );
  }
});

test("rejects suspension anchors outside the installed component envelope", () => {
  const document = createValidKartAssembly();
  const suspension = document.componentInstances.find(
    ({ id }) => id === "suspension-front-left",
  )!;
  for (const anchor of Object.values(suspension.suspensionMount!)) {
    anchor.y += 1.5;
  }
  const result = validateKartAssembly(document);

  expect(result.success).toBe(false);
  if (!result.success) {
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: "suspension-anchor-outside-envelope" }),
    );
  }
});

test("throws one validation error carrying author-facing issue evidence", () => {
  const document = createValidKartAssembly();
  (document as unknown as Record<string, unknown>).maximumDriveForce = 100;

  expect(() => parseValidatedKartAssembly(document)).toThrow(
    KartAssemblyValidationError,
  );
  try {
    parseValidatedKartAssembly(document);
  } catch (error) {
    expect(error).toBeInstanceOf(KartAssemblyValidationError);
    expect((error as KartAssemblyValidationError).issues[0].path).toEqual([]);
  }
});
