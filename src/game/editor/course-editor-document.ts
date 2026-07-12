import {
  type CourseDocument,
  type CourseObject,
  parseCourseDocument,
} from "../course/course-document";

export const COURSE_OBJECT_PRESETS = [
  "block",
  "barrier",
  "barrel",
  "ramp",
  "platform",
] as const;
export const COURSE_EDITOR_OBJECT_LIMIT = 500;

export type CourseObjectPreset = (typeof COURSE_OBJECT_PRESETS)[number];

export type CourseEditorSelection =
  | { id: string; kind: "checkpoint" }
  | { id: string; kind: "object" }
  | { id: string; kind: "start" };

export type CourseEditorGeometry = {
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };
  scale?: { x: number; y: number; z: number };
};

export type CourseEditorColor = CourseDocument["lighting"]["ambient"]["color"];
export type CourseEditorDirectionalLight =
  CourseDocument["lighting"]["directionalLights"][number];

const PRESET_OBJECTS: Record<
  CourseObjectPreset,
  Omit<CourseObject, "id" | "transform">
> = {
  block: {
    availability: "standard",
    category: "obstacle",
    collision: {
      friction: 0.8,
      halfExtents: { x: 1, y: 0.5, z: 1 },
      offset: {
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
      },
      restitution: 0,
      role: "solid-obstacle",
      shape: "box",
    },
    editable: true,
    visual: {
      material: "obstacleBlock",
      scale: { x: 2, y: 1, z: 2 },
      shape: "box",
    },
  },
  barrier: {
    availability: "standard",
    category: "obstacle",
    collision: {
      friction: 0.8,
      halfExtents: { x: 2, y: 0.6, z: 0.25 },
      offset: {
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
      },
      restitution: 0,
      role: "solid-obstacle",
      shape: "box",
    },
    editable: true,
    visual: {
      material: "obstacleBlock",
      scale: { x: 4, y: 1.2, z: 0.5 },
      shape: "box",
    },
  },
  barrel: {
    availability: "standard",
    category: "obstacle",
    collision: {
      axis: 1,
      friction: 0.8,
      height: 1.4,
      offset: {
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
      },
      radius: 0.5,
      restitution: 0,
      role: "solid-obstacle",
      shape: "cylinder",
    },
    editable: true,
    visual: {
      material: "obstacleBarrel",
      scale: { x: 1, y: 1.4, z: 1 },
      shape: "cylinder",
    },
  },
  ramp: {
    availability: "standard",
    category: "feature",
    collision: {
      friction: 1.1,
      halfExtents: { x: 2, y: 0.25, z: 3 },
      offset: {
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
      },
      restitution: 0,
      role: "drivable-surface",
      shape: "box",
    },
    editable: true,
    visual: {
      material: "ramp",
      scale: { x: 4, y: 0.5, z: 6 },
      shape: "box",
    },
  },
  platform: {
    availability: "standard",
    category: "surface",
    collision: {
      friction: 1.1,
      halfExtents: { x: 3, y: 0.25, z: 3 },
      offset: {
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
      },
      restitution: 0,
      role: "drivable-surface",
      shape: "box",
    },
    editable: true,
    visual: {
      material: "asphalt",
      scale: { x: 6, y: 0.5, z: 6 },
      shape: "box",
    },
  },
};

export function addCourseObjectPreset(
  document: CourseDocument,
  preset: CourseObjectPreset,
  reservedIds: ReadonlySet<string> = new Set(),
) {
  if (document.objects.length >= COURSE_EDITOR_OBJECT_LIMIT) {
    return document;
  }

  const id = nextStableId(document, preset, reservedIds);
  const index = document.objects.filter((object) =>
    object.id.startsWith(`${preset}-`),
  ).length;
  const template = PRESET_OBJECTS[preset];
  const y =
    template.collision?.shape === "box"
      ? template.collision.halfExtents.y
      : (template.collision?.height ?? 1) / 2;
  const object: CourseObject = {
    ...structuredClone(template),
    id,
    transform: {
      position: {
        x: roundEditorValue(document.start.position.x + (index % 4) * 2.5),
        y: roundEditorValue(y),
        z: roundEditorValue(
          document.start.position.z + 5 + Math.floor(index / 4) * 3,
        ),
      },
      rotation: preset === "ramp" ? { x: -8, y: 0, z: 0 } : { x: 0, y: 0, z: 0 },
    },
  };

  return parseCourseDocument({
    ...document,
    objects: [...document.objects, object],
  });
}

