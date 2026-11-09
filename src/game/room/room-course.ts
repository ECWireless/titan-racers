import {
  type CourseDocument,
  getCourseStartTransform,
  rotateByEulerAngles,
} from "../course/course-document";
import type { RaceGateGeometry } from "../race/race-gate";
import { createRaceSessionConfig } from "../race/race-course";
import { ROOM_MAX_PLAYERS } from "./room-protocol";
import type { RoomCourse } from "./room-signing";

// Two by two behind the start line, a lane either side of its centre:
// 1:10 karts are about 0.3 m wide and 0.45 m long.
const GRID_LANE_METRES = 0.5;
const GRID_ROW_METRES = 0.8;

/** A grid slot's offset from the course start, in the start's own axes. */
function roomGridOffset(slot: number) {
  return {
    right: (slot % 2 === 0 ? -1 : 1) * GRID_LANE_METRES,
    back: Math.floor(slot / 2) * GRID_ROW_METRES,
  };
}

/** Where a grid slot's kart starts. */
export function roomGridStart(document: CourseDocument, slot: number) {
  const start = getCourseStartTransform(document);
  const { right, back } = roomGridOffset(slot);
  const offset = rotateByEulerAngles(start.rotation, {
    x: right,
    y: 0,
    z: back,
  });
  return {
    x: start.position.x + offset.x,
    y: start.position.y + offset.y,
    z: start.position.z + offset.z,
  };
}

// Micrometres and millionths keep the token short; the room's gate check
// allows a centimetre.
const round = (value: number) => Math.round(value * 1e6) / 1e6;

function rounded<T extends Record<string, number>>(vector: T): T {
  return Object.fromEntries(
    Object.entries(vector).map(([key, value]) => [key, round(value)]),
  ) as T;
}

function gateGeometry({
  center,
  forward,
  halfExtents,
  worldToLocalRotation,
}: RaceGateGeometry): RaceGateGeometry {
  return {
    center: rounded(center),
    forward: rounded(forward),
    halfExtents: rounded(halfExtents),
    worldToLocalRotation: rounded(worldToLocalRotation),
  };
}

/** What a room checks its karts' states against, for its join tokens. */
export function createRoomCourse(document: CourseDocument): RoomCourse {
  const config = createRaceSessionConfig(document);
  return {
    lapCount: config.lapCount,
    grid: Array.from({ length: ROOM_MAX_PLAYERS }, (_, slot) =>
      rounded(roomGridStart(document, slot)),
    ),
    startGate: gateGeometry(config.startGate),
    startRecovery: { position: rounded(config.startRecovery.position) },
    checkpoints: config.checkpoints.map(({ gate, recovery }) => ({
      gate: gateGeometry(gate),
      recovery: { position: rounded(recovery.position) },
    })),
    doors: document.objects.flatMap((object) =>
      object.door
        ? [{ id: object.id, position: rounded(object.transform.position) }]
        : [],
    ),
  };
}
