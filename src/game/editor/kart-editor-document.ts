import type {
  KartAssemblyComponentInstance,
  KartAssemblyDocument,
  KartAssemblyPrimitiveInstance,
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
  subtractVector,
  transformVector,
  transposeMatrix,
  type KartBounds,
  type KartMatrix3,
  type KartVector,
} from "../kart/kart-construction-geometry";
import {
  APPROVED_COMPONENTS_BY_CATEGORY,
  getApprovedKartComponent,
  type KartComponentCategory,
} from "../kart/kart-component-registry";
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
    const previousTransform = instance.transform;
    const previousRotationInverse = transposeMatrix(
      rotationMatrix(previousTransform.rotationDegrees),
    );
    const nextRotation = rotationMatrix(transform.rotationDegrees);
    for (const point of Object.keys(instance.suspensionMount) as Array<
      keyof NonNullable<ComponentInstanceSuspensionMount>
    >) {
      const localPoint = transformVector(
        previousRotationInverse,
        subtractVector(
          instance.suspensionMount[point],
          previousTransform.position,
        ),
      );
      instance.suspensionMount[point] = addVector(
        transformVector(nextRotation, localPoint),
        transform.position,
      );
    }
  }
  instance.transform = transform;
}

function rotationDegreesFromMatrix(matrix: KartMatrix3): KartVector {
  const y = Math.asin(Math.max(-1, Math.min(1, matrix[2])));
  const nearGimbalLock = Math.abs(matrix[2]) >= 0.9999999;
  const x = nearGimbalLock
    ? Math.atan2(matrix[7], matrix[4])
    : Math.atan2(-matrix[5], matrix[8]);
  const z = nearGimbalLock ? 0 : Math.atan2(-matrix[1], matrix[0]);
  const toDegrees = 180 / Math.PI;
  return { x: x * toDegrees, y: y * toDegrees, z: z * toDegrees };
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
        {
          position: {
            x: -transform.position.x,
            y: transform.position.y,
            z: transform.position.z,
          },
          rotationDegrees: {
            x: transform.rotationDegrees.x,
            y: -transform.rotationDegrees.y,
            z: -transform.rotationDegrees.z,
          },
        },
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
  return parseKartAssemblyDocument({
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
      return values.shape === "box"
        ? { ...primitive, size: values.size }
        : {
            ...primitive,
            height: values.height,
            radius: values.radius,
          };
    }),
  });
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
        y:
          preset === "box-body"
            ? 0.148
            : preset === "cylinder-guard"
              ? 0.13
              : 0.128,
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

export function replaceKartComponentDefinition(
  document: KartAssemblyDocument,
  instanceId: string,
  definitionId: string,
) {
  const next = copyDocument(document);
  const instance = next.componentInstances.find(({ id }) => id === instanceId);
  if (!instance) return document;
  const definition = getApprovedKartComponent({ id: definitionId, version: 1 });
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
    member.definition = { id: definition.id, version: definition.version };
    if (definition.category === "suspension") {
      member.suspensionMount = resolveApprovedSuspensionMount(
        member,
        definition,
      );
    }
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

export function attachKartInstance(
  document: KartAssemblyDocument,
  childSelection: KartEditorSelection,
  parentId: string,
  retainedIds: ReadonlySet<string>,
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
  if (surfaceGap > KART_EDITOR_ATTACHMENT_TOLERANCE_METERS + 1e-9) {
    throw new Error(
      `Move the component within ${KART_EDITOR_ATTACHMENT_TOLERANCE_METERS} m of the target parent before attaching.`,
    );
  }
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
  const attachmentId =
    document.structuralAttachments.find(
      ({ child: endpoint }) => endpoint.instanceId === child.id,
    )?.id ?? uniqueId(document, `mount-${child.id}`, retainedIds);
  return parseKartAssemblyDocument({
    ...document,
    structuralAttachments: [
      ...document.structuralAttachments.filter(
        ({ child: endpoint }) => endpoint.instanceId !== child.id,
      ),
      {
        child: {
          anchor: localAnchor(child),
          instanceId: child.id,
        },
        id: attachmentId,
        parent: { anchor: localAnchor(parent), instanceId: parent.id },
      },
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

export function updateKartInstanceTransformAndAttachment(
  document: KartAssemblyDocument,
  selection: KartEditorSelection,
  transform: KartAssemblyComponentInstance["transform"],
  _targetParentId: string,
  retainedIds: ReadonlySet<string>,
  mirrorPair = false,
) {
  const next = updateKartInstanceTransform(
    document,
    selection,
    transform,
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
  return reconcileExistingKartInstanceAttachments(next, targets, retainedIds);
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
