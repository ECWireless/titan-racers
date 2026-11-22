import { expect, test } from "@playwright/test";

import {
  addKartPrimitive,
  attachKartInstance,
  canAlignKartMirrorPair,
  canAttachKartInstanceAtCurrentPosition,
  canAttachKartInstanceTo,
  collectKartDocumentIds,
  deleteKartInstance,
  detachKartInstance,
  getKartInstanceSeat,
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
import { createHandlingKartDocument } from "../src/game/kart/handling-kart-document";
import { getApprovedKartComponent } from "../src/game/kart/kart-component-registry";
import {
  addVector,
  multiplyMatrix,
  rotationMatrix,
  subtractVector,
  transformVector,
} from "../src/game/kart/kart-construction-geometry";
import {
  findKartMountSnap,
  rotationDegreesFromMatrix,
} from "../src/game/kart/kart-mount-snapping";
import { resolveApprovedSuspensionMount } from "../src/game/kart/kart-suspension-mounting";
import { validateKartAssembly } from "../src/game/kart/kart-assembly-validation";

test("edits identity and transforms through schema-valid document commands", () => {
  const original = createBalancedKartDocument();
  const named = updateKartIdentity(original, {
    name: "Balanced Workshop",
    practicalDescriptor: "A practical admin-authored kart.",
  });
  const moved = nudgeKartInstance(
    named,
    { id: "top-deck", kind: "primitive" },
    "y",
    0.01,
  );

  expect(original.name).toBe("Balanced Kart");
  expect(named.name).toBe("Balanced Workshop");
  expect(
    moved.primitiveInstances.find(({ id }) => id === "top-deck")?.transform
      .position.y,
  ).toBeCloseTo(0.109);
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

test("holds a snapped shock on its pin, and snaps it back once detached", () => {
  const document = createBalancedKartDocument();
  const selection = {
    id: "suspension-front-left",
    kind: "component",
  } as const;
  const suspension = document.componentInstances.find(
    ({ id }) => id === selection.id,
  )!;
  const retainedIds = collectKartDocumentIds(document);
  const lifted = (instance: typeof suspension, by: number) => ({
    ...instance.transform,
    position: {
      ...instance.transform.position,
      y: instance.transform.position.y + by,
    },
  });

  // Snapped, it stays put, and its mirror with it.
  const held = updateKartInstanceTransformAndAttachment(
    document,
    selection,
    lifted(suspension, 0.02),
    "shock-tower-front-bar",
    retainedIds,
    true,
  );
  expect(held.componentInstances).toEqual(document.componentInstances);
  const byId = (attachments: typeof document.structuralAttachments) =>
    [...attachments].sort((left, right) => left.id.localeCompare(right.id));
  expect(byId(held.structuralAttachments)).toEqual(
    byId(document.structuralAttachments),
  );

  // Detached and lifted until its top eye is 3 mm above the bar, the eye
  // snaps back onto the bar's pin.
  const bar = document.primitiveInstances.find(
    ({ id }) => id === "shock-tower-front-bar",
  )!;
  if (bar.shape !== "box") throw new Error("The bar is a box.");
  const barTop = bar.transform.position.y + bar.size.y / 2;
  const mirror = { id: "suspension-front-right", kind: "component" } as const;
  const detached = detachKartInstance(
    detachKartInstance(document, selection),
    mirror,
  );
  const moved = updateKartInstanceTransformAndAttachment(
    detached,
    selection,
    lifted(
      suspension,
      barTop + 0.003 - suspension.suspensionMount!.chassisAnchor.y,
    ),
    "",
    retainedIds,
    true,
  );
  // Its detached mirror snaps to match, and attaches the same way.
  const reattached = attachKartInstance(
    attachKartInstance(
      moved,
      selection,
      "shock-tower-front-bar",
      retainedIds,
      true,
    ),
    mirror,
    "shock-tower-front-bar",
    retainedIds,
  );
  expect(
    reattached.structuralAttachments.find(
      ({ child }) => child.instanceId === mirror.id,
    )?.child.mount,
  ).toBe("chassis-anchor");
  const attachment = reattached.structuralAttachments.find(
    ({ child }) => child.instanceId === selection.id,
  );
  expect(attachment?.child.mount).toBe("chassis-anchor");
  expect(attachment?.parent.mount).toBe("pin");
  expect(validateKartAssembly(reattached).success).toBe(true);
  const eye = reattached.componentInstances.find(
    ({ id }) => id === selection.id,
  )!.suspensionMount!.chassisAnchor;
  // 4 mm in from the bar's top edge, so the bolt has material around it.
  expect(eye.y).toBeCloseTo(
    bar.transform.position.y + Math.max(bar.size.y / 2 - 0.004, 0),
    9,
  );
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

test("slides a snapped footprint on its face, and detaches an unsnapped part moved away", () => {
  const document = createBalancedKartDocument();
  const selection = { id: "controller-main", kind: "component" } as const;
  const controller = document.componentInstances.find(
    ({ id }) => id === selection.id,
  )!;
  const originalAttachment = document.structuralAttachments.find(
    ({ child }) => child.instanceId === selection.id,
  )!;
  const retainedIds = collectKartDocumentIds(document);
  const at = (position: Partial<typeof controller.transform.position>) => ({
    ...controller.transform,
    position: { ...controller.transform.position, ...position },
  });
  const controllerIn = (candidate: typeof document) =>
    candidate.componentInstances.find(({ id }) => id === selection.id)!;
  const attachmentIn = (candidate: typeof document) =>
    candidate.structuralAttachments.find(
      ({ child }) => child.instanceId === selection.id,
    );

  // Lifted and tilted, it stays on the plate's top face, turned only about
  // it.
  const slid = updateKartInstanceTransformAndAttachment(
    document,
    selection,
    {
      position: { ...controller.transform.position, x: 0.005, y: 0.2 },
      rotationDegrees: { x: 20, y: 30, z: 0 },
    },
    "chassis-plate",
    retainedIds,
  );
  expect(attachmentIn(slid)?.id).toBe(originalAttachment.id);
  expect(attachmentIn(slid)?.parent.mount).toBe("top");
  expect(controllerIn(slid).transform.position.y).toBeCloseTo(
    controller.transform.position.y,
    9,
  );
  expect(controllerIn(slid).transform.rotationDegrees.x).toBeCloseTo(0, 6);
  expect(controllerIn(slid).transform.rotationDegrees.z).toBeCloseTo(0, 6);
  expect(validateKartAssembly(slid).success).toBe(true);

  // Pushed off the side, it stops with its footprint at the plate's edge.
  const pushed = updateKartInstanceTransformAndAttachment(
    document,
    selection,
    at({ x: 1 }),
    "chassis-plate",
    retainedIds,
  );
  const plate = document.primitiveInstances.find(
    ({ id }) => id === "chassis-plate",
  )!;
  if (plate.shape !== "box") throw new Error("The plate is a box.");
  const footprint = getApprovedKartComponent(controller.definition)!.mounts!.find(
    ({ id }) => id === "base",
  )!.area!;
  expect(attachmentIn(pushed)?.parent.mount).toBe("top");
  expect(controllerIn(pushed).transform.position.x).toBeCloseTo(
    plate.size.x / 2 - footprint.x / 2,
    9,
  );
  expect(validateKartAssembly(pushed).success).toBe(true);

  // Detached, it moves freely; it attaches to the battery, which has no
  // face to snap to, by touching it, and that attachment stays unnamed.
  const free = updateKartInstanceTransformAndAttachment(
    detachKartInstance(document, selection),
    selection,
    at({ x: 1 }),
    "",
    retainedIds,
  );
  expect(controllerIn(free).transform.position.x).toBe(1);
  const battery = document.componentInstances.find(
    ({ id }) => id === "battery-main",
  )!;
  const retargeted = updateKartInstanceTransformAndAttachment(
    free,
    selection,
    { ...controller.transform, position: battery.transform.position },
    battery.id,
    retainedIds,
  );
  expect(attachmentIn(retargeted)).toBeUndefined();
  expect(
    canAttachKartInstanceAtCurrentPosition(
      retargeted,
      selection,
      battery.id,
      retainedIds,
    ),
  ).toBe(true);
  const onBattery = attachKartInstance(
    retargeted,
    selection,
    battery.id,
    retainedIds,
  );
  expect(attachmentIn(onBattery)?.parent.instanceId).toBe(battery.id);
  expect(attachmentIn(onBattery)?.child.mount).toBeNull();
  expect(getKartInstanceSeat(onBattery, selection)).toEqual({
    parentId: battery.id,
    snapped: false,
  });
  expect(validateKartAssembly(onBattery).success).toBe(true);

  // Unnamed, it is moved freely, and detached once out of reach.
  const away = updateKartInstanceTransformAndAttachment(
    onBattery,
    selection,
    at({ x: 1 }),
    battery.id,
    retainedIds,
  );
  expect(attachmentIn(away)).toBeUndefined();
});

test("attaches touching construction surfaces when their centers are out of range", () => {
  const document = createBalancedKartDocument();
  const selection = { id: "top-deck", kind: "primitive" } as const;
  const deck = document.primitiveInstances.find(
    ({ id }) => id === selection.id,
  )!;
  const bumper = document.primitiveInstances.find(
    ({ id }) => id === "rear-bumper",
  )!;
  if (deck.shape !== "box" || bumper.shape !== "box") {
    throw new Error("Balanced Kart construction geometry is unavailable.");
  }
  const moved = updateKartInstanceTransformAndAttachment(
    detachKartInstance(document, selection),
    selection,
    {
      ...deck.transform,
      position: {
        x: bumper.transform.position.x,
        y: bumper.transform.position.y,
        z: bumper.transform.position.z + bumper.size.z / 2 + deck.size.z / 2,
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
  expect(bumperAttachment?.child.anchor.z).toBeCloseTo(-deck.size.z / 2);
  expect(bumperAttachment?.parent.anchor.z).toBeCloseTo(bumper.size.z / 2);
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

test("keeps mirrored suspension mounts across variant swaps", () => {
  const original = createBalancedKartDocument();
  expect(
    replaceKartComponentDefinition(
      original,
      "suspension-front-right",
      "suspension.firm-short",
      2,
    ),
  ).toEqual(original);

  const changed = replaceKartComponentDefinition(
    replaceKartComponentDefinition(
      original,
      "suspension-front-right",
      "suspension.compliant-long",
      3,
    ),
    "suspension-rear-left",
    "suspension.compliant-long",
    3,
  );
  for (const before of original.componentInstances.filter(
    ({ suspensionMount }) => suspensionMount,
  )) {
    const after = changed.componentInstances.find(
      ({ id }) => id === before.id,
    )!;
    expect(after.definition).toEqual({
      id: "suspension.compliant-long",
      version: 3,
    });
    expect(after.suspensionMount).toEqual(before.suspensionMount);
  }
  expect(validateKartAssembly(changed).success).toBe(true);
});

test("gives mount-less suspensions approved defaults on a variant swap", () => {
  const original = createBalancedKartDocument();
  const pair = ["suspension-front-left", "suspension-front-right"];
  for (const instance of original.componentInstances) {
    if (pair.includes(instance.id)) instance.suspensionMount = null;
  }
  const changed = replaceKartComponentDefinition(
    original,
    "suspension-front-left",
    "suspension.compliant-long",
    3,
  );
  const definition = getApprovedKartComponent({
    id: "suspension.compliant-long",
    version: 3,
  })!;
  for (const id of pair) {
    const instance = changed.componentInstances.find(
      (candidate) => candidate.id === id,
    )!;
    expect(definition.category).toBe("suspension");
    expect(instance.suspensionMount).toEqual(
      resolveApprovedSuspensionMount(
        instance,
        definition as Parameters<typeof resolveApprovedSuspensionMount>[1],
      ),
    );
  }
});

test("reports kept suspension mounts a shorter unit cannot span", () => {
  const original = createHandlingKartDocument();
  const changed = replaceKartComponentDefinition(
    replaceKartComponentDefinition(
      original,
      "suspension-front-left",
      "suspension.firm-short",
      2,
    ),
    "suspension-rear-left",
    "suspension.firm-short",
    2,
  );
  const result = validateKartAssembly(changed);
  expect(result.success).toBe(false);
  const codes = new Set(
    result.success ? [] : result.issues.map(({ code }) => code),
  );
  expect([...codes]).toEqual(["invalid-suspension-rest-length"]);
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
      right.transform.position.z * 2 - right.suspensionMount![point].z,
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

test("snaps a part onto its parent's nearest mounting point in reach", () => {
  const document = createBalancedKartDocument();
  const retainedIds = collectKartDocumentIds(document);
  const selection = { id: "battery-main", kind: "component" } as const;
  const battery = document.componentInstances.find(
    ({ id }) => id === selection.id,
  )!;
  const raised = (by: number) => ({
    position: {
      ...battery.transform.position,
      x: battery.transform.position.x + 0.003,
      y: battery.transform.position.y + by,
    },
    rotationDegrees: { x: 5, y: 90, z: 0 },
  });
  const detached = detachKartInstance(document, selection);

  // Moved freely, it stays where it is put; near its chosen parent, it
  // snaps onto the plate without attaching.
  const free = updateKartInstanceTransformAndAttachment(
    detached,
    selection,
    raised(0.006),
    "",
    retainedIds,
  );
  expect(
    free.componentInstances.find(({ id }) => id === selection.id)!.transform,
  ).toEqual(raised(0.006));
  const near = updateKartInstanceTransformAndAttachment(
    detached,
    selection,
    raised(0.006),
    "chassis-plate",
    retainedIds,
  );
  const nearBattery = near.componentInstances.find(
    ({ id }) => id === selection.id,
  )!;
  expect(nearBattery.transform.position.y).toBeCloseTo(
    battery.transform.position.y,
    9,
  );
  expect(nearBattery.transform.rotationDegrees.x).toBeCloseTo(0, 9);
  expect(
    near.structuralAttachments.some(
      ({ child }) => child.instanceId === selection.id,
    ),
  ).toBe(false);

  // Attached from where it was put, it is seated and named.
  const attached = attachKartInstance(free, selection, "chassis-plate", retainedIds);
  const attachment = attached.structuralAttachments.find(
    ({ child }) => child.instanceId === selection.id,
  )!;
  expect([attachment.child.mount, attachment.parent.mount]).toEqual([
    "base",
    "top",
  ]);
  const seated = attached.componentInstances.find(
    ({ id }) => id === selection.id,
  )!;
  expect(seated.transform.position.y).toBeCloseTo(
    battery.transform.position.y,
    9,
  );
  expect(seated.transform.rotationDegrees.x).toBeCloseTo(0, 9);
  expect(validateKartAssembly(attached).success).toBe(true);
  expect(getKartInstanceSeat(attached, selection)).toEqual({
    childMount: "base",
    hold: "slides",
    parentId: "chassis-plate",
    parentMount: "top",
    snapped: true,
  });

  // Out of reach, it doesn't snap; attached by touching, it stays unnamed,
  // which the builder won't save.
  const far = updateKartInstanceTransformAndAttachment(
    detached,
    selection,
    raised(0.012),
    "chassis-plate",
    retainedIds,
  );
  expect(
    far.componentInstances.find(({ id }) => id === selection.id)!.transform,
  ).toEqual(raised(0.012));
  expect(
    getKartInstanceSeat(
      attachKartInstance(far, selection, "chassis-plate", retainedIds),
      selection,
    ),
  ).toEqual({ parentId: "chassis-plate", snapped: false });
});

test("turns a snapped motor only about its shaft", () => {
  const document = createBalancedKartDocument();
  const retainedIds = collectKartDocumentIds(document);
  const selection = { id: "motor-main", kind: "component" } as const;
  const motor = document.componentInstances.find(
    ({ id }) => id === selection.id,
  )!;
  const motorIn = (candidate: typeof document) =>
    candidate.componentInstances.find(({ id }) => id === selection.id)!;
  const face = getApprovedKartComponent(motor.definition)!.mounts!.find(
    ({ id }) => id === "motor-face",
  )!.position;
  const rotation = rotationMatrix(motor.transform.rotationDegrees);
  const facePoint = addVector(
    motor.transform.position,
    transformVector(rotation, face),
  );
  // 30° about the shaft (along X: the motor is turned to face the gearbox),
  // through the motor face.
  const angle = Math.PI / 6;
  const aboutShaft = [
    1, 0, 0,
    0, Math.cos(angle), -Math.sin(angle),
    0, Math.sin(angle), Math.cos(angle),
  ] as Parameters<typeof transformVector>[0];
  const turned = {
    position: addVector(
      facePoint,
      transformVector(
        aboutShaft,
        subtractVector(motor.transform.position, facePoint),
      ),
    ),
    rotationDegrees: rotationDegreesFromMatrix(
      multiplyMatrix(aboutShaft, rotation),
    ),
  };
  const spun = updateKartInstanceTransformAndAttachment(
    document,
    selection,
    turned,
    "transmission-main",
    retainedIds,
  );
  for (const axis of ["x", "y", "z"] as const) {
    expect(motorIn(spun).transform.position[axis]).toBeCloseTo(
      turned.position[axis],
      9,
    );
  }
  // It keeps the turn about its shaft.
  rotationMatrix(motorIn(spun).transform.rotationDegrees).forEach(
    (value, index) =>
      expect(value).toBeCloseTo(
        multiplyMatrix(aboutShaft, rotation)[index],
        9,
      ),
  );
  expect(getKartInstanceSeat(spun, selection)).toMatchObject({
    snapped: true,
  });
  expect(validateKartAssembly(spun).success).toBe(true);

  // Moved off the plate and tilted, it goes back onto the plate, still
  // facing it.
  const pulled = updateKartInstanceTransformAndAttachment(
    document,
    selection,
    {
      position: addVector(motor.transform.position, { x: 0.01, y: 0.02, z: 0 }),
      rotationDegrees: { ...motor.transform.rotationDegrees, z: 15 },
    },
    "transmission-main",
    retainedIds,
  );
  const pulledFace = addVector(
    motorIn(pulled).transform.position,
    transformVector(
      rotationMatrix(motorIn(pulled).transform.rotationDegrees),
      face,
    ),
  );
  for (const axis of ["x", "y", "z"] as const) {
    expect(pulledFace[axis]).toBeCloseTo(facePoint[axis], 9);
  }
  expect(validateKartAssembly(pulled).success).toBe(true);
  expect(getKartInstanceSeat(pulled, selection)).toMatchObject({
    hold: "turns",
    snapped: true,
  });
});

test("keeps a swapped gearbox seated and carries its motor and rear tower", () => {
  const document = createBalancedKartDocument();
  const gearboxBase = (candidate: typeof document) => {
    const gearbox = candidate.componentInstances.find(
      ({ id }) => id === "transmission-main",
    )!;
    const base = getApprovedKartComponent(gearbox.definition)!.mounts!.find(
      ({ id }) => id === "base",
    )!.position;
    return addVector(
      gearbox.transform.position,
      transformVector(rotationMatrix(gearbox.transform.rotationDegrees), base),
    );
  };
  for (const ratio of ["transmission.tall-4to1", "transmission.short-8to1"]) {
    const swapped = replaceKartComponentDefinition(
      document,
      "transmission-main",
      ratio,
    );
    expect(validateKartAssembly(swapped).success, ratio).toBe(true);
    // Its new base sits on the plate.
    expect(gearboxBase(swapped).y).toBeCloseTo(gearboxBase(document).y, 9);
    for (const id of ["transmission-main", "motor-main", "shock-tower-rear"]) {
      expect(
        getKartInstanceSeat(swapped, {
          id,
          kind: id === "shock-tower-rear" ? "primitive" : "component",
        })?.snapped,
        `${ratio} ${id}`,
      ).toBe(true);
    }
    // The tower post is cut to the new pad, so its bar and the rear
    // suspension stay where they were.
    for (const id of ["shock-tower-rear-bar"]) {
      expect(
        swapped.primitiveInstances.find((primitive) => primitive.id === id)
          ?.transform,
      ).toEqual(
        document.primitiveInstances.find((primitive) => primitive.id === id)
          ?.transform,
      );
    }
    for (const id of ["suspension-rear-left", "suspension-rear-right"]) {
      expect(
        swapped.componentInstances.find((instance) => instance.id === id)
          ?.suspensionMount,
      ).toEqual(
        document.componentInstances.find((instance) => instance.id === id)
          ?.suspensionMount,
      );
    }
    // The gearbox keeps its outputs on the axle line.
    const gearboxAt = (candidate: typeof document) =>
      candidate.componentInstances.find(({ id }) => id === "transmission-main")!
        .transform.position;
    expect(gearboxAt(swapped).x).toBe(gearboxAt(document).x);
    expect(gearboxAt(swapped).z).toBe(gearboxAt(document).z);
  }

  // A version without the named mounts leaves those attachments unnamed,
  // and the joints still meet.
  const historical = replaceKartComponentDefinition(
    document,
    "transmission-main",
    "transmission.short-8to1",
    1,
  );
  expect(validateKartAssembly(historical).success).toBe(true);
  for (const id of ["transmission-main", "motor-main", "shock-tower-rear"]) {
    expect(
      getKartInstanceSeat(historical, {
        id,
        kind: id === "shock-tower-rear" ? "primitive" : "component",
      }),
    ).toMatchObject({ snapped: false });
  }
});

test("converts rotation matrices back to the angles that built them", () => {
  let worst = 0;
  for (let index = 0; index < 400; index += 1) {
    const angles = {
      x: ((index * 37) % 360) - 180,
      // Including the gimbal case at ±90°.
      y: index % 50 === 0 ? 90 : index % 50 === 1 ? -90 : ((index * 53) % 180) - 90,
      z: ((index * 71) % 360) - 180,
    };
    const matrix = rotationMatrix(angles);
    const back = rotationMatrix(rotationDegreesFromMatrix(matrix));
    worst = Math.max(worst, ...matrix.map((value, at) => Math.abs(value - back[at])));
  }
  expect(worst).toBeLessThan(1e-7);
});

test("keeps snapped parts snapped when a part is resized", () => {
  const document = createBalancedKartDocument();
  const post = document.primitiveInstances.find(
    ({ id }) => id === "shock-tower-rear",
  )!;
  if (post.shape !== "box") throw new Error("The post is a box.");
  const taller = updateKartPrimitiveGeometry(document, post.id, {
    shape: "box",
    size: { ...post.size, y: post.size.y + 0.004 },
  });
  expect(validateKartAssembly(taller).success).toBe(true);
  for (const selection of [
    { id: "shock-tower-rear", kind: "primitive" },
    { id: "shock-tower-rear-bar", kind: "primitive" },
    { id: "suspension-rear-left", kind: "component" },
  ] as const) {
    expect(getKartInstanceSeat(taller, selection)?.snapped, selection.id).toBe(
      true,
    );
  }
  // The post still stands on the pad, so its bar (and the rear shocks on
  // it) rise by all 4 mm.
  const barY = (candidate: typeof document) =>
    candidate.primitiveInstances.find(({ id }) => id === "shock-tower-rear-bar")!
      .transform.position.y;
  expect(barY(taller) - barY(document)).toBeCloseTo(0.004, 9);

  // A plate too narrow for a footprint leaves that part unsnapped, which the
  // panel says.
  const plate = document.primitiveInstances.find(
    ({ id }) => id === "chassis-plate",
  )!;
  if (plate.shape !== "box") throw new Error("The plate is a box.");
  const narrow = updateKartPrimitiveGeometry(document, plate.id, {
    shape: "box",
    size: { ...plate.size, x: 0.04 },
  });
  expect(
    getKartInstanceSeat(narrow, { id: "battery-main", kind: "component" }),
  ).toMatchObject({ snapped: false });
});

test("undoes a tilt a snapped part's face refuses, in place", () => {
  const document = createBalancedKartDocument();
  const selection = { id: "controller-main", kind: "component" } as const;
  const controller = document.componentInstances.find(
    ({ id }) => id === selection.id,
  )!;
  const tilted = updateKartInstanceTransformAndAttachment(
    document,
    selection,
    {
      ...controller.transform,
      rotationDegrees: { ...controller.transform.rotationDegrees, x: 25 },
    },
    "chassis-plate",
    collectKartDocumentIds(document),
  );
  const after = tilted.componentInstances.find(({ id }) => id === selection.id)!;
  for (const axis of ["x", "y", "z"] as const) {
    expect(after.transform.position[axis]).toBeCloseTo(
      controller.transform.position[axis],
      12,
    );
    expect(after.transform.rotationDegrees[axis]).toBeCloseTo(
      controller.transform.rotationDegrees[axis],
      9,
    );
  }
});

test("snaps a footprint onto a round face wherever all of it fits", () => {
  const document = createBalancedKartDocument();
  const battery = document.componentInstances.find(
    ({ id }) => id === "battery-main",
  )!;
  const plate = document.primitiveInstances.find(
    ({ id }) => id === "chassis-plate",
  )!;
  const definition = getApprovedKartComponent(battery.definition)!;
  const floor = definition.mounts!.find(({ id }) => id === "base")!.position.y;
  // A 70 mm disc whose top is at y = 0.
  const disc = {
    ...structuredClone(plate),
    axis: "y" as const,
    height: 0.01,
    id: "disc",
    radius: 0.07,
    shape: "cylinder" as const,
    transform: {
      position: { x: 0, y: -0.005, z: 0 },
      rotationDegrees: { x: 0, y: 0, z: 0 },
    },
  };
  const at = (x: number, lift: number) => ({
    position: { x, y: -floor + lift, z: 0 },
    rotationDegrees: { x: 0, y: 0, z: 0 },
  });
  const snapAt = (x: number, lift: number) =>
    findKartMountSnap(
      { definition, instance: battery },
      { definition: null, instance: disc },
      at(x, lift),
    );
  // 15 mm off centre (its 95 by 48 mm footprint fits to 18.3 mm), 1 mm up,
  // it drops straight down.
  const off = snapAt(0.015, 0.001);
  expect(off?.childMount).toBe("base");
  expect(off?.transform.position.x).toBeCloseTo(0.015, 12);
  expect(off?.distance).toBeCloseTo(0.001, 12);
  // Further out, it comes in only until its far corners are on the disc.
  const edge = snapAt(0.025, 0)!;
  expect(edge.transform.position.x).toBeLessThan(0.025);
  const corner = Math.hypot(edge.transform.position.x + 0.0475, 0.024);
  expect(corner).toBeCloseTo(0.07, 6);
});

test("turns a snapped part step by step past 90° about its face", () => {
  let document = createBalancedKartDocument();
  const selection = { id: "battery-main", kind: "component" } as const;
  const retainedIds = collectKartDocumentIds(document);
  const battery = () =>
    document.componentInstances.find(({ id }) => id === selection.id)!;
  expect(battery().transform.rotationDegrees.y).toBe(90);
  for (let step = 0; step < 2; step += 1) {
    document = updateKartInstanceTransformAndAttachment(
      document,
      selection,
      {
        ...battery().transform,
        rotationDegrees: {
          ...battery().transform.rotationDegrees,
          y: battery().transform.rotationDegrees.y + 5,
        },
      },
      "chassis-plate",
      retainedIds,
    );
  }
  expect(battery().transform.rotationDegrees).toEqual({ x: 0, y: 100, z: 0 });
  expect(getKartInstanceSeat(document, selection)?.snapped).toBe(true);
});

test("leaves shocks on a resized bar where they stand while their pins fit", () => {
  const document = createBalancedKartDocument();
  const bar = document.primitiveInstances.find(
    ({ id }) => id === "shock-tower-front-bar",
  )!;
  if (bar.shape !== "box") throw new Error("The bar is a box.");
  const thicker = updateKartPrimitiveGeometry(document, bar.id, {
    shape: "box",
    size: { ...bar.size, y: bar.size.y + 0.003 },
  });
  expect(validateKartAssembly(thicker).success).toBe(true);
  for (const id of [
    "suspension-front-left",
    "suspension-front-right",
    "wheel-front-left",
  ]) {
    const before = document.componentInstances.find((item) => item.id === id)!;
    const after = thicker.componentInstances.find((item) => item.id === id)!;
    expect(after.transform, id).toEqual(before.transform);
    expect(after.suspensionMount, id).toEqual(before.suspensionMount);
    expect(
      getKartInstanceSeat(thicker, { id, kind: "component" })?.snapped,
      id,
    ).toBe(true);
  }
});

test("keeps the angles nearest those asked for, within the document's turns", () => {
  // Facing its face needs a small turn back, which keeps Y past 90°.
  const document = createBalancedKartDocument();
  const selection = { id: "battery-main", kind: "component" } as const;
  const battery = document.componentInstances.find(
    ({ id }) => id === selection.id,
  )!;
  const asked = updateKartInstanceTransformAndAttachment(
    document,
    selection,
    { ...battery.transform, rotationDegrees: { x: 3, y: 95, z: 0 } },
    "chassis-plate",
    collectKartDocumentIds(document),
  );
  const angles = asked.componentInstances.find(({ id }) => id === selection.id)!
    .transform.rotationDegrees;
  expect(angles.x).toBeCloseTo(0, 9);
  expect(angles.y).toBeCloseTo(95, 9);
  expect(angles.z).toBeCloseTo(0, 9);
  // At ±90° about Y only X less Z is set, so the Z asked for is kept.
  const locked = rotationDegreesFromMatrix(
    rotationMatrix({ x: 30, y: 90, z: 30 }),
    { x: 30, y: 90, z: 30 },
  );
  expect(locked.x).toBeCloseTo(30, 9);
  expect(locked.y).toBe(90);
  expect(locked.z).toBe(30);
  // Near 360°, a further 5° stays within the document's ±360°.
  const past = rotationDegreesFromMatrix(rotationMatrix({ x: 0, y: 5, z: 0 }), {
    x: 0,
    y: 360,
    z: 0,
  });
  expect(past.y).toBeCloseTo(5, 9);
});

test("refuses a paired resize that would leave a mirror out of place", () => {
  const document = createBalancedKartDocument();
  const plate = document.primitiveInstances.find(
    ({ id }) => id === "chassis-plate",
  )!;
  if (plate.shape !== "box") throw new Error("The plate is a box.");
  // Mirrored boxes on faces 100 and 40 mm long.
  const box = (
    id: string,
    x: number,
    y: number,
    length: number,
    z = 0,
    mirrorOf: string | null = null,
  ) => ({
    ...structuredClone(plate),
    id,
    mirrorOf,
    size: { x: 0.025, y: 0.01, z: length },
    transform: { position: { x, y, z }, rotationDegrees: { x: 0, y: 0, z: 0 } },
  });
  const plateTop = plate.transform.position.y + plate.size.y / 2;
  const leftParent = box("left-parent", -0.05, plateTop + 0.005, 0.1);
  const rightParent = box("right-parent", 0.05, plateTop + 0.005, 0.04);
  const left = box("left-child", -0.05, plateTop + 0.015, 0.02, 0.01);
  const right = box("right-child", 0.05, plateTop + 0.015, 0.019, 0.01, left.id);
  document.primitiveInstances.push(leftParent, rightParent, left, right);
  const ids = collectKartDocumentIds(document);
  const primitive = (id: string) => ({ id, kind: "primitive" }) as const;
  let built = document;
  for (const [child, parent] of [
    [leftParent.id, plate.id],
    [rightParent.id, plate.id],
    [left.id, leftParent.id],
    [right.id, rightParent.id],
  ]) {
    built = attachKartInstance(built, primitive(child), parent, ids);
  }
  expect(validateKartAssembly(built).success).toBe(true);
  // 40 mm long, the right child would have to slide back onto its shorter
  // face, out of its mirror's place, so neither changes.
  const resized = updateKartPrimitiveGeometry(
    built,
    left.id,
    { shape: "box", size: { ...left.size, z: 0.04 } },
    true,
  );
  expect(resized).toBe(built);
});

test("slides a part on the side of a cut tower post to stay on it", () => {
  const document = createBalancedKartDocument();
  const post = document.primitiveInstances.find(
    ({ id }) => id === "shock-tower-rear",
  )!;
  if (post.shape !== "box") throw new Error("The post is a box.");
  const bottom = post.transform.position.y - post.size.y / 2;
  document.primitiveInstances.push({
    ...structuredClone(post),
    id: "side-block",
    mirrorOf: null,
    size: { x: 0.01, y: 0.006, z: post.size.z },
    transform: {
      position: {
        x: post.transform.position.x + post.size.x / 2 + 0.005,
        y: bottom + 0.003,
        z: post.transform.position.z,
      },
      rotationDegrees: { x: 0, y: 0, z: 0 },
    },
  });
  const ids = collectKartDocumentIds(document);
  const selection = { id: "side-block", kind: "primitive" } as const;
  const attached = attachKartInstance(document, selection, post.id, ids);
  expect(getKartInstanceSeat(attached, selection)?.snapped).toBe(true);
  // The 8:1 pad is 3.5 mm higher, so the post is cut from below, past the
  // block's lower edge.
  const swapped = replaceKartComponentDefinition(
    attached,
    "transmission-main",
    "transmission.short-8to1",
  );
  expect(validateKartAssembly(swapped).success).toBe(true);
  expect(getKartInstanceSeat(swapped, selection)?.snapped).toBe(true);
  const cut = swapped.primitiveInstances.find(({ id }) => id === post.id)!;
  if (cut.shape !== "box") throw new Error("The post is a box.");
  const block = swapped.primitiveInstances.find(({ id }) => id === selection.id)!;
  expect(block.transform.position.y - 0.003).toBeGreaterThanOrEqual(
    cut.transform.position.y - cut.size.y / 2 - 1e-9,
  );
});
