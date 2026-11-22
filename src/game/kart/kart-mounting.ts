import type {
  KartAssemblyComponentInstance,
  KartAssemblyPrimitiveInstance,
  KartStructuralAttachment,
} from "./kart-assembly-document";
import type { ApprovedComponentDefinition } from "./kart-component-registry";
import {
  addVector,
  rotationMatrix,
  scaleVector,
  subtractVector,
  transformVector,
  transposeMatrix,
  type KartVector,
} from "./kart-construction-geometry";
import type { DeepReadonly } from "./immutable-registry";

/**
 * Mounting points in assembly space, and the rules for two of them to meet
 * at a structural attachment (schema 3).
 *
 * Where each instance can mount:
 * - A part version that declares mounting points (`mounts` in the registry):
 *   `base`, `motor-face`, `motor-plate`, `tower-pad`.
 * - A suspension: `chassis-anchor` (its shock's top eye) and `hub-anchor`,
 *   at its authored mounting geometry.
 * - A wheel: `hub`, its centre.
 * - An authored box: its six faces `top`/`bottom` (±Y), `right`/`left`
 *   (±X), and `rear`/`front` (±Z) in its own frame, and `pin`, a bolt
 *   through it. A cylinder offers the two faces at its ends (named as a
 *   box's along its axis) and `pin`.
 *
 * Which mounts meet, all at the attachment's point:
 * - `base` on a structural primitive's face: the footprint's centre is the
 *   point, the two face each other, and all of the footprint rests on it.
 *   (A footprint slides by moving the point with it.)
 * - face on face, or a face on a `tower-pad`: they face each other and the
 *   point lies within both.
 * - `motor-face` on `motor-plate`: both points are the attachment point and
 *   they face each other. The motor may turn about its shaft.
 * - `chassis-anchor` on a structural primitive's `pin`: the shock's eye is
 *   the point, within the primitive.
 * - `hub` on `hub-anchor`: both points are the attachment point.
 *
 * Face contacts need only touch at the attachment point, so two faces that
 * meet along an edge can both pass; the editor snaps to the face chosen.
 */

export const KART_MOUNT_TOLERANCE_METERS = 1e-6;
/** How far two facing mounts may tilt from opposed: about 0.0036°. */
const KART_MOUNT_ALIGNMENT_TOLERANCE = 1e-9;

type ReadonlyDefinition = DeepReadonly<ApprovedComponentDefinition>;

export type KartMountKind =
  | "base"
  | "motor-face"
  | "motor-plate"
  | "tower-pad"
  | "face"
  | "pin"
  | "chassis-anchor"
  | "hub"
  | "hub-anchor";

type Region =
  | {
      kind: "rectangle";
      center: KartVector;
      halfU: number;
      halfV: number;
      u: KartVector;
      v: KartVector;
    }
  | { kind: "disc"; center: KartVector; radius: number };

export type KartResolvedMount = {
  id: string;
  instanceId: string;
  kind: KartMountKind;
  /** Outward, for mounts on a face. */
  normal: KartVector | null;
  point: KartVector;
  region: Region | null;
  /** For a `pin`: whether a point lies within the primitive. */
  contains?: (point: KartVector) => boolean;
  /** For a face or `pin`: whether its primitive is structure. */
  structural?: boolean;
};

export type KartMountInstance =
  | KartAssemblyComponentInstance
  | KartAssemblyPrimitiveInstance;

/** One end of an attachment: its instance, and its part version if any. */
export type KartMountSide = {
  definition: ReadonlyDefinition | null;
  instance: KartMountInstance;
};

type KartMountIssue = {
  code: string;
  /** The attachment end at fault, when it is one end's naming. */
  endpoint?: "child" | "parent";
  message: string;
};

const AXES = ["x", "y", "z"] as const;
type Axis = (typeof AXES)[number];
const FACE_NAMES: Record<Axis, [negative: string, positive: string]> = {
  x: ["left", "right"],
  y: ["bottom", "top"],
  z: ["front", "rear"],
};

