import { expect, test } from "@playwright/test";

import {
  addKartPrimitive,
  attachKartInstance,
  canAlignKartMirrorPair,
  canAttachKartInstanceAtCurrentPosition,
  canAttachKartInstanceTo,
  collectKartDocumentIds,
  deleteKartInstance,
  getKartMirrorCounterpartIds,
  mirrorKartInstance,
  nudgeKartInstance,
  replaceKartComponentDefinition,
  updateKartIdentity,
  updateKartInstanceTransform,
  updateKartInstanceTransformAndAttachment,
  updateKartPrimitiveGeometry,
} from "../src/game/editor/kart-editor-document";
import { shouldTrackKartEditorPointerDown } from "../src/game/editor/kart-editor-scene";
import { createBalancedKartDocument } from "../src/game/kart/balanced-kart-document";
import { validateKartAssembly } from "../src/game/kart/kart-assembly-validation";
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
  expect(
    getKartMirrorCounterpartIds(mirrored.document, added.selection),
  ).toEqual([mirrored.selection.id]);
  expect(
    getKartMirrorCounterpartIds(mirrored.document, mirrored.selection),
  ).toEqual([added.selection.id]);

  const deleted = deleteKartInstance(mirrored.document, added.selection);
  expect(
    deleted.primitiveInstances.some(
      ({ id }) => id === added.selection.id || id === mirrored.selection.id,
    ),
  ).toBe(false);
});

test("rejects descendant and mirrored-counterpart structural parents", () => {
  const document = createBalancedKartDocument();
  const suspension = {
    id: "suspension-front-left",
    kind: "component",
  } as const;

  expect(
    canAttachKartInstanceTo(document, suspension, "wheel-front-left"),
  ).toBe(false);
  expect(() =>
    attachKartInstance(
      document,
      suspension,
      "wheel-front-left",
      collectKartDocumentIds(document),
    ),
  ).toThrow(/descendants/);

  expect(
    canAttachKartInstanceTo(document, suspension, "suspension-front-right"),
  ).toBe(false);
  expect(() =>
    attachKartInstance(
      document,
      suspension,
      "suspension-front-right",
      collectKartDocumentIds(document),
    ),
  ).toThrow(/Mirrored counterparts/);
});

test("suppresses mirror alignment for legacy nested counterparts", () => {
  const document = structuredClone(createBalancedKartDocument());
  const selection = {
    id: "suspension-front-left",
    kind: "component",
  } as const;
  const attachment = document.structuralAttachments.find(
    ({ child }) => child.instanceId === selection.id,
  )!;
  attachment.parent.instanceId = "suspension-front-right";
  const selected = document.componentInstances.find(
    ({ id }) => id === selection.id,
  )!;
  const counterpartBefore = structuredClone(
    document.componentInstances.find(
      ({ id }) => id === "suspension-front-right",
    )!,
  );

  expect(canAlignKartMirrorPair(document, selection)).toBe(false);
  const moved = updateKartInstanceTransform(
    document,
    selection,
    {
      ...selected.transform,
      position: {
        ...selected.transform.position,
        y: selected.transform.position.y + 0.005,
      },
    },
    true,
  );
  expect(
    moved.componentInstances.find(({ id }) => id === counterpartBefore.id)
      ?.transform,
  ).toEqual(counterpartBefore.transform);
});

