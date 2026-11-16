import {
  box,
  cylinder,
  lathe,
  piece,
  type KartPartVisualPiece,
  type Station,
  type Vec3,
} from "./kart-part-visual-geometry";

/**
 * Code-built steering and drive linkages, modelled on 1:10 RC hardware: a
 * turnbuckle tie rod with a moulded ball cup at each end, a steering arm on
 * each steered knuckle, and a dogbone driveshaft between slotted cups. The
 * assembly visual poses them; nothing here feeds derivation.
 */

/** A 4.8 mm ball stud, the common 1:10 size. */
const BALL_RADIUS = 0.0024;
/** A ball's centre above the face its stud screws into. */
export const BALL_STUD_HEIGHT = 0.0038;
const BALL_CUP_RADIUS = 0.0036;
const BALL_CUP_HALF_HEIGHT = 0.0022;
const TURNBUCKLE_RADIUS = 0.0015; // 3 mm threaded rod

/** A ball about +Y, the stud's axis. */
function ball(mesh: KartPartVisualPiece, center: Vec3) {
  const r = BALL_RADIUS;
  const d = r * Math.SQRT1_2;
  lathe(mesh, "y", [
    [-r, 0], [-d, d, true], [0, r, true], [d, d, true], [r, 0],
  ], 10, center);
}

/**
 * A tie rod. Frame: origin at the horn ball's centre, +X to the knuckle
 * ball's centre at (length, 0, 0), +Y along the ball studs. It is drawn at
 * its rest length and stretched along X for the little its ends move apart.
 * 528 triangles, two finishes.
 */
export function buildTieRod(length: number): KartPartVisualPiece[] {
  const cups = piece("black-polymer");
  const steel = piece("bare-steel");
  const h = BALL_CUP_HALF_HEIGHT;
  const neckEnd = Math.min(0.012, length * 0.3);
  for (const [x, toward] of [[0, 1], [length, -1]] as const) {
    // The cup's eye, open top and bottom around the ball.
    lathe(cups, "y", [
      [-h, 0.0019], [-h, BALL_CUP_RADIUS - 0.0006],
      [-h + 0.0006, BALL_CUP_RADIUS], [h - 0.0006, BALL_CUP_RADIUS],
      [h, BALL_CUP_RADIUS - 0.0006], [h, 0.0019],
    ], 12, [x, 0, 0]);
    ball(steel, [x, 0, 0]);
    // The cup's threaded neck.
    cylinder(cups, "x", [x + toward * (0.003 + neckEnd) / 2, 0, 0],
      0.0023, neckEnd - 0.003, 8);
  }
  cylinder(steel, "x", [length / 2, 0, 0],
    TURNBUCKLE_RADIUS, length - 2 * neckEnd, 8);
  // The wrench flats at the turnbuckle's centre.
  cylinder(steel, "x", [length / 2, 0, 0], 0.0023, 0.006, 6);
  return [cups, steel];
}

export type KartSteeringArmVisual = {
  /** The tie rod's ball centre. */
  ball: Vec3;
  pieces: KartPartVisualPiece[];
};

/**
 * A steered wheel's steering arm, rigid with its pivot. Frame: the pivot's
 * (origin on the kingpin at the axle; +Y up). It lies against the wheel's
 * inboard face, `reach` along X from the kingpin, and runs `length` along Z
 * to its ball stud; negative values point it the other way. 100 triangles.
 */
export function buildSteeringArm(
  reach: number,
  length: number,
): KartSteeringArmVisual {
  const arm = piece("black-polymer");
  const steel = piece("bare-steel");
  const side = Math.sign(reach);
  const along = Math.sign(length);
  const x = reach + side * 0.0025;
  // It rides just above the suspension arm's tip.
  const bottom = 0.0037;
  const top = 0.0077;
  const middle = (bottom + top) / 2;
  box(arm, [x, middle, (length - along * 0.004) / 2],
    [0.005, top - bottom, Math.abs(length) + 0.004]);
  cylinder(arm, "y", [x, middle, length], 0.0036, top - bottom, 10);
  // The stud's hex seat and neck; the tie rod's cup covers its ball.
  cylinder(steel, "y", [x, top + 0.0008, length], 0.0026, 0.0016, 6);
  cylinder(steel, "y", [x, top + BALL_STUD_HEIGHT / 2 + 0.0008, length],
    0.0012, BALL_STUD_HEIGHT - 0.0016, 6);
  return {
    ball: [x, top + BALL_STUD_HEIGHT, length],
    pieces: [arm, steel],
  };
}

