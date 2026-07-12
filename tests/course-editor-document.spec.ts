import { expect, test } from "@playwright/test";

import { ROUGH_COURSE_DOCUMENT } from "../src/game/course/course-document";
import {
  addCourseCheckpoint,
  addCourseObjectPreset,
  collectCourseDocumentIds,
  deleteCourseSelection,
  getSelectionGeometry,
  nudgeSelection,
  renameCourseObject,
  scaleSelectionAxis,
  scaleSelectionUniformly,
  updateSelectionGeometry,
} from "../src/game/editor/course-editor-document";

test.describe("course editor document commands", () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(
      testInfo.project.name !== "desktop",
      "Pure course-document editing coverage only needs to run once.",
    );
  });

  test("adds bounded presets with stable unique IDs", () => {
    let document = structuredClone(ROUGH_COURSE_DOCUMENT);
    document = addCourseObjectPreset(document, "block");
    document = addCourseObjectPreset(document, "block");
    document = addCourseObjectPreset(document, "barrel");

    expect(document.objects.slice(-3).map(({ id }) => id)).toEqual([
      "block-1",
      "block-2",
      "barrel-1",
    ]);
    expect(document.objects.at(-1)).toMatchObject({
      collision: { radius: 0.5, shape: "cylinder" },
      editable: true,
      visual: { shape: "cylinder" },
    });
  });

  test("uniformly scales visual and authoritative collision geometry", () => {
    const document = addCourseObjectPreset(
      structuredClone(ROUGH_COURSE_DOCUMENT),
      "block",
    );
    const selection = { id: "block-1", kind: "object" } as const;
    const geometry = getSelectionGeometry(document, selection);
    expect(geometry).not.toBeNull();

    const scaled = updateSelectionGeometry(document, selection, {
      ...geometry!,
      scale: { x: 4, y: 2, z: 4 },
    });
    const object = scaled.objects.at(-1);

    expect(object?.visual.scale).toEqual({ x: 4, y: 2, z: 4 });
    expect(object?.collision).toMatchObject({
      halfExtents: { x: 2, y: 1, z: 2 },
      shape: "box",
    });
  });

  test("renames editable objects without changing their stable IDs", () => {
    const document = addCourseObjectPreset(
      structuredClone(ROUGH_COURSE_DOCUMENT),
      "barrier",
    );
    const renamed = renameCourseObject(
      document,
      { id: "barrier-1", kind: "object" },
      "  Pit entry barrier  ",
    );

    expect(renamed.objects.at(-1)).toMatchObject({
      id: "barrier-1",
      label: "Pit entry barrier",
    });
  });

  test("scales objects proportionally from precision controls", () => {
    const document = addCourseObjectPreset(
      structuredClone(ROUGH_COURSE_DOCUMENT),
      "ramp",
    );
    const scaled = scaleSelectionUniformly(
      document,
      { id: "ramp-1", kind: "object" },
      1.1,
    );

    expect(scaled.objects.at(-1)).toMatchObject({
      collision: { halfExtents: { x: 2.2, y: 0.275, z: 3.3 } },
      visual: { scale: { x: 4.4, y: 0.55, z: 6.6 } },
    });
  });

  test("scales box visual and collision dimensions on only the chosen axis", () => {
    const document = addCourseObjectPreset(
      structuredClone(ROUGH_COURSE_DOCUMENT),
      "block",
    );
    const scaled = scaleSelectionAxis(
      document,
      { id: "block-1", kind: "object" },
      "x",
      1.5,
    );

    expect(scaled.objects.at(-1)).toMatchObject({
      collision: { halfExtents: { x: 1.5, y: 0.5, z: 1 } },
      visual: { scale: { x: 3, y: 1, z: 2 } },
    });
  });

  test("keeps cylinder radial axes paired while scaling height independently", () => {
    const document = addCourseObjectPreset(
      structuredClone(ROUGH_COURSE_DOCUMENT),
      "barrel",
    );
    const wider = scaleSelectionAxis(
      document,
      { id: "barrel-1", kind: "object" },
      "x",
      1.1,
    );
    const taller = scaleSelectionAxis(
      wider,
      { id: "barrel-1", kind: "object" },
      "y",
      2,
    );

    expect(taller.objects.at(-1)).toMatchObject({
      collision: { height: 2.8, radius: 0.55 },
      visual: { scale: { x: 1.1, y: 2.8, z: 1.1 } },
    });
  });

  test("nudges start placement without changing unrelated document data", () => {
    const document = structuredClone(ROUGH_COURSE_DOCUMENT);
    const next = nudgeSelection(
      document,
      { id: document.start.id, kind: "start" },
      "position",
      "x",
      0.25,
    );

    expect(next.start.position.x).toBe(document.start.position.x + 0.25);
    expect(next.objects).toEqual(document.objects);
    expect(next.checkpoints).toEqual(document.checkpoints);
  });

  test("adds and deletes ordered checkpoints while retaining one minimum", () => {
    const document = addCourseCheckpoint(structuredClone(ROUGH_COURSE_DOCUMENT));
    const added = document.checkpoints.at(-1)!;
    const deleted = deleteCourseSelection(document, {
      id: document.checkpoints[1].id,
      kind: "checkpoint",
    });

    expect(added.id).toBe("checkpoint-1");
    expect(deleted.checkpoints.map(({ order }) => order)).toEqual(
      deleted.checkpoints.map((_, index) => index + 1),
    );

    const oneCheckpoint = {
      ...document,
      checkpoints: [document.checkpoints[0]],
    };
    expect(
      deleteCourseSelection(oneCheckpoint, {
        id: oneCheckpoint.checkpoints[0].id,
        kind: "checkpoint",
      }),
    ).toBe(oneCheckpoint);
  });

  test("does not reuse deleted object or checkpoint IDs in one editing session", () => {
    let document = structuredClone(ROUGH_COURSE_DOCUMENT);
    const issuedIds = collectCourseDocumentIds(document);

    document = addCourseObjectPreset(document, "block", issuedIds);
    issuedIds.add(document.objects.at(-1)!.id);
    document = deleteCourseSelection(document, {
      id: "block-1",
      kind: "object",
    });
    document = addCourseObjectPreset(document, "block", issuedIds);
    expect(document.objects.at(-1)?.id).toBe("block-2");

    document = addCourseCheckpoint(document, issuedIds);
    issuedIds.add(document.checkpoints.at(-1)!.id);
    document = deleteCourseSelection(document, {
      id: "checkpoint-1",
      kind: "checkpoint",
    });
    document = addCourseCheckpoint(document, issuedIds);
    expect(document.checkpoints.at(-1)?.id).toBe("checkpoint-2");
  });
});
