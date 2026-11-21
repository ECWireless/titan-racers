import type {
  KartAssemblyComponentInstance,
  KartAssemblyDocument,
  KartAssemblyPrimitiveInstance,
  KartStructuralAttachment,
} from "../kart/kart-assembly-document";
import {
  defaultKartComponentVisualColor,
  defaultKartPrimitiveVisualColor,
  parseKartAssemblyDocument,
} from "../kart/kart-assembly-document";
import {
  addVector,
  buildComponentMassElements,
  buildPrimitiveMassElement,
  combineBounds,
  multiplyMatrix,
  rotationMatrix,
  scaleVector,
  subtractVector,
  transformVector,
  transposeMatrix,
  type KartBounds,
  type KartVector,
} from "../kart/kart-construction-geometry";
import {
  APPROVED_COMPONENTS_BY_CATEGORY,
  getApprovedKartComponent,
  getLatestApprovedKartComponent,
  type KartComponentCategory,
} from "../kart/kart-component-registry";
import {
  checkKartAttachmentMounts,
  findKartAttachmentMounts,
  getKartAttachmentPoint,
  listKartInstanceMounts,
  type KartMountSide,
} from "../kart/kart-mounting";
import {
  findKartMountSnap,
  isKartMountLocked,
  moveSuspensionMount,
  rotationDegreesFromMatrix,
  seatKartMount,
  type KartInstanceTransform,
} from "../kart/kart-mount-snapping";
import { resolveApprovedSuspensionMount } from "../kart/kart-suspension-mounting";

export type KartEditorSelection = {
  id: string;
  kind: "component" | "primitive";
};

export type KartPrimitivePreset =
  "box-structure" | "box-body" | "cylinder-guard";

const ZERO_ROTATION = { x: 0, y: 0, z: 0 } as const;
export const KART_EDITOR_ATTACHMENT_TOLERANCE_METERS = 0.01;

function copyDocument(document: KartAssemblyDocument): KartAssemblyDocument {
  return structuredClone(document);
}

function uniqueId(
  document: KartAssemblyDocument,
  base: string,
  retainedIds: ReadonlySet<string>,
) {
  const issued = collectKartDocumentIds(document, retainedIds);
  if (!issued.has(base)) return base;
  for (let suffix = 2; suffix <= 999; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!issued.has(candidate)) return candidate;
  }
  throw new Error("No available stable ID remains for this item.");
}

function collectStructuralDescendants(
  document: KartAssemblyDocument,
  instanceId: string,
) {
  const descendants = new Set<string>();
  const pending = [instanceId];
  while (pending.length > 0) {
    const parentId = pending.pop()!;
    for (const attachment of document.structuralAttachments) {
      if (attachment.parent.instanceId !== parentId) continue;
      const childId = attachment.child.instanceId;
      if (descendants.has(childId)) continue;
      descendants.add(childId);
      pending.push(childId);
    }
  }
  descendants.delete(instanceId);
  return descendants;
}

function areStructurallyNested(
  document: KartAssemblyDocument,
  firstId: string,
  secondId: string,
) {
  return (
    collectStructuralDescendants(document, firstId).has(secondId) ||
    collectStructuralDescendants(document, secondId).has(firstId)
  );
}

export function getKartMirrorCounterpartIds(
  document: KartAssemblyDocument,
  selection: KartEditorSelection,
) {
  const instance = getKartEditorInstance(document, selection);
  if (!instance) return [];
  const collection =
    instance.kind === "component"
      ? document.componentInstances
      : document.primitiveInstances;
  const originalId = instance.mirrorOf ?? instance.id;
  return collection
    .filter(
      (candidate) =>
        candidate.id !== instance.id &&
        (candidate.id === originalId || candidate.mirrorOf === originalId),
    )
    .map(({ id }) => id);
}

export function canAlignKartMirrorPair(
  document: KartAssemblyDocument,
  selection: KartEditorSelection,
) {
  const instance = getKartEditorInstance(document, selection);
  if (!instance) return false;
  const counterpartIds = getKartMirrorCounterpartIds(document, selection);
  return (
    counterpartIds.length > 0 &&
    counterpartIds.every(
      (counterpartId) =>
        !areStructurallyNested(document, instance.id, counterpartId),
    )
  );
}

function attachmentRejectionReason(
  document: KartAssemblyDocument,
  childSelection: KartEditorSelection,
  parentId: string,
) {
  const child = getKartEditorInstance(document, childSelection);
  const parent = [
    ...document.componentInstances,
    ...document.primitiveInstances,
  ].find(({ id }) => id === parentId);
  if (!child || !parent || child.id === parent?.id) {
    return "Choose a different existing parent instance.";
  }
  if (collectStructuralDescendants(document, child.id).has(parent.id)) {
    return "A part cannot be attached beneath one of its descendants.";
  }

  const parentByChild = new Map(
    document.structuralAttachments
      .filter(({ child: endpoint }) => endpoint.instanceId !== child.id)
      .map((attachment) => [
        attachment.child.instanceId,
        attachment.parent.instanceId,
      ]),
  );
  parentByChild.set(child.id, parent.id);
  const isAncestor = (ancestorId: string, descendantId: string) => {
    const visited = new Set<string>();
    let currentId: string | undefined = descendantId;
    while (currentId && parentByChild.has(currentId)) {
      if (visited.has(currentId)) return true;
      visited.add(currentId);
      currentId = parentByChild.get(currentId);
      if (currentId === ancestorId) return true;
    }
    return false;
  };
  for (const instance of [
    ...document.componentInstances,
    ...document.primitiveInstances,
  ]) {
    if (
      instance.mirrorOf &&
      (isAncestor(instance.id, instance.mirrorOf) ||
        isAncestor(instance.mirrorOf, instance.id))
    ) {
      return "Mirrored counterparts cannot be nested in the same structural branch.";
    }
  }
  return null;
}

export function canAttachKartInstanceTo(
  document: KartAssemblyDocument,
  childSelection: KartEditorSelection,
  parentId: string,
) {
  return attachmentRejectionReason(document, childSelection, parentId) === null;
}

export function collectKartDocumentIds(
  document: KartAssemblyDocument,
  retainedIds: Iterable<string> = [],
) {
  return new Set([
    ...retainedIds,
    ...document.componentInstances.map(({ id }) => id),
    ...document.primitiveInstances.map(({ id }) => id),
    ...document.connections.map(({ id }) => id),
    ...document.structuralAttachments.map(({ id }) => id),
  ]);
}

