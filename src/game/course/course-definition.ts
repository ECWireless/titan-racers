import type { ObstacleObjectId, Position3 } from "../contracts";

export const ROUGH_COURSE = {
  centerZ: 8,
  ground: {
    depth: 59,
    width: 88,
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

export type RoughCourseRamp = {
  id: string;
  position: Position3;
  rotation: Position3;
  scale: Position3;
};

export type RoughCourseCollisionFixture = {
  id: string;
  position: Position3;
  scale: Position3;
};

// These are opt-in, non-production fixtures for reproducible fixed-step impact
// response and high-speed tunneling checks.
export const ROUGH_COURSE_COLLISION_FIXTURES: readonly RoughCourseCollisionFixture[] =
  [
    {
      id: "collision-response-wall",
      position: { x: 4, y: 0.75, z: 28.5 },
      scale: { x: 12, y: 1.5, z: 0.24 },
    },
    {
      id: "collision-ccd-thin-wall",
      position: { x: -33, y: 0.75, z: 24 },
      scale: { x: 0.1, y: 1.5, z: 4 },
    },
    {
      id: "collision-corner-horizontal-wall",
      position: { x: 25, y: 0.75, z: 30 },
      scale: { x: 8, y: 1.5, z: 0.24 },
    },
    {
      id: "collision-corner-vertical-wall",
      position: { x: 29, y: 0.75, z: 26 },
      scale: { x: 0.24, y: 1.5, z: 8 },
    },
  ];

export const ROUGH_COURSE_OBSTACLES: readonly RoughCourseObstacle[] = [
  {
    id: "obstacle-barrel-a",
    kind: "cylinder",
    position: { x: 14.5, y: 0.46, z: 2 },
    scale: { x: 0.9, y: 0.9, z: 0.9 },
    collisionRadius: 0.9,
  },
  {
    id: "obstacle-barrel-b",
    kind: "cylinder",
    position: { x: 20.6, y: 0.46, z: 8.4 },
    scale: { x: 0.85, y: 0.9, z: 0.85 },
    collisionRadius: 0.85,
  },
] as const;

export const ROUGH_COURSE_RAMPS: readonly RoughCourseRamp[] = [
  {
    id: "ramp-super-tall",
    position: { x: 0, y: 1.76, z: 16 },
    rotation: { x: 0, y: 0, z: 28 },
    scale: { x: 8, y: 0.45, z: 3.6 },
  },
] as const;
