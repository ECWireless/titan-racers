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

export type Vector3 = { x: number; y: number; z: number };

export const ISLAND_THREE_ENCLOSURE = {
  id: "enclosure.island-three",
  version: 1,
};

// Courses keep clear of the end caps and window edges by these margins.
const END_CAP_MARGIN = 1_200;
const WINDOW_EDGE_MARGIN_DEGREES = 1.5;
const AXIS_MARGIN = 100;

/**
 * The Sun's angular radius, radians. Island Three orbits Saturn with Titan,
 * 9.54 AU out, where the Sun looks a tenth as wide as from Earth.
 */
export const SUN_ANGULAR_RADIUS = 0.004652 / 9.54;

/**
 * The registry's sunlight stands for full sunlight, in lux. A white surface
 * shows the illuminance it receives, so one cd/m² of luminance is π lux of
 * scene light, and a lamp's candela sets its light's intensity in lux.
 */
export const SUNLIGHT_LUX = 100_000;

/** Scene light per lux in an enclosure, by luminance. */
export function sceneLux(definition: DeepReadonly<EnclosureDefinition>) {
  const { color, intensity } = definition.sunlight;
  return (
    (intensity * (0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b)) /
    SUNLIGHT_LUX
  );
}

/** A mirror at 90° stands fully open, so its window sees only space: night. */
export const MIRROR_ANGLE_LIMITS = { max: 90, min: 5 } as const;

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

export function add(a: Vector3, b: Vector3, scale = 1): Vector3 {
  return { x: a.x + b.x * scale, y: a.y + b.y * scale, z: a.z + b.z * scale };
}

export function dot(a: Vector3, b: Vector3) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function scaled(vector: Vector3, scale: number): Vector3 {
  return { x: vector.x * scale, y: vector.y * scale, z: vector.z * scale };
}

export function normalize(vector: Vector3): Vector3 {
  return scaled(vector, 1 / Math.hypot(vector.x, vector.y, vector.z));
}