export function getKartEditorInstance(
  document: KartAssemblyDocument,
  selection: KartEditorSelection | null,
) {
  if (!selection) return null;
  return selection.kind === "component"
    ? (document.componentInstances.find(({ id }) => id === selection.id) ??
        null)
    : (document.primitiveInstances.find(({ id }) => id === selection.id) ??
        null);
}

export function reconcileKartEditorSelection(
  document: KartAssemblyDocument,
  selection: KartEditorSelection | null,
) {
  return getKartEditorInstance(document, selection) ? selection : null;
}

export function updateKartIdentity(
  document: KartAssemblyDocument,
  values: Partial<
    Pick<
      KartAssemblyDocument,
      "name" | "practicalDescriptor" | "visualIdentity"
    >
  >,
) {
  return parseKartAssemblyDocument({ ...document, ...values });
}

export function updateKartInstanceVisualColor(
  document: KartAssemblyDocument,
  selection: KartEditorSelection,
  visualColor: string,
) {
  const key =
    selection.kind === "component"
      ? "componentInstances"
      : "primitiveInstances";
  return parseKartAssemblyDocument({
    ...document,
    [key]: document[key].map((instance) =>
      instance.id === selection.id ? { ...instance, visualColor } : instance,
    ),
  });
}

function applyInstanceTransform(
  instance: KartAssemblyComponentInstance | KartAssemblyPrimitiveInstance,
  transform: KartAssemblyComponentInstance["transform"],
) {
  if (instance.kind === "component" && instance.suspensionMount) {
    instance.suspensionMount = moveSuspensionMount(
      instance.suspensionMount,
      instance.transform,
      transform,
    );
  }
  instance.transform = transform;
}

function applyTransformWithDescendants(
  document: KartAssemblyDocument,
  instance: KartAssemblyComponentInstance | KartAssemblyPrimitiveInstance,
  transform: KartAssemblyComponentInstance["transform"],
  movedIds: Set<string>,
) {
  if (movedIds.has(instance.id)) return;
  const previousTransform = structuredClone(instance.transform);
  applyInstanceTransform(instance, transform);
  movedIds.add(instance.id);

  const previousRotation = rotationMatrix(previousTransform.rotationDegrees);
  const nextRotation = rotationMatrix(transform.rotationDegrees);
  const rotationDelta = multiplyMatrix(
    nextRotation,
    transposeMatrix(previousRotation),
  );
  const instances = new Map(
    [...document.componentInstances, ...document.primitiveInstances].map(
      (candidate) => [candidate.id, candidate],
    ),
  );

  for (const attachment of document.structuralAttachments) {
    if (attachment.parent.instanceId !== instance.id) continue;
    const child = instances.get(attachment.child.instanceId);
    if (!child || movedIds.has(child.id)) continue;
    const previousChildTransform = structuredClone(child.transform);
    const childLocalPosition = transformVector(
      transposeMatrix(previousRotation),
      subtractVector(
        previousChildTransform.position,
        previousTransform.position,
      ),
    );
    const nextChildTransform = {
      position: addVector(
        transformVector(nextRotation, childLocalPosition),
        transform.position,
      ),
      rotationDegrees: rotationDegreesFromMatrix(
        multiplyMatrix(
          rotationDelta,
          rotationMatrix(previousChildTransform.rotationDegrees),
        ),
        previousChildTransform.rotationDegrees,
      ),
    };
    applyTransformWithDescendants(
      document,
      child,
      nextChildTransform,
      movedIds,
    );
  }
}

export function updateKartInstanceTransform(
  document: KartAssemblyDocument,
  selection: KartEditorSelection,
  transform: KartAssemblyComponentInstance["transform"],
  mirrorPair = false,
) {
  const next = copyDocument(document);
  const collection: Array<
    KartAssemblyComponentInstance | KartAssemblyPrimitiveInstance
  > =
    selection.kind === "component"
      ? next.componentInstances
      : next.primitiveInstances;
  const instance = collection.find(({ id }) => id === selection.id);
  if (!instance) return document;
  const originalId = instance.mirrorOf ?? instance.id;
  const movedIds = new Set<string>();
  applyTransformWithDescendants(next, instance, transform, movedIds);

  if (mirrorPair) {
    const counterpart = collection.find(
      (candidate) =>
        candidate.id !== instance.id &&
        (candidate.id === originalId || candidate.mirrorOf === originalId),
    );
    if (
      counterpart &&
      !areStructurallyNested(next, instance.id, counterpart.id)
    ) {
      applyTransformWithDescendants(
        next,
        counterpart,
        mirrorKartTransform(transform),
        movedIds,
      );
    }
  }

  return parseKartAssemblyDocument(next);
}

export function nudgeKartInstance(
  document: KartAssemblyDocument,
  selection: KartEditorSelection,
  axis: keyof KartVector,
  amount: number,
  mirrorPair = false,
) {
  const instance = getKartEditorInstance(document, selection);
  if (!instance) return document;
  return updateKartInstanceTransform(
    document,
    selection,
    {
      ...instance.transform,
      position: {
        ...instance.transform.position,
        [axis]: instance.transform.position[axis] + amount,
      },
    },
    mirrorPair,
  );
}

export function updateKartPrimitiveGeometry(
  document: KartAssemblyDocument,
  instanceId: string,
  values:
    | { shape: "box"; size: KartVector }
    | { height: number; radius: number; shape: "cylinder" },
  mirrorPair = false,
) {
  const selected = document.primitiveInstances.find(
    (primitive) => primitive.id === instanceId,
  );
  const originalId = selected?.mirrorOf ?? selected?.id;
  const resized: string[] = [];
  const next = copyDocument({
    ...document,
    primitiveInstances: document.primitiveInstances.map((primitive) => {
      const belongsToPair =
        mirrorPair &&
        originalId !== undefined &&
        (primitive.id === originalId || primitive.mirrorOf === originalId);
      if (
        (!belongsToPair && primitive.id !== instanceId) ||
        primitive.shape !== values.shape
      ) {
        return primitive;
      }
      resized.push(primitive.id);
      return values.shape === "box"
        ? { ...primitive, size: values.size }
        : {
            ...primitive,
            height: values.height,
            radius: values.radius,
          };
    }),
  });
  // A resized part stays snapped: it keeps its seat on its parent, and the
  // parts snapped to its faces move with them.
  for (const id of resized) reseatAround(next, id);
  // Resized together, a mirrored pair stays mirrored, or neither changes.
  if (mirrorPair && !keepsMirrorsAligned(document, next, new Set(resized))) {
    return document;
  }
  return parseKartAssemblyDocument(next);
}

