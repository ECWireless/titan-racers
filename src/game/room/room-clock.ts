/**
 * Estimates the room server's clock from timed pings, NTP-style: a pong's
 * server time is taken to fall midway through its round trip, and the
 * sample with the shortest round trip wins, since it leaves the least room
 * for one-way delays to differ. A busy page (racing on a slow device) reads
 * its pongs late, so a quiet ping from the lobby beats them; it gives way
 * only as it ages, for the clocks' slow drift.
 */
/** Milliseconds of round trip that each millisecond of age counts as. */
export const ROOM_CLOCK_AGE_PENALTY = 2e-4;
/** Round trips longer than this say too little to keep. */
const MAX_ROUND_TRIP_MS = 3_000;

type ClockSample = { offset: number; roundTrip: number; at: number };

export class RoomClock {
  private best: ClockSample | null = null;

  /**
   * Adds one ping's result: when it was sent and its pong received, on the
   * local clock, and the server's time in the pong. Returns whether it is
   * now the estimate.
   */
  addSample(sentAt: number, serverAt: number, receivedAt: number) {
    const roundTrip = receivedAt - sentAt;
    if (
      !Number.isFinite(roundTrip) ||
      !Number.isFinite(serverAt) ||
      roundTrip < 0 ||
      roundTrip > MAX_ROUND_TRIP_MS
    ) {
      return false;
    }
    const sample = {
      offset: serverAt - (sentAt + receivedAt) / 2,
      roundTrip,
      at: receivedAt,
    };
    const score = ({ roundTrip: trip, at }: ClockSample) =>
      trip + (receivedAt - at) * ROOM_CLOCK_AGE_PENALTY;
    if (this.best && score(this.best) < score(sample)) return false;
    this.best = sample;
    return true;
  }

  get synced() {
    return this.best !== null;
  }

  /** Server time minus local time, in milliseconds. */
  get offset() {
    return this.best?.offset ?? 0;
  }

  /** The kept sample's round trip; half of it bounds the offset's error. */
  get roundTrip() {
    return this.best?.roundTrip ?? Infinity;
  }

  serverNow(localNow: number) {
    return localNow + this.offset;
  }

  localTimeOf(serverTime: number) {
    return serverTime - this.offset;
  }
}

/**
 * The room's race time at a server time, in microseconds: negative through
 * the countdown, zero as racing starts.
 */
export function roomRaceMicroseconds(racingAt: number, serverNow: number) {
  return Math.round((serverNow - racingAt) * 1_000);
}
