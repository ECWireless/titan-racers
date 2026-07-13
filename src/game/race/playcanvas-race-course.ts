import * as pc from "playcanvas";

import type { CourseDocument } from "../course/course-document";
import type {
  DirectedRaceGate,
  RaceQuaternion,
  RaceVector3,
} from "./race-gate";
import type { RaceSessionConfig } from "./race-session";

const LOCAL_FORWARD = new pc.Vec3(0, 0, -1);

function toRaceVector(vector: {
  x: number;
  y: number;
  z: number;
}): RaceVector3 {
  return { x: vector.x, y: vector.y, z: vector.z };
}

function toRaceQuaternion(quaternion: pc.Quat): RaceQuaternion {
  return {
    w: quaternion.w,
    x: quaternion.x,
    y: quaternion.y,
    z: quaternion.z,
  };
}

function rotationFromEuler(rotation: RaceVector3) {
  return new pc.Quat().setFromEulerAngles(rotation.x, rotation.y, rotation.z);
}

function worldToLocalRotation(rotation: RaceVector3) {
  return toRaceQuaternion(rotationFromEuler(rotation).invert());
}

function startGate(document: CourseDocument): DirectedRaceGate {
  const rotation = rotationFromEuler(document.start.rotation);
  const forward = rotation.transformVector(LOCAL_FORWARD.clone()).normalize();

  return {
    center: {
      x: document.start.position.x,
      y: document.start.position.y + document.start.gateHalfExtents.y,
      z: document.start.position.z,
    },
    forward: toRaceVector(forward),
    halfExtents: toRaceVector(document.start.gateHalfExtents),
    id: document.start.id,
    worldToLocalRotation: toRaceQuaternion(rotation.clone().invert()),
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
    startRecovery: {
      position: toRaceVector(document.start.position),
      rotation: toRaceVector(document.start.rotation),
    },
  };
}
