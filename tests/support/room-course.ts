import type { RoomKartState } from "../../src/game/room/room-rules";
import type { RoomCourse } from "../../src/game/room/room-signing";

const facingX = {
  forward: { x: 1, y: 0, z: 0 },
  halfExtents: { x: 0.4, y: 1.5, z: 3 },
  worldToLocalRotation: { w: 1, x: 0, y: 0, z: 0 },
};

/**
 * A straight room course along x: the start line at 0 and a checkpoint at
 * each of `checkpoints`, all facing +x, with the grid just behind the line.
 */
export function straightRoomCourse(
  lapCount: number,
  checkpoints: number[],
): RoomCourse {
  return {
    lapCount,
    grid: [
      { x: -1, y: 0, z: -0.5 },
      { x: -1, y: 0, z: 0.5 },
      { x: -1.8, y: 0, z: -0.5 },
      { x: -1.8, y: 0, z: 0.5 },
    ],
    startGate: { center: { x: 0, y: 1, z: 0 }, ...facingX },
    startRecovery: { position: { x: -1, y: 0, z: 0 } },
    checkpoints: checkpoints.map((x) => ({
      gate: { center: { x, y: 1, z: 0 }, ...facingX },
      recovery: { position: { x: x - 1, y: 0, z: 0 } },
    })),
  };
}

/** A kart's state at race time `t`, standing at `x` along the course. */
export function kartAt(
  t: number,
  x: number,
  extra: Partial<RoomKartState> = {},
) {
  return {
    t,
    p: [x, 0.5, 0],
    q: [0, 0, 0, 1],
    v: [20, 0, 0],
    s: 0,
    r: false,
    ...extra,
  } satisfies RoomKartState;
}

/** The step that crosses the gate at `x`, at race time `t`. */
export function crossingAt(t: number, x: number) {
  return kartAt(t, x + 0.1, { g: [x - 0.1, 0.5, 0] });
}