test("preserves valid attachments, detaches invalid moves, and requires explicit reattachment", () => {
  const document = createBalancedKartDocument();
  const selection = { id: "motor-main", kind: "component" } as const;
  const motor = document.componentInstances.find(
    ({ id }) => id === selection.id,
  )!;
  const originalAttachment = document.structuralAttachments.find(
    ({ child }) => child.instanceId === selection.id,
  )!;
  const retainedIds = collectKartDocumentIds(document);
  const validMove = updateKartInstanceTransformAndAttachment(
    document,
    selection,
    {
      ...motor.transform,
      position: { ...motor.transform.position, x: 0.005 },
    },
    "chassis-plate",
    retainedIds,
  );
  const validAttachment = validMove.structuralAttachments.find(
    ({ child }) => child.instanceId === selection.id,
  );
  expect(validAttachment?.id).toBe(originalAttachment.id);
  expect(validAttachment?.parent.instanceId).toBe("chassis-plate");
  expect(validateKartAssembly(validMove).success).toBe(true);

  const invalidMove = updateKartInstanceTransformAndAttachment(
    validMove,
    selection,
    {
      ...motor.transform,
      position: { ...motor.transform.position, x: 1 },
    },
    "chassis-plate",
    retainedIds,
  );
  expect(
    invalidMove.structuralAttachments.some(
      ({ child }) => child.instanceId === selection.id,
    ),
  ).toBe(false);
  expect(validateKartAssembly(invalidMove).success).toBe(false);

  const returnedToChassis = updateKartInstanceTransformAndAttachment(
    invalidMove,
    selection,
    {
      ...motor.transform,
      position: { ...motor.transform.position, x: 0.005 },
    },
    "chassis-plate",
    retainedIds,
  );
  expect(
    returnedToChassis.structuralAttachments.some(
      ({ child }) => child.instanceId === selection.id,
    ),
  ).toBe(false);
  expect(
    canAttachKartInstanceAtCurrentPosition(
      returnedToChassis,
      selection,
      "chassis-plate",
      retainedIds,
    ),
  ).toBe(true);

  const battery = document.componentInstances.find(
    ({ id }) => id === "battery-main",
  )!;
  const retargeted = updateKartInstanceTransformAndAttachment(
    invalidMove,
    selection,
    {
      ...motor.transform,
      position: battery.transform.position,
    },
    battery.id,
    retainedIds,
  );
  expect(
    retargeted.structuralAttachments.find(
      ({ child }) => child.instanceId === selection.id,
    ),
  ).toBeUndefined();
  expect(
    canAttachKartInstanceAtCurrentPosition(
      retargeted,
      selection,
      battery.id,
      retainedIds,
    ),
  ).toBe(true);
  const attachedToBattery = attachKartInstance(
    retargeted,
    selection,
    battery.id,
    retainedIds,
  );
  expect(
    attachedToBattery.structuralAttachments.find(
      ({ child }) => child.instanceId === selection.id,
    )?.parent.instanceId,
  ).toBe(battery.id);
  expect(validateKartAssembly(attachedToBattery).success).toBe(true);
});

