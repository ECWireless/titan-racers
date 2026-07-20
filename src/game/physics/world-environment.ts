export type WorldEnvironment = {
  airDensity: number;
  gravity: number;
};

export const EARTH_WORLD_ENVIRONMENT: WorldEnvironment = Object.freeze({
  airDensity: 1.225,
  gravity: 9.81,
});
