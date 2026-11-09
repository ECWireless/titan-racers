import type { GhostPose } from "../ghost/ghost-playback";
import type { RaceQuaternion, RaceVector3 } from "../race/race-gate";
import { advanceKartPose, type KartContactBody } from "./kart-contact";
import { ROOM_CONTACT } from "./room-contacts";

/**
 * How one opponent is drawn from the states it sends: a jitter buffer.
 * Each frame draws it a little in the past, at a time its own states'
 * lateness sets, along a curve through the two states either side that
 * uses each one's velocity, so no third state is needed. The time drawn
 * eases rather than jumps, whether the delay changes or the room's clock
 * estimate does. When the newest state is passed, the kart carries on
 * along its velocity, slowing to a stop over 100 ms (a sender's stall
 * then shows as a pause, not a lurch), and once states arrive it blends
 * back onto them within 150 ms. A reset, or a long gap, snaps. What it
 * draws is presentation only, apart from the states it is drawn from.
 *
 * Near your kart, it is drawn where it is now instead (PR 6.6), the same
 * estimate your kart's contacts are tested against: carried on from its
 * newest state by its velocity and spin, plus any push your kart gave it
 * since. Each new state's correction to that estimate blends out rather
 * than jumping. It eases between the past and the present with distance.
 */

/**
 * One state as drawn from: race time (µs), its centre of mass's position,
 * its own axes' rotation, velocity, and spin (rad/s).
 */
export type OpponentState = {
  t: number;
  position: RaceVector3;
  rotation: RaceQuaternion;
  velocity: RaceVector3;
  spin: RaceVector3;
  steerDegrees: number;
  reset: boolean;
  /** Its page says it can't answer a contact in time. */
  outOfTouch: boolean;
};

/** What contact needs of an opponent: where it is, and whether it can touch. */
export type OpponentEstimate = {
  /** Its estimated pose and motion at race time `atUs`; null before a state. */
  present(atUs: number): KartContactBody | null;
  /**
   * Whether its states are timely enough at `atUs` to touch, and its page
   * hasn't said it's out of touch.
   */
  touchable(atUs: number): boolean;
  /** How many resets its states have shown. */
  readonly resets: number;
  /** Its newest state's race time, or -Infinity before any. */
  readonly newestUs: number;
  /** The race time it was shown at last frame; null before its first. */
  readonly shownUs: number | null;
  /**
   * A push your kart gave it from `atUs`, kept until a state of its own from
   * after `forUs` (the touch it answers; by default `atUs`) shows it.
   */
  carry(
    atUs: number,
    velocity: RaceVector3,
    spin: RaceVector3,
    forUs?: number,
  ): void;
};

export const OPPONENT_MOTION = {
  /** The drawn delay's range behind the room's clock. */
  minDelayUs: 100_000,
  maxDelayUs: 350_000,
  /** Added to the latest lateness seen: one state gap at 30 a second. */
  delayMarginUs: 33_333,
  /** Lateness is judged over this much recent time... */
  latenessWindowUs: 3_000_000,
  /** ...ignoring a state this late, which is a resend, not jitter. */
  latenessOutlierUs: 1_000_000,
  /** The drawn time runs at most this much faster or slower than real. */
  maxRateChange: 0.1,
  /** It closes this much of its error each second, within that limit. */
  catchUpPerSecond: 2,
  /** Further off than this, it snaps. */
  snapUs: 500_000,
  /** Past the newest state, the kart slows to a stop over this long. */
  extrapolateUs: 100_000,
  /** A correction is blended in over this long. */
  blendUs: 150_000,
  /** A correction larger than this snaps instead. */
  blendMaxMetres: 3,
  /** Two states further apart than this are a stall or a pause: hold. */
  longGapUs: 500_000,
  /** Kept behind the drawn time, for a step back after a snap. */
  keepUs: 2_000_000,
  /** Within this of your kart it's drawn at the present... */
  nearMetres: 3,
  /** ...and beyond this in the past, easing between with distance... */
  farMetres: 8,
  /** ...by at most this share a second. */
  nearSharePerSecond: 2,
  /** The present is estimated at most this far past the newest state. */
  aheadUs: ROOM_CONTACT.lateUs,
  /**
   * A new state's correction to the present fades by e each this long, so
   * one arriving mid-fade carries on from what's drawn without a stall.
   */
  presentFadeUs: 40_000,
};

const IDENTITY = { w: 1, x: 0, y: 0, z: 0 };

