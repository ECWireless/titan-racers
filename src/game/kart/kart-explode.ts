import type {
  KartAssemblyDocument,
  KartStructuralAttachment,
} from "./kart-assembly-document";
import { getApprovedKartComponent } from "./kart-component-registry";
import {
  addVector,
  buildComponentMassElements,
  buildPrimitiveMassElement,
  scaleVector,
  subtractVector,
  type KartVector,
} from "./kart-construction-geometry";
import { getConvexShapeBounds } from "./kart-convex-distance";
import { listKartInstanceMounts, type KartMountInstance } from "./kart-mounting";

/** The gap an exploded part opens beyond its own depth, in metres. */
const EXPLODE_GAP = 0.02;
/** How much of its own depth along the way it moves a part lifts it. */
const EXPLODE_DEPTH_SHARE = 0.6;
/**
 * The most depth that counts, so a long part held by its end, such as a
 * deck on a tower, doesn't slide its whole length away.
 */
const EXPLODE_DEPTH_LIMIT = 0.08;

type Bounds = { maximum: KartVector; minimum: KartVector };

function instanceBounds(
  instance: KartMountInstance,
): Bounds | null {
  const shapes =
    instance.kind === "primitive"
      ? [buildPrimitiveMassElement(instance).solid]
      : (() => {
          const definition = getApprovedKartComponent(instance.definition);
          return definition
            ? buildComponentMassElements(instance, definition).map(
                ({ solid }) => solid,
              )
            : [];
        })();
  if (shapes.length === 0) return null;
  return shapes.map(getConvexShapeBounds).reduce((all, bounds) => ({
    maximum: {
      x: Math.max(all.maximum.x, bounds.maximum.x),
      y: Math.max(all.maximum.y, bounds.maximum.y),
      z: Math.max(all.maximum.z, bounds.maximum.z),
    },
    minimum: {
      x: Math.min(all.minimum.x, bounds.minimum.x),
      y: Math.min(all.minimum.y, bounds.minimum.y),
      z: Math.min(all.minimum.z, bounds.minimum.z),
    },
  }));
}

const center = ({ maximum, minimum }: Bounds) =>
  scaleVector(addVector(maximum, minimum), 0.5);

function normalize(vector: KartVector): KartVector | null {
  const length = Math.hypot(vector.x, vector.y, vector.z);
  return length > 1e-9 ? scaleVector(vector, 1 / length) : null;
}

/**
 * Which way a part leaves its parent: off the face it is mounted on, or for
 * a suspension or wheel, outboard. A part joined without named mounts moves
 * away from its parent's centre.
 */
function explodeDirection(
  attachment: KartStructuralAttachment,
  parent: KartMountInstance,
  child: KartMountInstance,
  parentBounds: Bounds | null,
  childBounds: Bounds | null,
): KartVector {
  const parentMount = attachment.parent.mount
    ? listKartInstanceMounts(
        parent,
        parent.kind === "component"
          ? (getApprovedKartComponent(parent.definition) ?? null)
          : null,
      ).find(({ id }) => id === attachment.parent.mount)
    : undefined;
  if (parentMount?.normal) return parentMount.normal;
  const from = parentBounds ? center(parentBounds) : parent.transform.position;
  const to = childBounds ? center(childBounds) : child.transform.position;
  if (parentMount) {
    // A pin or hub: suspensions and wheels move outboard.
    return { x: Math.sign(to.x) || 1, y: 0, z: 0 };
  }
  return normalize(subtractVector(to, from)) ?? { x: 0, y: 1, z: 0 };
}

/**
 * Each instance's offset in a fully exploded view: every part moves off the
 * part it is mounted on, carrying the parts mounted on it, by its own depth
 * along the way it moves plus a gap. Parts mounted on nothing stay put.
 */
export function getKartExplodeOffsets(
  document: KartAssemblyDocument,
): Map<string, KartVector> {
  const instances = new Map<string, KartMountInstance>(
    [...document.primitiveInstances, ...document.componentInstances].map(
      (instance) => [instance.id, instance],
    ),
  );
  const parentOf = new Map(
    document.structuralAttachments.map((attachment) => [
      attachment.child.instanceId,
      attachment,
    ]),
  );
  const bounds = new Map<string, Bounds | null>();
  const boundsOf = (id: string) => {
    if (!bounds.has(id)) {
      const instance = instances.get(id);
      bounds.set(id, instance ? instanceBounds(instance) : null);
    }
    return bounds.get(id)!;
  };
  const offsets = new Map<string, KartVector>();
  const offsetOf = (id: string, visiting: Set<string>): KartVector => {
    const known = offsets.get(id);
    if (known) return known;
    const attachment = parentOf.get(id);
    const parent = attachment && instances.get(attachment.parent.instanceId);
    const child = instances.get(id);
    let offset: KartVector = { x: 0, y: 0, z: 0 };
    if (attachment && parent && child && !visiting.has(id)) {
      visiting.add(id);
      const childBounds = boundsOf(id);
      const direction = explodeDirection(
        attachment,
        parent,
        child,
        boundsOf(parent.id),
        childBounds,
      );
      const depth = childBounds
        ? Math.abs(direction.x) * (childBounds.maximum.x - childBounds.minimum.x) +
          Math.abs(direction.y) * (childBounds.maximum.y - childBounds.minimum.y) +
          Math.abs(direction.z) * (childBounds.maximum.z - childBounds.minimum.z)
        : 0;
      offset = addVector(
        offsetOf(parent.id, visiting),
        scaleVector(
          direction,
          EXPLODE_GAP +
            EXPLODE_DEPTH_SHARE * Math.min(depth, EXPLODE_DEPTH_LIMIT),
        ),
      );
    }
    offsets.set(id, offset);
    return offset;
  };
  for (const id of instances.keys()) offsetOf(id, new Set());
  return offsets;
}
