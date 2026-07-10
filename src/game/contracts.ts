export type TransformAxis = "x" | "y" | "z";

export type ObstacleObjectId =
  | "obstacle-concrete-block-a"
  | "obstacle-barrel-a"
  | "obstacle-concrete-block-b"
  | "obstacle-barrel-b";

export type EditableObjectId = "start-position" | "kart" | ObstacleObjectId;

export type Position3 = {
  x: number;
  y: number;
  z: number;
};

export type StartPosition = Pick<Position3, "x" | "z">;

export type DrivingInput = {
  brake: number;
  reset: boolean;
  steer: number;
  throttle: number;
};

export type KartControllerState = {
  speed: number;
  steerAngle: number;
  verticalVelocity: number;
};

export interface KartController {
  readonly state: KartControllerState;
  reset(): void;
  setTuning(tuning: KartMovementTuning): void;
  update(input: DrivingInput, deltaSeconds: number): void;
}

export type SceneApi = {
  getEditableObjectScreenPoint: (objectId: EditableObjectId) => {
    x: number;
    y: number;
  } | null;
  getTranslateGizmoScreenPoint: (axis: TransformAxis) => {
    x: number;
    y: number;
  } | null;
  rotateSelected: (axis: TransformAxis, delta: number) => void;
  resetKart: () => void;
  setEditorMode: (isEditorMode: boolean) => void;
  setMovementTuning: (movementTuning: KartMovementTuning) => void;
  setStartPosition: (startPosition: StartPosition) => void;
  translateSelected: (axis: TransformAxis, delta: number) => void;
};

export type KartMovementTuning = {
  acceleration: number;
  brakeForce: number;
  drag: number;
  gravity: number;
  maxForwardSpeed: number;
  maxReverseSpeed: number;
  turnRate: number;
};

export type KartMovementTuningKey = keyof KartMovementTuning;
