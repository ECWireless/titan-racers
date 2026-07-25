export type EditorControllerCameraInput = {
  orbitX: number;
  orbitY: number;
  panX: number;
  panY: number;
  zoom: number;
};

export type EditorControllerDirection = "down" | "left" | "right" | "up";

export type EditorControllerTranslationStep = {
  axis: "x" | "y" | "z";
  sign: -1 | 1;
};

export type EditorControllerAxisProjections = Record<
  EditorControllerTranslationStep["axis"],
  { x: number; y: number }
>;

export function resolveEditorTranslationFromScreenProjections(
  projections: EditorControllerAxisProjections,
  direction: EditorControllerDirection,
): EditorControllerTranslationStep | null {
  const desired = {
    down: { x: 0, y: 1 },
    left: { x: -1, y: 0 },
    right: { x: 1, y: 0 },
    up: { x: 0, y: -1 },
  }[direction];
  let best: (EditorControllerTranslationStep & { alignment: number }) | null =
    null;

  for (const axis of ["x", "y", "z"] as const) {
    const { x, y } = projections[axis];
    const magnitude = Math.hypot(x, y);
    if (!Number.isFinite(magnitude) || magnitude < 0.5) continue;
    const signedAlignment = (x * desired.x + y * desired.y) / magnitude;
    const alignment = Math.abs(signedAlignment);
    if (!best || alignment > best.alignment) {
      best = {
        alignment,
        axis,
        sign: signedAlignment >= 0 ? 1 : -1,
      };
    }
  }

  if (!best) return null;
  return { axis: best.axis, sign: best.sign };
}

export type EditorControllerViewportHandle = {
  applyControllerCamera: (
    input: EditorControllerCameraInput,
    deltaSeconds: number,
  ) => void;
  getElement: () => HTMLCanvasElement | null;
  resolveTranslationStep: (
    direction: EditorControllerDirection,
  ) => EditorControllerTranslationStep | null;
  selectAtCenter: () => void;
};