export class OpponentMotion implements OpponentEstimate {
  private readonly states: OpponentState[] = [];
  /** Pushes your kart gave it since its newest state. */
  private shares: Array<{
    t: number;
    forUs: number;
    velocity: RaceVector3;
    spin: RaceVector3;
  }> = [];
  /** The present estimate's last correction, fading from `atUs`. */
  private correction: {
    atUs: number;
    offset: RaceVector3;
    rotation: RaceQuaternion;
  } | null = null;
  /** How late its newest state arrived, if the clock was known. */
  private newestLateUs: number | null = null;
  /** Out of touch by lateness, until a state arrives in time again. */
  private late = true;
  /** How much of the present it's drawn at, by distance from your kart. */
  private nearShare: number | null = null;
  private nearResets = 0;
  resets = 0;
  private lateness: Array<{ at: number; lateUs: number }> = [];
  private drawnUs: number | null = null;
  /** What was drawn last frame, and at what time, for a correction. */
  private readonly lastOutput = {
    position: { x: 0, y: 0, z: 0 },
    rotation: { ...IDENTITY },
  };
  private lastDrawnUs: number | null = null;
  private lastRoomUs: number | null = null;
  /**
   * The race time it was shown at last frame: its drawn time, eased toward
   * the present as near drawing eases its pose; null before its first.
   */
  shownUs: number | null = null;
  /** How far behind the room's clock it was drawn last frame. */
  get drawnDelayUs() {
    return this.lastRoomUs === null || this.lastDrawnUs === null
      ? 0
      : this.lastRoomUs - this.lastDrawnUs;
  }
  private lastNewestUs = -Infinity;
  private lastStarved = false;
  private blend: {
    leftUs: number;
    offset: RaceVector3;
    rotation: RaceQuaternion;
  } | null = null;
  private readonly raw = createPose();
  private readonly previousRaw = createPose();

  /** Frames drawn, and those past the newest state, for `?perf=1`. */
  frames = 0;
  starvedFrames = 0;

  /**
   * Adds a state. `receivedAtUs` is the room's race time as it arrived,
   * if known, to learn how late this opponent's states run.
   */
  add(state: OpponentState, receivedAtUs: number | null) {
    const newest = this.states.at(-1);
    if (newest && state.t <= newest.t) return;
    // What the present looked like as it arrived, to blend from.
    const before =
      newest && receivedAtUs !== null && !state.reset
        ? this.present(receivedAtUs)
        : null;
    this.states.push(state);
    if (state.reset) this.resets += 1;
    // A push answering a touch shows only in states after it: one stamped
    // then is the pose that step began from. A reset leaves none to show.
    this.shares = state.reset
      ? []
      : this.shares.filter(({ forUs }) => forUs >= state.t);
    this.correction = null;
    if (before) {
      const after = this.present(receivedAtUs!)!;
      const offset = {
        x: before.position.x - after.position.x,
        y: before.position.y - after.position.y,
        z: before.position.z - after.position.z,
      };
      if (length(offset) <= OPPONENT_MOTION.blendMaxMetres) {
        this.correction = {
          atUs: receivedAtUs!,
          offset,
          rotation: multiply(before.rotation, conjugate(after.rotation)),
        };
      }
    }
    this.newestLateUs = receivedAtUs === null ? null : receivedAtUs - state.t;
    if (this.newestLateUs === null || this.newestLateUs > ROOM_CONTACT.lateUs) {
      this.late = true;
    }
    if (receivedAtUs === null) return;
    const lateUs = receivedAtUs - state.t;
    if (lateUs > OPPONENT_MOTION.latenessOutlierUs) return;
    this.lateness.push({ at: receivedAtUs, lateUs });
    const since = receivedAtUs - OPPONENT_MOTION.latenessWindowUs;
    while (this.lateness[0] && this.lateness[0].at < since) {
      this.lateness.shift();
    }
  }

  present(atUs: number): KartContactBody | null {
    const newest = this.states.at(-1);
    if (!newest) return null;
    const { aheadUs } = OPPONENT_MOTION;
    const { velocity, spin } = newest;
    const body: KartContactBody = {
      ...advanceKartPose(
        newest,
        Math.min(aheadUs, Math.max(0, atUs - newest.t)) / 1_000_000,
      ),
      velocity: { ...velocity },
      spin: { ...spin },
    };
    for (const share of this.shares) {
      if (atUs <= share.t) continue;
      const pushed = advanceKartPose(
        { ...body, velocity: share.velocity, spin: share.spin },
        Math.min(aheadUs, atUs - share.t) / 1_000_000,
      );
      body.position = pushed.position;
      body.rotation = pushed.rotation;
      body.velocity = add(body.velocity, share.velocity);
      body.spin = add(body.spin, share.spin);
    }
    const { correction } = this;
    if (correction) {
      const share = Math.exp(
        -Math.max(0, atUs - correction.atUs) / OPPONENT_MOTION.presentFadeUs,
      );
      if (share > 1e-3) {
        body.position = add(body.position, scale(correction.offset, share));
        body.rotation = multiply(
          nlerp(IDENTITY, correction.rotation, share),
          body.rotation,
        );
      }
    }
    return body;
  }

