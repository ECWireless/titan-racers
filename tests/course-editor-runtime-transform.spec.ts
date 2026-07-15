import { expect, test } from "@playwright/test";

import { collectObjectPositionUpdates } from "../src/game/editor/course-editor-runtime-transform";

const objectSelections = [
  { id: "object-a", kind: "object" },
  { id: "object-b", kind: "object" },
] as const;

test.describe("course editor runtime transforms", () => {
  test("collects every selected object position as one update set", () => {
    const positions = new Map([
      ["object-a", { x: 1, y: 2, z: 3 }],
      ["object-b", { x: 4, y: 5, z: 6 }],
    ]);

    expect(
      collectObjectPositionUpdates(objectSelections, ({ id }) => {
        const position = positions.get(id);
        return position ? { getPosition: () => position } : null;
      }),
    ).toEqual([
      { id: "object-a", position: { x: 1, y: 2, z: 3 } },
      { id: "object-b", position: { x: 4, y: 5, z: 6 } },
    ]);
  });

  test("rejects the entire update when an object entity is missing", () => {
    expect(
      collectObjectPositionUpdates(objectSelections, ({ id }) =>
        id === "object-a"
          ? { getPosition: () => ({ x: 1, y: 2, z: 3 }) }
          : null,
      ),
    ).toBeNull();
  });

  test("rejects the entire update when any selection is not an object", () => {
    expect(
      collectObjectPositionUpdates(
        [objectSelections[0], { id: "start", kind: "start" }],
        () => ({ getPosition: () => ({ x: 1, y: 2, z: 3 }) }),
      ),
    ).toBeNull();
  });
});