const unit = (axis: Axis, sign = 1): KartVector => ({
  x: axis === "x" ? sign : 0,
  y: axis === "y" ? sign : 0,
  z: axis === "z" ? sign : 0,
});
const dot = (left: KartVector, right: KartVector) =>
  left.x * right.x + left.y * right.y + left.z * right.z;
const length = (vector: KartVector) => Math.sqrt(dot(vector, vector));

function frame(instance: KartMountInstance) {
  const rotation = rotationMatrix(instance.transform.rotationDegrees);
  return {
    direction: (local: KartVector) => transformVector(rotation, local),
    local: (world: KartVector) =>
      transformVector(
        transposeMatrix(rotation),
        subtractVector(world, instance.transform.position),
      ),
    point: (local: KartVector) =>
      addVector(instance.transform.position, transformVector(rotation, local)),
  };
}

function rectangle(
  place: ReturnType<typeof frame>,
  center: KartVector,
  normalAxis: Axis,
  size: { x: number; y: number; z: number },
): Region {
  const [first, second] = AXES.filter((axis) => axis !== normalAxis);
  return {
    center,
    halfU: size[first] / 2,
    halfV: size[second] / 2,
    kind: "rectangle",
    u: place.direction(unit(first)),
    v: place.direction(unit(second)),
  };
}

function primitiveMounts(
  primitive: KartAssemblyPrimitiveInstance,
): KartResolvedMount[] {
  const place = frame(primitive);
  const structural = primitive.role === "structure";
  const face = (axis: Axis, sign: 1 | -1, region: Region, offset: number) => ({
    id: FACE_NAMES[axis][sign > 0 ? 1 : 0],
    instanceId: primitive.id,
    kind: "face" as const,
    normal: place.direction(unit(axis, sign)),
    point: place.point(scaleVector(unit(axis, sign), offset)),
    region,
    structural,
  });
  const faces: KartResolvedMount[] = [];
  let contains: (point: KartVector) => boolean;
  if (primitive.shape === "box") {
    const half = scaleVector(
      { x: primitive.size.x, y: primitive.size.y, z: primitive.size.z },
      0.5,
    );
    for (const axis of AXES) {
      for (const sign of [-1, 1] as const) {
        const center = place.point(scaleVector(unit(axis, sign), half[axis]));
        const region = rectangle(place, center, axis, primitive.size);
        faces.push(face(axis, sign, region, half[axis]));
      }
    }
    contains = (point) => {
      const local = place.local(point);
      return AXES.every(
        (axis) =>
          Math.abs(local[axis]) <= half[axis] + KART_MOUNT_TOLERANCE_METERS,
      );
    };
  } else {
    const { axis, height, radius } = primitive;
    for (const sign of [-1, 1] as const) {
      const center = place.point(scaleVector(unit(axis, sign), height / 2));
      faces.push(
        face(axis, sign, { center, kind: "disc", radius }, height / 2),
      );
    }
    contains = (point) => {
      const local = place.local(point);
      const along = local[axis];
      const radial = Math.sqrt(dot(local, local) - along * along);
      return (
        Math.abs(along) <= height / 2 + KART_MOUNT_TOLERANCE_METERS &&
        radial <= radius + KART_MOUNT_TOLERANCE_METERS
      );
    };
  }
  return [
    ...faces,
    {
      contains,
      id: "pin",
      instanceId: primitive.id,
      kind: "pin",
      normal: null,
      point: primitive.transform.position,
      region: null,
      structural,
    },
  ];
}

function componentMounts(
  instance: KartAssemblyComponentInstance,
  definition: ReadonlyDefinition,
): KartResolvedMount[] {
  const point = (id: string, kind: KartMountKind, at: KartVector) => ({
    id,
    instanceId: instance.id,
    kind,
    normal: null,
    point: at,
    region: null,
  });
  if (definition.category === "suspension") {
    const mount = instance.suspensionMount;
    return mount
      ? [
          point("chassis-anchor", "chassis-anchor", mount.chassisAnchor),
          point("hub-anchor", "hub-anchor", mount.hubAnchor),
        ]
      : [];
  }
  if (definition.category === "wheel-tire") {
    return [point("hub", "hub", instance.transform.position)];
  }
  const place = frame(instance);
  return (definition.mounts ?? []).map((mount) => {
    const axis = mount.direction[1] as Axis;
    const sign = mount.direction[0] === "+" ? 1 : -1;
    const at = place.point(mount.position);
    return {
      id: mount.id,
      instanceId: instance.id,
      kind: mount.type,
      normal: place.direction(unit(axis, sign)),
      point: at,
      region: mount.area ? rectangle(place, at, axis, mount.area) : null,
    };
  });
}