  touchable(atUs: number) {
    const newest = this.states.at(-1);
    if (!newest) return false;
    const { lateUs, backUs } = ROOM_CONTACT;
    if (
      atUs - newest.t > lateUs ||
      this.newestLateUs === null ||
      this.newestLateUs > lateUs
    ) {
      this.late = true;
    } else if (this.late && this.newestLateUs < backUs) {
      this.late = false;
    }
    return !this.late && !newest.outOfTouch;
  }

  get newestUs() {
    return this.states.at(-1)?.t ?? -Infinity;
  }

  carry(
    atUs: number,
    velocity: RaceVector3,
    spin: RaceVector3,
    forUs = atUs,
  ) {
    this.shares.push({
      t: atUs,
      forUs,
      velocity: { ...velocity },
      spin: { ...spin },
    });
  }

  /** How far behind the room's clock this opponent aims to be drawn. */
  get delayUs() {
    const latest = this.lateness.reduce(
      (most, { lateUs }) => Math.max(most, lateUs),
      0,
    );
    return Math.min(
      OPPONENT_MOTION.maxDelayUs,
      Math.max(
        OPPONENT_MOTION.minDelayUs,
        latest + OPPONENT_MOTION.delayMarginUs,
      ),
    );
  }

  /**
   * Writes the pose to draw at the room's race time `roomUs`, `frameSeconds`
   * after the last frame, and returns it; null before any state. `near`
   * gives your kart's position, and the race time it's drawn at, to draw
   * this one at the present near it.
   */
  pose(
    roomUs: number,
    frameSeconds: number,
    out: GhostPose,
    near?: { atUs: number; viewer: RaceVector3 },
  ): GhostPose | null {
    if (this.states.length === 0) return null;
    const { drawnUs, snapped } = this.advance(roomUs, frameSeconds);
    const newestUs = this.states.at(-1)!.t;

    const starved = this.sample(drawnUs, this.raw);
    // States arrived after a guess: blend from what was drawn onto them.
    if (
      !snapped &&
      this.lastStarved &&
      newestUs > this.lastNewestUs &&
      this.lastDrawnUs !== null
    ) {
      this.sample(this.lastDrawnUs, this.previousRaw);
      const offset = {
        x: this.lastOutput.position.x - this.previousRaw.position.x,
        y: this.lastOutput.position.y - this.previousRaw.position.y,
        z: this.lastOutput.position.z - this.previousRaw.position.z,
      };
      // A reset among the late states, even one before the time last
      // drawn, means the guess was on the wrong side of a teleport.
      const crossed = this.states.some(
        ({ t, reset }) => reset && t > this.lastNewestUs,
      );
      this.blend =
        crossed ||
        Math.hypot(offset.x, offset.y, offset.z) > OPPONENT_MOTION.blendMaxMetres
          ? null
          : {
              leftUs: OPPONENT_MOTION.blendUs,
              offset,
              rotation: multiply(
                this.lastOutput.rotation,
                conjugate(this.previousRaw.rotation),
              ),
            };
    }
    if (snapped || this.resetBetween(this.lastDrawnUs ?? drawnUs, drawnUs)) {
      this.blend = null;
    }

    copyPose(this.raw, out);
    if (this.blend) {
      this.blend.leftUs -= frameSeconds * 1_000_000;
      if (this.blend.leftUs <= 0) {
        this.blend = null;
      } else {
        const share = smoothstep(this.blend.leftUs / OPPONENT_MOTION.blendUs);
        out.position.x += this.blend.offset.x * share;
        out.position.y += this.blend.offset.y * share;
        out.position.z += this.blend.offset.z * share;
        const correction = nlerp(IDENTITY, this.blend.rotation, share);
        const rotated = multiply(correction, out.rotation);
        Object.assign(out.rotation, rotated);
      }
    }

    this.frames += 1;
    if (starved) this.starvedFrames += 1;
    this.lastStarved = starved;
    this.lastNewestUs = newestUs;
    this.lastDrawnUs = drawnUs;
    this.lastRoomUs = roomUs;
    Object.assign(this.lastOutput.position, out.position);
    Object.assign(this.lastOutput.rotation, out.rotation);
    this.prune(drawnUs);
    this.shownUs = drawnUs;
    if (near) {
      this.drawNear(near, frameSeconds, snapped, out);
      this.shownUs += (near.atUs - drawnUs) * (this.nearShare ?? 0);
    }
    return out;
  }

