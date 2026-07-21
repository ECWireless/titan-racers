export type KartReferenceVector = Readonly<{
  x: number;
  y: number;
  z: number;
}>;

// The Phase 2 rough kart used full-size placeholder dimensions. PR 3.1 keeps
// its validated proportions while converting the fixture to the accepted
// miniature RC reference: about 0.46 m long and 1.875 kg. PR 3.3 replaces
// this fixture with versioned authored construction and deterministic
// derivation.
export const REFERENCE_KART_LINEAR_SCALE = 0.25;
export const REFERENCE_KART_AREA_SCALE = REFERENCE_KART_LINEAR_SCALE ** 2;
export const REFERENCE_KART_MASS_SCALE = REFERENCE_KART_LINEAR_SCALE ** 3;
export const REFERENCE_KART_INERTIA_SCALE =
  REFERENCE_KART_LINEAR_SCALE ** 5;
export const REFERENCE_KART_TIME_SCALE = Math.sqrt(
  REFERENCE_KART_LINEAR_SCALE,
);

export function scaleReferenceKartLength(value: number) {
  return value * REFERENCE_KART_LINEAR_SCALE;
}

export function scaleReferenceKartVector(
  vector: KartReferenceVector,
): KartReferenceVector {
  return {
    x: scaleReferenceKartLength(vector.x),
    y: scaleReferenceKartLength(vector.y),
    z: scaleReferenceKartLength(vector.z),
  };
}

const totalMass = 120 * REFERENCE_KART_MASS_SCALE;
// The battery, motor, and chassis dominate an RC kart's mass low in the body;
// the visible upper electronics housing is substantial but not the plurality.
const lowerBodyMass = 105 * REFERENCE_KART_MASS_SCALE;
const upperHousingMass = totalMass - lowerBodyMass;
const lowerBodyMassCenter = scaleReferenceKartVector({
  x: 0,
  y: -0.22,
  z: 0.1,
});
const upperHousingPosition = scaleReferenceKartVector({
  x: 0,
  y: 0.16,
  // Keep the heaviest upper assembly slightly rear-biased without putting the
  // default kart on its longitudinal tip-over threshold under full drive.
  z: 0.3,
});
const centerOfMassOffset = {
  x:
    (lowerBodyMass * lowerBodyMassCenter.x +
      upperHousingMass * upperHousingPosition.x) /
    totalMass,
  y:
    (lowerBodyMass * lowerBodyMassCenter.y +
      upperHousingMass * upperHousingPosition.y) /
    totalMass,
  z:
    (lowerBodyMass * lowerBodyMassCenter.z +
      upperHousingMass * upperHousingPosition.z) /
    totalMass,
};
const chassisDatumHeight = scaleReferenceKartLength(0.43);
const uprightRootHeight = chassisDatumHeight + centerOfMassOffset.y;

export const REFERENCE_KART_CONSTRUCTION = Object.freeze({
  chassisDimensions: scaleReferenceKartVector({ x: 1.25, y: 0.55, z: 1.85 }),
  collision: {
    bodyHalfExtents: scaleReferenceKartVector({ x: 0.58, y: 0.14, z: 0.55 }),
    bodyPosition: scaleReferenceKartVector({ x: 0, y: -0.08, z: 0 }),
    bumper: {
      height: scaleReferenceKartLength(1.52),
      positions: {
        front: scaleReferenceKartVector({ x: 0, y: -0.08, z: -0.68 }),
        rear: scaleReferenceKartVector({ x: 0, y: -0.08, z: 0.68 }),
      },
      radius: scaleReferenceKartLength(0.18),
    },
    broadphaseRadius: scaleReferenceKartLength(0.95),
    smallestRelevantCrossSection: scaleReferenceKartLength(0.32),
    upperHousingHalfExtents: scaleReferenceKartVector({
      x: 0.36,
      y: 0.21,
      z: 0.39,
    }),
    wheelGuard: {
      height: scaleReferenceKartLength(1.55),
      positions: {
        left: scaleReferenceKartVector({ x: -0.75, y: -0.07, z: 0 }),
        right: scaleReferenceKartVector({ x: 0.75, y: -0.07, z: 0 }),
      },
      radius: scaleReferenceKartLength(0.16),
    },
  },
  massProperties: {
    centerOfMassOffset,
    lowerBodyMass,
    lowerBodyMassCenter,
    totalMass,
    upperHousingMass,
  },
  rootHeight: chassisDatumHeight,
  steeringGeometry: {
    centerOfMassHeight: uprightRootHeight,
    trackWidth: scaleReferenceKartLength(1.8),
    wheelbase: scaleReferenceKartLength(1.2),
  },
  suspension: {
    armRadius: scaleReferenceKartLength(0.035),
    maximumCompressionY: scaleReferenceKartLength(0.06),
    restTravel: scaleReferenceKartLength(0.23),
    shockRadius: scaleReferenceKartLength(0.045),
    travel: scaleReferenceKartLength(0.42),
  },
  upperHousingPosition,
  visual: {
    bodyPosition: scaleReferenceKartVector({ x: 0, y: -0.03, z: 0 }),
    bodyScale: scaleReferenceKartVector({ x: 1.22, y: 0.28, z: 1.72 }),
    clearanceDatumHeight: scaleReferenceKartLength(0.26),
    upperHousingScale: scaleReferenceKartVector({
      x: 0.72,
      y: 0.42,
      z: 0.78,
    }),
    wheelHubDiameter: scaleReferenceKartLength(0.24),
    wheelHubWidthAllowance: scaleReferenceKartLength(0.025),
  },
  wheel: {
    radius: scaleReferenceKartLength(0.29),
    width: scaleReferenceKartLength(0.3),
  },
  wheelStations: [
    { driven: false, name: "front-left", steered: true, x: -0.9, z: -0.58 },
    { driven: false, name: "front-right", steered: true, x: 0.9, z: -0.58 },
    { driven: true, name: "rear-left", steered: false, x: -0.9, z: 0.62 },
    { driven: true, name: "rear-right", steered: false, x: 0.9, z: 0.62 },
  ].map((station) => ({
    ...station,
    x: scaleReferenceKartLength(station.x),
    z: scaleReferenceKartLength(station.z),
  })),
});

// Physics owns the rigid-body transform at the assembled center of mass, while
// authored poses describe the chassis datum. This is the upright conversion
// shared by scene tests and any future construction preview.
export const REFERENCE_KART_UPRIGHT_ROOT_HEIGHT =
  uprightRootHeight;
