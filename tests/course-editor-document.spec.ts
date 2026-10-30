import { expect, test } from "@playwright/test";

import {
  COURSE_LAMP_LIMIT,
  COURSE_STREET_LAMP_LIMIT,
  COURSE_TREE_LIMIT,
  COURSE_INDOOR_LAMP_LIMIT,
  countCourseTrees,
  FALLS_VIEW_PARK_DOCUMENT,
  ROUGH_COURSE_DOCUMENT,
  parseCourseDocument,
  serializeCourseDocument,
} from "../src/game/course/course-document";
import {
  COURSE_EDITOR_CHECKPOINT_LIMIT,
  addCourseCheckpoint,
  addCourseObjectPreset,
  collectCourseDocumentIds,
  deleteCourseSelection,
  getSelectionGeometry,
  nudgeObjectSelections,
  nudgeSelection,
  reconcileCourseEditorSelections,
  renameCourseObject,
  scaleSelectionAxis,
  scaleSelectionUniformly,
  updateCourseEditorSelections,
  updateMirrorAngle,
  updateObjectSelectionPositions,
  coursePresetLimitReached,
  updateSelectionArc,
  updateSelectionGeometry,
  updateSelectionPlacement,
} from "../src/game/editor/course-editor-document";

function courseAtCheckpointLimit() {
  const document = structuredClone(ROUGH_COURSE_DOCUMENT);
  const template = document.checkpoints[0]!;
  document.checkpoints = Array.from(
    { length: COURSE_EDITOR_CHECKPOINT_LIMIT },
    (_, index) => ({
      ...structuredClone(template),
      id: `limit-checkpoint-${index + 1}`,
      order: index + 1,
      position: { ...template.position, z: index },
    }),
  );
  return document;
}

