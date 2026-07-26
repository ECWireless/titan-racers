import * as pc from "playcanvas";

import type { Position3 } from "../contracts";
import { scaleReferenceKartLength } from "../kart/kart-reference-construction";

const DESKTOP_SETTINGS = {
  distance: scaleReferenceKartLength(7.5),
  fov: 45,
  height: scaleReferenceKartLength(3),
  lookAhead: scaleReferenceKartLength(2),
  maximumFov: 51,
  maximumLookAhead: scaleReferenceKartLength(4.2),
};

const MOBILE_SETTINGS = {
  distance: scaleReferenceKartLength(8.5),
  fov: 58,
  height: scaleReferenceKartLength(4.2),
  lookAhead: scaleReferenceKartLength(2.8),
  maximumFov: 63,
  maximumLookAhead: scaleReferenceKartLength(5),
};

const DEFAULT_MAXIMUM_SPEED = 17;
const MOTION_HEADING_WEIGHT = 0.48;
const MOTION_HEADING_MINIMUM_SPEED = 1.2;
const REVERSE_FRAMING_MINIMUM_SPEED = 0.5;
const SLIP_MINIMUM_SPEED = 2;
const MAXIMUM_SLIP_DEGREES = 42;
const MAXIMUM_SLIP_OFFSET = scaleReferenceKartLength(0.8);
const POSITION_SHARPNESS = 5.5;
const OBSTRUCTED_POSITION_SHARPNESS = 24;
const LOOK_SHARPNESS = 8;
const VELOCITY_SHARPNESS = 5;
const FOV_SHARPNESS = 4;
const AIRBORNE_SHARPNESS = 7;
const AIRBORNE_VERTICAL_LAG = 0.65;
const STABILIZATION_ANGULAR_SPEED_START = 2.5;
const STABILIZATION_ANGULAR_SPEED_FULL = 7;
const STABILIZATION_UPRIGHT_START = 0.7;
const STABILIZATION_UPRIGHT_FULL = 0.1;
const STABILIZATION_ENGAGE_SHARPNESS = 10;
const STABILIZATION_RELEASE_SHARPNESS = 2.4;
const NORMAL_HEADING_SLEW_RADIANS_PER_SECOND = (450 * Math.PI) / 180;
const STABILIZED_HEADING_SLEW_RADIANS_PER_SECOND = (25 * Math.PI) / 180;
const STABILIZED_LOOK_AHEAD_RATIO = 0.35;
const CAMERA_PIVOT_HEIGHT = scaleReferenceKartLength(0.65);
const OBSTRUCTION_MARGIN = scaleReferenceKartLength(0.28);
const IMPACT_MINIMUM_APPROACH_SPEED = 3.5;
const IMPACT_MAXIMUM_APPROACH_SPEED = 13;
const IMPACT_MAXIMUM_OFFSET = scaleReferenceKartLength(0.22);
const IMPACT_DECAY_SHARPNESS = 9;
const IMPACT_COOLDOWN_SECONDS = 0.16;

type CameraSettings = {
  distance: number;
  fov: number;
  height: number;
  lookAhead: number;
  maximumFov: number;
  maximumLookAhead: number;
};

export type ChaseCameraImpact = {
  approachSpeed: number;
  id: number;
  normal: Position3;
};

export type ChaseCameraSnapshot = {
  angularVelocity: pc.Vec3;
  impact: ChaseCameraImpact | null;
  linearVelocity: pc.Vec3;
  position: pc.Vec3;
  rotation: pc.Quat;
  supportCount: number;
};

export type ChaseCameraObstruction = {
  normal: pc.Vec3;
  point: pc.Vec3;
};

