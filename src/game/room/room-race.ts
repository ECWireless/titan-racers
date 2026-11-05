import type { GhostKart } from "../ghost/device-ghost";
import { GhostPlayback, type GhostPose } from "../ghost/ghost-playback";
import type { PersistedResolvedKartSnapshot } from "../kart/kart-derivation";
import type { KartAssemblyDocument } from "../kart/kart-assembly-document";
import {
  ROOM_STATE_HZ,
  type RoomClientMessage,
  type RoomServerMessage,
} from "./room-protocol";

/**
 * What a race canvas needs from its room: the room's clock, its grid slot,
 * the opponents to draw, and a way to report its own kart. Opponents are
 * presentation only; nothing here touches the kart's own physics.
 */
export type CanvasRoom = {
  slot: number;
  opponents: Array<{ id: string; kart: GhostKart }>;
  /**
   * The room's race time at a local `performance.now()` time, in
   * microseconds, negative through the countdown; null until racing has a
   * start time.
   */
  raceMicroseconds(localTime: number): number | null;
  /** Writes an opponent's pose at a race time, or returns null to hide it. */
  opponentPose(
    id: string,
    raceMicroseconds: number,
    out: GhostPose,
  ): GhostPose | null;
  send(message: RoomClientMessage): void;
};

/**
 * Opponents are drawn this far behind the room's clock, between samples:
 * two state gaps, so a late or bunched state rarely leaves it guessing.
 */
export const ROOM_OPPONENT_DELAY_US = 200_000;
/** Missed time below this is a frame's jitter, not worth charging. */
export const ROOM_CATCH_UP_US = 50_000;
/** A kart's state goes to the room this often. */
export const ROOM_STATE_INTERVAL_MS = 1_000 / ROOM_STATE_HZ;

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

/** Each opponent's received states, played back like a ghost. */
export class OpponentTracks {
  private readonly tracks = new Map<string, GhostPlayback>();
  private readonly hidden = new Set<string>();

  add(state: RelayedState) {
    const sample = {
      timeMicroseconds: state.t,
      position: { x: state.p[0], y: state.p[1], z: state.p[2] },
      rotation: { x: state.q[0], y: state.q[1], z: state.q[2], w: state.q[3] },
      steerDegrees: state.s,
      reset: state.r,
      gate: false,
    };
    const track = this.tracks.get(state.from);
    if (track) track.append(sample);
    else this.tracks.set(state.from, new GhostPlayback([sample]));
  }

  /** An opponent who left the race is no longer drawn. */
  hide(id: string) {
    this.hidden.add(id);
  }

  clear() {
    this.tracks.clear();
    this.hidden.clear();
  }

  /** Holds the latest pose, standing still, rather than guess past it. */
  pose(id: string, raceMicroseconds: number, out: GhostPose) {
    const track = this.tracks.get(id);
    if (!track || this.hidden.has(id)) return null;
    const held = raceMicroseconds >= track.finishMicroseconds;
    const pose = track.sample(
      held ? track.finishMicroseconds : raceMicroseconds,
      out,
    );
    if (pose && held) pose.speed = 0;
    return pose;
  }
}
