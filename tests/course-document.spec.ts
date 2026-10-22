import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

import {
  courseDocumentSchema,
  getCourseStartTransform,
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
  return ROUGH_COURSE_DOCUMENT.objects.find((object) => object.id === id);
}

test("parses the versioned rough course with stable IDs and ordered checkpoints", () => {
  expect(ROUGH_COURSE_DOCUMENT.schemaVersion).toBe(4);
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
    mirrorAngle: 19,
    placement: { axial: 0, azimuth: 0, heading: -142, height: 0 },
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
      (document) => (document.enclosure.placement.axial = -15_600),
      ["enclosure", "placement", "axial"],
    ],
    [
      (document) => (document.enclosure.placement.height = 3_950),
      ["enclosure", "placement", "height"],
    ],
    [
      (document) => (document.enclosure.mirrorAngle = 90),
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

test("draws every drivable surface at its collision top", () => {
  const surfaces = ROUGH_COURSE_DOCUMENT.objects.filter(
    (object) => object.collision?.role === "drivable-surface",
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
  const surfaces = ROUGH_COURSE_DOCUMENT.objects.filter(
    (object) =>
      object.collision?.role === "drivable-surface" &&
      object.transform.rotation.x === 0 &&
      object.transform.rotation.z === 0,
  );
  const markings = ROUGH_COURSE_DOCUMENT.objects.filter(
    (object) => object.category === "marker",
  );

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
});

test("serializes the seeds deterministically and round trips without changes", () => {
  for (const seed of ["rough-course.v4.json", "agricultural-zone.v4.json"]) {
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
      join(process.cwd(), "src/game/course/rough-course.v4.json"),
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
  expect(normalized.schemaVersion).toBe(4);
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
  input.objects[0].visual.scale.x = 0;

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
  expect(normalized.schemaVersion).toBe(4);
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
