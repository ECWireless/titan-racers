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
