import { expect, test } from "@playwright/test";

import { createBalancedKartDocument } from "../src/game/kart/balanced-kart-document";
import { createHandlingKartDocument } from "../src/game/kart/handling-kart-document";
import { createSpeedKartDocument } from "../src/game/kart/speed-kart-document";
import type {
  KartAssemblyDocument,
  KartStructuralAttachment,
} from "../src/game/kart/kart-assembly-document";
import { validateKartAssembly } from "../src/game/kart/kart-assembly-validation";
import { getApprovedKartComponent } from "../src/game/kart/kart-component-registry";
import {
  rotationMatrix,
  subtractVector,
  transformVector,
  transposeMatrix,
  type KartVector,
} from "../src/game/kart/kart-construction-geometry";
import {
  checkKartMountPair,
  findKartAttachmentMounts,
  listKartInstanceMounts,
} from "../src/game/kart/kart-mounting";
import { attachKartInstance } from "../src/game/editor/kart-editor-document";

type Instance =
  | KartAssemblyDocument["componentInstances"][number]
  | KartAssemblyDocument["primitiveInstances"][number];

function instanceOf(document: KartAssemblyDocument, id: string): Instance {
  return [...document.componentInstances, ...document.primitiveInstances].find(
    (instance) => instance.id === id,
  )!;
}

function side(document: KartAssemblyDocument, id: string) {
  const instance = instanceOf(document, id);
  return {
    definition:
      instance.kind === "component"
        ? (getApprovedKartComponent(instance.definition) ?? null)
        : null,
    instance,
  };
}

function attachmentOf(document: KartAssemblyDocument, childId: string) {
  return document.structuralAttachments.find(
    ({ child }) => child.instanceId === childId,
  )!;
}

function mountPoint(document: KartAssemblyDocument, id: string, mount: string) {
  const { definition, instance } = side(document, id);
  return listKartInstanceMounts(instance, definition).find(
    (candidate) => candidate.id === mount,
  )!.point;
}

/** Moves an attachment's point to `at` and names its mounts. */
function attachAt(
  attachment: KartStructuralAttachment,
  document: KartAssemblyDocument,
  at: KartVector,
  mounts: { child: string; parent: string },
) {
  const local = (id: string) => {
    const instance = instanceOf(document, id);
    return transformVector(
      transposeMatrix(rotationMatrix(instance.transform.rotationDegrees)),
      subtractVector(at, instance.transform.position),
    );
  };
  attachment.child.anchor = local(attachment.child.instanceId);
  attachment.parent.anchor = local(attachment.parent.instanceId);
  attachment.child.mount = mounts.child;
  attachment.parent.mount = mounts.parent;
}

function issueCodes(document: KartAssemblyDocument) {
  const result = validateKartAssembly(document);
  return result.success ? [] : result.issues.map(({ code }) => code);
}

/** Names every attachment's mounts that meet as the kart stands. */
function nameFoundMounts(document: KartAssemblyDocument) {
  const unnamed: string[] = [];
  for (const attachment of document.structuralAttachments) {
    const found = findKartAttachmentMounts(
      attachment,
      side(document, attachment.parent.instanceId),
      side(document, attachment.child.instanceId),
    );
    if (found) {
      attachment.parent.mount = found.parent;
      attachment.child.mount = found.child;
    } else {
      unnamed.push(attachment.child.instanceId);
    }
  }
  return unnamed;
}

const EQUIPMENT = [
  "battery-main",
  "brakes-main",
  "controller-main",
  "motor-main",
  "steering-main",
  "transmission-main",
];

