import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

import {
  COURSE_LAMP_LIMIT,
  type CourseDocument,
  courseDocumentSchema,
  FALLS_VIEW_PARK_DOCUMENT,
  getCourseStartTransform,
  isCoursePrimitiveObject,
  parseCourseDocument,
  ROUGH_COURSE_DOCUMENT,
  serializeCourseDocument,
} from "../src/game/course/course-document";

function cloneSeed() {
  return structuredClone(ROUGH_COURSE_DOCUMENT);
}

// The rough course's authored lights before it moved into Island Three.
const LEGACY_LIGHTING = {
  ambient: { color: { b: 0.46, g: 0.39, r: 0.34 }, intensity: 1 },
  directionalLights: [
    {
      color: { b: 0.78, g: 0.91, r: 1 },
      id: "warm-key-light",
      intensity: 0.78,
      rotation: { x: 52, y: 38, z: 0 },
      shadowQuality: "medium",
    },
    {
      color: { b: 0.9, g: 0.68, r: 0.55 },
      id: "cool-fill-light",
      intensity: 0.32,
      rotation: { x: 28, y: -132, z: 0 },
      shadowQuality: "off",
    },
  ],
};

function createVersionThreeSeed() {
  const document: Partial<ReturnType<typeof cloneSeed>> = cloneSeed();
  delete document.enclosure;
  return {
    ...(document as Omit<ReturnType<typeof cloneSeed>, "enclosure">),
    lighting: structuredClone(LEGACY_LIGHTING),
    schemaVersion: 3 as const,
  };
}

function createVersionTwoSeed() {
  const document = createVersionThreeSeed();
  const start: Partial<typeof document.start> = { ...document.start };
  delete start.spawnDistance;
  return {
    ...document,
    schemaVersion: 2 as const,
    start,
    objects: document.objects.map((object) => {
      if (!object.collision) return object;
      const collision = { ...object.collision } as Partial<
        typeof object.collision
      >;
      delete collision.surfaceMaterial;
      return { ...object, collision };
    }),
  };
}

function createVersionOneSeed() {
  const document = createVersionTwoSeed();
  const start = {
    id: document.start.id,
    position: document.start.position,
    rotation: document.start.rotation,
  };

  return {
    ...document,
    checkpoints: document.checkpoints.map((checkpoint) => ({
      halfExtents: checkpoint.halfExtents,
      id: checkpoint.id,
      order: checkpoint.order,
      position: checkpoint.position,
      rotation: checkpoint.rotation,
    })),
    schemaVersion: 1 as const,
    start,
  };
}

function findObject(id: string) {
  return ROUGH_COURSE_DOCUMENT.objects
    .filter(isCoursePrimitiveObject)
    .find((object) => object.id === id);
}

test("parses the versioned rough course with stable IDs and ordered checkpoints", () => {
  expect(ROUGH_COURSE_DOCUMENT.schemaVersion).toBe(6);
  expect(ROUGH_COURSE_DOCUMENT.units).toBe("meters");
  expect(ROUGH_COURSE_DOCUMENT.start.id).toBe("start-position");
  expect(ROUGH_COURSE_DOCUMENT.checkpoints).toHaveLength(3);
  expect(
    ROUGH_COURSE_DOCUMENT.checkpoints.map((checkpoint) => checkpoint.order),
  ).toEqual([1, 2, 3]);
  // Gates reach from the infield 4 m out into the grass beyond the lane.
  expect(ROUGH_COURSE_DOCUMENT.start.gateHalfExtents).toEqual({
    x: 8,
    y: 1.5,
    z: 0.4,
  });
  expect(
    ROUGH_COURSE_DOCUMENT.checkpoints.map((checkpoint) => checkpoint.forward),
  ).toEqual([
    { x: 0, y: 0, z: 1 },
    { x: 1, y: 0, z: 0 },
    { x: 0, y: 0, z: -1 },
  ]);
  for (const checkpoint of ROUGH_COURSE_DOCUMENT.checkpoints) {
    expect(
      Math.hypot(
        checkpoint.forward.x,
        checkpoint.forward.y,
        checkpoint.forward.z,
      ),
    ).toBeCloseTo(1, 8);
    expect(checkpoint.recovery.position.y).toBe(0);
  }

  const ids = [
    ROUGH_COURSE_DOCUMENT.start.id,
    ...ROUGH_COURSE_DOCUMENT.checkpoints.map((checkpoint) => checkpoint.id),
    ...ROUGH_COURSE_DOCUMENT.objects.map((object) => object.id),
  ];

  expect(new Set(ids).size).toBe(ids.length);
});

