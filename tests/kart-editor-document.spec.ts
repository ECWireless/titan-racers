import { expect, test } from "@playwright/test";

import {
  addKartPrimitive,
  attachKartInstance,
  collectKartDocumentIds,
  deleteKartInstance,
  mirrorKartInstance,
  nudgeKartInstance,
  replaceKartComponentDefinition,
  updateKartIdentity,
  updateKartInstanceTransform,
  updateKartPrimitiveGeometry,
  updateSuspensionMountPoint,
} from "../src/game/editor/kart-editor-document";
import { shouldTrackKartEditorPointerDown } from "../src/game/editor/kart-editor-scene";
import { createBalancedKartDocument } from "../src/game/kart/balanced-kart-document";
import { deriveKartSnapshot } from "../src/game/kart/kart-derivation";

test("edits identity and transforms through schema-valid document commands", () => {
  const original = createBalancedKartDocument();
  const named = updateKartIdentity(original, {
    name: "Balanced Workshop",
    practicalDescriptor: "A practical admin-authored kart.",
  });
  const moved = nudgeKartInstance(
    named,
    { id: "upper-housing", kind: "primitive" },
    "y",
    0.01,
  );

  expect(original.name).toBe("Balanced Kart");
  expect(named.name).toBe("Balanced Workshop");
  expect(
    moved.primitiveInstances.find(({ id }) => id === "upper-housing")?.transform
      .position.y,
  ).toBeCloseTo(0.1455);
});

test("adds, attaches, mirrors, and deletes bounded primitives", () => {
  const original = createBalancedKartDocument();
  const initialIds = collectKartDocumentIds(original);
  const added = addKartPrimitive(original, "cylinder-guard", initialIds);
  const addedIds = collectKartDocumentIds(added.document, initialIds);
  const attached = attachKartInstance(
    added.document,
    added.selection,
    "chassis-plate",
    addedIds,
  );
  const attachedIds = collectKartDocumentIds(attached, addedIds);
  const mirrored = mirrorKartInstance(attached, added.selection, attachedIds);

  expect(
    mirrored.document.structuralAttachments.some(
      ({ child }) => child.instanceId === added.selection.id,
    ),
  ).toBe(true);
  expect(
    mirrored.document.primitiveInstances.find(
      ({ id }) => id === mirrored.selection.id,
    )?.mirrorOf,
  ).toBe(added.selection.id);

  const deleted = deleteKartInstance(mirrored.document, added.selection);
  expect(
    deleted.primitiveInstances.some(
      ({ id }) => id === added.selection.id || id === mirrored.selection.id,
    ),
  ).toBe(false);
});

test("retains issued IDs after deletion instead of reusing logical identity", () => {
  const original = createBalancedKartDocument();
  const initialIds = collectKartDocumentIds(original);
  const added = addKartPrimitive(original, "cylinder-guard", initialIds);
  const retainedIds = collectKartDocumentIds(added.document, initialIds);
  const deleted = deleteKartInstance(added.document, added.selection);
  const replacement = addKartPrimitive(deleted, "cylinder-guard", retainedIds);

  expect(added.selection.id).toBe("cylinder-guard");
  expect(replacement.selection.id).toBe("cylinder-guard-2");
});

test("changes only approved component variants in the same category", () => {
  const original = createBalancedKartDocument();
  const changed = replaceKartComponentDefinition(
    original,
    "transmission-main",
    "transmission.short-8to1",
  );
  expect(
    changed.componentInstances.find(({ id }) => id === "transmission-main")
      ?.definition.id,
  ).toBe("transmission.short-8to1");
  expect(() =>
    replaceKartComponentDefinition(
      original,
      "transmission-main",
      "battery.lipo-standard",
    ),
  ).toThrow(/same category/);
});

test("updates both mirrored halves when the mirrored outline item changes", () => {
  const original = createBalancedKartDocument();
  const changed = replaceKartComponentDefinition(
    original,
    "wheel-front-right",
    "wheel-tire.large-standard",
  );

  for (const id of ["wheel-front-left", "wheel-front-right"]) {
    expect(
      changed.componentInstances.find((instance) => instance.id === id)
        ?.definition.id,
    ).toBe("wheel-tire.large-standard");
  }
});

test("reflects mirrored positions and orientations through one policy", () => {
  const original = createBalancedKartDocument();
  const next = updateKartInstanceTransform(
    original,
    { id: "wheel-front-right", kind: "component" },
    {
      position: { x: 0.21, y: 0.06, z: -0.16 },
      rotationDegrees: { x: 5, y: 10, z: 15 },
    },
    true,
  );
  const left = next.componentInstances.find(
    ({ id }) => id === "wheel-front-left",
  )!;

  expect(left.transform.position).toEqual({ x: -0.21, y: 0.06, z: -0.16 });
  expect(left.transform.rotationDegrees).toEqual({ x: 5, y: -10, z: -15 });
});

