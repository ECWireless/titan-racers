/**
 * Turns kart state into sound parameters. Pure and presentation only: it reads
 * physics results and never feeds anything back into them.
 */

export type MotorAudioState = {
  /** 0–1.1: motor speed over its no-load speed. */
  motorSpeed: number;
  /** 0–1: drive the ESC is asked for. */
  throttle: number;
  /** 0–1. */
  brake: number;
  /** 0–1: motor force used over the force available. */
  load: number;
  reversing: boolean;
};

export const SILENT_MOTOR: MotorAudioState = Object.freeze({
  brake: 0,
  load: 0,
  motorSpeed: 0,
  reversing: false,
  throttle: 0,
});

type MotorAudioWheel = {
  driven: boolean;
  locked: boolean;
  longitudinalSpeed: number;
  supported: boolean;
};

export type MotorAudioInput = {
  brake: number;
  /** Seconds since the previous call. */
  deltaSeconds: number;
  /** Signed speed along the kart's heading, m/s. */
  forwardSpeed: number;
  handbrake: number;
  /**
   * The kart is held on the grid, so throttle spins its driven wheels in
   * place, as the countdown burnout smoke shows.
   */
  held: boolean;
  noLoadSpeed: number;
  previousMotorSpeed: number;
  /** -1–1; negative drives backward. */
  throttle: number;
  wheels: readonly MotorAudioWheel[];
};

/** Seconds for a free-spinning motor to reach its target speed, to 1/e. */
const FREE_SPIN_UP_SECONDS = 0.12;
const FREE_SPIN_DOWN_SECONDS = 0.5;
/**
 * Seconds for grip to pull wheels spinning faster than the ground (after the
 * grid hold, or a landing under throttle) back to rolling speed, to 1/e.
 */
const GRIP_RECOVERY_SECONDS = 0.2;
/** Motor speed above rolling speed that counts as wheelspin. */
const WHEELSPIN_MARGIN = 0.05;

function clamp(value: number, minimum: number, maximum: number) {
  return Number.isFinite(value)
    ? Math.min(Math.max(value, minimum), maximum)
    : minimum;
}

/**
 * The motor turns with its driven wheels. On the ground they roll with the
 * kart (a locked wheel stops the motor), and wheelspin recovers to rolling
 * speed over a short grip time. With no driven wheel on the ground, or the
 * kart held on the grid, the unloaded motor spins toward its no-load speed at
 * the given throttle and coasts down on release.
 *
 * Load follows the drive model: throttle times the share of no-load speed
 * left, as in `getRequestedDriveForce`. The handbrake works as a clutch.
 */
export function getMotorAudioState(input: MotorAudioInput): MotorAudioState {
  const clutch = 1 - clamp(input.handbrake, 0, 1);
  const drive = clamp(input.throttle, -1, 1) * clutch;
  const throttle = Math.abs(drive);
  const brake = clamp(input.brake, 0, 1);
  const reversing = drive < 0;
  const noLoadSpeed = input.noLoadSpeed > 0 ? input.noLoadSpeed : 1;
  const previous = clamp(input.previousMotorSpeed, 0, 1.1);
  const deltaSeconds = Math.max(input.deltaSeconds, 0);

  let groundWheelCount = 0;
  let rollingSum = 0;
  let locked = false;
  for (const wheel of input.wheels) {
    if (!wheel.driven || !wheel.supported) continue;
    groundWheelCount += 1;
    if (wheel.locked) locked = true;
    else rollingSum += Math.abs(wheel.longitudinalSpeed);
  }

  if (groundWheelCount > 0 && !input.held) {
    const rolling = clamp(rollingSum / groundWheelCount / noLoadSpeed, 0, 1.1);
    const motorSpeed =
      !locked && previous - rolling > WHEELSPIN_MARGIN
        ? rolling +
          (previous - rolling) * Math.exp(-deltaSeconds / GRIP_RECOVERY_SECONDS)
        : rolling;
    const speedInDriveDirection = reversing
      ? -input.forwardSpeed
      : input.forwardSpeed;
    return {
      brake,
      load:
        throttle *
        clamp(1 - Math.max(speedInDriveDirection, 0) / noLoadSpeed, 0, 1),
      motorSpeed,
      reversing,
      throttle,
    };
  }

  const timeConstant =
    throttle > previous ? FREE_SPIN_UP_SECONDS : FREE_SPIN_DOWN_SECONDS;
  const motorSpeed =
    throttle + (previous - throttle) * Math.exp(-deltaSeconds / timeConstant);
  // Spinning tires against the grid's grip load the motor; spinning freely
  // in the air only takes current to speed the wheels up.
  const load = input.held
    ? throttle * 0.6
    : throttle * clamp((throttle - motorSpeed) * 4, 0, 1);
  return {
    brake,
    load: clamp(load, 0, 1),
    motorSpeed: clamp(motorSpeed, 0, 1.1),
    reversing,
    throttle,
  };
}