/** Seats a named attachment's child again from where it stands. */
function reseatAttachment(
  document: KartAssemblyDocument,
  attachment: KartStructuralAttachment,
) {
  const child = findKartEditorInstance(document, attachment.child.instanceId);
  const parent = findKartEditorInstance(document, attachment.parent.instanceId);
  if (
    !child ||
    !parent ||
    attachment.child.mount === null ||
    attachment.parent.mount === null
  ) {
    return;
  }
  const seat = seatKartMount(
    mountSide(child),
    mountSide(parent),
    attachment.child.mount,
    attachment.parent.mount,
    child.transform,
    attachment.child.anchor,
  );
  if (!seat) return;
  // Already seated, it stays exactly where it is.
  if (seat.distance > 1e-12 || seat.turn > 1e-12) {
    applyTransformWithDescendants(
      document,
      child,
      seat.transform,
      new Set([parent.id]),
    );
  }
  attachment.child.anchor = localPoint(child.transform, seat.point);
  attachment.parent.anchor = localPoint(parent.transform, seat.point);
}

/**
 * Seats again, each from where it stands, the named attachments a change to
 * part `id` may have parted: the part on its parent, then the parts on it.
 * Whatever hangs from a part that moves moves with it. A pair that can no
 * longer meet is left for validation to report.
 */
function reseatAround(document: KartAssemblyDocument, id: string) {
  const reseat = (attachment: KartStructuralAttachment) =>
    reseatAttachment(document, attachment);
  const own = document.structuralAttachments.find(
    ({ child }) => child.instanceId === id,
  );
  if (own) {
    // A shock on its pin or a wheel on its hub stays where it stood while
    // its part moves, unless its pin or hub has left it.
    const held = document.structuralAttachments.flatMap((attachment) => {
      if (attachment.parent.instanceId !== id) return [];
      const child = findKartEditorInstance(document, attachment.child.instanceId);
      const kind = child
        ? listKartInstanceMounts(child, mountSide(child).definition).find(
            ({ id: mount }) => mount === attachment.child.mount,
          )?.kind
        : undefined;
      return child && kind && isKartMountLocked(kind)
        ? [{ child, transform: structuredClone(child.transform) }]
        : [];
    });
    reseat(own);
    for (const { child, transform } of held) {
      applyTransformWithDescendants(document, child, transform, new Set([id]));
    }
  }
  for (const attachment of document.structuralAttachments) {
    if (attachment.parent.instanceId === id) reseat(attachment);
  }
}

/** Top face of the structural root, or the original chassis top without one. */
function chassisTopY(document: KartAssemblyDocument) {
  const children = new Set(
    document.structuralAttachments.map(({ child }) => child.instanceId),
  );
  const root = document.primitiveInstances.find(
    ({ id, role }) => role === "structure" && !children.has(id),
  );
  if (!root) return 0.118;
  const halfHeight =
    root.shape === "box"
      ? root.size.y / 2
      : root.axis === "y"
        ? root.height / 2
        : root.radius;
  return root.transform.position.y + halfHeight;
}

export function addKartPrimitive(
  document: KartAssemblyDocument,
  preset: KartPrimitivePreset,
  retainedIds: ReadonlySet<string>,
) {
  const id = uniqueId(document, preset, retainedIds);
  const common = {
    collision: preset === "box-body" ? ("none" as const) : ("solid" as const),
    construction:
      preset === "box-body"
        ? { mode: "shell" as const, thickness: 0.001 }
        : { mode: "solid" as const },
    id,
    kind: "primitive" as const,
    material:
      preset === "box-body"
        ? { id: "material.polycarbonate-shell", version: 1 }
        : preset === "cylinder-guard"
          ? { id: "material.steel", version: 1 }
          : { id: "material.structural-aluminum", version: 1 },
    mirrorOf: null,
    role:
      preset === "box-body"
        ? ("bodywork" as const)
        : preset === "cylinder-guard"
          ? ("guard" as const)
          : ("structure" as const),
    transform: {
      position: {
        x: 0,
        // Rest on the chassis, within attachment reach.
        y:
          chassisTopY(document) +
          (preset === "box-body"
            ? 0.03
            : preset === "cylinder-guard"
              ? 0.012
              : 0.01),
        z: 0,
      },
      rotationDegrees: { ...ZERO_ROTATION },
    },
    visualColor: defaultKartPrimitiveVisualColor(
      preset === "box-body"
        ? "bodywork"
        : preset === "cylinder-guard"
          ? "guard"
          : "structure",
      document.visualIdentity,
    ),
  };
  const primitive: KartAssemblyPrimitiveInstance =
    preset === "cylinder-guard"
      ? {
          ...common,
          axis: "z",
          height: 0.18,
          radius: 0.012,
          shape: "cylinder",
        }
      : {
          ...common,
          shape: "box",
          size:
            preset === "box-body"
              ? { x: 0.2, y: 0.06, z: 0.18 }
              : { x: 0.2, y: 0.02, z: 0.2 },
        };
  const next = parseKartAssemblyDocument({
    ...document,
    primitiveInstances: [...document.primitiveInstances, primitive],
  });
  return {
    document: next,
    selection: { id, kind: "primitive" } satisfies KartEditorSelection,
  };
}

export function addKartComponent(
  document: KartAssemblyDocument,
  category: KartComponentCategory,
  retainedIds: ReadonlySet<string>,
) {
  const definition = APPROVED_COMPONENTS_BY_CATEGORY[category][0];
  if (!definition) {
    throw new Error(`No approved ${category} component is available.`);
  }
  const id = uniqueId(document, category, retainedIds);
  const position = { x: 0, y: 0.15, z: 0 };
  const instance: KartAssemblyComponentInstance = {
    definition: { id: definition.id, version: definition.version },
    id,
    kind: "component",
    mirrorOf: null,
    suspensionMount: null,
    transform: {
      position,
      rotationDegrees: { ...ZERO_ROTATION },
    },
    visualColor: defaultKartComponentVisualColor(
      definition.id,
      document.visualIdentity,
    ),
  };
  if (definition.category === "suspension") {
    instance.suspensionMount = resolveApprovedSuspensionMount(
      instance,
      definition,
    );
  }
  const next = parseKartAssemblyDocument({
    ...document,
    componentInstances: [...document.componentInstances, instance],
  });
  return {
    document: next,
    selection: { id, kind: "component" } satisfies KartEditorSelection,
  };
}

