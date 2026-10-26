import { getApprovedEnclosure } from "../enclosure/island-three";
import type { CourseDocument, CourseObject } from "./course-document";

/**
 * Non-production test structure: an open ramp from a floor course up to a
 * flat pad 500 m from the habitat axis, then on to the axis itself, where an
 * end wall stops karts crossing it. Its centreline runs sunward through the
 * course origin, in the plane containing the axis, so gravity there points
 * straight down the course's vertical and only weakens (see
 * skills/game-concepts/rotating-habitat-physics).
 */
const AXIS_RAMP_TEST = Object.freeze({
  /**
   * The apron starts on the course's own ground, runs out through a gap in
   * its perimeter wall, and meets the ramp 60 m from the course origin.
   */
  apronStart: 20,
  apronLength: 40,
  padHeight: 3_500,
  padLength: 80,
  padWidth: 60,
  rampWidth: 8,
  slopeDegrees: 20,
  /**
   * Ramp collider pieces, metres along the slope; short enough that Bullet's
   * contact maths against centimetre wheels stays well conditioned.
   */
  segmentLength: 100,
  thickness: 1,
  wallHeight: 1.5,
  wallThickness: 0.5,
});

type Vector3 = { x: number; y: number; z: number };

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
const add = (a: Vector3, b: Vector3, scale = 1): Vector3 => ({
  x: a.x + b.x * scale,
  y: a.y + b.y * scale,
  z: a.z + b.z * scale,
});

const STANDARD_SURFACE = { id: "surface.standard-course", version: 1 };

function box(
  id: string,
  center: Vector3,
  rotation: Vector3,
  size: Vector3,
  role: "drivable-surface" | "solid-obstacle",
  material: CourseObject["visual"]["material"],
): CourseObject {
  return {
    availability: "standard",
    category: role === "drivable-surface" ? "surface" : "obstacle",
    collision: {
      friction: 0.7,
      halfExtents: { x: size.x / 2, y: size.y / 2, z: size.z / 2 },
      offset: {
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
      },
      restitution: 0,
      role,
      shape: "box",
      surfaceMaterial: STANDARD_SURFACE,
    },
    editable: false,
    id,
    transform: { position: center, rotation },
    visual: { material, scale: size, shape: "box" },
  };
}

/**
 * The ramp's frame for a pitch: `along` runs up the slope toward the sunward
 * end cap, `normal` is its top face, and `right` its width. Matches course
 * Euler rotations `{ x: pitch, y: heading, z: 0 }` with length along local Z.
 */
function slopeFrame(heading: number, pitchDegrees: number) {
  const yaw = toRadians(heading);
  const pitch = toRadians(pitchDegrees);
  return {
    along: {
      x: -Math.cos(pitch) * Math.sin(yaw),
      y: Math.sin(pitch),
      z: -Math.cos(pitch) * Math.cos(yaw),
    },
    normal: {
      x: Math.sin(pitch) * Math.sin(yaw),
      y: Math.cos(pitch),
      z: Math.sin(pitch) * Math.cos(yaw),
    },
    right: { x: Math.cos(yaw), y: 0, z: -Math.sin(yaw) },
    rotation: { x: pitchDegrees, y: heading, z: 0 },
  };
}

/** A strip whose top face starts at `from` and runs `length` along. */
function strip(
  id: string,
  from: Vector3,
  heading: number,
  pitch: number,
  length: number,
  width: number,
  material: CourseObject["visual"]["material"],
) {
  const frame = slopeFrame(heading, pitch);
  const mid = add(from, frame.along, length / 2);
  return {
    end: add(from, frame.along, length),
    object: box(
      id,
      add(mid, frame.normal, -AXIS_RAMP_TEST.thickness / 2),
      frame.rotation,
      { x: width, y: AXIS_RAMP_TEST.thickness, z: length },
      "drivable-surface",
      material,
    ),
  };
}

/** An open ramp climbing `rise` metres, split into collider segments. */
function ramp(id: string, from: Vector3, heading: number, rise: number) {
  const { rampWidth, segmentLength, slopeDegrees } = AXIS_RAMP_TEST;
  const total = rise / Math.sin(toRadians(slopeDegrees));
  const objects: CourseObject[] = [];
  let start = from;
  for (let travelled = 0, index = 0; travelled < total; index += 1) {
    const length = Math.min(segmentLength, total - travelled);
    const piece = strip(
      `${id}-${index}`,
      start,
      heading,
      slopeDegrees,
      length,
      rampWidth,
      "ramp",
    );
    objects.push(piece.object);
    start = piece.end;
    travelled += length;
  }
  return { end: start, objects };
}

/**
 * Splits any axis-aligned perimeter wall that the ramp's centreline (from the
 * course origin along `along`) crosses, leaving a gap the ramp's width wide.
 */