  /** Eases the drawn pose toward the present, by distance from your kart. */
  private drawNear(
    { atUs, viewer }: { atUs: number; viewer: RaceVector3 },
    frameSeconds: number,
    snapped: boolean,
    out: GhostPose,
  ) {
    const present = this.present(atUs)!;
    const { nearMetres, farMetres, nearSharePerSecond } = OPPONENT_MOTION;
    const distance = length({
      x: present.position.x - viewer.x,
      y: present.position.y - viewer.y,
      z: present.position.z - viewer.z,
    });
    const target = Math.min(
      1,
      Math.max(0, (farMetres - distance) / (farMetres - nearMetres)),
    );
    // A reset or a snap moves the kart, so its share jumps with it.
    const step = Math.max(0, frameSeconds) * nearSharePerSecond;
    this.nearShare =
      this.nearShare === null || snapped || this.resets !== this.nearResets
        ? target
        : this.nearShare +
          Math.max(-step, Math.min(step, target - this.nearShare));
    this.nearResets = this.resets;
    const share = this.nearShare;
    if (share === 0) return;
    const newest = this.states.at(-1)!;
    out.position.x += (present.position.x - out.position.x) * share;
    out.position.y += (present.position.y - out.position.y) * share;
    out.position.z += (present.position.z - out.position.z) * share;
    Object.assign(out.rotation, nlerp(out.rotation, present.rotation, share));
    out.speed += (length(present.velocity) - out.speed) * share;
    out.steerDegrees += (newest.steerDegrees - out.steerDegrees) * share;
  }

  /** Moves the drawn time toward the room's clock less the delay. */
  private advance(roomUs: number, frameSeconds: number) {
    const targetUs = roomUs - this.delayUs;
    if (
      this.drawnUs === null ||
      Math.abs(targetUs - this.drawnUs) > OPPONENT_MOTION.snapUs
    ) {
      this.drawnUs = targetUs;
      return { drawnUs: targetUs, snapped: true };
    }
    const frameUs = Math.max(0, frameSeconds) * 1_000_000;
    const errorUs = targetUs - (this.drawnUs + frameUs);
    const limit = OPPONENT_MOTION.maxRateChange;
    const rate =
      1 +
      Math.max(
        -limit,
        Math.min(limit, errorUs * OPPONENT_MOTION.catchUpPerSecond * 1e-6),
      );
    this.drawnUs += frameUs * rate;
    return { drawnUs: this.drawnUs, snapped: false };
  }

  /** Whether a reset lands in (from, to]. */
  private resetBetween(fromUs: number, toUs: number) {
    return this.states.some(({ t, reset }) => reset && t > fromUs && t <= toUs);
  }

  /** The pose the states give at `atUs`; returns whether it was a guess. */
  private sample(atUs: number, out: GhostPose) {
    const { states } = this;
    const first = states[0];
    if (atUs <= first.t) {
      writeState(first, 0, out);
      return false;
    }
    const newest = states.at(-1)!;
    if (atUs >= newest.t) {
      const limitUs = OPPONENT_MOTION.extrapolateUs;
      const aheadUs = Math.min(atUs - newest.t, limitUs);
      // Slowing evenly to a stop: v·τ·(1 − τ/2T) covers v·T/2 at most.
      const seconds = (aheadUs * (1 - aheadUs / (2 * limitUs))) / 1_000_000;
      writeState(newest, length(newest.velocity) * (1 - aheadUs / limitUs), out);
      out.position.x += newest.velocity.x * seconds;
      out.position.y += newest.velocity.y * seconds;
      out.position.z += newest.velocity.z * seconds;
      return true;
    }
    let index = states.length - 2;
    while (index > 0 && states[index].t > atUs) index -= 1;
    const from = states[index];
    const to = states[index + 1];
    const spanUs = to.t - from.t;
    // A reset teleports: the kart holds until it, then jumps. A long gap is
    // a stall or a pause, when the kart stood still.
    if (to.reset || spanUs > OPPONENT_MOTION.longGapUs) {
      writeState(from, 0, out);
      return false;
    }
    const u = (atUs - from.t) / spanUs;
    const spanSeconds = spanUs / 1_000_000;
    const chord = {
      x: to.position.x - from.position.x,
      y: to.position.y - from.position.y,
      z: to.position.z - from.position.z,
    };
    // Tangents from each state's velocity, no longer than 1.5 chords, so a
    // stall (time without motion) eases through rather than loops.
    const cap = 1.5 * length(chord);
    const m0 = capped(scale(from.velocity, spanSeconds), cap);
    const m1 = capped(scale(to.velocity, spanSeconds), cap);
    for (const axis of ["x", "y", "z"] as const) {
      out.position[axis] = hermite(
        from.position[axis],
        to.position[axis],
        m0[axis],
        m1[axis],
        u,
      );
    }
    out.speed =
      Math.hypot(
        hermiteSlope(from.position.x, to.position.x, m0.x, m1.x, u),
        hermiteSlope(from.position.y, to.position.y, m0.y, m1.y, u),
        hermiteSlope(from.position.z, to.position.z, m0.z, m1.z, u),
      ) / spanSeconds;
    Object.assign(out.rotation, nlerp(from.rotation, to.rotation, u));
    out.steerDegrees =
      from.steerDegrees + (to.steerDegrees - from.steerDegrees) * u;
    return false;
  }

