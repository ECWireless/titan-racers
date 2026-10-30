import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "@playwright/test";
import type * as pc from "playcanvas";

import {
  COURSE_HEDGE_SPRAY_LIMIT,
  COURSE_INDOOR_LAMP_LIMIT,
  COURSE_LAMP_LIMIT,
  COURSE_STREET_LAMP_LIMIT,
  COURSE_TREE_LIMIT,
  countCourseHedgeSprays,
  countCourseIndoorLamps,
  countCourseTrees,
  type CourseDocument,
  courseDocumentSchema,
  FALLS_VIEW_PARK_DOCUMENT,
  getCourseStartTransform,
  isCoursePrimitiveObject,
  parseCourseDocument,
  rotateCourseDirection,
  ROUGH_COURSE_DOCUMENT,
  serializeCourseDocument,
} from "../src/game/course/course-document";
import {
  getCourseWaterVolumes,
  isUnderCourseWater,
} from "../src/game/course/course-water";

function cloneSeed() {
  return structuredClone(ROUGH_COURSE_DOCUMENT);
}

// Falls View Park as a version-seven course could hold it: no water, work
// lights, or bicycles, turf where its lanes are concrete, and block where
// its stream bed is gravel.
function versionSevenFallsViewPark() {
  const document = structuredClone(FALLS_VIEW_PARK_DOCUMENT);
  document.objects = document.objects.filter(
    (object) =>
      object.visual.material !== "water" &&
      object.lamp !== "street" &&
      object.lamp !== "work" &&
      !object.bicycle,
  );
  for (const object of document.objects) {
    if (object.visual.material === "concrete") object.visual.material = "verge";
    if (object.visual.material === "gravel")
      object.visual.material = "obstacleBlock";
  }
  return document;
}

// Falls View Park as a version-six course could hold it: no nursery
// finishes or beds, and eight floodlights.
function versionSixFallsViewPark() {
  const document = versionSevenFallsViewPark();
  let floodlights = 0;
  document.objects = document.objects.filter(
    (object) =>
      !object.planting &&
      !["hedge", "mulch", "timber"].includes(object.visual.material) &&
      (object.lamp !== "floodlight" || ++floodlights <= 8),
  );
  return document;
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
  expect(ROUGH_COURSE_DOCUMENT.schemaVersion).toBe(9);
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
  ).toHaveLength(12);

  // Version four upgrades unchanged, but keeps its 85° mirrors and no lamps.
  expect(parseCourseDocument({ ...cloneSeed(), schemaVersion: 4 })).toEqual(
    ROUGH_COURSE_DOCUMENT,
  );
  const night = cloneSeed();
  night.enclosure.mirrorAngle = 90;
  expect(courseDocumentSchema.safeParse(night).success).toBe(true);
  expect(() => parseCourseDocument({ ...night, schemaVersion: 4 })).toThrow();
  const lampsInVersionFour = {
    ...versionSixFallsViewPark(),
    enclosure: { ...FALLS_VIEW_PARK_DOCUMENT.enclosure, mirrorAngle: 80 },
    schemaVersion: 4,
  };
  expect(() => parseCourseDocument(lampsInVersionFour)).toThrow();

  // Versions five and six hold eight floodlights; seven holds twelve.
  const withLamps = (count: number) => {
    const document = versionSixFallsViewPark();
    const mast = document.objects.find((object) => object.lamp === "floodlight")!;
    for (let index = 8; index < count; index++) {
      document.objects.push({ ...structuredClone(mast), id: `lamp-extra-${index}` });
    }
    return document;
  };
  expect(courseDocumentSchema.safeParse(withLamps(COURSE_LAMP_LIMIT)).success).toBe(true);
  expect(
    courseDocumentSchema.safeParse(withLamps(COURSE_LAMP_LIMIT + 1)).error?.issues,
  ).toContainEqual(expect.objectContaining({ path: ["objects"] }));
  expect(() => parseCourseDocument({ ...withLamps(9), schemaVersion: 6 })).toThrow();
});