export function addCourseCheckpoint(
  document: CourseDocument,
  reservedIds: ReadonlySet<string> = new Set(),
) {
  const order = document.checkpoints.length + 1;
  const previous = document.checkpoints.at(-1);
  const checkpoint = {
    halfExtents: { x: 3, y: 1.5, z: 0.5 },
    id: nextStableId(document, "checkpoint", reservedIds),
    order,
    position: previous
      ? {
          x: previous.position.x,
          y: previous.position.y,
          z: roundEditorValue(previous.position.z + 8),
        }
      : { ...document.start.position },
    rotation: previous ? { ...previous.rotation } : { ...document.start.rotation },
  };

  return parseCourseDocument({
    ...document,
    checkpoints: [...document.checkpoints, checkpoint],
  });
}

export function deleteCourseSelection(
  document: CourseDocument,
  selection: CourseEditorSelection,
) {
  if (selection.kind === "start") {
    return document;
  }

  if (selection.kind === "object") {
    return parseCourseDocument({
      ...document,
      objects: document.objects.filter((object) => object.id !== selection.id),
    });
  }

  if (document.checkpoints.length <= 1) {
    return document;
  }

  return parseCourseDocument({
    ...document,
    checkpoints: document.checkpoints
      .filter((checkpoint) => checkpoint.id !== selection.id)
      .map((checkpoint, index) => ({ ...checkpoint, order: index + 1 })),
  });
}

export function getSelectionGeometry(
  document: CourseDocument,
  selection: CourseEditorSelection,
): CourseEditorGeometry | null {
  if (selection.kind === "start") {
    return {
      position: { ...document.start.position },
      rotation: { ...document.start.rotation },
    };
  }

  if (selection.kind === "checkpoint") {
    const checkpoint = document.checkpoints.find(({ id }) => id === selection.id);
    return checkpoint
      ? {
          position: { ...checkpoint.position },
          rotation: { ...checkpoint.rotation },
          scale: {
            x: checkpoint.halfExtents.x * 2,
            y: checkpoint.halfExtents.y * 2,
            z: checkpoint.halfExtents.z * 2,
          },
        }
      : null;
  }

  const object = document.objects.find(({ id }) => id === selection.id);
  return object
    ? {
        position: { ...object.transform.position },
        rotation: { ...object.transform.rotation },
        scale: { ...object.visual.scale },
      }
    : null;
}