for (const [name, create] of [
  ["Balanced", createBalancedKartDocument],
  ["Speed", createSpeedKartDocument],
  ["Handling", createHandlingKartDocument],
] as const) {
  test(`${name}: its chassis, suspension, and wheels meet at named mounts as built`, () => {
    const document = create();
    expect(document.schemaVersion).toBe(3);
    expect(
      document.structuralAttachments.every(
        ({ child, parent }) => child.mount === null && parent.mount === null,
      ),
    ).toBe(true);

    // Only the version 1 equipment, which declares no mounts, stays unnamed.
    expect(nameFoundMounts(document).sort()).toEqual(EQUIPMENT);
    expect(issueCodes(document)).toEqual([]);

    const names = (childId: string) => {
      const { child, parent } = attachmentOf(document, childId);
      return [child.mount, parent.mount];
    };
    expect(names("arm-mount-front-left")).toEqual(["bottom", "top"]);
    expect(names("shock-tower-rear")).toEqual(["bottom", "top"]);
    expect(names("shock-tower-rear-bar")).toEqual(["bottom", "top"]);
    expect(names("suspension-front-right")).toEqual(["chassis-anchor", "pin"]);
    expect(names("wheel-rear-left")).toEqual(["hub", "hub-anchor"]);
    expect(names("top-deck")).toEqual(["front", "rear"]);
    expect(names("front-bumper")).toEqual(["rear", "front"]);
    expect(names("rear-bumper")).toEqual(["front", "rear"]);
  });
}

test("version 2 equipment sits on the plate by its base footprint", () => {
  const document = createBalancedKartDocument();
  for (const id of [
    "battery-main",
    "brakes-main",
    "controller-main",
    "steering-main",
  ]) {
    const instance = document.componentInstances.find(
      (candidate) => candidate.id === id,
    )!;
    instance.definition.version = 2;
  }
  nameFoundMounts(document);
  for (const id of ["battery-main", "brakes-main", "controller-main", "steering-main"]) {
    const { child, parent } = attachmentOf(document, id);
    expect([id, child.mount, parent.mount]).toEqual([id, "base", "top"]);
  }
  expect(issueCodes(document)).toEqual([]);
});

/**
 * Balanced with the version 2 gearbox on the plate by its base, the motor
 * bolted to its plate, and a tower standing on its pad.
 */
function createMountedDrivetrain() {
  const document = createBalancedKartDocument();
  const gearbox = document.componentInstances.find(
    ({ id }) => id === "transmission-main",
  )!;
  gearbox.definition.version = 2;
  attachAt(
    attachmentOf(document, "transmission-main"),
    document,
    mountPoint(document, "transmission-main", "base"),
    { child: "base", parent: "top" },
  );

  const motor = document.componentInstances.find(({ id }) => id === "motor-main")!;
  motor.definition.version = 2;
  const plate = mountPoint(document, "transmission-main", "motor-plate");
  // Turned so its shaft points to -X; its face is 25 mm ahead of its centre.
  motor.transform = {
    position: { x: plate.x + 0.025, y: plate.y, z: plate.z },
    rotationDegrees: { x: 0, y: 90, z: 0 },
  };
  const motorAttachment = attachmentOf(document, "motor-main");
  motorAttachment.parent.instanceId = "transmission-main";
  attachAt(motorAttachment, document, plate, {
    child: "motor-face",
    parent: "motor-plate",
  });

  const pad = mountPoint(document, "transmission-main", "tower-pad");
  const tower = structuredClone(
    document.primitiveInstances.find(({ id }) => id === "shock-tower-rear")!,
  );
  if (tower.shape !== "box") throw new Error("The tower is a box.");
  tower.id = "gearbox-tower";
  tower.size = { x: 0.03, y: 0.02, z: 0.004 };
  tower.transform.position = { x: pad.x, y: pad.y + 0.01, z: pad.z };
  document.primitiveInstances.push(tower);
  document.structuralAttachments.push({
    child: { anchor: { x: 0, y: 0, z: 0 }, instanceId: tower.id, mount: null },
    id: "mount-gearbox-tower",
    parent: {
      anchor: { x: 0, y: 0, z: 0 },
      instanceId: "transmission-main",
      mount: null,
    },
  });
  attachAt(attachmentOf(document, tower.id), document, pad, {
    child: "bottom",
    parent: "tower-pad",
  });
  return document;
}

test("a motor bolts to a gearbox's plate, and a tower stands on its pad", () => {
  const document = createMountedDrivetrain();
  expect(issueCodes(document)).toEqual([]);
  for (const id of ["transmission-main", "motor-main", "gearbox-tower"]) {
    const attachment = attachmentOf(document, id);
    expect(
      findKartAttachmentMounts(
        attachment,
        side(document, attachment.parent.instanceId),
        side(document, id),
      ),
    ).toEqual({
      child: attachment.child.mount,
      parent: attachment.parent.mount,
    });
  }
});