test("keeps the primitive catalog bounded and collision geometry explicit", () => {
  expect(
    new Set(ROUGH_COURSE_DOCUMENT.objects.map((object) => object.visual.shape)),
  ).toEqual(new Set(["box", "cylinder"]));

  const barrel = findObject("obstacle-barrel-a");
  const ramp = findObject("ramp-super-tall");

  expect(barrel?.editable).toBe(true);
  expect(barrel?.collision).toMatchObject({
    height: 0.9,
    radius: 0.45,
    role: "solid-obstacle",
    shape: "cylinder",
  });
  expect(ramp?.editable).toBe(true);
  expect(ramp?.collision).toMatchObject({
    halfExtents: { x: 4, y: 0.225, z: 1.8 },
    role: "drivable-surface",
    shape: "box",
  });
});

test("places the rough course in Island Three where its old key light shone", () => {
  expect(ROUGH_COURSE_DOCUMENT.enclosure).toEqual({
    id: "enclosure.island-three",
    mirrorAngle: 71,
    placement: { axial: 0, azimuth: 0, heading: 38, height: 0 },
    version: 1,
  });
  expect(parseCourseDocument(createVersionThreeSeed())).toEqual(
    ROUGH_COURSE_DOCUMENT,
  );
});

test("rejects enclosures and placements outside the approved habitat", () => {
  const cases: Array<
    [(document: ReturnType<typeof cloneSeed>) => void, (string | number)[]]
  > = [
    [(document) => (document.enclosure.version = 2), ["enclosure", "id"]],
    [
      (document) => (document.enclosure.id = "enclosure.island-one"),
      ["enclosure", "id"],
    ],
    [
      (document) => (document.enclosure.placement.azimuth = 60),
      ["enclosure", "placement", "azimuth"],
    ],
    [
      (document) => (document.enclosure.placement.azimuth = 360),
      ["enclosure", "placement", "azimuth"],
    ],
    [
      (document) => (document.enclosure.placement.axial = -14_900),
      ["enclosure", "placement", "axial"],
    ],
    [
      (document) => (document.enclosure.placement.height = 3_950),
      ["enclosure", "placement", "height"],
    ],
    [
      (document) => (document.enclosure.mirrorAngle = 90.5),
      ["enclosure", "mirrorAngle"],
    ],
  ];

  for (const [mutate, path] of cases) {
    const input = cloneSeed();
    mutate(input);
    const result = courseDocumentSchema.safeParse(input);
    expect(result.success, path.join(".")).toBe(false);
    expect(result.error?.issues).toContainEqual(
      expect.objectContaining({ path }),
    );
  }

  const otherValley = cloneSeed();
  otherValley.enclosure.placement.azimuth = 268;
  expect(courseDocumentSchema.safeParse(otherValley).success).toBe(true);
});

test("adds course lamps and night mirrors from schema version five", () => {
  // Falls View Park races at deep dusk under its lamps.
  expect(FALLS_VIEW_PARK_DOCUMENT.enclosure.mirrorAngle).toBe(89.5);
  expect(
    FALLS_VIEW_PARK_DOCUMENT.objects.filter(
      (object) => object.lamp === "floodlight",
    ),
  ).toHaveLength(COURSE_LAMP_LIMIT);

  // Version four upgrades unchanged, but keeps its 85° mirrors and no lamps.
  expect(parseCourseDocument({ ...cloneSeed(), schemaVersion: 4 })).toEqual(
    ROUGH_COURSE_DOCUMENT,
  );
  const night = cloneSeed();
  night.enclosure.mirrorAngle = 90;
  expect(courseDocumentSchema.safeParse(night).success).toBe(true);
  expect(() => parseCourseDocument({ ...night, schemaVersion: 4 })).toThrow();
  const lampsInVersionFour = {
    ...structuredClone(FALLS_VIEW_PARK_DOCUMENT),
    enclosure: { ...FALLS_VIEW_PARK_DOCUMENT.enclosure, mirrorAngle: 80 },
    schemaVersion: 4,
  };
  expect(() => parseCourseDocument(lampsInVersionFour)).toThrow();

  const extraLamp = structuredClone(FALLS_VIEW_PARK_DOCUMENT);
  extraLamp.objects.push({
    ...extraLamp.objects.find((object) => object.lamp === "floodlight")!,
    id: "lamp-extra",
  });
  expect(courseDocumentSchema.safeParse(extraLamp).error?.issues).toContainEqual(
    expect.objectContaining({ path: ["objects"] }),
  );
});