export function updateSelectionGeometry(
  document: CourseDocument,
  selection: CourseEditorSelection,
  geometry: CourseEditorGeometry,
) {
  const position = mapVector(geometry.position, roundEditorValue);
  const rotation = mapVector(geometry.rotation, roundEditorValue);

  if (selection.kind === "start") {
    return parseCourseDocument({
      ...document,
      start: { ...document.start, position, rotation },
    });
  }

  if (selection.kind === "checkpoint") {
    return parseCourseDocument({
      ...document,
      checkpoints: document.checkpoints.map((checkpoint) =>
        checkpoint.id === selection.id
          ? {
              ...checkpoint,
              halfExtents: geometry.scale
                ? mapVector(geometry.scale, (value) =>
                    Math.max(0.05, roundEditorValue(value / 2)),
                  )
                : checkpoint.halfExtents,
              position,
              rotation,
            }
          : checkpoint,
      ),
    });
  }

  return parseCourseDocument({
    ...document,
    objects: document.objects.map((object) => {
      if (object.id !== selection.id) {
        return object;
      }

      const requestedScale = geometry.scale
        ? mapVector(geometry.scale, (value) =>
            Math.max(0.05, roundEditorValue(value)),
          )
        : object.visual.scale;
      const nextScale = normalizeCylinderScale(object, requestedScale);
      const scaleRatio = mapVectorByAxis(nextScale, (axis, value) =>
        Math.max(0.01, value / object.visual.scale[axis]),
      );
      const collision = object.collision
        ? {
            ...object.collision,
            ...(object.collision.shape === "box"
              ? {
                  halfExtents: mapVectorByAxis(
                    object.collision.halfExtents,
                    (axis, value) =>
                      roundEditorValue(value * scaleRatio[axis]),
                  ),
                }
              : {
                  height: roundEditorValue(
                    object.collision.height *
                      scaleRatio[axisName(object.collision.axis)],
                  ),
                  radius: roundEditorValue(
                    object.collision.radius *
                      scaleRatio[radialAxes(object.collision.axis)[0]],
                  ),
                }),
            offset: {
              ...object.collision.offset,
              position: mapVectorByAxis(
                object.collision.offset.position,
                (axis, value) =>
                  roundEditorValue(value * scaleRatio[axis]),
              ),
            },
          }
        : null;

      return {
        ...object,
        collision,
        transform: { position, rotation },
        visual: { ...object.visual, scale: nextScale },
      };
    }),
  });
}

export function nudgeSelection(
  document: CourseDocument,
  selection: CourseEditorSelection,
  field: "position" | "rotation",
  axis: "x" | "y" | "z",
  delta: number,
) {
  const geometry = getSelectionGeometry(document, selection);
  if (!geometry) {
    return document;
  }

  return updateSelectionGeometry(document, selection, {
    ...geometry,
    [field]: {
      ...geometry[field],
      [axis]: roundEditorValue(geometry[field][axis] + delta),
    },
  });
}

export function renameCourseObject(
  document: CourseDocument,
  selection: CourseEditorSelection,
  label: string,
) {
  if (selection.kind !== "object") {
    return document;
  }

  const trimmedLabel = label.trim();
  if (!trimmedLabel) {
    return document;
  }

  const object = document.objects.find(({ id }) => id === selection.id);
  if (!object?.editable || (object.label ?? object.id) === trimmedLabel) {
    return document;
  }

  return parseCourseDocument({
    ...document,
    objects: document.objects.map((candidate) =>
      candidate.id === selection.id
        ? {
            ...candidate,
            label: trimmedLabel === candidate.id ? undefined : trimmedLabel,
          }
        : candidate,
    ),
  });
}

export function scaleSelectionUniformly(
  document: CourseDocument,
  selection: CourseEditorSelection,
  multiplier: number,
) {
  const geometry = getSelectionGeometry(document, selection);
  if (!geometry?.scale || selection.kind === "start") {
    return document;
  }

  return updateSelectionGeometry(document, selection, {
    ...geometry,
    scale: mapVector(geometry.scale, (value) => value * multiplier),
  });
}

export function scaleSelectionAxis(
  document: CourseDocument,
  selection: CourseEditorSelection,
  axis: "x" | "y" | "z",
  multiplier: number,
) {
  const geometry = getSelectionGeometry(document, selection);
  if (!geometry?.scale || selection.kind === "start") {
    return document;
  }

  return updateSelectionGeometry(document, selection, {
    ...geometry,
    scale: {
      ...geometry.scale,
      [axis]: geometry.scale[axis] * multiplier,
    },
  });
}

export function collectCourseDocumentIds(document: CourseDocument) {
  return new Set([
    document.start.id,
    ...document.objects.map(({ id }) => id),
    ...document.checkpoints.map(({ id }) => id),
    ...document.lighting.directionalLights.map(({ id }) => id),
  ]);
}