test("adds indoor objects, overhead objects, and tunnel lamps from schema version six", () => {
  // Version five upgrades unchanged, but has no tunnel lamps, indoors or arcs.
  const outdoors = versionSixFallsViewPark();
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
  // The seed's own indoor lamps make way for a full set of tunnel lamps.
  const tunnel = structuredClone(FALLS_VIEW_PARK_DOCUMENT);
  tunnel.objects = tunnel.objects.filter(
    (object) => object.lamp !== "tunnel" && object.lamp !== "work",
  );
  tunnel.objects.push(
    ...Array.from({ length: COURSE_INDOOR_LAMP_LIMIT }, (_, index) => tunnelLamp(index)),
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
  extraTunnelLamp.objects.push(tunnelLamp(COURSE_INDOOR_LAMP_LIMIT));
  expect(
    courseDocumentSchema.safeParse(extraTunnelLamp).error?.issues,
  ).toContainEqual(
    expect.objectContaining({
      message: expect.stringContaining("tunnel and work lamps"),
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
  expect(
    withArc((object) => {
      Object.assign((object.visual as { arc: object }).arc, {
        innerRadius: 0.05,
        width: 1,
      });
    }),
  ).toContainEqual(
    expect.objectContaining({
      message: "An arc is at most 16 times as wide as its inner radius",
      path: ["objects", index, "visual", "arc", "width"],
    }),
  );
  // The race finds karts beneath box roofs only.
  expect(
    withArc((object) => {
      object.overhead = true;
    }),
  ).toContainEqual(
    expect.objectContaining({
      message: "Indoor roofs are boxes",
      path: ["objects", index, "visual", "shape"],
    }),
  );
  // A box cannot collide as an arc either.
  const boxAsArc = structuredClone(FALLS_VIEW_PARK_DOCUMENT);
  boxAsArc.objects[0]!.collision = structuredClone(barrier.collision);
  expect(courseDocumentSchema.safeParse(boxAsArc).success).toBe(false);
  // Version five has no arcs: without its other version-six fields, the
  // seed fails as version five only while it keeps them.
  const versionFive = versionSixFallsViewPark();
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

test("keeps every start and recovery pose clear of solid obstacles and water", async () => {
  const engine = await import("playcanvas/build/playcanvas/src/index.js");
  for (const document of [ROUGH_COURSE_DOCUMENT, FALLS_VIEW_PARK_DOCUMENT]) {
    const poses = [
      { id: document.start.id, ...document.start.position },
      ...document.checkpoints.map(({ id, recovery }) => ({
        id,
        ...recovery.position,
      })),
    ];
    // A kart recovered into water would drown again at once.
    const water = getCourseWaterVolumes(document);
    for (const pose of poses) {
      expect(
        isUnderCourseWater(water, { ...pose, y: pose.y + 0.15 }),
        `${pose.id} under water`,
      ).toBe(false);
    }
    for (const object of document.objects) {
      const { collision, visual } = object;
      if (collision?.shape === "arc" && visual.shape === "arc") {
        for (const pose of poses) {
          const local = toObjectFrame(engine, object, { ...pose, y: pose.y + 0.15 });
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
      for (const pose of poses) {
        // A kart's body sits just above its pose.
        const local = toObjectFrame(engine, object, { ...pose, y: pose.y + 0.15 });
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

function toObjectFrame(
  engine: Pick<typeof pc, "Quat" | "Vec3">,
  object: CourseDocument["objects"][number],
  point: { x: number; y: number; z: number },
) {
  const { position, rotation } = object.transform;
  const local = new engine.Quat()
    .setFromEulerAngles(rotation.x, rotation.y, rotation.z)
    .invert()
    .transformVector(
      new engine.Vec3(
        point.x - position.x,
        point.y - position.y,
        point.z - position.z,
      ),
    );
  return { x: local.x, y: local.y, z: local.z };
}

test("serializes the seeds deterministically and round trips without changes", () => {
  for (const seed of ["rough-course.v9.json", "falls-view-park.v9.json"]) {
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
      join(process.cwd(), "src/game/course/rough-course.v9.json"),
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
  expect(normalized.schemaVersion).toBe(9);
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
  expect(normalized.schemaVersion).toBe(9);
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

test("adds the nursery's finishes and planted beds in schema version seven", () => {
  // Version six upgrades unchanged.
  const versionSix = versionSixFallsViewPark();
  expect(parseCourseDocument({ ...versionSix, schemaVersion: 6 })).toEqual(
    versionSix,
  );

  const block = FALLS_VIEW_PARK_DOCUMENT.objects
    .filter(isCoursePrimitiveObject)
    .find((object) => object.collision?.role === "solid-obstacle" && !object.lamp && !object.indoors && !object.overhead)!;
  const bed = {
    ...structuredClone(block),
    id: "nursery-bed",
    planting: { across: 1.5, along: 1.2 },
    visual: { material: "mulch" as const, scale: { x: 6, y: 0.2, z: 6 }, shape: "box" as const },
  };
  const planted = structuredClone(versionSix);
  planted.objects.push(bed, {
    ...structuredClone(block),
    id: "nursery-hedge",
    visual: { material: "hedge", scale: { x: 1.2, y: 2.4, z: 6 }, shape: "box" },
  });
  expect(parseCourseDocument(planted)).toEqual(planted);
  expect(
    parseCourseDocument(JSON.parse(serializeCourseDocument(planted))),
  ).toEqual(planted);
  // Rows of five 1.2 m apart, four rows 1.5 m apart.
  expect(countCourseTrees(planted)).toBe(20);
  // The new finishes and planting are version seven's.
  expect(() => parseCourseDocument({ ...planted, schemaVersion: 6 })).toThrow();

  const issuePath = (document: CourseDocument) =>
    courseDocumentSchema
      .safeParse(document)
      .error?.issues.map(({ path }) => path);
  const index = planted.objects.length - 2;
  for (const mutate of [
    (object: CourseDocument["objects"][number]) => (object.lamp = "floodlight"),
    (object: CourseDocument["objects"][number]) => (object.indoors = true),
    (object: CourseDocument["objects"][number]) => (object.overhead = true),
    (object: CourseDocument["objects"][number]) =>
      (object.visual = { ...bed.visual, shape: "cylinder" }),
  ]) {
    const invalid = structuredClone(planted);
    mutate(invalid.objects[index]!);
    expect(issuePath(invalid)).toContainEqual(["objects", index, "planting"]);
  }

  // A course holds at most two thousand trees.
  const crowded = structuredClone(planted);
  crowded.objects[index]!.planting = { across: 0.5, along: 0.5 };
  crowded.objects[index]!.visual = {
    ...bed.visual,
    scale: { x: 30, y: 0.2, z: 20 },
  };
  expect(countCourseTrees(crowded)).toBeGreaterThan(COURSE_TREE_LIMIT);
  expect(issuePath(crowded)).toContainEqual(["objects"]);

  // Hedges are outdoor boxes, and their leaves are bounded.
  const hedgeIndex = planted.objects.length - 1;
  const indoorHedge = structuredClone(planted);
  indoorHedge.objects[hedgeIndex]!.indoors = true;
  expect(issuePath(indoorHedge)).toContainEqual([
    "objects",
    hedgeIndex,
    "visual",
    "material",
  ]);
  const vastHedge = structuredClone(planted);
  vastHedge.objects[hedgeIndex]!.visual = {
    material: "hedge",
    scale: { x: 1.2, y: 5, z: 300 },
    shape: "box",
  };
  expect(countCourseHedgeSprays(vastHedge)).toBeGreaterThan(COURSE_HEDGE_SPRAY_LIMIT);
  expect(issuePath(vastHedge)).toContainEqual(["objects"]);
});

test("adds water and work lights in schema version eight", () => {
  // Version seven upgrades unchanged.
  const versionSeven = versionSevenFallsViewPark();
  expect(parseCourseDocument({ ...versionSeven, schemaVersion: 7 })).toEqual(versionSeven);

  const housing = FALLS_VIEW_PARK_DOCUMENT.objects.find(
    (object) => object.lamp === "tunnel",
  )!;
  const workLight = (index: number) => ({
    ...structuredClone(housing),
    id: `work-light-${index}`,
    lamp: "work" as const,
  });
  const water = {
    ...structuredClone(housing),
    collision: null,
    id: "test-water",
    visual: { material: "water" as const, scale: { x: 6, y: 0.3, z: 3 }, shape: "box" as const },
  };
  delete water.indoors;
  delete water.lamp;
  // Falls View Park without its own water and work lights, given new ones.
  const wet = versionSevenFallsViewPark();
  wet.objects.push(workLight(1), water);
  expect(parseCourseDocument(wet)).toEqual(wet);
  expect(parseCourseDocument(JSON.parse(serializeCourseDocument(wet)))).toEqual(wet);
  // Water and work lights are version eight's.
  expect(() => parseCourseDocument({ ...wet, schemaVersion: 7 })).toThrow();

  const issuePath = (document: CourseDocument) =>
    courseDocumentSchema
      .safeParse(document)
      .error?.issues.map(({ path }) => path);

  // Work lights stand indoors, and share the tunnel lamps' limit.
  const outdoorWorkLight = structuredClone(wet);
  const lightIndex = wet.objects.length - 2;
  delete outdoorWorkLight.objects[lightIndex]!.indoors;
  expect(issuePath(outdoorWorkLight)).toContainEqual(["objects", lightIndex, "indoors"]);
  const crowded = versionSevenFallsViewPark();
  const indoorLamps = countCourseIndoorLamps(crowded);
  crowded.objects.push(
    ...Array.from({ length: COURSE_INDOOR_LAMP_LIMIT - indoorLamps }, (_, index) =>
      workLight(index),
    ),
  );
  expect(courseDocumentSchema.safeParse(crowded).success).toBe(true);
  crowded.objects.push(workLight(99));
  expect(issuePath(crowded)).toContainEqual(["objects"]);
  // Version eight makes room for twenty indoor lamps; earlier versions keep
  // sixteen.
  const seventeen = versionSevenFallsViewPark();
  seventeen.objects.push(
    ...Array.from({ length: 17 - countCourseIndoorLamps(seventeen) }, (_, index) => ({
      ...structuredClone(housing),
      id: `extra-tunnel-lamp-${index}`,
    })),
  );
  expect(parseCourseDocument(seventeen)).toEqual(seventeen);
  expect(() => parseCourseDocument({ ...seventeen, schemaVersion: 7 })).toThrow(
    "16 tunnel and work lamps",
  );
  const versionSix = versionSixFallsViewPark();
  versionSix.objects.push(...seventeen.objects.filter(({ id }) => id.startsWith("extra-tunnel-lamp-")));
  expect(countCourseIndoorLamps(versionSix)).toBe(17);
  expect(() => parseCourseDocument({ ...versionSix, schemaVersion: 6 })).toThrow(
    "16 tunnel and work lamps",
  );

  // Water is an outdoor box that never collides.
  const waterIndex = wet.objects.length - 1;
  for (const mutate of [
    (object: CourseDocument["objects"][number]) =>
      (object.collision = structuredClone(
        FALLS_VIEW_PARK_DOCUMENT.objects.find(({ collision }) => collision?.shape === "box")!
          .collision,
      )),
    (object: CourseDocument["objects"][number]) => (object.indoors = true),
    (object: CourseDocument["objects"][number]) => (object.overhead = true),
    (object: CourseDocument["objects"][number]) =>
      (object.visual = { ...water.visual, shape: "cylinder" }),
  ]) {
    const invalid = structuredClone(wet);
    mutate(invalid.objects[waterIndex]!);
    expect(issuePath(invalid)).toContainEqual(["objects", waterIndex, "visual", "material"]);
  }
});

test("parks bicycles only in schema version eight, as upright boxes", () => {
  const bicycles = FALLS_VIEW_PARK_DOCUMENT.objects.filter(
    (object) => object.bicycle,
  );
  expect(bicycles.map(({ bicycle }) => bicycle).sort()).toEqual([
    "bmx",
    "hardtail",
  ]);

  // Bicycles are version eight's.
  const versionSeven = versionSevenFallsViewPark();
  const parked = structuredClone(versionSeven);
  parked.objects.push(structuredClone(bicycles[0]!));
  expect(parseCourseDocument(parked)).toEqual(parked);
  expect(() => parseCourseDocument({ ...parked, schemaVersion: 7 })).toThrow();

  // A bicycle is an upright outdoor box, which itself never collides.
  const index = parked.objects.length - 1;
  const wall = FALLS_VIEW_PARK_DOCUMENT.objects.find(
    ({ collision }) => collision?.shape === "box",
  )!;
  for (const mutate of [
    (object: CourseDocument["objects"][number]) =>
      (object.collision = structuredClone(wall.collision)),
    (object: CourseDocument["objects"][number]) =>
      (object.transform.rotation.z = 10),
    (object: CourseDocument["objects"][number]) => (object.indoors = true),
    (object: CourseDocument["objects"][number]) => (object.lamp = "floodlight"),
    (object: CourseDocument["objects"][number]) =>
      (object.visual.material = "hedge"),
  ]) {
    const invalid = structuredClone(parked);
    mutate(invalid.objects[index]!);
    expect(
      courseDocumentSchema
        .safeParse(invalid)
        .error?.issues.map(({ path }) => path),
    ).toContainEqual(["objects", index, "bicycle"]);
  }
});


test("upgrades v8 unchanged and bounds outdoor street lamps in v9", () => {
  const legacy = structuredClone(FALLS_VIEW_PARK_DOCUMENT);
  legacy.objects = legacy.objects.filter((o) => o.lamp !== "street");
  expect(parseCourseDocument({ ...legacy, schemaVersion: 8 })).toEqual(legacy);
  const street = FALLS_VIEW_PARK_DOCUMENT.objects.find(
    (o) => o.lamp === "street",
  )!;
  expect(() =>
    parseCourseDocument({ ...FALLS_VIEW_PARK_DOCUMENT, schemaVersion: 8 }),
  ).toThrow();
  const full = structuredClone(legacy);
  for (let i = 0; i < COURSE_STREET_LAMP_LIMIT; i++)
    full.objects.push({ ...structuredClone(street), id: `street-${i}` });
  expect(parseCourseDocument(full)).toEqual(full);
  expect(() =>
    parseCourseDocument({
      ...full,
      objects: [...full.objects, { ...street, id: "street-extra" }],
    }),
  ).toThrow("8 street lamps");
  for (const change of [
    { indoors: true },
    { overhead: true },
    { visual: { ...street.visual, shape: "box" } },
  ]) {
    expect(() =>
      parseCourseDocument({
        ...legacy,
        objects: [...legacy.objects, { ...street, ...change }],
      }),
    ).toThrow();
  }
});


test("connects both return-turn kerbs to the downhill and return straight", () => {
  for (const [side, start, end] of [
    ["outer", [-49, -47.325], [-58.325, -38]],
    ["inner", [-49, -42.675], [-53.675, -38]],
  ] as const) {
    const object = FALLS_VIEW_PARK_DOCUMENT.objects.find(
      (o) => o.id === `return-turn-kerb-${side}`,
    )!;
    if (object.visual.shape !== "arc")
      throw new Error("Expected a curved kerb");
    const { innerRadius, width, sweep } = object.visual.arc;
    const radius = innerRadius + width / 2;
    for (const [angle, expected] of [
      [0, start],
      [sweep, end],
    ] as const) {
      const radians = (angle * Math.PI) / 180;
      const offset = rotateCourseDirection(
        { x: radius * Math.cos(radians), y: 0, z: -radius * Math.sin(radians) },
        { x: 0, y: 0, z: 0 },
        object.transform.rotation,
      );
      expect(object.transform.position.x + offset.x).toBeCloseTo(
        expected[0],
        5,
      );
      expect(object.transform.position.z + offset.z).toBeCloseTo(
        expected[1],
        5,
      );
    }
  }
});