test("rejects mounts that do not meet", () => {
  // A motor a millimetre off its plate, or turned to face away.
  let document = createMountedDrivetrain();
  const motor = () =>
    document.componentInstances.find(({ id }) => id === "motor-main")!;
  const motorAttachment = () => attachmentOf(document, "motor-main");
  motor().transform.position.x += 0.001;
  motorAttachment().child.anchor.z -= 0.001;
  expect(issueCodes(document)).toContain("separated-mounts");

  document = createMountedDrivetrain();
  motor().transform.rotationDegrees.y = -90;
  motor().transform.position.x -= 0.05;
  motorAttachment().child.anchor = { x: 0, y: 0, z: -0.025 };
  expect(issueCodes(document)).toEqual(["misaligned-mounts"]);

  // A tower slid off its pad, though still on the gearbox's top.
  document = createMountedDrivetrain();
  const tower = document.primitiveInstances.find(
    ({ id }) => id === "gearbox-tower",
  )!;
  tower.transform.position.z += 0.003;
  attachmentOf(document, "gearbox-tower").child.anchor.z -= 0.003;
  expect(issueCodes(document)).toEqual(["mount-outside-face"]);
});

test("a base footprint rests wholly on a structural face", () => {
  const document = createBalancedKartDocument();
  const battery = document.componentInstances.find(
    ({ id }) => id === "battery-main",
  )!;
  battery.definition.version = 2;
  nameFoundMounts(document);
  expect(issueCodes(document)).toEqual([]);

  // Slid until it overhangs the plate's edge: the footprint's centre still
  // sits on the plate.
  const overhang = structuredClone(document);
  const moved = overhang.componentInstances.find(
    ({ id }) => id === "battery-main",
  )!;
  moved.transform.position.x -= 0.03;
  attachmentOf(overhang, "battery-main").parent.anchor.x -= 0.03;
  expect(issueCodes(overhang)).toEqual(["mount-outside-face"]);

  // A footprint cannot sit on a bumper, which is not structure.
  const onBumper = structuredClone(document);
  const bumper = onBumper.primitiveInstances.find(
    ({ id }) => id === "rear-bumper",
  )!;
  bumper.role = "structure";
  const attachment = attachmentOf(onBumper, "battery-main");
  const top = mountPoint(onBumper, "rear-bumper", "top");
  const batteryOnBumper = onBumper.componentInstances.find(
    ({ id }) => id === "battery-main",
  )!;
  batteryOnBumper.transform.rotationDegrees.y = 0;
  batteryOnBumper.transform.position = { x: top.x, y: top.y + 0.013, z: top.z };
  attachment.parent.instanceId = "rear-bumper";
  attachAt(attachment, onBumper, top, { child: "base", parent: "top" });
  // As structure, the bumper's 90 × 30 mm top is too small for the
  // battery; as a guard it takes no footprint at all.
  expect(issueCodes(onBumper)).toContain("mount-outside-face");
  bumper.role = "guard";
  expect(issueCodes(onBumper)).toContain("unsupported-mount-face");
});

test("rejects unnamed, unknown, and incompatible mounts", () => {
  const document = createBalancedKartDocument();
  nameFoundMounts(document);
  const deck = attachmentOf(document, "top-deck");

  const halfNamed = structuredClone(document);
  attachmentOf(halfNamed, "top-deck").parent.mount = null;
  expect(issueCodes(halfNamed)).toEqual(["incomplete-mount-names"]);

  const unknown = structuredClone(document);
  attachmentOf(unknown, "top-deck").parent.mount = "motor-plate";
  expect(issueCodes(unknown)).toEqual(["unknown-mount"]);

  const incompatible = structuredClone(document);
  attachmentOf(incompatible, "top-deck").parent.mount = "pin";
  expect(issueCodes(incompatible)).toEqual(["incompatible-mounts"]);

  // Faces that point the same way do not meet.
  const sameWay = structuredClone(document);
  attachmentOf(sameWay, "top-deck").parent.mount = "front";
  expect(issueCodes(sameWay)).toEqual(["misaligned-mounts"]);
  expect(deck.parent.mount).toBe("rear");
});