test("adds indoor objects, overhead objects, and tunnel lamps from schema version six", () => {
  // Version five upgrades unchanged, but has no tunnel lamps, indoors or arcs.
  const outdoors = structuredClone(FALLS_VIEW_PARK_DOCUMENT);
  outdoors.objects = outdoors.objects
    .filter(isCoursePrimitiveObject)
    .filter((object) => object.lamp !== "tunnel");
  outdoors.objects.forEach((object) => {
    delete object.indoors;
    delete object.overhead;
  });
  const versionFive = { ...outdoors, schemaVersion: 5 };
  expect(parseCourseDocument(versionFive)).toEqual(outdoors);
  const indoorsInVersionFive = structuredClone(versionFive);
  Object.assign(indoorsInVersionFive.objects[0]!, { indoors: true });
  expect(() => parseCourseDocument(indoorsInVersionFive)).toThrow();

  const mast = FALLS_VIEW_PARK_DOCUMENT.objects.find(
    (object) => object.lamp === "floodlight",
  )!;
  const tunnelLamp = (index: number) => ({
    ...structuredClone(mast),
    collision: null,
    id: `tunnel-lamp-${index}`,
    indoors: true as const,
    lamp: "tunnel" as const,
  });
  // The seed's own tunnel lamps make way for a full set of sixteen.
  const tunnel = structuredClone(FALLS_VIEW_PARK_DOCUMENT);
  tunnel.objects = tunnel.objects.filter((object) => object.lamp !== "tunnel");
  tunnel.objects.push(
    ...Array.from({ length: 16 }, (_, index) => tunnelLamp(index)),
    {
      ...structuredClone(tunnel.objects[0]!),
      collision: null,
      id: "tunnel-roof",
      indoors: true,
      overhead: true,
    },
  );
  // Tunnel lamps have their own limit beside the eight floodlights.
  expect(parseCourseDocument(tunnel)).toEqual(tunnel);
  expect(
    parseCourseDocument(JSON.parse(serializeCourseDocument(tunnel))),
  ).toEqual(tunnel);

  const issuePath = (document: CourseDocument) =>
    courseDocumentSchema
      .safeParse(document)
      .error?.issues.map(({ path }) => path);
  const extraTunnelLamp = structuredClone(tunnel);
  extraTunnelLamp.objects.push(tunnelLamp(16));
  expect(
    courseDocumentSchema.safeParse(extraTunnelLamp).error?.issues,
  ).toContainEqual(
    expect.objectContaining({
      message: expect.stringContaining("tunnel lamps"),
      path: ["objects"],
    }),
  );

  const outdoorTunnelLamp = structuredClone(tunnel);
  const lampIndex = outdoorTunnelLamp.objects.findIndex(
    (object) => object.lamp === "tunnel",
  );
  delete outdoorTunnelLamp.objects[lampIndex]!.indoors;
  expect(issuePath(outdoorTunnelLamp)).toContainEqual([
    "objects",
    lampIndex,
    "indoors",
  ]);

  const indoorFloodlight = structuredClone(tunnel);
  const mastIndex = indoorFloodlight.objects.findIndex(
    (object) => object.lamp === "floodlight",
  );
  indoorFloodlight.objects[mastIndex]!.indoors = true;
  expect(issuePath(indoorFloodlight)).toContainEqual([
    "objects",
    mastIndex,
    "indoors",
  ]);

  // A drivable roof would catch karts and checkpoint recovery above it.
  const drivableRoof = structuredClone(tunnel);
  const roof = drivableRoof.objects.at(-1)!;
  roof.collision = structuredClone(tunnel.objects[0]!.collision);
  expect(roof.collision?.role).toBe("drivable-surface");
  expect(issuePath(drivableRoof)).toContainEqual([
    "objects",
    drivableRoof.objects.length - 1,
    "collision",
    "role",
  ]);
});