/** Every mounting point an instance offers, in assembly space. */
export function listKartInstanceMounts(
  instance: KartMountInstance,
  definition: ReadonlyDefinition | null,
): KartResolvedMount[] {
  if (instance.kind === "primitive") return primitiveMounts(instance);
  return definition ? componentMounts(instance, definition) : [];
}

const PAIRS: ReadonlyArray<[KartMountKind, KartMountKind]> = [
  ["base", "face"],
  ["face", "face"],
  ["face", "tower-pad"],
  ["motor-face", "motor-plate"],
  ["chassis-anchor", "pin"],
  ["hub", "hub-anchor"],
];

function within(region: Region, point: KartVector) {
  const offset = subtractVector(point, region.center);
  const reach = (half: number) => half + KART_MOUNT_TOLERANCE_METERS;
  if (region.kind === "disc") return length(offset) <= reach(region.radius);
  return (
    Math.abs(dot(offset, region.u)) <= reach(region.halfU) &&
    Math.abs(dot(offset, region.v)) <= reach(region.halfV)
  );
}

function onPlane(mount: KartResolvedMount, point: KartVector) {
  return (
    Math.abs(dot(subtractVector(point, mount.point), mount.normal!)) <=
    KART_MOUNT_TOLERANCE_METERS
  );
}

function corners(region: Region & { kind: "rectangle" }) {
  return [-1, 1].flatMap((su) =>
    [-1, 1].map((sv) =>
      addVector(
        region.center,
        addVector(
          scaleVector(region.u, su * region.halfU),
          scaleVector(region.v, sv * region.halfV),
        ),
      ),
    ),
  );
}

/**
 * Whether two mounting points meet at `point` (in assembly space). Returns
 * the first rule they break, or null when they meet.
 */
export function checkKartMountPair(
  first: KartResolvedMount,
  second: KartResolvedMount,
  point: KartVector,
): KartMountIssue | null {
  const pair = PAIRS.find(
    ([a, b]) =>
      (first.kind === a && second.kind === b) ||
      (first.kind === b && second.kind === a),
  );
  if (!pair) {
    return {
      code: "incompatible-mounts",
      message: `A ${first.kind} mounting point cannot meet a ${second.kind}.`,
    };
  }
  const [a, b] = first.kind === pair[0] ? [first, second] : [second, first];
  const at = (mount: KartResolvedMount) =>
    length(subtractVector(point, mount.point)) <= KART_MOUNT_TOLERANCE_METERS;

  if (
    a.normal &&
    b.normal &&
    dot(a.normal, b.normal) > -1 + KART_MOUNT_ALIGNMENT_TOLERANCE
  ) {
    return {
      code: "misaligned-mounts",
      message: `"${a.id}" and "${b.id}" must face each other.`,
    };
  }
  switch (pair[0]) {
    case "base": {
      if (!b.structural) {
        return {
          code: "unsupported-mount-face",
          message: "A part's base footprint sits only on a structural face.",
        };
      }
      if (!at(a) || !onPlane(b, point)) {
        return {
          code: "separated-mounts",
          message: `The base footprint must sit on "${b.id}" at the attachment point.`,
        };
      }
      const footprint = a.region as Region & { kind: "rectangle" };
      if (
        !corners(footprint).every(
          (corner) => onPlane(b, corner) && within(b.region!, corner),
        )
      ) {
        return {
          code: "mount-outside-face",
          message: `All of the base footprint must rest on "${b.id}".`,
        };
      }
      return null;
    }
    case "face": {
      if (!onPlane(a, point) || !onPlane(b, point)) {
        return {
          code: "separated-mounts",
          message: `"${a.id}" and "${b.id}" must touch at the attachment point.`,
        };
      }
      if (!within(a.region!, point) || !within(b.region!, point)) {
        return {
          code: "mount-outside-face",
          message: `The attachment point must lie within both "${a.id}" and "${b.id}".`,
        };
      }
      return null;
    }
    case "chassis-anchor":
      if (!b.structural) {
        return {
          code: "unsupported-mount-face",
          message: "A shock's top eye mounts only on a pin through structure.",
        };
      }
      if (!at(a) || !b.contains!(point)) {
        return {
          code: "separated-mounts",
          message:
            "The shock's top eye must be the attachment point, on a pin through the part.",
        };
      }
      return null;
    default:
      if (!at(a) || !at(b)) {
        return {
          code: "separated-mounts",
          message: `"${a.id}" and "${b.id}" must both be at the attachment point.`,
        };
      }
      return null;
  }
}