export type ChaseCameraDiagnostics = {
  airborneBlend: number;
  angularSpeed: number;
  cameraPosition: Position3;
  chaseHeading: Position3;
  desiredPosition: Position3;
  fov: number;
  forwardSpeed: number;
  impactOffset: Position3;
  lookTarget: Position3;
  maximumSpeed: number;
  obstructed: boolean;
  obstructionDistance: number | null;
  planarSpeed: number;
  signedSlipDegrees: number;
  snapCount: number;
  stabilizationBlend: number;
  trailingDistance: number;
  uprightness: number;
};

type ObstructionQuery = (
  pivot: pc.Vec3,
  desiredPosition: pc.Vec3,
) => ChaseCameraObstruction | null;

export function smoothFactor(sharpness: number, deltaSeconds: number) {
  return 1 - Math.exp(-sharpness * Math.max(deltaSeconds, 0));
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

function lerp(start: number, end: number, amount: number) {
  return start + (end - start) * amount;
}

export function calculateCameraStabilizationTarget(
  uprightness: number,
  angularSpeed: number,
) {
  const tiltInstability = clamp(
    (STABILIZATION_UPRIGHT_START - uprightness) /
      (STABILIZATION_UPRIGHT_START - STABILIZATION_UPRIGHT_FULL),
    0,
    1,
  );
  const spinInstability = clamp(
    (angularSpeed - STABILIZATION_ANGULAR_SPEED_START) /
      (STABILIZATION_ANGULAR_SPEED_FULL -
        STABILIZATION_ANGULAR_SPEED_START),
    0,
    1,
  );

  return Math.max(tiltInstability, spinInstability);
}

export function calculatePlanarHeadingStep(
  current: Position3,
  target: Position3,
  maximumRadians: number,
) {
  const currentYaw = Math.atan2(current.x, -current.z);
  const targetYaw = Math.atan2(target.x, -target.z);
  const delta = Math.atan2(
    Math.sin(targetYaw - currentYaw),
    Math.cos(targetYaw - currentYaw),
  );

  return clamp(delta, -Math.max(maximumRadians, 0), Math.max(maximumRadians, 0));
}

export function smoothCameraStabilizationBlend(
  current: number,
  target: number,
  deltaSeconds: number,
) {
  return lerp(
    current,
    target,
    smoothFactor(
      target > current
        ? STABILIZATION_ENGAGE_SHARPNESS
        : STABILIZATION_RELEASE_SHARPNESS,
      deltaSeconds,
    ),
  );
}

export function calculateSignedSlipDegrees(
  forward: Position3,
  velocity: Position3,
  minimumSpeed = SLIP_MINIMUM_SPEED,
) {
  const forwardLength = Math.hypot(forward.x, forward.z);
  const speed = Math.hypot(velocity.x, velocity.z);

  if (forwardLength <= Number.EPSILON || speed < minimumSpeed) {
    return 0;
  }

  const forwardX = forward.x / forwardLength;
  const forwardZ = forward.z / forwardLength;
  const velocityX = velocity.x / speed;
  const velocityZ = velocity.z / speed;
  const crossY = forwardZ * velocityX - forwardX * velocityZ;
  const dot = forwardX * velocityX + forwardZ * velocityZ;

  // Reverse is deliberately orientation-led. Treating backward travel as
  // roughly 180 degrees of slip makes tiny lateral changes alternate between
  // positive and negative angles, which swings the camera across the kart.
  if (dot <= 0) {
    return 0;
  }

  return (Math.atan2(crossY, dot) * 180) / Math.PI;
}

export function calculateImpactStrength(approachSpeed: number) {
  return clamp(
    (approachSpeed - IMPACT_MINIMUM_APPROACH_SPEED) /
      (IMPACT_MAXIMUM_APPROACH_SPEED - IMPACT_MINIMUM_APPROACH_SPEED),
    0,
    1,
  );
}

export function selectStrongerImpact(
  pending: ChaseCameraImpact | null,
  candidate: ChaseCameraImpact,
) {
  return !pending || candidate.approachSpeed > pending.approachSpeed
    ? candidate
    : pending;
}

export class ChaseCamera {
  private readonly smoothedPosition = new pc.Vec3();
  private readonly smoothedLookTarget = new pc.Vec3();
  private readonly smoothedVelocity = new pc.Vec3();
  private readonly desiredPosition = new pc.Vec3();
  private readonly desiredLookTarget = new pc.Vec3();
  private readonly kartForward = new pc.Vec3();
  private readonly kartUp = new pc.Vec3();
  private readonly chaseHeading = new pc.Vec3();
  private readonly desiredChaseHeading = new pc.Vec3();
  private readonly stabilizedHeading = new pc.Vec3();
  private readonly velocityHeading = new pc.Vec3();
  private readonly kartRight = new pc.Vec3();
  private readonly cameraPivot = new pc.Vec3();
  private readonly impactOffset = new pc.Vec3();
  private readonly desiredImpactOffset = new pc.Vec3();
  private readonly correctedPosition = new pc.Vec3();
  private readonly trackedPosition = new pc.Vec3();
  private readonly scaledHeading = new pc.Vec3();
  private readonly scaledRight = new pc.Vec3();
  private readonly pivotToHit = new pc.Vec3();
  private readonly desiredDirection = new pc.Vec3();
  private smoothedFov = DESKTOP_SETTINGS.fov;
  private airborneBlend = 0;
  private lastImpactId = -1;
  private impactCooldown = 0;
  private snapCount = 0;
  private planarSpeed = 0;
  private forwardSpeed = 0;
  private signedSlipDegrees = 0;
  private obstructed = false;
  private obstructionDistance: number | null = null;
  private stabilizationBlend = 0;
  private angularSpeed = 0;
  private uprightness = 1;

  constructor(
    private readonly camera: pc.Entity,
    private readonly canvas: HTMLCanvasElement,
    private readonly queryObstruction: ObstructionQuery = () => null,
    private maximumSpeed = DEFAULT_MAXIMUM_SPEED,
  ) {}

  setMaximumSpeed(maximumSpeed: number) {
    this.maximumSpeed = Math.max(maximumSpeed, Number.EPSILON);
  }

  snap(snapshot: ChaseCameraSnapshot) {
    const settings = this.getSettings();

    this.smoothedVelocity.copy(snapshot.linearVelocity);
    this.airborneBlend = snapshot.supportCount === 0 ? 1 : 0;
    this.impactOffset.set(0, 0, 0);
    this.desiredImpactOffset.set(0, 0, 0);
    this.impactCooldown = 0;
    this.lastImpactId = snapshot.impact?.id ?? -1;
    this.updateMotionState(snapshot);
    this.stabilizationBlend = calculateCameraStabilizationTarget(
      this.uprightness,
      this.angularSpeed,
    );
    this.initializeChaseHeading();
    this.updateDesiredState(snapshot, settings, 0);
    this.resolveObstruction();
    this.smoothedPosition.copy(this.correctedPosition);
    this.smoothedLookTarget.copy(this.desiredLookTarget);
    this.smoothedFov = this.getDesiredFov(settings);
    this.snapCount += 1;
    this.enforceReverseFraming(settings);
    this.applyCameraTransform();
  }

  update(deltaSeconds: number, snapshot: ChaseCameraSnapshot) {
    const frameSeconds = clamp(deltaSeconds, 0, 0.1);
    const settings = this.getSettings();

    this.smoothedVelocity.lerp(
      this.smoothedVelocity,
      snapshot.linearVelocity,
      smoothFactor(VELOCITY_SHARPNESS, frameSeconds),
    );
    this.airborneBlend = lerp(
      this.airborneBlend,
      snapshot.supportCount === 0 ? 1 : 0,
      smoothFactor(AIRBORNE_SHARPNESS, frameSeconds),
    );
    this.updateMotionState(snapshot);
    const stabilizationTarget = calculateCameraStabilizationTarget(
      this.uprightness,
      this.angularSpeed,
    );
    this.stabilizationBlend = smoothCameraStabilizationBlend(
      this.stabilizationBlend,
      stabilizationTarget,
      frameSeconds,
    );
    this.impactCooldown = Math.max(this.impactCooldown - frameSeconds, 0);
    this.consumeImpact(snapshot.impact);
    this.updateDesiredState(snapshot, settings, frameSeconds);
    this.resolveObstruction();

    this.impactOffset.lerp(
      this.impactOffset,
      this.desiredImpactOffset,
      smoothFactor(IMPACT_DECAY_SHARPNESS, frameSeconds),
    );
    this.desiredImpactOffset.mulScalar(
      Math.exp(-IMPACT_DECAY_SHARPNESS * frameSeconds),
    );
    this.correctedPosition.add(this.impactOffset);

    this.smoothedPosition.lerp(
      this.smoothedPosition,
      this.correctedPosition,
      smoothFactor(
        this.obstructed ? OBSTRUCTED_POSITION_SHARPNESS : POSITION_SHARPNESS,
        frameSeconds,
      ),
    );
    this.smoothedLookTarget.lerp(
      this.smoothedLookTarget,
      this.desiredLookTarget,
      smoothFactor(LOOK_SHARPNESS, frameSeconds),
    );
    this.smoothedFov = lerp(
      this.smoothedFov,
      this.getDesiredFov(settings),
      smoothFactor(FOV_SHARPNESS, frameSeconds),
    );
    this.enforceReverseFraming(settings);
    this.applyCameraTransform();
  }

  getTrackedPosition() {
    return this.trackedPosition.clone();
  }

  getDiagnostics(): ChaseCameraDiagnostics {
    return {
      airborneBlend: this.airborneBlend,
      angularSpeed: this.angularSpeed,
      cameraPosition: copyPosition(this.smoothedPosition),
      chaseHeading: copyPosition(this.chaseHeading),
      desiredPosition: copyPosition(this.desiredPosition),
      fov: this.smoothedFov,
      forwardSpeed: this.forwardSpeed,
      impactOffset: copyPosition(this.impactOffset),
      lookTarget: copyPosition(this.smoothedLookTarget),
      maximumSpeed: this.maximumSpeed,
      obstructed: this.obstructed,
      obstructionDistance: this.obstructionDistance,
      planarSpeed: this.planarSpeed,
      signedSlipDegrees: this.signedSlipDegrees,
      snapCount: this.snapCount,
      stabilizationBlend: this.stabilizationBlend,
      trailingDistance: this.calculateTrailingDistance(),
      uprightness: this.uprightness,
    };
  }

  private updateMotionState(snapshot: ChaseCameraSnapshot) {
    snapshot.rotation.transformVector(pc.Vec3.FORWARD, this.kartForward);
    snapshot.rotation.transformVector(pc.Vec3.UP, this.kartUp);
    this.uprightness = clamp(this.kartUp.y, -1, 1);
    this.angularSpeed = snapshot.angularVelocity.length();

    this.kartForward.y = 0;
    if (this.kartForward.lengthSq() > Number.EPSILON) {
      this.kartForward.normalize();
    }

    this.planarSpeed = Math.hypot(
      this.smoothedVelocity.x,
      this.smoothedVelocity.z,
    );
    if (this.planarSpeed >= MOTION_HEADING_MINIMUM_SPEED) {
      this.velocityHeading
        .set(this.smoothedVelocity.x, 0, this.smoothedVelocity.z)
        .normalize();
    }
  }

  private initializeChaseHeading() {
    if (this.kartForward.lengthSq() > Number.EPSILON) {
      this.chaseHeading.copy(this.kartForward);
    } else if (this.planarSpeed >= MOTION_HEADING_MINIMUM_SPEED) {
      this.chaseHeading.copy(this.velocityHeading);
    } else {
      this.chaseHeading.set(0, 0, -1);
    }

    this.updateDesiredHeading();
    this.chaseHeading.copy(this.desiredChaseHeading);
  }

  private updateDesiredHeading() {
    if (this.kartForward.lengthSq() <= Number.EPSILON) {
      this.kartForward.copy(this.chaseHeading);
    }
    const orientationForwardSpeed =
      this.smoothedVelocity.dot(this.kartForward);
    this.desiredChaseHeading.copy(this.kartForward);

    if (
      this.planarSpeed >= MOTION_HEADING_MINIMUM_SPEED &&
      orientationForwardSpeed > 0
    ) {
      const motionWeight =
        MOTION_HEADING_WEIGHT *
        clamp((this.planarSpeed - MOTION_HEADING_MINIMUM_SPEED) / 6, 0, 1);
      this.desiredChaseHeading
        .lerp(this.kartForward, this.velocityHeading, motionWeight)
        .normalize();
    }

    this.stabilizedHeading.copy(
      this.planarSpeed >= MOTION_HEADING_MINIMUM_SPEED &&
        this.smoothedVelocity.dot(this.chaseHeading) > 0
        ? this.velocityHeading
        : this.chaseHeading,
    );
    blendPlanarHeadings(
      this.desiredChaseHeading,
      this.stabilizedHeading,
      this.stabilizationBlend,
      this.desiredChaseHeading,
    );
  }

  private updateDesiredState(
    snapshot: ChaseCameraSnapshot,
    settings: CameraSettings,
    frameSeconds: number,
  ) {
    this.trackedPosition.copy(snapshot.position);
    this.updateDesiredHeading();
    const maximumHeadingStep =
      lerp(
        NORMAL_HEADING_SLEW_RADIANS_PER_SECOND,
        STABILIZED_HEADING_SLEW_RADIANS_PER_SECOND,
        this.stabilizationBlend,
      ) * frameSeconds;
    const headingStep = calculatePlanarHeadingStep(
      this.chaseHeading,
      this.desiredChaseHeading,
      maximumHeadingStep,
    );
    const nextYaw = Math.atan2(this.chaseHeading.x, -this.chaseHeading.z) +
      headingStep;
    this.chaseHeading.set(Math.sin(nextYaw), 0, -Math.cos(nextYaw));
    this.forwardSpeed = this.smoothedVelocity.dot(this.chaseHeading);

    this.kartRight.cross(pc.Vec3.UP, this.chaseHeading).normalize();
    this.signedSlipDegrees = clamp(
      calculateSignedSlipDegrees(this.kartForward, this.smoothedVelocity),
      -MAXIMUM_SLIP_DEGREES,
      MAXIMUM_SLIP_DEGREES,
    );
    const slipOffset =
      (this.signedSlipDegrees / MAXIMUM_SLIP_DEGREES) *
      MAXIMUM_SLIP_OFFSET *
      (1 - this.stabilizationBlend);
    const speedRatio = clamp(this.planarSpeed / this.maximumSpeed, 0, 1);
    const lookAhead =
      lerp(settings.lookAhead, settings.maximumLookAhead, speedRatio) *
      lerp(1, STABILIZED_LOOK_AHEAD_RATIO, this.stabilizationBlend);

    this.desiredPosition
      .copy(snapshot.position)
      .sub(
        this.scaledHeading.copy(this.chaseHeading).mulScalar(settings.distance),
      );
    this.desiredPosition.y +=
      settings.height + this.airborneBlend * AIRBORNE_VERTICAL_LAG;
    this.desiredPosition.add(
      this.scaledRight.copy(this.kartRight).mulScalar(slipOffset),
    );

    this.desiredLookTarget
      .copy(snapshot.position)
      .add(this.scaledHeading.copy(this.chaseHeading).mulScalar(lookAhead));
    this.desiredLookTarget.y += 0.45;
    this.desiredLookTarget.add(
      this.scaledRight.copy(this.kartRight).mulScalar(slipOffset * 0.65),
    );
  }

  private resolveObstruction() {
    this.cameraPivot.copy(this.trackedPosition);
    this.cameraPivot.y += CAMERA_PIVOT_HEIGHT;
    const obstruction = this.queryObstruction(
      this.cameraPivot,
      this.desiredPosition,
    );

    this.correctedPosition.copy(this.desiredPosition);
    this.obstructed = obstruction !== null;
    this.obstructionDistance = null;

    if (!obstruction) {
      return;
    }

    const hitDistance = this.pivotToHit
      .copy(obstruction.point)
      .sub(this.cameraPivot)
      .length();
    const correctedDistance = Math.max(hitDistance - OBSTRUCTION_MARGIN, 0);
    this.desiredDirection
      .copy(this.desiredPosition)
      .sub(this.cameraPivot)
      .normalize();

    this.correctedPosition
      .copy(this.cameraPivot)
      .add(this.desiredDirection.mulScalar(correctedDistance));
    this.obstructionDistance = correctedDistance;
  }

  private calculateTrailingDistance() {
    return (
      (this.trackedPosition.x - this.smoothedPosition.x) *
        this.chaseHeading.x +
      (this.trackedPosition.z - this.smoothedPosition.z) *
        this.chaseHeading.z
    );
  }

  private enforceReverseFraming(settings: CameraSettings) {
    // Forward smoothing leaves the camera farther behind. In reverse it creates
    // the opposite error: at speed, the kart can catch and cross the camera
    // plane. Correct only that unsafe longitudinal lag so reverse remains
    // orientation-led. A real obstruction remains authoritative.
    if (
      this.obstructed ||
      this.forwardSpeed >= -REVERSE_FRAMING_MINIMUM_SPEED
    ) {
      return;
    }

    const correction = settings.distance - this.calculateTrailingDistance();

    if (correction > 0) {
      this.smoothedPosition.sub(
        this.scaledHeading.copy(this.chaseHeading).mulScalar(correction),
      );
    }
  }

  private consumeImpact(impact: ChaseCameraImpact | null) {
    if (!impact || impact.id === this.lastImpactId) {
      return;
    }

    this.lastImpactId = impact.id;
    const strength = calculateImpactStrength(impact.approachSpeed);

    if (strength <= 0 || this.impactCooldown > 0) {
      return;
    }

    this.desiredImpactOffset.set(
      impact.normal.x,
      Math.max(impact.normal.y, 0) * 0.3,
      impact.normal.z,
    );
    if (this.desiredImpactOffset.lengthSq() > Number.EPSILON) {
      this.desiredImpactOffset
        .normalize()
        .mulScalar(strength * IMPACT_MAXIMUM_OFFSET);
    }
    this.impactCooldown = IMPACT_COOLDOWN_SECONDS;
  }

  private applyCameraTransform() {
    const cameraComponent = this.camera.camera;

    if (cameraComponent) {
      cameraComponent.fov = this.smoothedFov;
    }

    this.camera.setPosition(this.smoothedPosition);
    this.camera.lookAt(this.smoothedLookTarget, pc.Vec3.UP);
  }

  private getDesiredFov(settings: CameraSettings) {
    return lerp(
      settings.fov,
      settings.maximumFov,
      clamp(this.planarSpeed / this.maximumSpeed, 0, 1),
    );
  }

  private getSettings() {
    return this.canvas.clientHeight > this.canvas.clientWidth * 1.15
      ? MOBILE_SETTINGS
      : DESKTOP_SETTINGS;
  }
}

function copyPosition(vector: pc.Vec3): Position3 {
  return { x: vector.x, y: vector.y, z: vector.z };
}

function blendPlanarHeadings(
  start: pc.Vec3,
  end: pc.Vec3,
  amount: number,
  result: pc.Vec3,
) {
  const startYaw = Math.atan2(start.x, -start.z);
  const delta = calculatePlanarHeadingStep(start, end, Math.PI);
  const yaw = startYaw + delta * clamp(amount, 0, 1);

  result.set(Math.sin(yaw), 0, -Math.cos(yaw));
}
