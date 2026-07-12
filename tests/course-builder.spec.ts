import { expect, test } from "@playwright/test";
import type {
  Application,
  Entity,
  StandardMaterial,
} from "playcanvas";

import {
  buildRoughCourse,
  projectCourseObject,
  selectCourseObjectsForBuild,
} from "../src/game/course/build-rough-course";
import {
  type CourseVisualMaterial,
  ROUGH_COURSE_DOCUMENT,
} from "../src/game/course/course-document";
import {
  PHYSICS_GROUP,
  PHYSICS_MASK,
} from "../src/game/physics/collision-groups";

const materials = {} as Record<CourseVisualMaterial, StandardMaterial>;

function findObject(id: string) {
  const object = ROUGH_COURSE_DOCUMENT.objects.find(
    (candidate) => candidate.id === id,
  );

  if (!object) {
    throw new Error(`Missing seed object ${id}`);
  }

  return object;
}

test("projects every seed object without losing authored runtime properties", () => {
  ROUGH_COURSE_DOCUMENT.objects.forEach((object) => {
    const projection = projectCourseObject(object);
    const supportsKart = object.collision?.role === "drivable-surface";

    expect(projection).toEqual({
      availability: object.availability,
      category: object.category,
      collision: object.collision,
      editable: object.editable,
      id: object.id,
      physics: object.collision
        ? {
            friction: object.collision.friction,
            group: supportsKart
              ? PHYSICS_GROUP.drivableSurface
              : PHYSICS_GROUP.solidObstacle,
            mask: supportsKart
              ? PHYSICS_MASK.drivableSurface
              : PHYSICS_MASK.solidObstacle,
            restitution: object.collision.restitution,
            tag: supportsKart ? "drivable-surface" : "obstacle",
          }
        : null,
      transform: object.transform,
      visual: object.visual,
    });
  });
});

test("maps exact box, cylinder, and visual-only branches", () => {
  expect(projectCourseObject(findObject("ground"))).toMatchObject({
    collision: {
      halfExtents: { x: 44, y: 0.05, z: 29.5 },
      offset: {
        position: { x: 0, y: 0.01, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
      },
      shape: "box",
    },
    physics: {
      group: PHYSICS_GROUP.drivableSurface,
      mask: PHYSICS_MASK.drivableSurface,
      tag: "drivable-surface",
    },
  });

  expect(projectCourseObject(findObject("obstacle-barrel-a"))).toMatchObject({
    collision: {
      axis: 1,
      height: 0.9,
      offset: {
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
      },
      radius: 0.45,
      shape: "cylinder",
    },
    physics: {
      friction: 0.7,
      group: PHYSICS_GROUP.solidObstacle,
      mask: PHYSICS_MASK.solidObstacle,
      restitution: 0,
      tag: "obstacle",
    },
    visual: {
      material: "obstacleBarrel",
      scale: { x: 0.9, y: 0.9, z: 0.9 },
      shape: "cylinder",
    },
  });

  expect(projectCourseObject(findObject("start-finish-line"))).toMatchObject({
    collision: null,
    physics: null,
    visual: { material: "line", shape: "box" },
  });
});

test("gates collision fixtures without changing standard document order", () => {
  const standardIds = selectCourseObjectsForBuild(
    ROUGH_COURSE_DOCUMENT,
    false,
  ).map((object) => object.id);
  const allIds = selectCourseObjectsForBuild(
    ROUGH_COURSE_DOCUMENT,
    true,
  ).map((object) => object.id);

  expect(standardIds).toEqual(
    ROUGH_COURSE_DOCUMENT.objects
      .filter((object) => object.availability === "standard")
      .map((object) => object.id),
  );
  expect(allIds).toEqual(
    ROUGH_COURSE_DOCUMENT.objects.map((object) => object.id),
  );
  expect(standardIds).not.toContain("collision-response-wall");
  expect(allIds).toContain("collision-response-wall");
});

test("destroys every staged entity when a later course object fails", () => {
  const events: string[] = [];
  const app = {
    root: {
      addChild(entity: Entity) {
        events.push(`attach:${entity.name}`);
      },
    },
  } as unknown as Application;
  let createdCount = 0;

  expect(() =>
    buildRoughCourse(app, {
      createEntity(projection) {
        createdCount += 1;

        if (createdCount === 3) {
          throw new Error("forced mid-build failure");
        }

        events.push(`create:${projection.id}`);
        return {
          destroy() {
            events.push(`destroy:${projection.id}`);
          },
          name: projection.id,
        } as unknown as Entity;
      },
      document: ROUGH_COURSE_DOCUMENT,
      materials,
    }),
  ).toThrow("forced mid-build failure");

  expect(events).toEqual([
    "create:ground",
    "create:course-outer-straight",
    "destroy:ground",
    "destroy:course-outer-straight",
  ]);
  expect(events.some((event) => event.startsWith("attach:"))).toBe(false);
});

test("attaches staged entities only after the complete batch succeeds", () => {
  const events: string[] = [];
  const app = {
    root: {
      addChild(entity: Entity) {
        events.push(`attach:${entity.name}`);
      },
    },
  } as unknown as Application;

  const result = buildRoughCourse(app, {
    createEntity(projection) {
      events.push(`create:${projection.id}`);
      return {
        destroy() {
          events.push(`destroy:${projection.id}`);
        },
        name: projection.id,
      } as unknown as Entity;
    },
    document: ROUGH_COURSE_DOCUMENT,
    materials,
  });
  const firstAttachIndex = events.findIndex((event) =>
    event.startsWith("attach:"),
  );

  expect(result.courseEntities.size).toBe(13);
  expect(firstAttachIndex).toBe(13);
  expect(events.slice(0, firstAttachIndex)).toEqual(
    selectCourseObjectsForBuild(ROUGH_COURSE_DOCUMENT, false).map(
      (object) => `create:${object.id}`,
    ),
  );
  expect(events.some((event) => event.startsWith("destroy:"))).toBe(false);
});