test("preserves the accepted camera fixtures and ramp placement", () => {
  const largeWall = findObject("camera-test-large-wall");
  const cornerWall = findObject("camera-test-corner-wall");
  const ramp = findObject("ramp-super-tall");

  expect(largeWall?.visual.scale.x).toBeGreaterThanOrEqual(12);
  expect(largeWall?.visual.scale.y).toBeGreaterThanOrEqual(4);
  expect(cornerWall?.visual.scale.z).toBeGreaterThanOrEqual(4);
  expect(cornerWall?.transform.position.x).toBeCloseTo(
    (largeWall?.visual.scale.x ?? 0) * 0.5 -
      (cornerWall?.visual.scale.x ?? 0) * 0.5,
  );

  const angle = Math.abs(ramp?.transform.rotation.z ?? 0) * (Math.PI / 180);
  const halfLength = (ramp?.visual.scale.x ?? 0) * 0.5;
  const halfThickness = (ramp?.visual.scale.y ?? 0) * 0.5;
  const entryTop =
    (ramp?.transform.position.y ?? 0) -
    Math.sin(angle) * halfLength +
    Math.cos(angle) * halfThickness;
  const entryX =
    (ramp?.transform.position.x ?? 0) - Math.cos(angle) * halfLength;
  const ground = findObject("ground");
  const groundWestEdge =
    (ground?.transform.position.x ?? 0) - (ground?.visual.scale.x ?? 0) * 0.5;
  const runwayLength = entryX - groundWestEdge;
  const lapOuterEdgeZ = 20;

  // The tall jump is a sandbox feature beside the lap, not on it.
  expect(
    (ramp?.transform.position.z ?? 0) - (ramp?.visual.scale.z ?? 0) * 0.5,
  ).toBeGreaterThan(lapOuterEdgeZ);
  expect(ramp?.transform.rotation.z).toBeGreaterThan(0);
  // A raised entry lip taller than the wheel radius stops karts dead.
  expect(entryTop).toBeLessThanOrEqual(0);
  expect(entryTop).toBeGreaterThan(-0.005);
  expect(runwayLength).toBeGreaterThan(16);
});

test("keeps the expanded ground approximately 1.5 times its original area", () => {
  const ground = findObject("ground");
  const originalArea = 72 * 48;
  const expandedArea =
    (ground?.visual.scale.x ?? 0) * (ground?.visual.scale.z ?? 0);

  expect(expandedArea / originalArea).toBeCloseTo(1.5, 1);
});

