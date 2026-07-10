import type { ObstacleObjectId, Position3 } from "../contracts";

export const ROUGH_COURSE = {
  centerZ: 8,
  ground: {
    depth: 48,
    width: 72,
  },
  road: {
    halfStraight: 20,
    turnRadius: 8,
    width: 8,
  },
} as const;

export type RoughCourseObstacle = {
  id: ObstacleObjectId;
  kind: "box" | "cylinder";
  position: Position3;
  rotationY?: number;
  scale: Position3;
  collisionRadius: number;
};

export const ROUGH_COURSE_OBSTACLES: readonly RoughCourseObstacle[] = [
  {
    id: "obstacle-concrete-block-a",
    kind: "box",
    position: { x: 8, y: 0.42, z: -1.45 },
    rotationY: 18,
    scale: { x: 1.5, y: 0.7, z: 1 },
    collisionRadius: 1.05,
  },
  {
    id: "obstacle-barrel-a",
    kind: "cylinder",
    position: { x: 14.5, y: 0.46, z: 2 },
    scale: { x: 0.9, y: 0.9, z: 0.9 },
    collisionRadius: 0.9,
  },
  {
    id: "obstacle-concrete-block-b",
    kind: "box",
    position: { x: -9, y: 0.42, z: 16.4 },
    rotationY: -22,
    scale: { x: 1.2, y: 0.7, z: 1.45 },
    collisionRadius: 1,
  },
  {
    id: "obstacle-barrel-b",
    kind: "cylinder",
    position: { x: 20.6, y: 0.46, z: 8.4 },
    scale: { x: 0.85, y: 0.9, z: 0.85 },
    collisionRadius: 0.85,
  },
] as const;
