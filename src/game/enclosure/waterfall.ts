import { HABITAT_WORLD_ENVIRONMENT } from "../physics/world-environment";
import { TERRACES } from "./habitat-land";

// The terraces the gorge cuts through, from the floor up.
const CUT = 6;

/**
 * The falls off Falls View Park's sunward terraces: water leaves a spillway
 * in a gorge cut through the lowest six terraces, `drop` metres up its
 * cliff, and falls into a plunge pool joined to the falls lake. Distances
 * in are from the sunward cap; azimuths are degrees from the valley centre,
 * spinward. The gorge sits spinward of the centre, so the falls land
 * spinward of the course's line of sight to the cap.
 */
export const FALLS = {
  /** Where the water leaves the spillway, degrees spinward of the centre. */
  azimuth: 11.5,
  /** The cliff at the gorge's back, up to the sixth terrace's shelf. */
  cliff: {
    height: CUT * TERRACES.rise,
    in: (TERRACES.count - CUT + 1) * TERRACES.depth - TERRACES.run,
  },
  drop: 800,
  /** The gorge's sides, degrees spinward of the centre, on the terraces' 2.5° segments. */
  gorge: [2.5, 15],
  /** The spillway's lip stands this far out from the cliff, metres. */
  lip: 8,
  /** The spillway throws the water out from the cliff, m/s. */
  outflow: 6,
  /** The sheet's width as it leaves the spillway, metres. */
  width: 150,
} as const;

/** The sheet's half-width, metres: it widens by half as it falls. */
export function sheetHalfWidth(time: number, landingTime: number) {
  return (FALLS.width / 2) * (1 + (0.5 * time) / landingTime);
}

/** The sheet's half-width at the spillway, degrees, in a habitat of `radius`. */
export function spillHalfDegrees(radius: number) {
  return (FALLS.width / 2 / (radius - FALLS.drop)) * (180 / Math.PI);
}

/**
 * A spray veil trailing off the sheet's edge on `side` (1 spinward), metres:
 * its half-width, its centre's offset across from the sheet's centre, and
 * how far it drifts out beyond the sheet. It spreads out and away as it
 * falls, but stays inside the gorge.
 */
export function veilShape(side: -1 | 1, time: number, landingTime: number) {
  const share = time / landingTime;
  const half = sheetHalfWidth(time, landingTime);
  return {
    half: half * (0.25 + 0.35 * share),
    offset: side * half * (0.8 + 0.2 * share),
    out: 12 + 40 * share * share,
  };
}

export type FallPoint = {
  /** Seconds since leaving the spillway. */
  time: number;
  /** Distance from the axis, metres. */
  radius: number;
  /** Turn from the spillway's azimuth, radians: negative is anti-spinward. */
  turn: number;
  /** Distance out from the cliff, metres. */
  out: number;
};

/**
 * Water falling from rest relative to the habitat at `radius − drop`. With
 * no forces it moves in a straight line in the stars' frame, at the speed
 * the spin gave it; the floor turns beneath it, so in the habitat it lands
 * behind, anti-spinward (see rotating-habitat-physics). Axial outflow is
 * along the spin axis, which the spin leaves alone. Air drag is left out:
 * real falls break into spray that falls slower and bends less.
 */
export function fallPath(
  radius: number,
  drop: number,
  outflow: number,
  samples: number,
  gravity = HABITAT_WORLD_ENVIRONMENT.gravity,
): FallPoint[] {
  const spin = Math.sqrt(gravity / radius);
  const start = radius - drop;
  const landing = Math.sqrt(radius * radius - start * start) / (spin * start);
  return Array.from({ length: samples + 1 }, (_, i) => {
    const time = (landing * i) / samples;
    const swept = spin * time;
    return {
      out: outflow * time,
      radius: start * Math.hypot(1, swept),
      time,
      turn: Math.atan(swept) - swept,
    };
  });
}
