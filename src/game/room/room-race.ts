import type { GhostKart } from "../ghost/device-ghost";
import type { GhostPose } from "../ghost/ghost-playback";
import {
  getKartContactFootprint,
  type KartContactFootprint,
} from "../kart/kart-contact-shadow";
import type { PersistedResolvedKartSnapshot } from "../kart/kart-derivation";
import type { KartAssemblyDocument } from "../kart/kart-assembly-document";
import {
  ROOM_STATE_HZ,
  type RoomClientMessage,
  type RoomServerMessage,
} from "./room-protocol";
import { OpponentMotion } from "./opponent-motion";

/**
 * What a race canvas needs from its room: the room's clock, its grid slot,
 * the opponents to draw, and a way to report its own kart. Opponents are
 * presentation only; nothing here touches the kart's own physics.
 */
export type CanvasRoom = {
  slot: number;
  opponents: Array<{
    id: string;
    kart: GhostKart;
    /** Where its contact shadow falls, in its kart's own axes. */
    footprint: KartContactFootprint;
    /** Its motor's top speed, m/s, which its voice's pitch reaches. */
    noLoadSpeed: number;
  }>;
  /**
   * The room's race time at a local `performance.now()` time, in
   * microseconds, negative through the countdown; null until racing has a
   * start time.
   */
  raceMicroseconds(localTime: number): number | null;
  /**
   * Writes the pose to draw an opponent at the room's race time now,
   * `frameSeconds` after the last frame, or returns null to hide it.
   */
  opponentPose(
    id: string,
    raceMicroseconds: number,
    frameSeconds: number,
    out: GhostPose,
  ): GhostPose | null;
  /** How opponents have drawn this race, for `?perf=1`. */
  opponentStats(): OpponentStats;
  send(message: RoomClientMessage): void;
};

/** Missed time below this is a frame's jitter, not worth charging. */
export const ROOM_CATCH_UP_US = 50_000;
/** A kart's state goes to the room this often. */
export const ROOM_STATE_INTERVAL_MS = 1_000 / ROOM_STATE_HZ;

/** Where an opponent's contact shadow falls, from its published snapshot. */
export function opponentFootprint(snapshot: PersistedResolvedKartSnapshot) {
  return getKartContactFootprint(snapshot.geometry.wheelStations);
}

/** How an opponent's kart is drawn and posed, from its published snapshot. */
export function opponentKart(
  document: KartAssemblyDocument,
  snapshot: PersistedResolvedKartSnapshot,
): GhostKart {
  return {
    centerOfMass: { ...snapshot.massProperties.centerOfMass },
    document,
    wheels: snapshot.geometry.wheelStations.map(({ id, radius, steered }) => ({
      id,
      radius,
      steered,
    })),
  };
}

type RelayedState = Extract<RoomServerMessage, { type: "state" }>;

export type OpponentStats = {
  /** Opponent frames drawn, and those past the newest state. */
  frames: number;
  starvedFrames: number;
  /** The furthest any opponent was drawn behind last frame, in ms. */
  delayMs: number;
};

/** Each opponent's received states, and how each is drawn from them. */
export class OpponentTracks {
  private readonly tracks = new Map<string, OpponentMotion>();
  private readonly hidden = new Set<string>();

  /**
   * Adds a relayed state; `receivedAtUs` is the room's race time as it
   * arrived, if known.
   */
  add(state: RelayedState, receivedAtUs: number | null) {
    let track = this.tracks.get(state.from);
    if (!track) {
      track = new OpponentMotion();
      this.tracks.set(state.from, track);
    }
    track.add(
      {
        t: state.t,
        position: { x: state.p[0], y: state.p[1], z: state.p[2] },
        rotation: { x: state.q[0], y: state.q[1], z: state.q[2], w: state.q[3] },
        velocity: { x: state.v[0], y: state.v[1], z: state.v[2] },
        steerDegrees: state.s,
        reset: state.r,
      },
      receivedAtUs,
    );
  }

  /** An opponent who left the race is no longer drawn. */
  hide(id: string) {
    this.hidden.add(id);
  }

  clear() {
    this.tracks.clear();
    this.hidden.clear();
  }

  pose(
    id: string,
    raceMicroseconds: number,
    frameSeconds: number,
    out: GhostPose,
  ) {
    const track = this.tracks.get(id);
    if (!track || this.hidden.has(id)) return null;
    return track.pose(raceMicroseconds, frameSeconds, out);
  }

  stats(): OpponentStats {
    let frames = 0;
    let starvedFrames = 0;
    let delayUs = 0;
    for (const track of this.tracks.values()) {
      frames += track.frames;
      starvedFrames += track.starvedFrames;
      delayUs = Math.max(delayUs, track.drawnDelayUs);
    }
    return { frames, starvedFrames, delayMs: delayUs / 1_000 };
  }
}