export function updateAmbientLighting(
  document: CourseDocument,
  update: Partial<{
    color: CourseEditorColor;
    intensity: number;
  }>,
) {
  return parseCourseDocument({
    ...document,
    lighting: {
      ...document.lighting,
      ambient: { ...document.lighting.ambient, ...update },
    },
  });
}

export function updateDirectionalLight(
  document: CourseDocument,
  lightId: string,
  update: Partial<
    Pick<
      CourseEditorDirectionalLight,
      "color" | "intensity" | "rotation" | "shadowQuality"
    >
  >,
) {
  return parseCourseDocument({
    ...document,
    lighting: {
      ...document.lighting,
      directionalLights: document.lighting.directionalLights.map((light) =>
        light.id === lightId ? { ...light, ...update } : light,
      ),
    },
  });
}

export function setFillLightEnabled(
  document: CourseDocument,
  enabled: boolean,
  fillLight?: CourseEditorDirectionalLight,
) {
  const [keyLight, currentFillLight] = document.lighting.directionalLights;
  if (!keyLight || enabled === Boolean(currentFillLight)) {
    return document;
  }

  return parseCourseDocument({
    ...document,
    lighting: {
      ...document.lighting,
      directionalLights: enabled
        ? [
            keyLight,
            fillLight ?? {
              color: { b: 0.9, g: 0.68, r: 0.55 },
              id: nextStableId(document, "fill-light", new Set()),
              intensity: 0.32,
              rotation: { x: 28, y: -132, z: 0 },
              shadowQuality: "off" as const,
            },
          ]
        : [keyLight],
    },
  });
}

function nextStableId(
  document: CourseDocument,
  prefix: string,
  reservedIds: ReadonlySet<string>,
) {
  const used = collectCourseDocumentIds(document);
  reservedIds.forEach((id) => used.add(id));
  let suffix = 1;

  while (used.has(`${prefix}-${suffix}`)) {
    suffix += 1;
  }

  return `${prefix}-${suffix}`;
}

function mapVector(
  vector: { x: number; y: number; z: number },
  map: (value: number) => number,
) {
  return { x: map(vector.x), y: map(vector.y), z: map(vector.z) };
}

function mapVectorByAxis(
  vector: { x: number; y: number; z: number },
  map: (axis: "x" | "y" | "z", value: number) => number,
) {
  return {
    x: map("x", vector.x),
    y: map("y", vector.y),
    z: map("z", vector.z),
  };
}

function axisName(axis: 0 | 1 | 2) {
  return (["x", "y", "z"] as const)[axis];
}

function radialAxes(axis: 0 | 1 | 2) {
  const heightAxis = axisName(axis);
  return (["x", "y", "z"] as const).filter(
    (candidate) => candidate !== heightAxis,
  );
}

function normalizeCylinderScale(
  object: CourseObject,
  requestedScale: { x: number; y: number; z: number },
) {
  if (object.collision?.shape !== "cylinder") {
    return requestedScale;
  }

  const [firstRadiusAxis, secondRadiusAxis] = radialAxes(object.collision.axis);
  const firstRatio = requestedScale[firstRadiusAxis] / object.visual.scale[firstRadiusAxis];
  const secondRatio = requestedScale[secondRadiusAxis] / object.visual.scale[secondRadiusAxis];
  const radiusRatio =
    Math.abs(firstRatio - 1) >= Math.abs(secondRatio - 1)
      ? firstRatio
      : secondRatio;

  return {
    ...requestedScale,
    [firstRadiusAxis]: roundEditorValue(
      object.visual.scale[firstRadiusAxis] * radiusRatio,
    ),
    [secondRadiusAxis]: roundEditorValue(
      object.visual.scale[secondRadiusAxis] * radiusRatio,
    ),
  };
}

function roundEditorValue(value: number) {
  const rounded = Number(value.toFixed(3));
  return Object.is(rounded, -0) ? 0 : rounded;
}
