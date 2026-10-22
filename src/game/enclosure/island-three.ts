import { deepFreeze, type DeepReadonly } from "../kart/immutable-registry";

/**
 * Approved habitat enclosures, pinned by `id@version` like surface materials,
 * so a saved course keeps the habitat it was built in. Structure and
 * conventions are documented in docs/island-three.md.
 */
export type EnclosureDefinition = {
  id: string;
  version: number;
  /** Floor radius, metres. */
  radius: number;
  /** Interior length between the end caps, metres. */
  length: number;
  /**
   * Land valleys alternating with window strips around the circumference,
   * each spanning 180 / valleyCount degrees. Valley k is centred at azimuth
   * k × 360 / valleyCount.
   */
  valleyCount: number;
  /** Sunlight reflected in through the windows. */
  sunlight: { color: { b: number; g: number; r: number }; intensity: number };
};

export type EnclosurePlacement = {
  /** Metres along the axis from the midpoint; positive toward the sunward cap. */
  axial: number;
  /** Degrees around the axis, increasing spinward. */
  azimuth: number;
  /** Yaw, degrees, from the course's -Z to the sunward axis. */
  heading: number;
  /** Metres above the floor. */
  height: number;
};

export type CourseEnclosure = {
  id: string;
  version: number;
  /** Mirror opening from the window, degrees: 45 is noon. */
  mirrorAngle: number;
  placement: EnclosurePlacement;
};

type Vector3 = { x: number; y: number; z: number };

export const ISLAND_THREE_ENCLOSURE = {
  id: "enclosure.island-three",
  version: 1,
};

// Courses keep clear of the end caps and window edges by these margins.
const END_CAP_MARGIN = 500;
const WINDOW_EDGE_MARGIN_DEGREES = 1.5;
const AXIS_MARGIN = 100;

export const MIRROR_ANGLE_LIMITS = { max: 85, min: 5 } as const;

const enclosures = new Map(
  (
    [
      {
        ...ISLAND_THREE_ENCLOSURE,
        length: 32_000,
        radius: 4_000,
        sunlight: { color: { b: 0.78, g: 0.91, r: 1 }, intensity: 0.78 },
        valleyCount: 3,
      },
    ] satisfies EnclosureDefinition[]
  ).map((definition) => [
    `${definition.id}@${definition.version}`,
    deepFreeze(definition),
  ]),
);

export function getApprovedEnclosure(reference: {
  id: string;
  version: number;
}): DeepReadonly<EnclosureDefinition> | undefined {
  return enclosures.get(`${reference.id}@${reference.version}`);
}

/** The valley centre nearest an azimuth, in degrees. */
function nearestValleyCentre(
  definition: DeepReadonly<EnclosureDefinition>,
  azimuth: number,
) {
  const spacing = 360 / definition.valleyCount;
  return Math.round(azimuth / spacing) * spacing;
}

/** Reasons a placement does not fit its enclosure; empty when it fits. */
export function getEnclosurePlacementIssues(
  definition: DeepReadonly<EnclosureDefinition>,
  placement: EnclosurePlacement,
) {
  const issues: { message: string; path: keyof EnclosurePlacement }[] = [];
  const axialLimit = definition.length / 2 - END_CAP_MARGIN;
  if (Math.abs(placement.axial) > axialLimit) {
    issues.push({
      message: `Placement must stay within ${axialLimit} m of the enclosure midpoint`,
      path: "axial",
    });
  }
  const valleyHalfWidth =
    90 / definition.valleyCount - WINDOW_EDGE_MARGIN_DEGREES;
  if (
    Math.abs(
      placement.azimuth - nearestValleyCentre(definition, placement.azimuth),
    ) > valleyHalfWidth
  ) {
    issues.push({
      message: "Placement must sit on a land valley, clear of the windows",
      path: "azimuth",
    });
  }
  if (placement.height > definition.radius - AXIS_MARGIN) {
    issues.push({
      message: `Placement must stay at least ${AXIS_MARGIN} m from the axis`,
      path: "height",
    });
  }
  return issues;
}

function add(a: Vector3, b: Vector3, scale = 1): Vector3 {
  return { x: a.x + b.x * scale, y: a.y + b.y * scale, z: a.z + b.z * scale };
}

function scaled(vector: Vector3, scale: number): Vector3 {
  return { x: vector.x * scale, y: vector.y * scale, z: vector.z * scale };
}

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

/**
 * The enclosure in course coordinates (metres, Y-up, the course origin at the
 * placement). The cylinder spins right-handed about the sunward axis, so
 * spinward = up × sunward.
 */
export function getEnclosureFrame(enclosure: CourseEnclosure) {
  const definition = getApprovedEnclosure(enclosure);
  if (!definition) {
    throw new Error("Unsupported enclosure");
  }
  const { axial, azimuth, heading, height } = enclosure.placement;
  const yaw = toRadians(heading);
  const up = { x: 0, y: 1, z: 0 };
  const sunward = { x: -Math.sin(yaw), y: 0, z: -Math.cos(yaw) };
  const spinward = { x: -Math.cos(yaw), y: 0, z: Math.sin(yaw) };
  const axisOrigin = scaled(up, definition.radius - height);

  /** Outward from the axis at an azimuth, in course coordinates. */
  const outward = (atAzimuth: number) => {
    const offset = toRadians(atAzimuth - azimuth);
    return add(scaled(up, -Math.cos(offset)), spinward, Math.sin(offset));
  };

  return {
    definition,
    outward,
    spinward,
    sunward,
    up,
    /** A point in cylinder coordinates, in course coordinates. */
    point(atAxial: number, atAzimuth: number, radius: number) {
      return add(
        add(axisOrigin, sunward, atAxial - axial),
        outward(atAzimuth),
        radius,
      );
    },
    /**
     * Unit vector toward the sun's image. Each valley is lit through the
     * window opposite it, by a flat mirror hinged at the window's anti-sun
     * end: a mirror opened by α turns the sun's rays by 2α, so the image sits
     * 2α above the sunward horizon (overhead at 45°).
     */
    sunDirection() {
      const deflection = toRadians(2 * enclosure.mirrorAngle);
      const window = nearestValleyCentre(definition, azimuth) + 180;
      return add(
        scaled(sunward, Math.cos(deflection)),
        outward(window),
        Math.sin(deflection),
      );
    },
  };
}