export function cross(a: Vector3, b: Vector3): Vector3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
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

  const mirrorAngle = toRadians(enclosure.mirrorAngle);
  const deflection = 2 * mirrorAngle;
  const valleyCentres = Array.from(
    { length: definition.valleyCount },
    (_, k) => (k * 360) / definition.valleyCount,
  );
  const point = (atAxial: number, atAzimuth: number, radius: number) =>
    add(add(axisOrigin, sunward, atAxial - axial), outward(atAzimuth), radius);
  /** Toward the sun's image seen from a valley, through its window. */
  const sunFromValley = (centre: number) =>
    add(
      scaled(sunward, Math.cos(deflection)),
      outward(centre + 180),
      Math.sin(deflection),
    );

  /**
   * The mirror lighting each valley: a flat mirror the length of the
   * cylinder, hinged across the anti-sun end of the window opposite the
   * valley and opened toward the Sun by the mirror angle. Its normal faces
   * the Sun and the window.
   */
  const mirrors = valleyCentres.map((centre) => {
    const out = outward(centre + 180);
    return {
      across: outward(centre + 270),
      along: add(
        scaled(sunward, Math.cos(mirrorAngle)),
        out,
        Math.sin(mirrorAngle),
      ),
      halfWidth:
        definition.radius * Math.sin(toRadians(90 / definition.valleyCount)),
      hinge: point(-definition.length / 2, centre + 180, definition.radius),
      length: definition.length,
      normal: add(
        scaled(sunward, Math.sin(mirrorAngle)),
        out,
        -Math.cos(mirrorAngle),
      ),
      toSun: sunFromValley(centre),
    };
  });

  /**
   * Whether a mirror's sunlight reaches a point: looking toward that
   * mirror's sun image, the point sees the mirror.
   */
  const reflects = (mirror: (typeof mirrors)[number], at: Vector3) => {
    const facing = dot(mirror.toSun, mirror.normal);
    if (facing >= 0) return false;
    const distance = dot(add(mirror.hinge, at, -1), mirror.normal) / facing;
    if (distance <= 0) return false;
    const hit = add(add(at, mirror.toSun, distance), mirror.hinge, -1);
    const along = dot(hit, mirror.along);
    return (
      along >= 0 &&
      along <= mirror.length &&
      Math.abs(dot(hit, mirror.across)) <= mirror.halfWidth
    );
  };

  /**
   * Sunlight on a surface at a point facing along a normal, relative to
   * the sunlight's full intensity: the cosine toward each mirror's sun
   * image that reflects onto the point.
   */
  const sunlightOn = (at: Vector3, normal: Vector3) =>
    mirrors.reduce(
      (light, mirror) =>
        light +
        (reflects(mirror, at) ? Math.max(dot(normal, mirror.toSun), 0) : 0),
      0,
    );

  return {
    definition,
    mirrors,
    outward,
    point,
    spinward,
    sunward,
    /**
     * Unit vector toward the sun's image. Each valley is lit through the
     * window opposite it: a mirror opened by α turns the sun's rays by 2α, so
     * the image sits 2α above the sunward horizon (overhead at 45°).
     */
    sunDirection() {
      return sunFromValley(nearestValleyCentre(definition, azimuth));
    },
    /**
     * Whether the course's mirror reflects sunlight onto a point (course
     * coordinates). A 32 km mirror lights only a band of its valley, which
     * moves along the axis with the mirror angle.
     */
    sunReaches(at: Vector3 = { x: 0, y: 0, z: 0 }) {
      const count = definition.valleyCount;
      const valley = Math.round((azimuth * count) / 360);
      return reflects(mirrors[((valley % count) + count) % count]!, at);
    },
    /**
     * Sunlight the mirrors send into the habitat, relative to a noon
     * mirror's full catch: what lands on the floors and end caps. Opening a
     * mirror past noon moves its light onto the sunward cap and then out of
     * the windows altogether, which makes dusk and night. Every valley
     * shares the angle, so one valley and its two cap sectors stand for all.
     */
    daylight() {
      const { length, radius } = definition;
      const spacing = 360 / definition.valleyCount;
      const halfStrip = spacing / 4;
      const sample = (
        steps: readonly [number, number],
        at: (u: number, v: number) => { area: number; normal: Vector3; point: Vector3 },
      ) => {
        let flux = 0;
        for (let i = 0; i < steps[0]; i += 1) {
          for (let j = 0; j < steps[1]; j += 1) {
            const { area, normal, point } = at(
              (i + 0.5) / steps[0],
              (j + 0.5) / steps[1],
            );
            flux += sunlightOn(point, normal) * area;
          }
        }
        return flux;
      };
      const floorStep = [64, 12] as const;
      const floor = sample(floorStep, (u, v) => {
        const along = (u - 0.5) * length;
        const around = (v - 0.5) * 2 * halfStrip;
        return {
          area:
            (length / floorStep[0]) *
            ((toRadians(2 * halfStrip) * radius) / floorStep[1]),
          normal: scaled(outward(around), -1),
          point: point(along, around, radius - 1),
        };
      });
      const capStep = [24, 24] as const;
      const caps = [1, -1].reduce(
        (flux, end) =>
          flux +
          sample(capStep, (u, v) => {
            const fromAxis = u * radius;
            const around = (v - 0.5) * spacing;
            return {
              area:
                (radius / capStep[0]) *
                ((toRadians(spacing) * fromAxis) / capStep[1]),
              normal: scaled(sunward, -end),
              point: point(end * (length / 2 - 1), around, fromAxis),
            };
          }),
        0,
      );
      const noonCatch =
        mirrors[0]!.halfWidth * 2 * length * Math.sin(Math.PI / 4);
      return (floor + caps) / noonCatch;
    },
    sunlightOn,
  };
}
