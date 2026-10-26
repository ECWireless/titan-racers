/**
 * How fast a wheel visual turns. The physics has no wheel spin, so the
 * visual follows what the tire model implies: a supported wheel rolls with
 * its contact patch, a wheel braked past its grip is locked, and a wheel in
 * the air coasts down on its bearings. Presentation only.
 */

/**
 * How long wheels blur over. A camera would blur over one frame; this is an
 * art choice of at least 1/15 s so a turning wheel reads as one from a
 * crawl, and at least the frame it shows for, so fast detail never strobes
 * backward. Bounded when frames stall.
 */
export function getWheelShutterSeconds(frameSeconds: number) {
  return Math.min(Math.max(frameSeconds, 1 / 15), 1 / 8);
}

/** Seconds for an unsupported wheel's spin to fall to 1/e. */
export const WHEEL_SPIN_COAST_SECONDS = 2;

export type WheelSpinContact = {
  /** Wheel radius, m. */
  radius: number;
  supported: boolean;
  /** Braking force on the wheel exceeds what its tire can grip. */
  locked: boolean;
  /** Contact-patch speed along the wheel's heading, m/s. */
  longitudinalSpeed: number;
};

/** Spin rate in rad/s, positive when rolling forward. */
export function getWheelSpinRate(
  contact: WheelSpinContact,
  previousRate: number,
  stepSeconds: number,
) {
  if (!contact.supported) {
    return previousRate * Math.exp(-stepSeconds / WHEEL_SPIN_COAST_SECONDS);
  }
  if (contact.locked) return 0;
  return contact.longitudinalSpeed / contact.radius;
}