/**
 * After a part version swap, a part seated by a named mount keeps its
 * origin's place across its face and seats again from there (a gearbox
 * keeps its outputs on the axle line, its new base on the plate), and the
 * parts on its named mounts go to where the new version has them: the
 * motor onto the new motor plate, and a post on the tower pad is cut to
 * the new pad's height, so the tower bar and the suspension on it stay
 * where they were. Parts joined without named mounts move with the part,
 * and a mount the new version lacks leaves its attachment unnamed.
 */
function reseatSwappedComponent(
  document: KartAssemblyDocument,
  before: KartAssemblyComponentInstance,
  member: KartAssemblyComponentInstance,
) {
  const mountOf = (instance: KartEditorInstance, id: string | null) =>
    id === null
      ? undefined
      : listKartInstanceMounts(instance, mountSide(instance).definition).find(
          (mount) => mount.id === id,
        );
  const unname = (attachment: KartStructuralAttachment) => {
    attachment.child.mount = null;
    attachment.parent.mount = null;
  };

  // Its own seat, from where its named mount was.
  const start = member.transform.position;
  const own = document.structuralAttachments.find(
    ({ child }) => child.instanceId === member.id,
  );
  const ownParent =
    own && findKartEditorInstance(document, own.parent.instanceId);
  if (own && ownParent && own.child.mount !== null && own.parent.mount !== null) {
    const seat = mountOf(member, own.child.mount)
      ? seatKartMount(
          mountSide(member),
          mountSide(ownParent),
          own.child.mount,
          own.parent.mount,
          member.transform,
        )
      : null;
    if (!seat) {
      unname(own);
    } else {
      applyInstanceTransform(member, seat.transform);
      own.child.anchor = localPoint(member.transform, seat.point);
      own.parent.anchor = localPoint(ownParent.transform, seat.point);
    }
  }
  const shift = subtractVector(member.transform.position, start);
  const carry = (child: KartEditorInstance) =>
    applyTransformWithDescendants(
      document,
      child,
      {
        ...child.transform,
        position: addVector(child.transform.position, shift),
      },
      new Set([member.id]),
    );

  for (const attachment of document.structuralAttachments) {
    if (attachment.parent.instanceId !== member.id) continue;
    const child = findKartEditorInstance(document, attachment.child.instanceId);
    if (!child) continue;
    const named =
      attachment.child.mount !== null && attachment.parent.mount !== null;
    const was = mountOf(before, attachment.parent.mount);
    const now = mountOf(member, attachment.parent.mount);
    if (!named || !now || !was) {
      if (named) unname(attachment);
      carry(child);
      continue;
    }
    const childMount = mountOf(child, attachment.child.mount);
    if (
      childMount?.kind === "face" &&
      child.kind === "primitive" &&
      child.shape === "box" &&
      document.structuralAttachments.some(
        ({ parent }) => parent.instanceId === child.id,
      )
    ) {
      cutToPad(document, attachment, child, member, now.normal!);
      continue;
    }
    const followed = {
      ...child.transform,
      position: addVector(
        child.transform.position,
        subtractVector(now.point, was.point),
      ),
    };
    const seat = seatKartMount(
      mountSide(child),
      mountSide(member),
      attachment.child.mount!,
      attachment.parent.mount!,
      followed,
      attachment.child.anchor,
    );
    const target = seat?.transform ?? followed;
    applyTransformWithDescendants(document, child, target, new Set([member.id]));
    const point = seat?.point ?? worldPoint(target, attachment.child.anchor);
    attachment.child.anchor = localPoint(target, point);
    attachment.parent.anchor = localPoint(member.transform, point);
  }
}

/**
 * Seats a box that carries other parts (a tower post) on its parent's new
 * face from where it stands, growing or shortening it along the face's
 * normal so its far face, and everything on it, stays put. Slides across
 * the face move everything with it.
 */
function cutToPad(
  document: KartAssemblyDocument,
  attachment: KartStructuralAttachment,
  post: Extract<KartAssemblyPrimitiveInstance, { shape: "box" }>,
  parent: KartEditorInstance,
  normal: KartVector,
) {
  const seat = seatKartMount(
    mountSide(post),
    mountSide(parent),
    attachment.child.mount!,
    attachment.parent.mount!,
    post.transform,
    attachment.child.anchor,
  );
  if (!seat) return;
  const move = subtractVector(seat.transform.position, post.transform.position);
  const rise =
    move.x * normal.x + move.y * normal.y + move.z * normal.z;
  const across = subtractVector(move, scaleVector(normal, rise));
  // The post's own axis along the face's normal.
  const rotation = rotationMatrix(post.transform.rotationDegrees);
  const localNormal = transformVector(transposeMatrix(rotation), normal);
  const axis = (["x", "y", "z"] as const).reduce((best, candidate) =>
    Math.abs(localNormal[candidate]) > Math.abs(localNormal[best])
      ? candidate
      : best,
  );
  const size = post.size[axis] - rise;
  if (size <= 0.001) return;
  // Its children's attachment points, before it changes.
  const carried = document.structuralAttachments
    .filter(({ parent: end }) => end.instanceId === post.id)
    .map((child) => ({
      child,
      point: addVector(worldPoint(post.transform, child.parent.anchor), across),
    }));
  applyTransformWithDescendants(
    document,
    post,
    { ...post.transform, position: addVector(post.transform.position, across) },
    new Set([parent.id]),
  );
  post.transform = {
    ...post.transform,
    position: addVector(post.transform.position, scaleVector(normal, rise / 2)),
  };
  post.size = { ...post.size, [axis]: size };
  for (const { child, point } of carried) {
    child.parent.anchor = localPoint(post.transform, point);
  }
  attachment.child.anchor = localPoint(post.transform, seat.point);
  attachment.parent.anchor = localPoint(parent.transform, seat.point);
  // A part on one of its sides may need to slide to stay on it.
  for (const child of carried) reseatAttachment(document, child.child);
}