test("attaches touching construction surfaces when their centers are out of range", () => {
  const document = createBalancedKartDocument();
  const selection = { id: "upper-housing", kind: "primitive" } as const;
  const bodywork = document.primitiveInstances.find(
    ({ id }) => id === selection.id,
  )!;
  const bumper = document.primitiveInstances.find(
    ({ id }) => id === "rear-bumper",
  )!;
  if (bodywork.shape !== "box" || bumper.shape !== "cylinder") {
    throw new Error("Balanced Kart construction geometry is unavailable.");
  }
  const moved = updateKartInstanceTransformAndAttachment(
    document,
    selection,
    {
      ...bodywork.transform,
      position: {
        x: bumper.transform.position.x,
        y: bumper.transform.position.y,
        z: bumper.transform.position.z + bumper.radius + bodywork.size.z / 2,
      },
    },
    bumper.id,
    collectKartDocumentIds(document),
  );
  const attachment = moved.structuralAttachments.find(
    ({ child }) => child.instanceId === selection.id,
  );

  expect(attachment).toBeUndefined();
  expect(
    canAttachKartInstanceAtCurrentPosition(
      moved,
      selection,
      "chassis-plate",
      collectKartDocumentIds(document),
    ),
  ).toBe(false);
  expect(
    canAttachKartInstanceAtCurrentPosition(
      moved,
      selection,
      bumper.id,
      collectKartDocumentIds(document),
    ),
  ).toBe(true);
  const attached = attachKartInstance(
    moved,
    selection,
    bumper.id,
    collectKartDocumentIds(document),
  );
  const bumperAttachment = attached.structuralAttachments.find(
    ({ child }) => child.instanceId === selection.id,
  );
  expect(bumperAttachment?.child.anchor.z).toBeCloseTo(-bodywork.size.z / 2);
  expect(bumperAttachment?.parent.anchor.z).toBeCloseTo(bumper.radius);
  expect(validateKartAssembly(attached).success).toBe(true);
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

test("moves attached descendants with their structural parent", () => {
  const original = createBalancedKartDocument();
  const suspension = original.componentInstances.find(
    ({ id }) => id === "suspension-front-left",
  )!;
  const wheelBefore = original.componentInstances.find(
    ({ id }) => id === "wheel-front-left",
  )!;
  const moved = updateKartInstanceTransform(
    original,
    { id: suspension.id, kind: "component" },
    {
      ...suspension.transform,
      position: {
        ...suspension.transform.position,
        y: suspension.transform.position.y + 0.005,
      },
    },
  );
  const wheelAfter = moved.componentInstances.find(
    ({ id }) => id === wheelBefore.id,
  )!;

  expect(wheelAfter.transform.position.y).toBeCloseTo(
    wheelBefore.transform.position.y + 0.005,
  );

  const validation = validateKartAssembly(moved);
  expect(validation.success).toBe(false);
  if (validation.success) return;
  const suspensionAttachmentIndex = moved.structuralAttachments.findIndex(
    ({ child }) => child.instanceId === suspension.id,
  );
  const wheelAttachmentIndex = moved.structuralAttachments.findIndex(
    ({ child }) => child.instanceId === wheelBefore.id,
  );
  expect(validation.issues).toContainEqual(
    expect.objectContaining({
      code: "separated-structural-attachment",
      path: ["structuralAttachments", suspensionAttachmentIndex],
    }),
  );
  expect(validation.issues).not.toContainEqual(
    expect.objectContaining({
      code: "separated-structural-attachment",
      path: ["structuralAttachments", wheelAttachmentIndex],
    }),
  );
});

test("rotates a complete attached subtree without separating descendants", () => {
  const original = createBalancedKartDocument();
  const chassis = original.primitiveInstances.find(
    ({ id }) => id === "chassis-plate",
  )!;
  const frontBumperBefore = original.primitiveInstances.find(
    ({ id }) => id === "front-bumper",
  )!;
  const rotated = updateKartInstanceTransform(
    original,
    { id: chassis.id, kind: "primitive" },
    {
      ...chassis.transform,
      rotationDegrees: { x: 0, y: 12, z: 0 },
    },
  );
  const frontBumperAfter = rotated.primitiveInstances.find(
    ({ id }) => id === frontBumperBefore.id,
  )!;

  expect(frontBumperAfter.transform.position).not.toEqual(
    frontBumperBefore.transform.position,
  );
  expect(frontBumperAfter.transform.rotationDegrees.y).toBeCloseTo(12);
  const validation = validateKartAssembly(rotated);
  if (validation.success) return;
  expect(
    validation.issues.filter(
      ({ code }) => code === "separated-structural-attachment",
    ),
  ).toEqual([]);
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

test("applies approved suspension mounting defaults to a mirrored pair", () => {
  const original = createBalancedKartDocument();
  const left = original.componentInstances.find(
    ({ id }) => id === "suspension-front-left",
  )!;
  const changedFront = replaceKartComponentDefinition(
    original,
    left.id,
    "suspension.compliant-long",
  );
  const next = replaceKartComponentDefinition(
    changedFront,
    "suspension-rear-left",
    "suspension.compliant-long",
  );
  const changedLeft = next.componentInstances.find(({ id }) => id === left.id)!;
  const right = next.componentInstances.find(
    ({ id }) => id === "suspension-front-right",
  )!;

  expect(changedLeft.definition.id).toBe("suspension.compliant-long");
  expect(right.definition.id).toBe("suspension.compliant-long");
  expect(changedLeft.suspensionMount?.armPivot.x).toBeCloseTo(
    changedLeft.transform.position.x + 0.08 * Math.sqrt(812.5 / 1_600),
  );
  expect(right.suspensionMount?.armPivot.x).toBeCloseTo(
    right.transform.position.x - 0.08 * Math.sqrt(812.5 / 1_600),
  );
  expect(() => deriveKartSnapshot(next)).not.toThrow();
});