test("moves suspension mounting geometry with transformed mirrored components", () => {
  const original = createBalancedKartDocument();
  const right = original.componentInstances.find(
    ({ id }) => id === "suspension-front-right",
  )!;
  const moved = updateKartInstanceTransform(
    original,
    { id: right.id, kind: "component" },
    {
      ...right.transform,
      position: {
        ...right.transform.position,
        y: right.transform.position.y + 0.005,
      },
    },
    true,
  );

  for (const id of ["suspension-front-left", "suspension-front-right"]) {
    const before = original.componentInstances.find(
      (instance) => instance.id === id,
    )!;
    const after = moved.componentInstances.find(
      (instance) => instance.id === id,
    )!;
    for (const point of Object.keys(after.suspensionMount!) as Array<
      keyof NonNullable<typeof after.suspensionMount>
    >) {
      expect(after.suspensionMount![point].y).toBeCloseTo(
        before.suspensionMount![point].y + 0.005,
      );
    }
  }

  const rotated = updateKartInstanceTransform(
    original,
    { id: right.id, kind: "component" },
    {
      ...right.transform,
      rotationDegrees: { x: 0, y: 180, z: 0 },
    },
  );
  const rotatedRight = rotated.componentInstances.find(
    ({ id }) => id === right.id,
  )!;
  for (const point of Object.keys(rotatedRight.suspensionMount!) as Array<
    keyof NonNullable<typeof rotatedRight.suspensionMount>
  >) {
    expect(rotatedRight.suspensionMount![point].x).toBeCloseTo(
      right.transform.position.x * 2 - right.suspensionMount![point].x,
    );
    expect(rotatedRight.suspensionMount![point].y).toBeCloseTo(
      right.suspensionMount![point].y,
    );
    expect(rotatedRight.suspensionMount![point].z).toBeCloseTo(
      right.suspensionMount![point].z,
    );
  }
});

test("resizes both halves of a mirrored primitive from either selection", () => {
  const original = createBalancedKartDocument();
  const initialIds = collectKartDocumentIds(original);
  const added = addKartPrimitive(original, "cylinder-guard", initialIds);
  const retainedIds = collectKartDocumentIds(added.document, initialIds);
  const mirrored = mirrorKartInstance(
    added.document,
    added.selection,
    retainedIds,
  );
  const resizedFromOriginal = updateKartPrimitiveGeometry(
    mirrored.document,
    added.selection.id,
    { height: 0.2, radius: 0.014, shape: "cylinder" },
    true,
  );
  const resizedFromMirror = updateKartPrimitiveGeometry(
    resizedFromOriginal,
    mirrored.selection.id,
    { height: 0.22, radius: 0.016, shape: "cylinder" },
    true,
  );

  for (const id of [added.selection.id, mirrored.selection.id]) {
    const primitive = resizedFromMirror.primitiveInstances.find(
      (instance) => instance.id === id,
    );
    expect(primitive?.shape).toBe("cylinder");
    if (primitive?.shape === "cylinder") {
      expect(primitive.height).toBe(0.22);
      expect(primitive.radius).toBe(0.016);
    }
  }
});

test("does not start camera gestures from gizmo-consumed pointer downs", () => {
  expect(shouldTrackKartEditorPointerDown({ defaultPrevented: true })).toBe(
    false,
  );
  expect(shouldTrackKartEditorPointerDown({ defaultPrevented: false })).toBe(
    true,
  );
});

test("keeps focused suspension edits mirrored and derivable", () => {
  const original = createBalancedKartDocument();
  const left = original.componentInstances.find(
    ({ id }) => id === "suspension-front-left",
  )!;
  const next = updateSuspensionMountPoint(original, left.id, "chassisAnchor", {
    ...left.suspensionMount!.chassisAnchor,
    y: left.suspensionMount!.chassisAnchor.y - 0.005,
  });
  const right = next.componentInstances.find(
    ({ id }) => id === "suspension-front-right",
  )!;

  expect(right.suspensionMount?.chassisAnchor.x).toBeCloseTo(
    -next.componentInstances.find(({ id }) => id === left.id)!.suspensionMount!
      .chassisAnchor.x,
  );
  expect(() => deriveKartSnapshot(next)).not.toThrow();
});