export function replaceKartComponentDefinition(
  document: KartAssemblyDocument,
  instanceId: string,
  definitionId: string,
  definitionVersion?: number,
) {
  const next = copyDocument(document);
  const instance = next.componentInstances.find(({ id }) => id === instanceId);
  if (!instance) return document;
  const definition =
    definitionVersion === undefined
      ? getLatestApprovedKartComponent(definitionId)
      : getApprovedKartComponent({
          id: definitionId,
          version: definitionVersion,
        });
  const current = getApprovedKartComponent(instance.definition);
  if (!definition || !current || definition.category !== current.category) {
    throw new Error(
      "Replacement must use an approved component in the same category.",
    );
  }
  const originalId = instance.mirrorOf ?? instance.id;
  for (const member of next.componentInstances.filter(
    (candidate) =>
      candidate.id === originalId || candidate.mirrorOf === originalId,
  )) {
    const before = structuredClone(member);
    member.definition = { id: definition.id, version: definition.version };
    // Mounts are authored in assembly space, so a swap keeps the arm and shock
    // eyes in place; validation reports a unit that cannot span them.
    if (definition.category === "suspension") {
      member.suspensionMount ??= resolveApprovedSuspensionMount(
        member,
        definition,
      );
    }
    reseatSwappedComponent(next, before, member);
  }
  return parseKartAssemblyDocument(next);
}

export function mirrorKartInstance(
  document: KartAssemblyDocument,
  selection: KartEditorSelection,
  retainedIds: ReadonlySet<string>,
) {
  const source = getKartEditorInstance(document, selection);
  if (!source) throw new Error("Select an instance to mirror.");
  if (source.mirrorOf)
    throw new Error("Mirror the original instance, not its mirror.");
  if (selection.kind === "component") {
    if (source.kind !== "component") {
      throw new Error("The selected component is unavailable.");
    }
    const definition = getApprovedKartComponent(source.definition);
    if (!definition?.assembly.mirrorable) {
      throw new Error("This approved component cannot be mirrored.");
    }
  }
  const collection =
    selection.kind === "component"
      ? document.componentInstances
      : document.primitiveInstances;
  if (collection.some(({ mirrorOf }) => mirrorOf === source.id)) {
    throw new Error("This instance already has a mirror.");
  }
  const id = uniqueId(document, `${source.id}-mirror`, retainedIds);
  const clone = structuredClone(source);
  clone.id = id;
  clone.mirrorOf = source.id;
  clone.transform.position.x = -source.transform.position.x;
  clone.transform.rotationDegrees = {
    x: source.transform.rotationDegrees.x,
    y: -source.transform.rotationDegrees.y,
    z: -source.transform.rotationDegrees.z,
  };
  if (clone.kind === "component" && clone.suspensionMount) {
    for (const point of Object.values(clone.suspensionMount)) {
      point.x = -point.x;
    }
  }
  const next =
    selection.kind === "component"
      ? parseKartAssemblyDocument({
          ...document,
          componentInstances: [...document.componentInstances, clone],
        })
      : parseKartAssemblyDocument({
          ...document,
          primitiveInstances: [...document.primitiveInstances, clone],
        });
  return {
    document: next,
    selection: { id, kind: selection.kind } satisfies KartEditorSelection,
  };
}

type KartEditorInstance =
  | KartAssemblyComponentInstance
  | KartAssemblyPrimitiveInstance;

function findKartEditorInstance(document: KartAssemblyDocument, id: string) {
  return [...document.componentInstances, ...document.primitiveInstances].find(
    (instance) => instance.id === id,
  );
}

function mountSide(instance: KartEditorInstance): KartMountSide {
  return {
    definition:
      instance.kind === "component"
        ? (getApprovedKartComponent(instance.definition) ?? null)
        : null,
    instance,
  };
}

/** A point in assembly space, in a transform's own frame. */
function localPoint(transform: KartInstanceTransform, point: KartVector) {
  return transformVector(
    transposeMatrix(rotationMatrix(transform.rotationDegrees)),
    subtractVector(point, transform.position),
  );
}

function worldPoint(transform: KartInstanceTransform, local: KartVector) {
  return addVector(
    transform.position,
    transformVector(rotationMatrix(transform.rotationDegrees), local),
  );
}

