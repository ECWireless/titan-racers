export const PHYSICS_GROUP = {
  drivableSurface: 1 << 8,
  solidObstacle: 1 << 9,
  kart: 1 << 10,
  wheelProbe: 1 << 11,
} as const;

export const PHYSICS_MASK = {
  drivableSurface: PHYSICS_GROUP.kart | PHYSICS_GROUP.wheelProbe,
  solidObstacle: PHYSICS_GROUP.kart,
  kart: PHYSICS_GROUP.drivableSurface | PHYSICS_GROUP.solidObstacle,
  wheelSupport: PHYSICS_GROUP.drivableSurface,
} as const;
