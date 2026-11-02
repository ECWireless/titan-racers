import {
  getCourseStartTransform,
  quaternionFromEulerAngles,
  rotateByEulerAngles,
  type CourseDocument,
} from "../course/course-document";
import type {
  DirectedRaceGate,
  RaceQuaternion,
  RaceVector3,
} from "./race-gate";
import type { RaceSessionConfig } from "./race-session";

// Plain maths, so the server builds the same gates to check recordings.

function toRaceVector(vector: RaceVector3): RaceVector3 {
  return { x: vector.x, y: vector.y, z: vector.z };
}

function worldToLocalRotation(rotation: RaceVector3): RaceQuaternion {
  const { w, x, y, z } = quaternionFromEulerAngles(rotation);
  return { w, x: -x, y: -y, z: -z };
}

function startGate(document: CourseDocument): DirectedRaceGate {
  const forward = rotateByEulerAngles(document.start.rotation, {
    x: 0,
    y: 0,
    z: -1,
  });
  const length = Math.hypot(forward.x, forward.y, forward.z);

  return {
    center: {
      x: document.start.position.x,
      y: document.start.position.y + document.start.gateHalfExtents.y,
      z: document.start.position.z,
    },
    forward: {
      x: forward.x / length,
      y: forward.y / length,
      z: forward.z / length,
    },
    halfExtents: toRaceVector(document.start.gateHalfExtents),
    id: document.start.id,
    worldToLocalRotation: worldToLocalRotation(document.start.rotation),
  };
}

export function createRaceSessionConfig(
  document: CourseDocument,
): RaceSessionConfig {
  return {
    checkpoints: document.checkpoints.map((checkpoint) => ({
      gate: {
        center: toRaceVector(checkpoint.position),
        forward: toRaceVector(checkpoint.forward),
        halfExtents: toRaceVector(checkpoint.halfExtents),
        id: checkpoint.id,
        worldToLocalRotation: worldToLocalRotation(checkpoint.rotation),
      },
      id: checkpoint.id,
      recovery: {
        position: toRaceVector(checkpoint.recovery.position),
        rotation: toRaceVector(checkpoint.recovery.rotation),
      },
    })),
    countdownSeconds: 3,
    lapCount: 2,
    recoverySeconds: 0.5,
    startGate: startGate(document),
    startRecovery: getCourseStartTransform(document),
  };
}