export function attachKartInstance(
  document: KartAssemblyDocument,
  childSelection: KartEditorSelection,
  parentId: string,
  retainedIds: ReadonlySet<string>,
  mirrorPair = false,
) {
  const child = getKartEditorInstance(document, childSelection);
  const parent = [
    ...document.componentInstances,
    ...document.primitiveInstances,
  ].find(({ id }) => id === parentId);
  const rejectionReason = attachmentRejectionReason(
    document,
    childSelection,
    parentId,
  );
  if (rejectionReason) throw new Error(rejectionReason);
  if (!child || !parent) throw new Error("Choose an existing parent instance.");
  const constructionBounds = (
    instance: typeof child | typeof parent,
  ): KartBounds | null => {
    try {
      if (instance.kind === "primitive") {
        return buildPrimitiveMassElement(instance).bounds;
      }
      const definition = getApprovedKartComponent(instance.definition);
      if (!definition) return null;
      return combineBounds(
        buildComponentMassElements(instance, definition).map(
          ({ bounds }) => bounds,
        ),
      );
    } catch {
      return null;
    }
  };
  const childAttachmentAxis = (
    parentMinimum: number,
    parentMaximum: number,
    childMinimum: number,
    childMaximum: number,
  ) => {
    const overlapMinimum = Math.max(parentMinimum, childMinimum);
    const overlapMaximum = Math.min(parentMaximum, childMaximum);
    if (overlapMinimum <= overlapMaximum) {
      return (overlapMinimum + overlapMaximum) / 2;
    }
    return parentMaximum < childMinimum ? childMinimum : childMaximum;
  };
  const parentBounds = constructionBounds(parent);
  const childBounds = constructionBounds(child);
  if (!parentBounds || !childBounds) {
    throw new Error("Attachment construction geometry is unavailable.");
  }
  const childDefinition =
    child.kind === "component"
      ? getApprovedKartComponent(child.definition)
      : null;
  const suspensionChassisAnchor =
    child.kind === "component" && childDefinition?.category === "suspension"
      ? child.suspensionMount?.chassisAnchor
      : null;
  const axisGap = (
    leftMinimum: number,
    leftMaximum: number,
    rightMinimum: number,
    rightMaximum: number,
  ) =>
    leftMaximum < rightMinimum
      ? rightMinimum - leftMaximum
      : rightMaximum < leftMinimum
        ? leftMinimum - rightMaximum
        : 0;
  const pointAxisGap = (minimum: number, maximum: number, value: number) =>
    value < minimum ? minimum - value : value > maximum ? value - maximum : 0;
  const surfaceGap = suspensionChassisAnchor
    ? Math.hypot(
        pointAxisGap(
          parentBounds.minimum.x,
          parentBounds.maximum.x,
          suspensionChassisAnchor.x,
        ),
        pointAxisGap(
          parentBounds.minimum.y,
          parentBounds.maximum.y,
          suspensionChassisAnchor.y,
        ),
        pointAxisGap(
          parentBounds.minimum.z,
          parentBounds.maximum.z,
          suspensionChassisAnchor.z,
        ),
      )
    : Math.hypot(
        axisGap(
          parentBounds.minimum.x,
          parentBounds.maximum.x,
          childBounds.minimum.x,
          childBounds.maximum.x,
        ),
        axisGap(
          parentBounds.minimum.y,
          parentBounds.maximum.y,
          childBounds.minimum.y,
          childBounds.maximum.y,
        ),
        axisGap(
          parentBounds.minimum.z,
          parentBounds.maximum.z,
          childBounds.minimum.z,
          childBounds.maximum.z,
        ),
      );
  const worldAnchor = suspensionChassisAnchor ?? {
    x: childAttachmentAxis(
      parentBounds.minimum.x,
      parentBounds.maximum.x,
      childBounds.minimum.x,
      childBounds.maximum.x,
    ),
    y: childAttachmentAxis(
      parentBounds.minimum.y,
      parentBounds.maximum.y,
      childBounds.minimum.y,
      childBounds.maximum.y,
    ),
    z: childAttachmentAxis(
      parentBounds.minimum.z,
      parentBounds.maximum.z,
      childBounds.minimum.z,
      childBounds.maximum.z,
    ),
  };
  const localAnchor = (instance: typeof child | typeof parent) =>
    transformVector(
      transposeMatrix(rotationMatrix(instance.transform.rotationDegrees)),
      subtractVector(worldAnchor, instance.transform.position),
    );
  const existing = document.structuralAttachments.find(
    ({ child: endpoint }) => endpoint.instanceId === child.id,
  );
  const attachmentId =
    existing?.id ?? uniqueId(document, `mount-${child.id}`, retainedIds);
  const attachment = {
    child: {
      anchor: localAnchor(child),
      instanceId: child.id,
      mount: null as string | null,
    },
    id: attachmentId,
    parent: {
      anchor: localAnchor(parent),
      instanceId: parent.id,
      mount: null as string | null,
    },
  };
  const side = (instance: typeof child | typeof parent) => ({
    definition:
      instance.kind === "component"
        ? (getApprovedKartComponent(instance.definition) ?? null)
        : null,
    instance,
  });
  // Mounting points the attachment named stay named while they still meet,
  // at the point the child carries with it (a footprint slides with its
  // part, and a motor turns about its own face).
  let named = false;
  if (
    existing?.parent.instanceId === parent.id &&
    existing.child.mount !== null &&
    existing.parent.mount !== null
  ) {
    const carried = addVector(
      child.transform.position,
      transformVector(
        rotationMatrix(child.transform.rotationDegrees),
        existing.child.anchor,
      ),
    );
    const parentLocal = transformVector(
      transposeMatrix(rotationMatrix(parent.transform.rotationDegrees)),
      subtractVector(carried, parent.transform.position),
    );
    const kept = {
      child: { ...existing.child },
      id: attachmentId,
      parent: { ...existing.parent, anchor: parentLocal },
    };
    const issues = checkKartAttachmentMounts(kept, side(parent), side(child));
    if (issues.length === 0) {
      attachment.child = kept.child;
      attachment.parent = kept.parent;
      named = true;
    }
  }
  // Otherwise, a pair of mounting points that meet where the parts touch,
  // or at one of the child's own mounting points (a face at its centre), is
  // named there.
  if (!named) {
    const candidates = [
      worldAnchor,
      ...listKartInstanceMounts(child, side(child).definition).flatMap(
        (mount) => (mount.kind === "pin" ? [] : [mount.point]),
      ),
    ];
    for (const point of candidates) {
      const at = (instance: typeof child | typeof parent) =>
        transformVector(
          transposeMatrix(rotationMatrix(instance.transform.rotationDegrees)),
          subtractVector(point, instance.transform.position),
        );
      const candidate = {
        child: { ...attachment.child, anchor: at(child) },
        id: attachmentId,
        parent: { ...attachment.parent, anchor: at(parent) },
      };
      const found = findKartAttachmentMounts(
        candidate,
        side(parent),
        side(child),
      );
      if (found) {
        attachment.child = { ...candidate.child, mount: found.child };
        attachment.parent = { ...candidate.parent, mount: found.parent };
        break;
      }
    }
  }
  // Otherwise the nearest pair within snapping reach is seated: the child
  // (and whatever hangs from it) moves onto its parent's mount.
  let base = document;
  if (attachment.child.mount === null) {
    const snap = findKartMountSnap(
      side(child),
      side(parent),
      child.transform,
    );
    if (snap) {
      base = updateKartInstanceTransform(
        document,
        childSelection,
        snap.transform,
      );
      attachment.child = {
        ...attachment.child,
        anchor: localPoint(snap.transform, snap.point),
        mount: snap.childMount,
      };
      attachment.parent = {
        ...attachment.parent,
        anchor: localPoint(parent.transform, snap.point),
        mount: snap.parentMount,
      };
    }
  }
  // Parts that meet at named mounting points are in reach however far apart
  // their construction stands, as a wheel's hub is from its shock.
  if (
    attachment.child.mount === null &&
    surfaceGap > KART_EDITOR_ATTACHMENT_TOLERANCE_METERS + 1e-9
  ) {
    throw new Error(
      `Move the component within ${KART_EDITOR_ATTACHMENT_TOLERANCE_METERS} m of the target parent before attaching.`,
    );
  }
  // Snapped with its mirror kept aligned, a detached mirror moves to match,
  // ready to attach the same way.
  if (
    mirrorPair &&
    attachment.child.mount !== null &&
    getKartMirrorCounterpartIds(document, childSelection).every(
      (id) =>
        !document.structuralAttachments.some(
          ({ child: endpoint }) => endpoint.instanceId === id,
        ),
    )
  ) {
    base = updateKartInstanceTransform(
      base,
      childSelection,
      getKartEditorInstance(base, childSelection)!.transform,
      true,
    );
  }
  return parseKartAssemblyDocument({
    ...base,
    structuralAttachments: [
      ...base.structuralAttachments.filter(
        ({ child: endpoint }) => endpoint.instanceId !== child.id,
      ),
      attachment,
    ],
  });
}