/**
 * The attachment's point in assembly space: midway between its two ends'
 * anchors, which validation requires to meet. Null when they are apart.
 */
export function getKartAttachmentPoint(
  attachment: KartStructuralAttachment,
  parent: KartMountInstance,
  child: KartMountInstance,
) {
  const fromParent = frame(parent).point(attachment.parent.anchor);
  const fromChild = frame(child).point(attachment.child.anchor);
  if (
    length(subtractVector(fromParent, fromChild)) > KART_MOUNT_TOLERANCE_METERS
  ) {
    return null;
  }
  return scaleVector(addVector(fromParent, fromChild), 0.5);
}

/**
 * Checks the mounting points an attachment names. An attachment that names
 * neither is unchecked (documents from before schema 3).
 */
export function checkKartAttachmentMounts(
  attachment: KartStructuralAttachment,
  parent: KartMountSide,
  child: KartMountSide,
): KartMountIssue[] {
  const parentMount = attachment.parent.mount;
  const childMount = attachment.child.mount;
  if (parentMount === null && childMount === null) return [];
  if (parentMount === null || childMount === null) {
    return [
      {
        code: "incomplete-mount-names",
        endpoint: parentMount === null ? "parent" : "child",
        message:
          "A structural attachment must name a mounting point at both ends or at neither.",
      },
    ];
  }
  const issues: KartMountIssue[] = [];
  const resolve = (
    side: typeof parent,
    id: string,
    endpoint: "child" | "parent",
  ): KartResolvedMount | null => {
    const mount = listKartInstanceMounts(side.instance, side.definition).find(
      (candidate) => candidate.id === id,
    );
    if (!mount) {
      issues.push({
        code: "unknown-mount",
        endpoint,
        message: `"${side.instance.id}" has no mounting point "${id}".`,
      });
    }
    return mount ?? null;
  };
  const parentResolved = resolve(parent, parentMount, "parent");
  const childResolved = resolve(child, childMount, "child");
  // Validation reports anchors that do not meet on their own.
  const point = getKartAttachmentPoint(
    attachment,
    parent.instance,
    child.instance,
  );
  if (!parentResolved || !childResolved || !point) return issues;
  const issue = checkKartMountPair(childResolved, parentResolved, point);
  return issue ? [issue] : [];
}

/**
 * The pair of mounting points (parent, child) that meet at an attachment
 * as it stands, if any: what the editor snaps to and the official karts
 * name.
 */
export function findKartAttachmentMounts(
  attachment: KartStructuralAttachment,
  parent: KartMountSide,
  child: KartMountSide,
): { child: string; parent: string } | null {
  const point = getKartAttachmentPoint(
    attachment,
    parent.instance,
    child.instance,
  );
  if (!point) return null;
  for (const parentMount of listKartInstanceMounts(
    parent.instance,
    parent.definition,
  )) {
    for (const childMount of listKartInstanceMounts(
      child.instance,
      child.definition,
    )) {
      if (!checkKartMountPair(childMount, parentMount, point)) {
        return { child: childMount.id, parent: parentMount.id };
      }
    }
  }
  return null;
}
