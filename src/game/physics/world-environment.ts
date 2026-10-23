export type WorldEnvironment = {
  /** kg/m³. */
  airDensity: number;
  /**
   * m/s² felt at rest on the habitat floor. It sets the habitat's spin, so
   * gravity elsewhere comes from the rotating-habitat field.
   */
  gravity: number;
};

// Island Three's air: 0.2 atm oxygen plus 0.3 atm nitrogen at 20 °C.
export const HABITAT_WORLD_ENVIRONMENT: WorldEnvironment = Object.freeze({
  airDensity: 0.615,
  gravity: 9.81,
});