test("adds smooth arcs in schema version six", () => {
  const barrier = FALLS_VIEW_PARK_DOCUMENT.objects.find(
    ({ id }) => id === "tunnel-bend-barrier-inner",
  )!;
  expect(barrier.visual).toEqual({
    arc: { height: 0.5, innerRadius: 4.45, sweep: 90, width: 0.3 },
    material: "obstacleBlock",
    shape: "arc",
  });
  expect(barrier.collision).toMatchObject({
    role: "solid-obstacle",
    shape: "arc",
  });

  const withArc = (change: (object: Record<string, unknown>) => void) => {
    const document = structuredClone(FALLS_VIEW_PARK_DOCUMENT);
    const object = document.objects.find(({ id }) => id === barrier.id)!;
    change(object as unknown as Record<string, unknown>);
    return courseDocumentSchema.safeParse(document).error?.issues ?? [];
  };
  const index = FALLS_VIEW_PARK_DOCUMENT.objects.indexOf(barrier);
  expect(withArc(() => {})).toEqual([]);
  // Arcs collide as arcs, and only as walls.
  expect(
    withArc((object) => {
      object.collision = structuredClone(
        FALLS_VIEW_PARK_DOCUMENT.objects.find(
          ({ id }) => id === "tunnel-pipe-bay",
        )!.collision,
      );
    }),
  ).toContainEqual(
    expect.objectContaining({
      path: ["objects", index, "collision", "shape"],
    }),
  );
  expect(
    withArc((object) => {
      (object.collision as { role: string }).role = "drivable-surface";
    }),
  ).not.toEqual([]);
  expect(
    withArc((object) => {
      object.lamp = "tunnel";
    }),
  ).toContainEqual(
    expect.objectContaining({ path: ["objects", index, "visual", "shape"] }),
  );
  expect(
    withArc((object) => {
      (object.visual as { arc: { width: number } }).arc.width = 196;
    }),
  ).toContainEqual(
    expect.objectContaining({
      message: "An arc's outer radius is at most 200 m",
    }),
  );
  // A box cannot collide as an arc either.
  const boxAsArc = structuredClone(FALLS_VIEW_PARK_DOCUMENT);
  boxAsArc.objects[0]!.collision = structuredClone(barrier.collision);
  expect(courseDocumentSchema.safeParse(boxAsArc).success).toBe(false);
  // Version five has no arcs: without its other version-six fields, the
  // seed fails as version five only while it keeps them.
  const versionFive = structuredClone(FALLS_VIEW_PARK_DOCUMENT);
  versionFive.objects = versionFive.objects.filter(
    (object) => object.lamp !== "tunnel",
  );
  versionFive.objects.forEach((object) => {
    delete object.indoors;
    delete object.overhead;
  });
  expect(() =>
    parseCourseDocument({ ...versionFive, schemaVersion: 5 }),
  ).toThrow();
  versionFive.objects = versionFive.objects.filter(isCoursePrimitiveObject);
  expect(() =>
    parseCourseDocument({ ...versionFive, schemaVersion: 5 }),
  ).not.toThrow();
});

test("draws every drivable surface at its collision top", () => {
  const surfaces = [ROUGH_COURSE_DOCUMENT, FALLS_VIEW_PARK_DOCUMENT].flatMap(
    (document) =>
      document.objects
        .filter(isCoursePrimitiveObject)
        .filter((object) => object.collision?.role === "drivable-surface"),
  );

  expect(surfaces.length).toBeGreaterThan(0);
  for (const object of surfaces) {
    const collision = object.collision!;
    const rotation = collision.offset.rotation;
    const collisionHalfHeight =
      collision.shape === "box"
        ? collision.halfExtents.y
        : collision.height * 0.5;

    // Both tops share the entity's local up axis, so tilted ramps compare too.
    expect([rotation.x, rotation.y, rotation.z], object.id).toEqual([0, 0, 0]);
    if (collision.shape === "cylinder")
      expect(collision.axis, object.id).toBe(1);
    expect(
      Math.abs(
        object.visual.scale.y * 0.5 -
          (collision.offset.position.y + collisionHalfHeight),
      ),
      object.id,
    ).toBeLessThanOrEqual(0.001);
  }
});

test("rests every visual-only marking on the drivable surface beneath it", () => {
  for (const document of [ROUGH_COURSE_DOCUMENT, FALLS_VIEW_PARK_DOCUMENT]) {
    expectMarkingsRestOnSurfaces(document);
  }
});

function expectMarkingsRestOnSurfaces(document: CourseDocument) {
  const surfaces = document.objects
    .filter(isCoursePrimitiveObject)
    .filter(
      (object) =>
        object.collision?.role === "drivable-surface" &&
        object.transform.rotation.x === 0 &&
        object.transform.rotation.z === 0,
    );
  const markings = document.objects
    .filter(isCoursePrimitiveObject)
    .filter((object) => object.category === "marker");

  expect(markings.length).toBeGreaterThan(0);
  for (const marking of markings) {
    const { position } = marking.transform;
    const top = position.y + marking.visual.scale.y * 0.5;
    const supportTops = surfaces
      .filter((surface) => {
        const yaw = (surface.transform.rotation.y * Math.PI) / 180;
        const dx = position.x - surface.transform.position.x;
        const dz = position.z - surface.transform.position.z;
        const localX = dx * Math.cos(yaw) - dz * Math.sin(yaw);
        const localZ = dx * Math.sin(yaw) + dz * Math.cos(yaw);
        const { x, z } = surface.visual.scale;
        return surface.visual.shape === "box"
          ? Math.abs(localX) <= x * 0.5 && Math.abs(localZ) <= z * 0.5
          : Math.hypot(localX / x, localZ / z) <= 0.5;
      })
      .map(
        (surface) =>
          surface.transform.position.y + surface.visual.scale.y * 0.5,
      );

    // A marking rests on the highest surface beneath it, not a buried one.
    expect(marking.collision, marking.id).toBeNull();
    expect(
      Math.abs(top - Math.max(...supportTops)),
      marking.id,
    ).toBeLessThanOrEqual(0.001);
  }
}

