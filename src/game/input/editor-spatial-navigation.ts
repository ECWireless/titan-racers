import type { EditorFocusDirection } from "./editor-gamepad-input";

export type SpatialRect = {
  bottom: number;
  left: number;
  right: number;
  top: number;
};

export type SpatialCandidate<T> = {
  eligible?: boolean;
  order: number;
  rect: SpatialRect;
  region: string | null;
  value: T;
};

function axisCenter(rect: SpatialRect, axis: "x" | "y") {
  return axis === "x"
    ? (rect.left + rect.right) / 2
    : (rect.top + rect.bottom) / 2;
}

function directionalGap(
  origin: SpatialRect,
  candidate: SpatialRect,
  direction: EditorFocusDirection,
) {
  if (direction === "left") return origin.left - candidate.right;
  if (direction === "right") return candidate.left - origin.right;
  if (direction === "up") return origin.top - candidate.bottom;
  return candidate.top - origin.bottom;
}

function isInDirection(
  origin: SpatialRect,
  candidate: SpatialRect,
  direction: EditorFocusDirection,
) {
  return directionalGap(origin, candidate, direction) >= -0.5;
}

function projectedOverlap(
  origin: SpatialRect,
  candidate: SpatialRect,
  direction: EditorFocusDirection,
) {
  if (direction === "left" || direction === "right") {
    return Math.max(
      0,
      Math.min(origin.bottom, candidate.bottom) -
        Math.max(origin.top, candidate.top),
    );
  }
  return Math.max(
    0,
    Math.min(origin.right, candidate.right) -
      Math.max(origin.left, candidate.left),
  );
}

function compareCandidates<T>(
  origin: SpatialCandidate<T>,
  direction: EditorFocusDirection,
  left: SpatialCandidate<T>,
  right: SpatialCandidate<T>,
) {
  const leftOverlap = projectedOverlap(origin.rect, left.rect, direction);
  const rightOverlap = projectedOverlap(origin.rect, right.rect, direction);
  const leftPrimary = Math.max(
    0,
    directionalGap(origin.rect, left.rect, direction),
  );
  const rightPrimary = Math.max(
    0,
    directionalGap(origin.rect, right.rect, direction),
  );
  const orthogonalAxis =
    direction === "left" || direction === "right" ? "y" : "x";
  const leftOrthogonal = Math.abs(
    axisCenter(origin.rect, orthogonalAxis) -
      axisCenter(left.rect, orthogonalAxis),
  );
  const rightOrthogonal = Math.abs(
    axisCenter(origin.rect, orthogonalAxis) -
      axisCenter(right.rect, orthogonalAxis),
  );
  const leftScore = [
    leftOverlap > 0 ? 0 : 1,
    leftPrimary,
    leftOrthogonal,
    -leftOverlap,
    left.order,
  ];
  const rightScore = [
    rightOverlap > 0 ? 0 : 1,
    rightPrimary,
    rightOrthogonal,
    -rightOverlap,
    right.order,
  ];
  for (let index = 0; index < leftScore.length; index += 1) {
    const difference = leftScore[index] - rightScore[index];
    if (difference !== 0) return difference;
  }
  return 0;
}

export function findSpatialNavigationCandidate<T>(
  origin: SpatialCandidate<T>,
  candidates: SpatialCandidate<T>[],
  direction: EditorFocusDirection,
) {
  const directional = candidates.filter(
    (candidate) =>
      candidate.eligible !== false &&
      candidate.value !== origin.value &&
      isInDirection(origin.rect, candidate.rect, direction),
  );
  const local =
    origin.region === null
      ? []
      : directional.filter((candidate) => candidate.region === origin.region);
  return [...(local.length > 0 ? local : directional)].sort((left, right) =>
    compareCandidates(origin, direction, left, right),
  )[0] ?? null;
}
