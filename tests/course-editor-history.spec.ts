import { expect, test } from "@playwright/test";

import {
  CommandHistory,
  type EditorCommand,
} from "../src/game/editor/command-history";

type DocumentFixture = { name: string };

function renameCommand(
  before: string,
  after: string,
): EditorCommand<DocumentFixture> {
  return {
    apply: (current) => ({ ...current, name: after }),
    label: `Rename ${before} to ${after}`,
    revert: (current) => ({ ...current, name: before }),
  };
}

test.describe("course editor command history", () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(
      testInfo.project.name !== "desktop",
      "Pure command history coverage only needs to run once.",
    );
  });

  test("tracks clean state across execute, undo, redo, save, and reset", () => {
    const loaded = { name: "Loaded" };
    const history = new CommandHistory(loaded);

    expect(history.current).toEqual(loaded);
    expect(history.isDirty).toBe(false);

    history.execute(renameCommand("Loaded", "Edited"));
    expect(history.current.name).toBe("Edited");
    expect(history.canUndo).toBe(true);
    expect(history.isDirty).toBe(true);

    history.undo();
    expect(history.current.name).toBe("Loaded");
    expect(history.canRedo).toBe(true);
    expect(history.isDirty).toBe(false);

    history.redo();
    history.markClean();
    expect(history.current.name).toBe("Edited");
    expect(history.isDirty).toBe(false);

    history.execute(renameCommand("Edited", "Again"));
    expect(history.resetToLoaded()).toEqual({ name: "Edited" });
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
    expect(history.isDirty).toBe(false);
  });

  test("invalidates an unreachable clean index when a redo branch is replaced", () => {
    const history = new CommandHistory<DocumentFixture>({ name: "Loaded" });

    history.execute(renameCommand("Loaded", "First"));
    history.execute(renameCommand("First", "Saved"));
    history.markClean();
    history.undo();
    history.execute(renameCommand("First", "Branched"));

    expect(history.current.name).toBe("Branched");
    expect(history.canRedo).toBe(false);
    expect(history.isDirty).toBe(true);
  });

  test("reloads a new clean revision and forgets previous commands", () => {
    const history = new CommandHistory<DocumentFixture>({ name: "One" });
    history.execute(renameCommand("One", "Edited"));

    history.reload({ name: "Two" });

    expect(history.current.name).toBe("Two");
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
    expect(history.isDirty).toBe(false);
  });
});