export type AudioSurface =
  "asphalt" | "concrete" | "grass" | "gravel" | "water";
export type ImpactMaterial = "concrete" | "metal" | "wood" | "soft";
export type RaceCue =
  | "count-1"
  | "count-2"
  | "count-3"
  | "go"
  | "final-lap"
  | "finish"
  | "lap-rejected";

const GRASS_SURFACE_IDS = new Set([
  "surface.lawn-grass",
  "surface.short-grass",
]);
const CONCRETE_LOOKS = new Set(["concrete", "kerb", "obstacleBlock", "timber"]);
const GRAVEL_LOOKS = new Set(["gravel", "mulch"]);

/**
 * What a tire rolls on, by how the ground looks and grips. Water wins when
 * the contact is under a course water volume. Timber decks sound like smooth
 * concrete; anything unknown sounds like asphalt.
 */
export function getAudioSurface(
  physicsSurfaceId: string | null,
  look: string | undefined,
  underWater: boolean,
): AudioSurface {
  if (underWater) return "water";
  if (physicsSurfaceId && GRASS_SURFACE_IDS.has(physicsSurfaceId)) {
    return "grass";
  }
  if (look && GRAVEL_LOOKS.has(look)) return "gravel";
  if (look && CONCRETE_LOOKS.has(look)) return "concrete";
  return "asphalt";
}

const IMPACT_MATERIALS: Readonly<Record<string, ImpactMaterial>> = {
  gravel: "soft",
  ground: "soft",
  hedge: "soft",
  lawn: "soft",
  mulch: "soft",
  obstacleBarrel: "metal",
  ramp: "metal",
  steel: "metal",
  timber: "wood",
  verge: "soft",
};

/** What a course object sounds like when hit, by how it looks. */
export function getImpactMaterial(look: string): ImpactMaterial {
  return IMPACT_MATERIALS[look] ?? "concrete";
}

export type AudioWheel = {
  /** 0–1 vertical load: about 0.25 at rest, about 1 on a hard landing. */
  load: number;
  locked: boolean;
  /** 0–1: from the tire-mark onset to a fully committed slide. */
  scrub: number;
  /** Contact-patch speed, m/s. */
  speed: number;
  supported: boolean;
  surface: AudioSurface | null;
};

/**
 * One wheel's sound inputs. Scrub uses the tire marks' lateral scrub power,
 * so sliding starts to sound where marks start to show.
 */
export function getAudioWheel(
  wheel: {
    appliedLateralTireForce: number;
    lateralSpeed: number;
    locked: boolean;
    longitudinalSpeed: number;
    suspensionLoad: number;
    supported: boolean;
  },
  surface: AudioSurface | null,
  restWheelLoad: number,
  scrubOnsetWatts: number,
  scrubFullWatts: number,
  // Filled in place when given, so per-frame updates allocate nothing.
  target: AudioWheel = {
    load: 0,
    locked: false,
    scrub: 0,
    speed: 0,
    supported: false,
    surface: null,
  },
): AudioWheel {
  if (!wheel.supported || surface === null) {
    target.load = 0;
    target.locked = false;
    target.scrub = 0;
    target.speed = 0;
    target.supported = false;
    target.surface = null;
    return target;
  }
  // The tire marks' lateral scrub power (`getLateralScrubPower`).
  const scrubPower =
    Math.abs(wheel.appliedLateralTireForce) * Math.abs(wheel.lateralSpeed);
  target.load = clamp(
    wheel.suspensionLoad / (4 * Math.max(restWheelLoad, 1e-6)),
    0,
    1,
  );
  target.locked = wheel.locked;
  target.scrub = clamp(
    (scrubPower - scrubOnsetWatts) / (scrubFullWatts - scrubOnsetWatts),
    0,
    1,
  );
  target.speed = Math.hypot(wheel.longitudinalSpeed, wheel.lateralSpeed);
  target.supported = true;
  target.surface = surface;
  return target;
}

/** Approach speed of a full-strength hit, m/s; 4.2 m/s is a firm tap (0.3). */
const IMPACT_FULL_APPROACH_SPEED = 14;
/** Below this the chassis is resting or sliding along, not hitting. */
const IMPACT_MINIMUM_APPROACH_SPEED = 0.5;
/** A wall scrape's repeated contacts sound as one hit within this window. */
const IMPACT_REPEAT_SECONDS = 0.12;

/**
 * Turns contact approach speeds into impact sounds: 0.05 a light brush, 0.3
 * a firm tap, 1 head-on at top speed. A contact that carries on from the
 * last step (scraping along a wall) plays again only when clearly harder,
 * and so does a new one inside the repeat window.
 */
export class ImpactAudioGate {
  private sinceLast = Number.POSITIVE_INFINITY;
  private lastStrength = 0;

