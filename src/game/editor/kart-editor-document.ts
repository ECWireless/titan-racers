import type {
  KartAssemblyComponentInstance,
  KartAssemblyDocument,
  KartAssemblyPrimitiveInstance,
} from "../kart/kart-assembly-document";
import { parseKartAssemblyDocument } from "../kart/kart-assembly-document";
import {
  addVector,
  rotationMatrix,
  subtractVector,
  transformVector,
  transposeMatrix,
  type KartVector,
} from "../kart/kart-construction-geometry";
import {
  APPROVED_COMPONENTS_BY_CATEGORY,
  getApprovedKartComponent,
  type KartComponentCategory,
} from "../kart/kart-component-registry";

export type KartEditorSelection = {
  id: string;
  kind: "component" | "primitive";
};

export type KartPrimitivePreset =
  "box-structure" | "box-body" | "cylinder-guard";

const ZERO_ROTATION = { x: 0, y: 0, z: 0 } as const;

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
  applyInstanceTransform(instance, transform);

  if (mirrorPair) {
    const originalId = instance.mirrorOf ?? instance.id;
    const counterpart = collection.find(
      (candidate) =>
        candidate.id !== instance.id &&
        (candidate.id === originalId || candidate.mirrorOf === originalId),
    );
    if (counterpart) {
      applyInstanceTransform(counterpart, {
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
      });
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
      position: { x: 0, y: 0.15, z: 0 },
      rotationDegrees: { ...ZERO_ROTATION },
    },
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
  const suspensionMount =
    category === "suspension"
      ? {
          armPivot: { x: -0.04, y: 0.06, z: 0 },
          chassisAnchor: { x: 0, y: 0.18, z: 0 },
          hubAnchor: { x: -0.1, y: 0.06, z: 0 },
          springArmAnchor: { x: -0.02, y: 0.06, z: 0 },
        }
      : null;
  const instance: KartAssemblyComponentInstance = {
    definition: { id: definition.id, version: definition.version },
    id,
    kind: "component",
    mirrorOf: null,
    suspensionMount,
    transform: {
      position,
      rotationDegrees: { ...ZERO_ROTATION },
    },
  };
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
  if (!child || !parent || child.id === parent.id) {
    throw new Error("Choose a different existing parent instance.");
  }
  const worldDelta = subtractVector(
    child.transform.position,
    parent.transform.position,
  );
  const parentAnchor = transformVector(
    transposeMatrix(rotationMatrix(parent.transform.rotationDegrees)),
    worldDelta,
  );
  const attachmentId = uniqueId(document, `mount-${child.id}`, retainedIds);
  return parseKartAssemblyDocument({
    ...document,
    structuralAttachments: [
      ...document.structuralAttachments.filter(
        ({ child: endpoint }) => endpoint.instanceId !== child.id,
      ),
      {
        child: {
          anchor: { x: 0, y: 0, z: 0 },
          instanceId: child.id,
        },
        id: attachmentId,
        parent: { anchor: parentAnchor, instanceId: parent.id },
      },
    ],
  });
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