test("keeps every start and recovery pose clear of solid obstacles", () => {
  for (const document of [ROUGH_COURSE_DOCUMENT, FALLS_VIEW_PARK_DOCUMENT]) {
    const poses = [
      { id: document.start.id, ...document.start.position },
      ...document.checkpoints.map(({ id, recovery }) => ({
        id,
        ...recovery.position,
      })),
    ];
    for (const object of document.objects) {
      const { collision, visual } = object;
      if (collision?.shape === "arc" && visual.shape === "arc") {
        for (const pose of poses) {
          const local = toObjectFrame(object, { ...pose, y: pose.y + 0.15 });
          const radius = Math.hypot(local.x, local.z);
          const angle =
            (Math.atan2(-local.z, local.x) + 2 * Math.PI) % (2 * Math.PI);
          const { height, innerRadius, sweep, width } = visual.arc;
          const inside =
            radius >= innerRadius &&
            radius <= innerRadius + width &&
            local.y >= 0 &&
            local.y <= height &&
            angle <= (sweep * Math.PI) / 180;
          expect(inside, `${pose.id} inside ${object.id}`).toBe(false);
        }
        continue;
      }
      if (collision?.role !== "solid-obstacle" || collision.shape !== "box") {
        continue;
      }
      const { rotation } = object.transform;
      expect(
        [rotation.x, rotation.y, rotation.z].filter(Boolean).length,
        `${object.id} turns about one axis`,
      ).toBeLessThanOrEqual(1);
      for (const pose of poses) {
        // A kart's body sits just above its pose.
        const local = toObjectFrame(object, { ...pose, y: pose.y + 0.15 });
        const inside = (["x", "y", "z"] as const).every(
          (axis) =>
            Math.abs(local[axis] - collision.offset.position[axis]) <
            collision.halfExtents[axis],
        );
        expect(inside, `${pose.id} inside ${object.id}`).toBe(false);
      }
    }
  }
});

// Seeds turn obstacles about a single axis, so the order of the inverse
// rotations does not matter.
function toObjectFrame(
  object: CourseDocument["objects"][number],
  point: { x: number; y: number; z: number },
) {
  const { position, rotation } = object.transform;
  let { x, y, z } = {
    x: point.x - position.x,
    y: point.y - position.y,
    z: point.z - position.z,
  };
  const turn = (degrees: number) => {
    const radians = (-degrees * Math.PI) / 180;
    return [Math.cos(radians), Math.sin(radians)] as const;
  };
  let [cos, sin] = turn(rotation.x);
  [y, z] = [y * cos - z * sin, y * sin + z * cos];
  [cos, sin] = turn(rotation.y);
  [x, z] = [x * cos + z * sin, -x * sin + z * cos];
  [cos, sin] = turn(rotation.z);
  [x, y] = [x * cos - y * sin, x * sin + y * cos];
  return { x, y, z };
}

test("serializes the seeds deterministically and round trips without changes", () => {
  for (const seed of ["rough-course.v6.json", "falls-view-park.v6.json"]) {
    const source = readFileSync(
      join(process.cwd(), "src/game/course", seed),
      "utf8",
    );
    const document = parseCourseDocument(JSON.parse(source));

    expect(serializeCourseDocument(document)).toBe(source);
    expect(parseCourseDocument(JSON.parse(source))).toEqual(document);
  }
  expect(serializeCourseDocument(ROUGH_COURSE_DOCUMENT)).toBe(
    readFileSync(
      join(process.cwd(), "src/game/course/rough-course.v6.json"),
      "utf8",
    ),
  );
});