test("documents from schema 2 validate with no mounts named", () => {
  const document = createBalancedKartDocument();
  const version2 = {
    ...document,
    schemaVersion: 2,
    structuralAttachments: document.structuralAttachments.map(
      ({ child, id, parent }) => ({
        child: { anchor: child.anchor, instanceId: child.instanceId },
        id,
        parent: { anchor: parent.anchor, instanceId: parent.instanceId },
      }),
    ),
  };
  const result = validateKartAssembly(version2);
  expect(result.success).toBe(true);
  if (result.success) expect(result.assembly.document).toEqual(document);
});

function mountOf(instance: Instance, id: string) {
  const definition =
    instance.kind === "component"
      ? (getApprovedKartComponent(instance.definition) ?? null)
      : null;
  return listKartInstanceMounts(instance, definition).find(
    (mount) => mount.id === id,
  )!;
}

test("names a rotated primitive's faces in its own frame", () => {
  const document = createBalancedKartDocument();
  const deck = structuredClone(
    document.primitiveInstances.find(({ id }) => id === "top-deck")!,
  );
  deck.transform.rotationDegrees = { x: 0, y: 90, z: 0 };
  const right = mountOf(deck, "right");
  expect(right.normal!.x).toBeCloseTo(0, 12);
  expect(right.normal!.z).toBeCloseTo(-1, 12);
  if (deck.shape !== "box") throw new Error("The deck is a box.");
  expect(right.point.z).toBeCloseTo(
    deck.transform.position.z - deck.size.x / 2,
    12,
  );
});

test("a footprint rests on a cylinder's end within its disc", () => {
  const document = createBalancedKartDocument();
  const battery = structuredClone(
    document.componentInstances.find(({ id }) => id === "battery-main")!,
  );
  battery.definition.version = 2;
  battery.transform = {
    position: { x: 0, y: 0.2 + 0.005 + 0.013, z: 0 },
    rotationDegrees: { x: 0, y: 0, z: 0 },
  };
  const post = {
    ...structuredClone(document.primitiveInstances[0]),
    axis: "y" as const,
    height: 0.01,
    id: "post",
    radius: 0.06,
    shape: "cylinder" as const,
    transform: {
      position: { x: 0, y: 0.2, z: 0 },
      rotationDegrees: { x: 0, y: 0, z: 0 },
    },
  } as Instance;
  const top = { x: 0, y: 0.205, z: 0 };
  expect(
    checkKartMountPair(mountOf(battery, "base"), mountOf(post, "top"), top),
  ).toBeNull();
  // The battery's 95 x 48 mm footprint reaches 53.3 mm from its centre.
  (post as { radius: number }).radius = 0.053;
  expect(
    checkKartMountPair(mountOf(battery, "base"), mountOf(post, "top"), top)
      ?.code,
  ).toBe("mount-outside-face");
});

test("a shock's eye and a wheel's hub must be at the attachment point", () => {
  const document = createBalancedKartDocument();
  const suspension = instanceOf(document, "suspension-front-left");
  const bar = instanceOf(document, "shock-tower-front-bar");
  const deck = instanceOf(document, "top-deck");
  const eye = mountOf(suspension, "chassis-anchor");
  expect(checkKartMountPair(eye, mountOf(bar, "pin"), eye.point)).toBeNull();
  expect(checkKartMountPair(eye, mountOf(deck, "pin"), eye.point)?.code).toBe(
    "separated-mounts",
  );

  const wheel = instanceOf(document, "wheel-front-left");
  const hub = mountOf(wheel, "hub");
  const anchor = mountOf(suspension, "hub-anchor");
  expect(checkKartMountPair(hub, anchor, hub.point)).toBeNull();
  const moved = structuredClone(wheel);
  moved.transform.position.x += 0.001;
  expect(
    checkKartMountPair(mountOf(moved, "hub"), anchor, anchor.point)?.code,
  ).toBe("separated-mounts");
});

test("a shock mounts only on a pin through structure", () => {
  const document = createBalancedKartDocument();
  nameFoundMounts(document);
  const bar = document.primitiveInstances.find(
    ({ id }) => id === "shock-tower-front-bar",
  )!;
  bar.role = "trim";
  expect(issueCodes(document)).toContain("unsupported-mount-face");
});