export function detachKartInstance(
  document: KartAssemblyDocument,
  selection: KartEditorSelection,
) {
  return parseKartAssemblyDocument({
    ...document,
    structuralAttachments: document.structuralAttachments.filter(
      ({ child }) => child.instanceId !== selection.id,
    ),
  });
}

function reconcileExistingKartInstanceAttachments(
  document: KartAssemblyDocument,
  targets: Array<{ parentId: string; selection: KartEditorSelection }>,
  retainedIds: ReadonlySet<string>,
) {
  let candidate = document;
  for (const target of targets) {
    if (!target.parentId) {
      candidate = detachKartInstance(candidate, target.selection);
      continue;
    }
    try {
      candidate = attachKartInstance(
        candidate,
        target.selection,
        target.parentId,
        retainedIds,
      );
    } catch {
      candidate = detachKartInstance(candidate, target.selection);
    }
  }

  return candidate;
}

export type KartInstanceSeat =
  | {
      childMount: string;
      /** How it moves while snapped. */
      hold: "locked" | "slides" | "turns";
      parentId: string;
      parentMount: string;
      snapped: true;
    }
  | { parentId: string; snapped: false };

/** How an attached part is held on its parent, or null if unattached. */
export function getKartInstanceSeat(
  document: KartAssemblyDocument,
  selection: KartEditorSelection,
): KartInstanceSeat | null {
  const attachment = document.structuralAttachments.find(
    ({ child }) => child.instanceId === selection.id,
  );
  if (!attachment) return null;
  const { child, parent } = attachment;
  const instance = getKartEditorInstance(document, selection);
  const kind = instance
    ? listKartInstanceMounts(instance, mountSide(instance).definition).find(
        ({ id }) => id === child.mount,
      )?.kind
    : undefined;
  const parentInstance = findKartEditorInstance(document, parent.instanceId);
  if (
    child.mount === null ||
    parent.mount === null ||
    !kind ||
    !instance ||
    !parentInstance ||
    // Named, but no longer meeting (a part resized under it).
    !getKartAttachmentPoint(attachment, parentInstance, instance) ||
    checkKartAttachmentMounts(
      attachment,
      mountSide(parentInstance),
      mountSide(instance),
    ).length > 0
  ) {
    return { parentId: parent.instanceId, snapped: false };
  }
  return {
    childMount: child.mount,
    hold: isKartMountLocked(kind)
      ? "locked"
      : kind === "motor-face"
        ? "turns"
        : "slides",
    parentId: parent.instanceId,
    parentMount: parent.mount,
    snapped: true,
  };
}