test("normalizes version-one course data without mutating the stored input", () => {
  const input = createVersionOneSeed();
  const storedInput = structuredClone(input);
  const normalized = parseCourseDocument(input);

  // Version one derives recovery poses and the start gate; the seed authors
  // lane-following recoveries and a wider start gate instead.
  const withoutDerived = (document: typeof ROUGH_COURSE_DOCUMENT) => ({
    ...document,
    objects: document.objects.map((object) => ({
      ...object,
      collision: object.collision
        ? { ...object.collision, surfaceMaterial: null }
        : null,
    })),
    checkpoints: document.checkpoints.map((checkpoint) => ({
      ...checkpoint,
      recovery: null,
    })),
    start: { ...document.start, gateHalfExtents: null, spawnDistance: null },
  });

  expect(input).toEqual(storedInput);
  expect(normalized.start.spawnDistance).toBe(0);
  expect(withoutDerived(normalized)).toEqual(
    withoutDerived(ROUGH_COURSE_DOCUMENT),
  );
  expect(normalized.schemaVersion).toBe(6);
});

test("normalizes a valid one-checkpoint version-one course", () => {
  const input = createVersionOneSeed();
  input.checkpoints = [input.checkpoints[0]];
  const storedInput = structuredClone(input);

  const normalized = parseCourseDocument(input);

  expect(input).toEqual(storedInput);
  expect(normalized.checkpoints).toHaveLength(1);
  expect(normalized.checkpoints[0]).toMatchObject({
    forward: { x: -1, y: 0, z: 0 },
    recovery: { position: { x: -28, y: 0, z: 8 } },
  });
  // A lone checkpoint's recovery faces back toward the start.
  expect(normalized.checkpoints[0].recovery.rotation.y).toBeCloseTo(
    (Math.atan2(-28, 8) * 180) / Math.PI,
  );
});

test("aligns legacy diagonal version-two directions to the full gate face", () => {
  const input = createVersionTwoSeed();
  const diagonal = Math.SQRT1_2;
  input.checkpoints[0].forward = { x: -diagonal, y: 0, z: diagonal };
  const storedInput = structuredClone(input);

  const normalized = parseCourseDocument(input);

  expect(input).toEqual(storedInput);
  expect(normalized.checkpoints[0].forward).toEqual({ x: 0, y: 0, z: 1 });
});

test("rejects non-normalized checkpoint directions", () => {
  const input = cloneSeed();
  input.checkpoints[0].forward.x = -2;

  const result = courseDocumentSchema.safeParse(input);

  expect(result.success).toBe(false);
  expect(result.error?.issues).toContainEqual(
    expect.objectContaining({
      message: "Checkpoint forward direction must be normalized",
      path: ["checkpoints", 0, "forward"],
    }),
  );
});

test("rejects unknown fields with an exact path", () => {
  const input = cloneSeed() as typeof ROUGH_COURSE_DOCUMENT & {
    engineEntityGuid?: string;
  };
  input.engineEntityGuid = "runtime-only";

  const result = courseDocumentSchema.safeParse(input);

  expect(result.success).toBe(false);
  expect(result.error?.issues).toContainEqual(
    expect.objectContaining({
      code: "unrecognized_keys",
      keys: ["engineEntityGuid"],
      path: [],
    }),
  );
});

test("rejects duplicate stable IDs across document sections", () => {
  const input = cloneSeed();
  input.checkpoints[0].id = input.start.id;

  const result = courseDocumentSchema.safeParse(input);

  expect(result.success).toBe(false);
  expect(result.error?.issues).toContainEqual(
    expect.objectContaining({
      message: expect.stringContaining("Duplicate stable ID"),
      path: ["checkpoints", 0, "id"],
    }),
  );
});

test("rejects non-contiguous checkpoint order", () => {
  const input = cloneSeed();
  input.checkpoints[2].order = 8;

  const result = courseDocumentSchema.safeParse(input);

  expect(result.success).toBe(false);
  expect(result.error?.issues).toContainEqual(
    expect.objectContaining({
      message: expect.stringContaining("expected 3"),
      path: ["checkpoints", 2, "order"],
    }),
  );
});