test("a footprint tilted off its face does not rest on it", () => {
  const document = createBalancedKartDocument();
  const battery = document.componentInstances.find(
    ({ id }) => id === "battery-main",
  )!;
  battery.definition.version = 2;
  nameFoundMounts(document);
  expect(issueCodes(document)).toEqual([]);
  // Tilted 0.0024°: the faces still read as opposed, but the footprint's
  // ends lift about 2 µm off the plate.
  battery.transform.rotationDegrees.x = 0.0024;
  expect(issueCodes(document)).toEqual(["mount-outside-face"]);
});

test("names nothing where an attachment's two ends are apart", () => {
  const document = createBalancedKartDocument();
  const attachment = attachmentOf(document, "top-deck");
  attachment.child.anchor.y += 0.001;
  expect(
    findKartAttachmentMounts(
      attachment,
      side(document, "shock-tower-front"),
      side(document, "top-deck"),
    ),
  ).toBeNull();
});

test("reports a naming problem at the attachment end at fault", () => {
  const document = createBalancedKartDocument();
  nameFoundMounts(document);
  const index = document.structuralAttachments.findIndex(
    ({ child }) => child.instanceId === "top-deck",
  );
  document.structuralAttachments[index].child.mount = "base";
  const result = validateKartAssembly(document);
  expect(result.success).toBe(false);
  if (!result.success) {
    expect(result.issues).toEqual([
      expect.objectContaining({
        code: "unknown-mount",
        path: ["structuralAttachments", index, "child", "mount"],
      }),
    ]);
  }
});

test("the editor keeps named mounts while a moved part still meets them", () => {
  const document = createBalancedKartDocument();
  const battery = document.componentInstances.find(
    ({ id }) => id === "battery-main",
  )!;
  battery.definition.version = 2;
  nameFoundMounts(document);

  const nudged = structuredClone(document);
  nudged.componentInstances.find(
    ({ id }) => id === "battery-main",
  )!.transform.position.x += 0.005;
  const kept = attachKartInstance(
    nudged,
    { id: "battery-main", kind: "component" },
    "chassis-plate",
    new Set(),
  );
  const keptAttachment = attachmentOf(kept, "battery-main");
  expect([keptAttachment.child.mount, keptAttachment.parent.mount]).toEqual([
    "base",
    "top",
  ]);
  expect(issueCodes(kept)).toEqual([]);

  // Over the plate's edge the footprint no longer rests on it.
  nudged.componentInstances.find(
    ({ id }) => id === "battery-main",
  )!.transform.position.x -= 0.035;
  const dropped = attachmentOf(
    attachKartInstance(
      nudged,
      { id: "battery-main", kind: "component" },
      "chassis-plate",
      new Set(),
    ),
    "battery-main",
  );
  expect([dropped.child.mount, dropped.parent.mount]).toEqual([null, null]);
});

test("the editor keeps drivetrain mounts named across a re-attach", () => {
  const document = createMountedDrivetrain();
  const reattach = (
    edited: KartAssemblyDocument,
    id: string,
    parentId: string,
  ) => {
    const attachment = attachmentOf(
      attachKartInstance(
        edited,
        { id, kind: id === "gearbox-tower" ? "primitive" : "component" },
        parentId,
        new Set(),
      ),
      id,
    );
    return [attachment.child.mount, attachment.parent.mount];
  };
  expect(reattach(document, "transmission-main", "chassis-plate")).toEqual([
    "base",
    "top",
  ]);
  expect(reattach(document, "motor-main", "transmission-main")).toEqual([
    "motor-face",
    "motor-plate",
  ]);
  expect(reattach(document, "gearbox-tower", "transmission-main")).toEqual([
    "bottom",
    "tower-pad",
  ]);

  // A gearbox slid along the plate keeps its footprint on it.
  const slid = structuredClone(document);
  slid.componentInstances.find(
    ({ id }) => id === "transmission-main",
  )!.transform.position.z -= 0.005;
  expect(reattach(slid, "transmission-main", "chassis-plate")).toEqual([
    "base",
    "top",
  ]);
});