export function canAttachKartInstanceAtCurrentPosition(
  document: KartAssemblyDocument,
  selection: KartEditorSelection,
  parentId: string,
  retainedIds: ReadonlySet<string>,
) {
  if (!parentId) return false;
  try {
    attachKartInstance(document, selection, parentId, retainedIds);
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether every mirrored pair that `document` holds mirrored (placed as
 * each other's mirror image) is still so in `next`: an edit that keeps a
 * pair aligned must leave it so.
 */
function keepsMirrorsAligned(
  document: KartAssemblyDocument,
  next: KartAssemblyDocument,
  ids: ReadonlySet<string>,
) {
  for (const collection of ["componentInstances", "primitiveInstances"] as const) {
    for (const mirror of document[collection]) {
      if (!mirror.mirrorOf || (!ids.has(mirror.id) && !ids.has(mirror.mirrorOf))) {
        continue;
      }
      const original = document[collection].find(
        ({ id }) => id === mirror.mirrorOf,
      );
      const nextMirror = next[collection].find(({ id }) => id === mirror.id);
      const nextOriginal = next[collection].find(
        ({ id }) => id === mirror.mirrorOf,
      );
      if (!original || !nextMirror || !nextOriginal) continue;
      // As validation requires of a mirror: its transform, not its size.
      const aligned = (
        left: KartEditorInstance,
        right: KartEditorInstance,
      ) =>
        sameKartTransform(mirrorKartTransform(left.transform), right.transform);
      if (aligned(original, mirror) && !aligned(nextOriginal, nextMirror)) {
        return false;
      }
    }
  }
  return true;
}

/** The mirror image of a transform across the kart's centre plane. */
function mirrorKartTransform(transform: KartInstanceTransform) {
  // `+ 0` keeps a mirrored 0 from reading as −0.
  return {
    position: { ...transform.position, x: -transform.position.x + 0 },
    rotationDegrees: {
      x: transform.rotationDegrees.x,
      y: -transform.rotationDegrees.y + 0,
      z: -transform.rotationDegrees.z + 0,
    },
  };
}

function sameKartTransform(
  left: KartInstanceTransform,
  right: KartInstanceTransform,
) {
  const tolerance = 1e-9;
  const leftRotation = rotationMatrix(left.rotationDegrees);
  const rightRotation = rotationMatrix(right.rotationDegrees);
  return (
    (["x", "y", "z"] as const).every(
      (axis) => Math.abs(left.position[axis] - right.position[axis]) <= tolerance,
    ) &&
    leftRotation.every(
      (value, index) => Math.abs(value - rightRotation[index]) <= tolerance,
    )
  );
}

/**
 * Where a part asked to stand at `transform` stands. A snapped part keeps
 * to its mounting points: a footprint or face slides on its face and turns
 * only about it, a motor turns only about its shaft, and a wheel on its hub
 * or a shock on its pin stays put until detached. A part not yet attached
 * snaps onto its chosen parent's nearest mounting point in reach.
 */
function holdKartTransform(
  document: KartAssemblyDocument,
  instance: KartEditorInstance,
  transform: KartInstanceTransform,
  targetParentId: string,
): KartInstanceTransform {
  const attachment = document.structuralAttachments.find(
    ({ child }) => child.instanceId === instance.id,
  );
  if (attachment) {
    const { child, parent } = attachment;
    const parentInstance = findKartEditorInstance(document, parent.instanceId);
    if (child.mount === null || parent.mount === null || !parentInstance) {
      return transform;
    }
    const side = mountSide(instance);
    const mount = listKartInstanceMounts(instance, side.definition).find(
      ({ id }) => id === child.mount,
    );
    if (!mount || isKartMountLocked(mount.kind)) return instance.transform;
    return (
      seatKartMount(
        side,
        mountSide(parentInstance),
        child.mount,
        parent.mount,
        transform,
        child.anchor,
      )?.transform ?? instance.transform
    );
  }
  const parentInstance = targetParentId
    ? findKartEditorInstance(document, targetParentId)
    : undefined;
  if (!parentInstance || parentInstance.id === instance.id) return transform;
  return (
    findKartMountSnap(mountSide(instance), mountSide(parentInstance), transform)
      ?.transform ?? transform
  );
}

export function updateKartInstanceTransformAndAttachment(
  document: KartAssemblyDocument,
  selection: KartEditorSelection,
  transform: KartAssemblyComponentInstance["transform"],
  targetParentId: string,
  retainedIds: ReadonlySet<string>,
  mirrorPair = false,
) {
  const instance = getKartEditorInstance(document, selection);
  let held = instance
    ? holdKartTransform(document, instance, transform, targetParentId)
    : transform;
  // A mirrored counterpart keeps to its own mounting points too: where its
  // seat takes it elsewhere, the pair meets at its seat, and where they
  // still can't stay mirrored, neither moves.
  if (mirrorPair && instance) {
    for (const counterpartId of getKartMirrorCounterpartIds(
      document,
      selection,
    )) {
      const counterpart = getKartEditorInstance(document, {
        id: counterpartId,
        kind: selection.kind,
      });
      if (!counterpart) continue;
      const counterpartHeld = holdKartTransform(
        document,
        counterpart,
        mirrorKartTransform(held),
        "",
      );
      if (sameKartTransform(counterpartHeld, mirrorKartTransform(held))) {
        continue;
      }
      held = holdKartTransform(
        document,
        instance,
        mirrorKartTransform(counterpartHeld),
        targetParentId,
      );
      if (
        !sameKartTransform(
          holdKartTransform(document, counterpart, mirrorKartTransform(held), ""),
          mirrorKartTransform(held),
        )
      ) {
        return document;
      }
    }
  }
  const next = updateKartInstanceTransform(
    document,
    selection,
    held,
    mirrorPair,
  );
  const targets: Array<{ parentId: string; selection: KartEditorSelection }> =
    [];
  const selectedAttachment = document.structuralAttachments.find(
    ({ child }) => child.instanceId === selection.id,
  );
  if (selectedAttachment) {
    targets.push({
      parentId: selectedAttachment.parent.instanceId,
      selection,
    });
  }
  if (mirrorPair) {
    for (const counterpartId of getKartMirrorCounterpartIds(
      document,
      selection,
    )) {
      const counterpartAttachment = document.structuralAttachments.find(
        ({ child }) => child.instanceId === counterpartId,
      );
      if (!counterpartAttachment) continue;
      targets.push({
        parentId: counterpartAttachment.parent.instanceId,
        selection: { id: counterpartId, kind: selection.kind },
      });
    }
  }
  const result = reconcileExistingKartInstanceAttachments(
    next,
    targets,
    retainedIds,
  );
  // Seated and reattached, a pair moved together stays mirrored, or
  // neither moves.
  if (
    mirrorPair &&
    !keepsMirrorsAligned(
      document,
      result,
      new Set([
        selection.id,
        ...getKartMirrorCounterpartIds(document, selection),
      ]),
    )
  ) {
    return document;
  }
  return result;
}

export function updateSuspensionMountPoint(
  document: KartAssemblyDocument,
  instanceId: string,
  point: keyof NonNullable<ComponentInstanceSuspensionMount>,
  value: KartVector,
  mirrorPair = true,
) {
  const next = copyDocument(document);
  const instance = next.componentInstances.find(({ id }) => id === instanceId);
  if (!instance?.suspensionMount) {
    throw new Error("Select a suspension component.");
  }
  instance.suspensionMount[point] = value;
  if (mirrorPair) {
    const originalId = instance.mirrorOf ?? instance.id;
    const mirror = next.componentInstances.find(
      (candidate) =>
        candidate.id !== instance.id &&
        (candidate.id === originalId || candidate.mirrorOf === originalId),
    );
    if (mirror?.suspensionMount) {
      mirror.suspensionMount[point] = { ...value, x: -value.x };
    }
  }
  return parseKartAssemblyDocument(next);
}

type ComponentInstanceSuspensionMount =
  KartAssemblyComponentInstance["suspensionMount"];

export function deleteKartInstance(
  document: KartAssemblyDocument,
  selection: KartEditorSelection,
) {
  const removedIds = new Set([selection.id]);
  for (const instance of [
    ...document.componentInstances,
    ...document.primitiveInstances,
  ]) {
    if (instance.mirrorOf === selection.id) removedIds.add(instance.id);
  }
  return parseKartAssemblyDocument({
    ...document,
    componentInstances: document.componentInstances
      .filter(({ id }) => !removedIds.has(id))
      .map((instance) =>
        instance.mirrorOf && removedIds.has(instance.mirrorOf)
          ? { ...instance, mirrorOf: null }
          : instance,
      ),
    connections: document.connections.filter(
      ({ from, to }) =>
        !removedIds.has(from.instanceId) && !removedIds.has(to.instanceId),
    ),
    primitiveInstances: document.primitiveInstances
      .filter(({ id }) => !removedIds.has(id))
      .map((instance) =>
        instance.mirrorOf && removedIds.has(instance.mirrorOf)
          ? { ...instance, mirrorOf: null }
          : instance,
      ),
    structuralAttachments: document.structuralAttachments.filter(
      ({ child, parent }) =>
        !removedIds.has(child.instanceId) && !removedIds.has(parent.instanceId),
    ),
  });
}