test("rejects non-positive primitive dimensions", () => {
  const input = cloneSeed();
  const ground = input.objects[0]!;
  if (ground.visual.shape === "arc") throw new Error("Expected a box");
  ground.visual.scale.x = 0;

  const result = courseDocumentSchema.safeParse(input);

  expect(result.success).toBe(false);
  expect(result.error?.issues).toContainEqual(
    expect.objectContaining({
      path: ["objects", 0, "visual", "scale", "x"],
    }),
  );
});

test("preserves a complete non-yaw start transform for runtime consumption", () => {
  const input = cloneSeed();
  input.start.position = { x: 3, y: 1.25, z: -4 };
  input.start.rotation = { x: 8, y: 123, z: -6 };
  input.start.spawnDistance = 0;
  const document = parseCourseDocument(input);

  expect(getCourseStartTransform(document)).toEqual({
    position: { x: 3, y: 1.25, z: -4 },
    rotation: { x: 8, y: 123, z: -6 },
  });
});

test("spawns the seed kart behind the start gate along its heading", () => {
  const spawn = getCourseStartTransform(ROUGH_COURSE_DOCUMENT);
  const gate = ROUGH_COURSE_DOCUMENT.start;

  // The seed start faces -x, so behind the gate is +x.
  expect(gate.rotation).toEqual({ x: 0, y: 90, z: 0 });
  expect(spawn.position.x - gate.position.x).toBeCloseTo(gate.spawnDistance);
  expect(spawn.position.z).toBeCloseTo(gate.position.z);
  expect(gate.spawnDistance).toBeGreaterThan(0);
});

test("rejects oversized cylinder collision dimensions at exact paths", () => {
  const oversizedRadius = cloneSeed();
  const radiusCollision = oversizedRadius.objects.find(
    (object) => object.id === "obstacle-barrel-a",
  )?.collision;

  if (radiusCollision?.shape !== "cylinder") {
    throw new Error("Expected the seed barrel to use cylinder collision");
  }

  radiusCollision.radius = 10_001;
  const radiusResult = courseDocumentSchema.safeParse(oversizedRadius);

  expect(radiusResult.success).toBe(false);
  expect(radiusResult.error?.issues).toContainEqual(
    expect.objectContaining({
      path: [
        "objects",
        oversizedRadius.objects.findIndex(
          (object) => object.id === "obstacle-barrel-a",
        ),
        "collision",
        "radius",
      ],
    }),
  );

  const oversizedHeight = cloneSeed();
  const heightCollision = oversizedHeight.objects.find(
    (object) => object.id === "obstacle-barrel-a",
  )?.collision;

  if (heightCollision?.shape !== "cylinder") {
    throw new Error("Expected the seed barrel to use cylinder collision");
  }

  heightCollision.height = 10_001;
  const heightResult = courseDocumentSchema.safeParse(oversizedHeight);

  expect(heightResult.success).toBe(false);
  expect(heightResult.error?.issues).toContainEqual(
    expect.objectContaining({
      path: [
        "objects",
        oversizedHeight.objects.findIndex(
          (object) => object.id === "obstacle-barrel-a",
        ),
        "collision",
        "height",
      ],
    }),
  );
});

test("normalizes v2 to standard surfaces without inferring physics from visuals", () => {
  const input = createVersionTwoSeed();
  const stored = structuredClone(input);
  const normalized = parseCourseDocument(input);
  expect(normalized.schemaVersion).toBe(6);
  // Legacy karts keep spawning on the start gate.
  expect(normalized.start.spawnDistance).toBe(0);
  for (const object of normalized.objects) {
    if (object.collision)
      expect(object.collision.surfaceMaterial).toEqual({
        id: "surface.standard-course",
        version: 1,
      });
  }
  expect(input).toEqual(stored);
  expect(
    parseCourseDocument(JSON.parse(serializeCourseDocument(input))),
  ).toEqual(normalized);
});

test("rejects missing and unsupported v3 surface identities", () => {
  for (const surfaceMaterial of [
    undefined,
    { id: "surface.short-grass", version: 99 },
    { id: "ground", version: 1 },
  ]) {
    const input = cloneSeed();
    Object.assign(input.objects[0].collision!, { surfaceMaterial });
    expect(courseDocumentSchema.safeParse(input).success).toBe(false);
  }
});
