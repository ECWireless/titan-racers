/**
 * Estimates the room server's clock from timed pings, NTP-style: a pong's
 * server time is taken to fall midway through its round trip, and the
 * sample with the shortest round trip among the recent ones wins, since it
 * leaves the least room for one-way delays to differ.
 */
export const ROOM_CLOCK_SAMPLES = 8;
/** Round trips longer than this say too little to keep. */
const MAX_ROUND_TRIP_MS = 3_000;

type ClockSample = { offset: number; roundTrip: number };

export class RoomClock {
  private samples: ClockSample[] = [];
  private best: ClockSample | null = null;

  /**
   * Adds one ping's result: when it was sent and its pong received, on the
   * local clock, and the server's time in the pong. Returns whether it was
   * kept.
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
    this.samples.push({
      offset: serverAt - (sentAt + receivedAt) / 2,
      roundTrip,
    });
    if (this.samples.length > ROOM_CLOCK_SAMPLES) this.samples.shift();
    this.best = this.samples.reduce((best, sample) =>
      sample.roundTrip < best.roundTrip ? sample : best,
    );
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