function openPerimeter(objects: CourseObject[], along: Vector3) {
  const margin = 1;
  return objects.flatMap((object) => {
    const collision = object.collision;
    const { position, rotation } = object.transform;
    if (
      !object.id.startsWith("perimeter-wall") ||
      collision?.shape !== "box" ||
      object.visual.shape === "arc" ||
      collision.offset.position.x !== 0 ||
      collision.offset.position.z !== 0 ||
      rotation.x !== 0 ||
      rotation.y !== 0 ||
      rotation.z !== 0
    ) {
      return [object];
    }
    const { visual } = object;
    const long = collision.halfExtents.x > collision.halfExtents.z ? "x" : "z";
    const across = long === "x" ? "z" : "x";
    if (Math.abs(along[across]) < 1e-6) return [object];
    const t = position[across] / along[across];
    const crossing = t * along[long];
    const half = collision.halfExtents[long];
    if (t <= 0 || Math.abs(crossing - position[long]) > half) return [object];
    const gapHalf =
      AXIS_RAMP_TEST.rampWidth / 2 / Math.abs(along[across]) + margin;
    return [
      [position[long] - half, crossing - gapHalf, "a"],
      [crossing + gapHalf, position[long] + half, "b"],
    ]
      .filter(([from, to]) => (to as number) > (from as number))
      .map(([from, to, suffix]) => {
        const length = (to as number) - (from as number);
        const centre = ((from as number) + (to as number)) / 2;
        return {
          ...object,
          collision: {
            ...collision,
            halfExtents: { ...collision.halfExtents, [long]: length / 2 },
          },
          id: `${object.id}-${suffix}`,
          transform: {
            ...object.transform,
            position: { ...position, [long]: centre },
          },
          visual: { ...visual, scale: { ...visual.scale, [long]: length } },
        };
      });
  });
}

/**
 * The Starter Course with the axis ramp added and its start moved to the
 * apron. `startHeight` (metres above the floor) starts the kart partway up
 * instead: on the first ramp, on the pad, or on the final ramp.
 */
export function withAxisRampTest(
  document: CourseDocument,
  startHeight = 0,
): CourseDocument {
  const definition = getApprovedEnclosure(document.enclosure);
  if (!definition) {
    throw new Error("Unsupported enclosure");
  }
  const {
    apronLength,
    apronStart,
    padHeight,
    padLength,
    padWidth,
    rampWidth,
    slopeDegrees,
    wallHeight,
    wallThickness,
  } = AXIS_RAMP_TEST;
  const { heading, height } = document.enclosure.placement;
  const axisHeight = definition.radius - height;
  const level = slopeFrame(heading, 0);
  const sloped = slopeFrame(heading, slopeDegrees);
  const sinSlope = Math.sin(toRadians(slopeDegrees));

  // 2 mm above the course's own coplanar surfaces so their tops don't fight.
  const apronFrom = add({ x: 0, y: 0.002, z: 0 }, level.along, apronStart);
  const apron = strip(
    "axis-ramp-apron",
    apronFrom,
    heading,
    0,
    apronLength,
    rampWidth,
    "asphalt",
  );
  const climb = ramp("axis-ramp-climb", apron.end, heading, padHeight);
  const padFrom = climb.end;
  const padEnd = add(padFrom, level.along, padLength);
  const padMid = add(padFrom, level.along, padLength / 2);
  const pad = box(
    "axis-ramp-pad",
    add(padMid, level.normal, -AXIS_RAMP_TEST.thickness / 2),
    level.rotation,
    { x: padWidth, y: AXIS_RAMP_TEST.thickness, z: padLength },
    "drivable-surface",
    "asphalt",
  );
  const final = ramp(
    "axis-ramp-final",
    padEnd,
    heading,
    axisHeight - padHeight,
  );
  const endWall = box(
    "axis-ramp-end-wall",
    add(
      add(final.end, sloped.along, -wallThickness / 2),
      sloped.normal,
      wallHeight / 2,
    ),
    sloped.rotation,
    { x: rampWidth, y: wallHeight, z: wallThickness },
    "solid-obstacle",
    "steel",
  );

  // Sloped starts drop the kart from just above the ramp: the course start
  // adds the kart's root height straight up, which on a slope would sink its
  // wheels, and in weak gravity the suspension would throw it into a long hop.
  const slopeStartLift = 0.05;
  // Within a metre of a crease, start on the level surface instead, so the
  // course start's setback never pushes a pitched kart into the slab.
  const crease = 1;
  const start = (() => {
    const clamped = Math.min(
      Math.max(Number.isNaN(startHeight) ? 0 : startHeight, 0),
      axisHeight - 10,
    );
    if (clamped < crease) {
      return {
        position: add(apronFrom, level.along, apronLength / 3),
        rotation: level.rotation,
      };
    }
    if (clamped < padHeight - crease) {
      return {
        position: add(
          add(apron.end, sloped.along, clamped / sinSlope),
          sloped.normal,
          slopeStartLift,
        ),
        rotation: sloped.rotation,
      };
    }
    if (clamped < padHeight + crease) {
      return { position: padMid, rotation: level.rotation };
    }
    return {
      position: add(
        add(padEnd, sloped.along, (clamped - padHeight) / sinSlope),
        sloped.normal,
        slopeStartLift,
      ),
      rotation: sloped.rotation,
    };
  })();

  return {
    ...document,
    objects: [
      ...openPerimeter(document.objects, level.along),
      apron.object,
      ...climb.objects,
      pad,
      ...final.objects,
      endWall,
    ],
    start: { ...document.start, ...start },
  };
}