  advance(seconds: number) {
    this.sinceLast += seconds;
  }

  /** The strength to play, or null to stay silent. */
  admit(approachSpeed: number, newContact: boolean) {
    if (!(approachSpeed >= IMPACT_MINIMUM_APPROACH_SPEED)) return null;
    const strength = clamp(approachSpeed / IMPACT_FULL_APPROACH_SPEED, 0, 1);
    const repeat = !newContact || this.sinceLast < IMPACT_REPEAT_SECONDS;
    if (repeat && strength < this.lastStrength * 1.5) return null;
    this.sinceLast = 0;
    this.lastStrength = strength;
    return strength;
  }

  reset() {
    this.sinceLast = Number.POSITIVE_INFINITY;
    this.lastStrength = 0;
  }
}

/** Downward speed of a landing from about a 1 m drop in habitat gravity. */
const LANDING_FULL_SPEED = 4.5;
/** Shorter flights are bumps the suspension already hides. */
const LANDING_MINIMUM_AIRBORNE_SECONDS = 0.1;

/**
 * Detects a landing: no wheel on the ground for long enough, then any. The
 * strength follows the downward speed just before touchdown.
 */
export class LandingAudioDetector {
  private airborneSeconds = 0;
  private downwardSpeed = 0;

  /** Returns a landing strength on the step a flight ends, else null. */
  step(supportCount: number, downwardSpeed: number, seconds: number) {
    if (supportCount === 0) {
      this.airborneSeconds += seconds;
      this.downwardSpeed = downwardSpeed;
      return null;
    }
    const landed = this.airborneSeconds >= LANDING_MINIMUM_AIRBORNE_SECONDS;
    this.airborneSeconds = 0;
    if (!landed) return null;
    const strength = clamp(this.downwardSpeed / LANDING_FULL_SPEED, 0, 1);
    return strength >= 0.05 ? strength : null;
  }

  reset() {
    this.airborneSeconds = 0;
    this.downwardSpeed = 0;
  }
}

type CueSnapshot = {
  countdownValue: number | null;
  /** The cue shown on screen, such as "Go!". */
  cue: string | null;
  currentLap: number;
  lapCount: number;
  state: string;
};

/**
 * The cue a race presentation change calls for: each countdown or resume
 * tick, Go whenever the screen shows it, the final lap, and the finish.
 */
export function getRaceCue(
  previous: CueSnapshot,
  next: CueSnapshot,
): RaceCue | null {
  if (
    next.countdownValue !== null &&
    (next.countdownValue !== previous.countdownValue ||
      next.state !== previous.state)
  ) {
    return `count-${clamp(next.countdownValue, 1, 3)}` as RaceCue;
  }
  if (next.cue === "Go!" && previous.cue !== "Go!") return "go";
  if (
    next.state === "racing" &&
    next.currentLap > previous.currentLap &&
    next.currentLap === next.lapCount &&
    next.lapCount > 1
  ) {
    return "final-lap";
  }
  if (next.state === "finished" && previous.state !== "finished") {
    return "finish";
  }
  return null;
}

/** The course object a collider belongs to: arc and elbow walls name their
 * collision boxes `<id>-collision-<n>`. */
export function getContactObjectId(entityName: string) {
  return /^(.*)-collision(?:-\d+)?$/.exec(entityName)?.[1] ?? entityName;
}

/**
 * The material of whatever a chassis contact names: a solid course object, a
 * tree, a parked bicycle, or the clearing's steel fence. Null for anything
 * else, such as drivable ground: an upright chassis bottoming out there is a
 * landing, and only a tipped kart's body sounds on it (see the race canvas).
 */
export function resolveImpactMaterial(
  entityName: string,
  solidMaterials: ReadonlyMap<string, ImpactMaterial>,
): ImpactMaterial | null {
  const solid = solidMaterials.get(getContactObjectId(entityName));
  if (solid) return solid;
  if (entityName.startsWith("course-tree-collider-")) return "wood";
  if (
    entityName.startsWith("course-bicycle-collider-") ||
    entityName.startsWith("course-clearing-fence-")
  ) {
    return "metal";
  }
  return null;
}

/** Uprightness (the body's up · the habitat's up) below which it is tipped. */
export const TIPPED_UPRIGHTNESS = 0.5;
/** Slide speed for a full body scrape, m/s. */
const FULL_SCRAPE_SPEED = 6;

/**
 * How hard a tipped kart's body scrapes along the ground: by the speed it
 * slides across the contact, 0 when upright or off the ground.
 */
export function getBodyScrapeLevel(
  uprightness: number,
  groundContact: boolean,
  slideSpeed: number,
) {
  if (!groundContact || !(uprightness < TIPPED_UPRIGHTNESS)) return 0;
  if (!(slideSpeed > 0.3)) return 0;
  return Math.min(1, slideSpeed / FULL_SCRAPE_SPEED) ** 0.8;
}
