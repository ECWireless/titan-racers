import type {
  CourseEditorSelection,
  CourseEditorSelections,
} from "./course-editor-document";

type RuntimePosition = { x: number; y: number; z: number };

type RuntimePositionEntity = {
  getPosition: () => RuntimePosition;
};

export type CourseObjectPositionUpdate = {
  id: string;
  position: RuntimePosition;
};

export function collectObjectPositionUpdates(
  selections: CourseEditorSelections,
  entityForSelection: (
    selection: CourseEditorSelection,
  ) => RuntimePositionEntity | null,
): CourseObjectPositionUpdate[] | null {
  const selectionsWithEntities = selections
    .map((selection) => ({
      entity: entityForSelection(selection),
      selection,
    }))
    .filter(
      (
        entry,
      ): entry is {
        entity: RuntimePositionEntity;
        selection: CourseEditorSelection;
      } => Boolean(entry.entity),
    );

  if (
    selectionsWithEntities.length !== selections.length ||
    selectionsWithEntities.some(({ selection }) => selection.kind !== "object")
  ) {
    return null;
  }

  return selectionsWithEntities.map(({ entity, selection }) => {
    const position = entity.getPosition();
    return {
      id: selection.id,
      position: { x: position.x, y: position.y, z: position.z },
    };
  });
}
