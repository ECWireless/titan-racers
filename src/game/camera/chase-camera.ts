import * as pc from "playcanvas";

const DESKTOP_SETTINGS = {
  distance: 6,
  fov: 45,
  height: 3,
  lookAhead: 2,
};

const MOBILE_SETTINGS = {
  distance: 8.5,
  fov: 58,
  height: 4.2,
  lookAhead: 2.8,
};

const TURN_LOOK_OFFSET = 0.85;
const TURN_YAW_BIAS = 15;
const POSITION_SHARPNESS = 5.5;
const LOOK_SHARPNESS = 8;

function smoothFactor(sharpness: number, deltaSeconds: number) {
  return 1 - Math.exp(-sharpness * deltaSeconds);
}

function rotateY(vector: pc.Vec3, degrees: number) {
  const radians = (degrees * Math.PI) / 180;
  const sin = Math.sin(radians);
  const cos = Math.cos(radians);

  return new pc.Vec3(
    vector.x * cos - vector.z * sin,
    vector.y,
    vector.x * sin + vector.z * cos,
  );
}

export class ChaseCamera {
  private readonly smoothedPosition = new pc.Vec3();
  private readonly smoothedLookTarget = new pc.Vec3();
  private readonly desiredPosition = new pc.Vec3();
  private readonly desiredLookTarget = new pc.Vec3();

  constructor(
    private readonly camera: pc.Entity,
    private readonly kart: pc.Entity,
    private readonly canvas: HTMLCanvasElement,
  ) {}

  update(deltaSeconds: number, turnDirection: number) {
    const cameraComponent = this.camera.camera;
    const settings = this.getSettings();
    const kartPosition = this.kart.getPosition();
    const kartForward = this.kart.forward.clone().normalize();
    const kartRight = this.kart.right.clone().normalize();
    const biasedForward = rotateY(
      kartForward,
      turnDirection * TURN_YAW_BIAS,
    ).normalize();

    if (cameraComponent) {
      cameraComponent.fov = settings.fov;
    }

    this.desiredPosition
      .copy(kartPosition)
      .sub(biasedForward.mulScalar(settings.distance));
    this.desiredPosition.y += settings.height;
    this.desiredPosition.add(
      kartRight.mulScalar(turnDirection * TURN_LOOK_OFFSET),
    );

    this.desiredLookTarget
      .copy(kartPosition)
      .add(kartForward.mulScalar(settings.lookAhead));
    this.desiredLookTarget.y += 0.45;
    this.desiredLookTarget.add(
      kartRight.mulScalar(turnDirection * TURN_LOOK_OFFSET),
    );

    this.smoothedPosition.lerp(
      this.smoothedPosition,
      this.desiredPosition,
      smoothFactor(POSITION_SHARPNESS, deltaSeconds),
    );
    this.smoothedLookTarget.lerp(
      this.smoothedLookTarget,
      this.desiredLookTarget,
      smoothFactor(LOOK_SHARPNESS, deltaSeconds),
    );

    this.camera.setPosition(this.smoothedPosition);
    this.camera.lookAt(this.smoothedLookTarget);
  }

  getTrackedPosition() {
    return this.kart.getPosition().clone();
  }

  private getSettings() {
    return this.canvas.clientHeight > this.canvas.clientWidth * 1.15
      ? MOBILE_SETTINGS
      : DESKTOP_SETTINGS;
  }
}