test.describe("course editor document commands", () => {

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

  test("builds an object-only additive selection without allowing an empty set", () => {
    const start = { id: "start-position", kind: "start" } as const;
    const block = { id: "block-1", kind: "object" } as const;
    const barrel = { id: "barrel-1", kind: "object" } as const;

    const firstObject = updateCourseEditorSelections([start], block, true);
    expect(firstObject).toEqual([block]);

    const group = updateCourseEditorSelections(firstObject, barrel, true);
    expect(group).toEqual([block, barrel]);
    expect(updateCourseEditorSelections(group, block, true)).toEqual([barrel]);
    expect(updateCourseEditorSelections([barrel], barrel, true)).toEqual([
      barrel,
    ]);
    expect(updateCourseEditorSelections(group, start, true)).toEqual([start]);
  });

  test("moves selected objects by one shared delta without changing their spacing", () => {
    let document = addCourseObjectPreset(
      structuredClone(ROUGH_COURSE_DOCUMENT),
      "block",
    );
    document = addCourseObjectPreset(document, "barrel");
    const selections = [
      { id: "block-1", kind: "object" },
      { id: "barrel-1", kind: "object" },
    ] as const;

    const nudged = nudgeObjectSelections(document, selections, "x", 0.25);
    expect(nudged.objects.slice(-2).map(({ transform }) => transform.position.x)).toEqual([
      0.25,
      0.25,
    ]);

    const moved = updateObjectSelectionPositions(nudged, [
      { id: "block-1", position: { x: 1.13, y: 0.5, z: 2 } },
      { id: "barrel-1", position: { x: 4.38, y: 0.7, z: 2 } },
    ]);
    expect(moved.objects.slice(-2).map(({ transform }) => transform.position)).toEqual([
      { x: 1.13, y: 0.5, z: 2 },
      { x: 4.38, y: 0.7, z: 2 },
    ]);
    expect(moved.objects.slice(-2).map(({ transform }) => transform.rotation)).toEqual(
      document.objects.slice(-2).map(({ transform }) => transform.rotation),
    );
  });

  test("reconciles removed group members and rejects stale group updates", () => {
    const document = structuredClone(ROUGH_COURSE_DOCUMENT);
    const existing = { id: "obstacle-barrel-a", kind: "object" } as const;
    const missing = { id: "removed-object", kind: "object" } as const;

    expect(
      reconcileCourseEditorSelections(document, [existing, missing]),
    ).toEqual([existing]);
    expect(nudgeObjectSelections(document, [existing, missing], "x", 0.25)).toBe(
      document,
    );
    expect(
      updateObjectSelectionPositions(document, [
        { id: existing.id, position: { x: 1, y: 1, z: 1 } },
        { id: missing.id, position: { x: 2, y: 2, z: 2 } },
      ]),
    ).toBe(document);
  });

  test("keeps checkpoint creation bounded at the document limit", () => {
    const document = courseAtCheckpointLimit();
    expect(document.checkpoints).toHaveLength(COURSE_EDITOR_CHECKPOINT_LIMIT);
    expect(addCourseCheckpoint(document)).toBe(document);
  });

  test("uniformly scales visual and authoritative collision geometry", () => {
    const document = addCourseObjectPreset(
      structuredClone(ROUGH_COURSE_DOCUMENT),
      "block",
    );
    const selection = { id: "block-1", kind: "object" } as const;
    document.objects.at(-1)!.collision!.surfaceMaterial = { id: "surface.short-grass", version: 1 };
    const geometry = getSelectionGeometry(document, selection);
    expect(geometry).not.toBeNull();

    const scaled = updateSelectionGeometry(document, selection, {
      ...geometry!,
      scale: { x: 4, y: 2, z: 4 },
    });
    const object = scaled.objects.at(-1);

    expect(object?.visual).toMatchObject({ scale: { x: 4, y: 2, z: 4 } });
    expect(object?.collision).toMatchObject({
      halfExtents: { x: 2, y: 1, z: 2 },
      shape: "box",
      surfaceMaterial: { id: "surface.short-grass", version: 1 },
    });
    expect(parseCourseDocument(JSON.parse(serializeCourseDocument(scaled)))).toEqual(scaled);
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
    const document = addCourseCheckpoint(
      structuredClone(ROUGH_COURSE_DOCUMENT),
    );
    const added = document.checkpoints.at(-1)!;
    const deleted = deleteCourseSelection(document, {
      id: document.checkpoints[1].id,
      kind: "checkpoint",
    });

    expect(added.id).toBe("checkpoint-1");
    expect(added.forward).toEqual({
      x: expect.any(Number),
      y: 0,
      z: expect.any(Number),
    });
    expect(Math.hypot(added.forward.x, added.forward.z)).toBeCloseTo(1);
    expect(added.recovery).toEqual({
      position: {
        x: added.position.x,
        y: added.position.y - added.halfExtents.y,
        z: added.position.z,
      },
      rotation: added.rotation,
    });
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

  test("translates checkpoint recovery position with its gate", () => {
    const document = structuredClone(ROUGH_COURSE_DOCUMENT);
    const checkpoint = document.checkpoints[0];
    const moved = nudgeSelection(
      document,
      { id: checkpoint.id, kind: "checkpoint" },
      "position",
      "x",
      0.25,
    );

    expect(moved.checkpoints[0].position.x).toBe(checkpoint.position.x + 0.25);
    expect(moved.checkpoints[0].recovery.position.x).toBe(
      checkpoint.recovery.position.x + 0.25,
    );
    expect(moved.checkpoints[0].recovery.rotation).toEqual(
      checkpoint.recovery.rotation,
    );
  });

  test("rotates a checkpoint gate face and preserves it across axis-changing scale", () => {
    const document = structuredClone(ROUGH_COURSE_DOCUMENT);
    const checkpoint = document.checkpoints[0];
    const selection = { id: checkpoint.id, kind: "checkpoint" } as const;
    const geometry = getSelectionGeometry(document, selection)!;
    const rotated = updateSelectionGeometry(document, selection, {
      ...geometry,
      rotation: { ...geometry.rotation, y: 90 },
    });

    expect(rotated.checkpoints[0].forward).toEqual({ x: 0, y: 0, z: 1 });

    const scaled = updateSelectionGeometry(rotated, selection, {
      ...getSelectionGeometry(rotated, selection)!,
      scale: { x: 10, y: 3, z: 2 },
    });

    expect(scaled.checkpoints[0].halfExtents).toEqual({ x: 5, y: 1.5, z: 1 });
    expect(scaled.checkpoints[0].forward).toEqual({ x: 0, y: 0, z: 1 });
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

  test("adds floodlights up to the course's lamp limit", () => {
    let document = structuredClone(ROUGH_COURSE_DOCUMENT);
    for (let count = 0; count <= COURSE_LAMP_LIMIT; count += 1) {
      document = addCourseObjectPreset(document, "lamp");
    }
    const lamps = document.objects.filter((object) => object.lamp);

    expect(lamps.map((lamp) => lamp.id)).toEqual(
      Array.from(
        { length: COURSE_LAMP_LIMIT },
        (_, index) => `lamp-${index + 1}`,
      ),
    );
    expect(lamps[0]).toMatchObject({
      collision: { role: "solid-obstacle", shape: "cylinder" },
      lamp: "floodlight",
      transform: { position: { y: 6 } },
    });
  });

  test("hangs tunnel lamps from the roof, up to their own limit", () => {
    let document = structuredClone(ROUGH_COURSE_DOCUMENT);
    for (let count = 0; count <= COURSE_INDOOR_LAMP_LIMIT; count += 1) {
      document = addCourseObjectPreset(document, "tunnel-lamp");
    }
    const lamps = document.objects.filter(
      (object) => object.lamp === "tunnel",
    );

    expect(lamps).toHaveLength(COURSE_INDOOR_LAMP_LIMIT);
    expect(lamps[0]).toMatchObject({
      collision: null,
      id: "tunnel-lamp-1",
      indoors: true,
      transform: { position: { y: 3.54 } },
      visual: { material: "steel", scale: { x: 1.2, y: 0.12, z: 0.36 } },
    });
    expect(coursePresetLimitReached(document, "tunnel-lamp")).toBe(
      COURSE_INDOOR_LAMP_LIMIT,
    );
    // Floodlights keep their own limit beside them.
    expect(coursePresetLimitReached(document, "lamp")).toBeNull();
    expect(addCourseObjectPreset(document, "lamp").objects).toHaveLength(
      document.objects.length + 1,
    );
  });

  test("adds tree beds up to the course's tree limit, and hedges", () => {
    let document = addCourseObjectPreset(
      structuredClone(ROUGH_COURSE_DOCUMENT),
      "tree-bed",
    );
    document = addCourseObjectPreset(document, "hedge");
    expect(document.objects.at(-2)).toMatchObject({
      collision: { halfExtents: { y: 0.1 }, role: "solid-obstacle" },
      id: "tree-bed-1",
      planting: { across: 1.5, along: 1.2 },
      transform: { position: { y: 0.1 } },
      visual: { material: "mulch", scale: { x: 6, y: 0.2, z: 6 } },
    });
    expect(document.objects.at(-1)).toMatchObject({
      id: "hedge-1",
      transform: { position: { y: 1.2 } },
      visual: { material: "hedge" },
    });

    // Twenty trees a bed: a hundred beds fill the course's two thousand.
    let full = document;
    while (coursePresetLimitReached(full, "tree-bed") === null) {
      full = addCourseObjectPreset(full, "tree-bed");
    }
    expect(countCourseTrees(full)).toBe(COURSE_TREE_LIMIT);
    expect(coursePresetLimitReached(full, "tree-bed")).toBe(COURSE_TREE_LIMIT);
    expect(addCourseObjectPreset(full, "tree-bed")).toBe(full);
  });

  test("marks objects indoors or overhead within the course's rules", () => {
    let document = addCourseObjectPreset(
      structuredClone(ROUGH_COURSE_DOCUMENT),
      "block",
    );
    document = addCourseObjectPreset(document, "lamp");
    document = addCourseObjectPreset(document, "platform");
    const block = { id: "block-1", kind: "object" } as const;
    const find = (id: string, next = document) =>
      next.objects.find((object) => object.id === id)!;

    const roofed = updateSelectionPlacement(document, block, {
      indoors: true,
      overhead: true,
    });
    expect(find("block-1", roofed)).toMatchObject({
      indoors: true,
      overhead: true,
    });
    const cleared = updateSelectionPlacement(roofed, block, {
      indoors: false,
      overhead: false,
    });
    expect(find("block-1", cleared)).not.toHaveProperty("indoors");
    expect(find("block-1", cleared)).not.toHaveProperty("overhead");

    // Floodlights stand outdoors, and karts never drive on a roof.
    expect(
      updateSelectionPlacement(
        document,
        { id: "lamp-1", kind: "object" },
        { indoors: true, overhead: false },
      ),
    ).toBe(document);
    expect(
      updateSelectionPlacement(
        document,
        { id: "platform-1", kind: "object" },
        { indoors: false, overhead: true },
      ),
    ).toBe(document);
  });

  test("sets the time of day through the enclosure mirror angle", () => {
    const document = structuredClone(ROUGH_COURSE_DOCUMENT);
    const evening = updateMirrorAngle(document, 80);

    expect(evening.enclosure).toEqual({ ...document.enclosure, mirrorAngle: 80 });
    expect(evening.objects).toEqual(document.objects);
    expect(updateMirrorAngle(document, 90).enclosure.mirrorAngle).toBe(90);
    expect(() => updateMirrorAngle(document, 90.5)).toThrow();
  });

  test("adds a smooth curved barrier and sizes it by its arc", () => {
    const document = addCourseObjectPreset(
      structuredClone(ROUGH_COURSE_DOCUMENT),
      "curve",
    );
    const selection = { id: "curve-1", kind: "object" } as const;
    const curve = document.objects.at(-1)!;
    expect(curve).toMatchObject({
      collision: { role: "solid-obstacle", shape: "arc" },
      id: "curve-1",
      visual: {
        arc: { height: 0.5, innerRadius: 4, sweep: 90, width: 0.3 },
        shape: "arc",
      },
    });
    // An arc stands on its base and has no scale to edit.
    expect(curve.transform.position.y).toBe(0);
    expect(getSelectionGeometry(document, selection)?.scale).toBeUndefined();
    expect(scaleSelectionAxis(document, selection, "x", 2)).toBe(document);
    expect(scaleSelectionUniformly(document, selection, 2)).toBe(document);

    // Nor does a bicycle, which keeps its real size.
    const bicycle = {
      id: FALLS_VIEW_PARK_DOCUMENT.objects.find(({ bicycle }) => bicycle)!.id,
      kind: "object",
    } as const;
    expect(
      scaleSelectionAxis(FALLS_VIEW_PARK_DOCUMENT, bicycle, "y", 1.1),
    ).toBe(FALLS_VIEW_PARK_DOCUMENT);
    expect(scaleSelectionUniformly(FALLS_VIEW_PARK_DOCUMENT, bicycle, 2)).toBe(
      FALLS_VIEW_PARK_DOCUMENT,
    );

    const arc = { height: 0.6, innerRadius: 6.12345, sweep: 120, width: 0.4 };
    const resized = updateSelectionArc(document, selection, arc);
    expect(resized.objects.at(-1)!.visual).toMatchObject({
      arc: { ...arc, innerRadius: 6.123 },
    });
    // An edit that changes nothing, such as a step held at a minimum, or
    // dimensions outside the schema's range leave the arc unchanged.
    expect(
      updateSelectionArc(resized, selection, { ...arc, innerRadius: 6.123 }),
    ).toBe(resized);
    expect(
      updateSelectionArc(resized, selection, { ...arc, width: 0.05 }),
    ).toBe(resized);
    expect(updateSelectionArc(resized, selection, { ...arc, sweep: 365 })).toBe(
      resized,
    );

    // Moving and turning it keep its dimensions.
    const moved = updateSelectionGeometry(resized, selection, {
      position: { x: 1, y: 0, z: 2 },
      rotation: { x: 0, y: 30, z: 0 },
    });
    expect(moved.objects.at(-1)).toMatchObject({
      transform: { position: { x: 1, y: 0, z: 2 }, rotation: { y: 30 } },
      visual: resized.objects.at(-1)!.visual,
    });
  });
});


test("places full-size street columns up to their independent budget", () => {
  let document = structuredClone(ROUGH_COURSE_DOCUMENT);
  for (let i = 0; i < COURSE_STREET_LAMP_LIMIT; i++)
    document = addCourseObjectPreset(document, "street-lamp");
  const street = document.objects.filter((o) => o.lamp === "street");
  expect(street).toHaveLength(COURSE_STREET_LAMP_LIMIT);
  expect(street[0]).toMatchObject({
    transform: { position: { y: 3 } },
    visual: { shape: "cylinder", scale: { y: 6 } },
    collision: { height: 6, radius: 0.075 },
  });
  expect(coursePresetLimitReached(document, "street-lamp")).toBe(8);
  expect(addCourseObjectPreset(document, "street-lamp")).toBe(document);
  expect(coursePresetLimitReached(document, "lamp")).toBeNull();
  expect(coursePresetLimitReached(document, "tunnel-lamp")).toBeNull();
});
