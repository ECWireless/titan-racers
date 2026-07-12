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

function findObject(id: string) {
  return ROUGH_COURSE_DOCUMENT.objects.find((object) => object.id === id);
}

test("parses the versioned rough course with stable IDs and ordered checkpoints", () => {
  expect(ROUGH_COURSE_DOCUMENT.schemaVersion).toBe(1);
  expect(ROUGH_COURSE_DOCUMENT.units).toBe("meters");
  expect(ROUGH_COURSE_DOCUMENT.start.id).toBe("start-position");
  expect(ROUGH_COURSE_DOCUMENT.checkpoints).toHaveLength(6);
  expect(
    ROUGH_COURSE_DOCUMENT.checkpoints.map((checkpoint) => checkpoint.order),
  ).toEqual([1, 2, 3, 4, 5, 6]);

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

test("keeps course lighting bounded and preserves the accepted setup", () => {
  expect(ROUGH_COURSE_DOCUMENT.lighting).toEqual({
    ambient: {
      color: { b: 0.46, g: 0.39, r: 0.34 },
      intensity: 1,
    },
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
  });
});

test("rejects unsafe or unbounded course lighting", () => {
  const invalidColor = cloneSeed();
  invalidColor.lighting.ambient.color.r = 1.01;
  const colorResult = courseDocumentSchema.safeParse(invalidColor);

  expect(colorResult.success).toBe(false);
  expect(colorResult.error?.issues).toContainEqual(
    expect.objectContaining({
      path: ["lighting", "ambient", "color", "r"],
    }),
  );

  const tooManyLights = cloneSeed();
  tooManyLights.lighting.directionalLights.push({
    ...tooManyLights.lighting.directionalLights[0],
    id: "third-light",
  });
  const countResult = courseDocumentSchema.safeParse(tooManyLights);

  expect(countResult.success).toBe(false);
  expect(countResult.error?.issues).toContainEqual(
    expect.objectContaining({
      path: ["lighting", "directionalLights"],
    }),
  );
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
  const runwayLength = entryX + 20;

  expect(ramp?.transform.position.z).toBe(16);
  expect(ramp?.transform.rotation.z).toBeGreaterThan(0);
  expect(entryTop).toBeGreaterThan(0.04);
  expect(entryTop).toBeLessThan(0.12);
  expect(runwayLength).toBeGreaterThan(16);
});

test("keeps the expanded ground approximately 1.5 times its original area", () => {
  const ground = findObject("ground");
  const originalArea = 72 * 48;
  const expandedArea =
    (ground?.visual.scale.x ?? 0) * (ground?.visual.scale.z ?? 0);

  expect(expandedArea / originalArea).toBeCloseTo(1.5, 1);
});

test("serializes the seed deterministically and round trips without changes", () => {
  const serialized = serializeCourseDocument(ROUGH_COURSE_DOCUMENT);
  const source = readFileSync(
    join(process.cwd(), "src/game/course/rough-course.v1.json"),
    "utf8",
  );

  expect(serialized).toBe(source);
  expect(serializeCourseDocument(JSON.parse(serialized))).toBe(serialized);
  expect(parseCourseDocument(JSON.parse(serialized))).toEqual(
    ROUGH_COURSE_DOCUMENT,
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

test("rejects directional light IDs that collide with other authored IDs", () => {
  const input = cloneSeed();
  input.lighting.directionalLights[0].id = input.objects[0].id;

  const result = courseDocumentSchema.safeParse(input);

  expect(result.success).toBe(false);
  expect(result.error?.issues).toContainEqual(
    expect.objectContaining({
      message: expect.stringContaining("Duplicate stable ID"),
      path: ["lighting", "directionalLights", 0, "id"],
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
  const document = parseCourseDocument(input);

  expect(getCourseStartTransform(document)).toEqual({
    position: { x: 3, y: 1.25, z: -4 },
    rotation: { x: 8, y: 123, z: -6 },
  });
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
      path: ["objects", 8, "collision", "radius"],
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
      path: ["objects", 8, "collision", "height"],
    }),
  );
});