const DOGBONE_SHAFT_RADIUS = 0.0019; // 3.8 mm
const DOGBONE_BALL_RADIUS = 0.0034;
const DOGBONE_PIN_RADIUS = 0.00115;
const DOGBONE_PIN_LENGTH = 0.0098;

/**
 * A dogbone driveshaft. Frame: origin at the axle end's ball centre, +X to
 * the transmission end's ball centre at (length, 0, 0); the cross pins lie
 * along Y, in line with the outdrive cups' slots. 208 triangles.
 */
export function buildDogbone(length: number): KartPartVisualPiece[] {
  const bone = piece("black-oxide-steel");
  const pins = piece("bare-steel");
  const r = DOGBONE_BALL_RADIUS;
  const d = r * Math.SQRT1_2;
  const s = DOGBONE_SHAFT_RADIUS;
  // Where each ball's surface narrows to the shaft.
  const waist = Math.sqrt(r * r - s * s);
  lathe(bone, "x", [
    [-r, 0], [-d, d, true], [0, r, true], [d, d, true], [waist, s],
    [length - waist, s], [length - d, d, true], [length, r, true],
    [length + d, d, true], [length + r, 0],
  ], 10);
  for (const x of [0, length]) {
    cylinder(pins, "y", [x, 0, 0], DOGBONE_PIN_RADIUS, DOGBONE_PIN_LENGTH, 6);
  }
  return [bone, pins];
}

const AXLE_CUP_RADIUS = 0.0055;
const AXLE_CUP_BORE_RADIUS = 0.0042;
const AXLE_CUP_LENGTH = 0.011;
const AXLE_CUP_BORE_DEPTH = 0.008;
const AXLE_STUB_RADIUS = 0.0024;
/** A dogbone's ball centre, inside the cup's mouth. */
const AXLE_CUP_BALL_DEPTH = 0.0038;
/** From a driven arm's lower shock eye inboard to its axle cup's back. */
const AXLE_CUP_EYE_CLEARANCE = 0.006;

/** How far a driven wheel's arm hangs below its pivots, under the dogbone. */
export const DRIVEN_ARM_DROP = 0.006;

/** Along a driven wheel's arm from its pivot, where the dogbone's ball sits. */
export function getAxleCupStation(armLength: number, shockEyeStation: number) {
  const back = Math.min(shockEyeStation, armLength) - AXLE_CUP_EYE_CLEARANCE;
  return Math.max(back - AXLE_CUP_LENGTH + AXLE_CUP_BALL_DEPTH, 0.012);
}

/**
 * A driven wheel's axle: the cup that takes the dogbone, and the stub axle
 * that runs on along the arm to the hub. Frame: +X toward the hub; the
 * dogbone's ball centre is at `station` and the hub at `hub`. The cup opens
 * toward -X. 144 triangles.
 */
export function buildAxleCup(
  station: number,
  hub: number,
): KartPartVisualPiece[] {
  const steel = piece("black-oxide-steel");
  const mouth = station - AXLE_CUP_BALL_DEPTH;
  const back = mouth + AXLE_CUP_LENGTH;
  const floor = mouth + AXLE_CUP_BORE_DEPTH;
  const profile: Station[] = [
    [mouth, AXLE_CUP_BORE_RADIUS], [mouth, AXLE_CUP_RADIUS],
    [back, AXLE_CUP_RADIUS], [back, AXLE_STUB_RADIUS],
    [Math.max(hub, back + 0.001), AXLE_STUB_RADIUS],
    [Math.max(hub, back + 0.001), 0],
    [floor, 0], [floor, AXLE_CUP_BORE_RADIUS],
  ];
  lathe(steel, "x", profile, 12);
  return [steel];
}