  /** Drops states long behind the drawn time, keeping one before it. */
  private prune(drawnUs: number) {
    const keepFrom = drawnUs - OPPONENT_MOTION.keepUs;
    while (this.states.length > 2 && this.states[1].t < keepFrom) {
      this.states.shift();
    }
  }
}

function createPose(): GhostPose {
  return {
    position: { x: 0, y: 0, z: 0 },
    rotation: { ...IDENTITY },
    speed: 0,
    steerDegrees: 0,
  };
}

function copyPose(from: GhostPose, to: GhostPose) {
  Object.assign(to.position, from.position);
  Object.assign(to.rotation, from.rotation);
  to.speed = from.speed;
  to.steerDegrees = from.steerDegrees;
}

function writeState(state: OpponentState, speed: number, out: GhostPose) {
  Object.assign(out.position, state.position);
  Object.assign(out.rotation, state.rotation);
  out.steerDegrees = state.steerDegrees;
  out.speed = speed;
}

function add(a: RaceVector3, b: RaceVector3) {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function length({ x, y, z }: RaceVector3) {
  return Math.hypot(x, y, z);
}

function scale({ x, y, z }: RaceVector3, by: number) {
  return { x: x * by, y: y * by, z: z * by };
}

function capped(vector: RaceVector3, most: number) {
  const size = length(vector);
  return size > most && size > 0 ? scale(vector, most / size) : vector;
}

function hermite(p0: number, p1: number, m0: number, m1: number, u: number) {
  const u2 = u * u;
  const u3 = u2 * u;
  return (
    (2 * u3 - 3 * u2 + 1) * p0 +
    (u3 - 2 * u2 + u) * m0 +
    (-2 * u3 + 3 * u2) * p1 +
    (u3 - u2) * m1
  );
}

/** The curve's rate of change with u, for the speed the wheels turn at. */
function hermiteSlope(
  p0: number,
  p1: number,
  m0: number,
  m1: number,
  u: number,
) {
  const u2 = u * u;
  return (
    (6 * u2 - 6 * u) * p0 +
    (3 * u2 - 4 * u + 1) * m0 +
    (-6 * u2 + 6 * u) * p1 +
    (3 * u2 - 2 * u) * m1
  );
}

function smoothstep(value: number) {
  const t = Math.min(1, Math.max(0, value));
  return t * t * (3 - 2 * t);
}

/** Normalized blend along the shorter arc. */
function nlerp(a: RaceQuaternion, b: RaceQuaternion, t: number): RaceQuaternion {
  const sign = a.w * b.w + a.x * b.x + a.y * b.y + a.z * b.z < 0 ? -1 : 1;
  const w = a.w + (sign * b.w - a.w) * t;
  const x = a.x + (sign * b.x - a.x) * t;
  const y = a.y + (sign * b.y - a.y) * t;
  const z = a.z + (sign * b.z - a.z) * t;
  const size = Math.hypot(w, x, y, z) || 1;
  return { w: w / size, x: x / size, y: y / size, z: z / size };
}

function multiply(a: RaceQuaternion, b: RaceQuaternion): RaceQuaternion {
  return {
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  };
}

function conjugate({ w, x, y, z }: RaceQuaternion): RaceQuaternion {
  return { w, x: -x, y: -y, z: -z };
}
