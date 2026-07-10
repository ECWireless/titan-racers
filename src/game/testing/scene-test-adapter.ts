import type {
  EditableObjectId,
  Position3,
  TransformAxis,
} from "../contracts";

type CanvasPoint = { x: number; y: number } | null;

export type CollisionDebugState = {
  blockAX: number | null;
  obstacleBlocksKart: boolean;
  obstacleCount: number;
  startClear: boolean;
};

export type KartDebugState = {
  angularSpeed: number;
  isOverGround: boolean;
  maximumLateralSpeed: number;
  maximumTireForceUtilization: number;
  maxForwardSpeed: number;
  rotationX: number;
  rotationY: number;
  rotationZ: number;
  speed: number;
  steerAngle: number;
  supportCount: number;
  supportEntityNames: string[];
  supportedWheelNames: string[];
  saturatedTireCount: number;
  verticalVelocity: number;
  wheelLoads: Record<string, number>;
  x: number;
  y: number;
  z: number;
};

export type KartDebugPose = {
  angularVelocity?: Position3;
  linearVelocity?: Position3;
  position: Position3;
  rotation: Position3;
};

export type PresentationDebugState = {
  cameraTrackedPosition: Position3;
  physicsPosition: Position3;
  visualPosition: Position3;
};

export type SceneTestApi = {
  getCollisionDebugState: () => CollisionDebugState;
  getEditableObjectPoint: (objectId: EditableObjectId) => CanvasPoint;
  getKartDebugState: () => KartDebugState;
  getPresentationDebugState: () => PresentationDebugState;
  getTranslateGizmoPoint: (axis: TransformAxis) => CanvasPoint;
  setKartDebugPose: (pose: KartDebugPose) => void;
  setSimulationPaused: (paused: boolean) => void;
  stepSimulation: (steps: number) => void;
};

export function attachSceneTestAdapter(
  canvas: HTMLCanvasElement,
  api: SceneTestApi,
) {
  const listeners: Array<[string, EventListener]> = [
    [
      "getTranslateGizmoPoint",
      ((event: CustomEvent<{
        axis: TransformAxis;
        respond: (point: CanvasPoint) => void;
      }>) => {
        event.detail.respond(api.getTranslateGizmoPoint(event.detail.axis));
      }) as EventListener,
    ],
    [
      "getEditableObjectPoint",
      ((event: CustomEvent<{
        objectId: EditableObjectId;
        respond: (point: CanvasPoint) => void;
      }>) => {
        event.detail.respond(api.getEditableObjectPoint(event.detail.objectId));
      }) as EventListener,
    ],
    [
      "getCollisionDebugState",
      ((event: CustomEvent<{
        respond: (state: CollisionDebugState) => void;
      }>) => {
        event.detail.respond(api.getCollisionDebugState());
      }) as EventListener,
    ],
    [
      "getKartDebugState",
      ((event: CustomEvent<{
        respond: (state: KartDebugState) => void;
      }>) => {
        event.detail.respond(api.getKartDebugState());
      }) as EventListener,
    ],
    [
      "getPresentationDebugState",
      ((event: CustomEvent<{
        respond: (state: PresentationDebugState) => void;
      }>) => {
        event.detail.respond(api.getPresentationDebugState());
      }) as EventListener,
    ],
    [
      "setSimulationPaused",
      ((event: CustomEvent<{ paused: boolean }>) => {
        api.setSimulationPaused(event.detail.paused);
      }) as EventListener,
    ],
    [
      "stepSimulation",
      ((event: CustomEvent<{ steps: number }>) => {
        api.stepSimulation(event.detail.steps);
      }) as EventListener,
    ],
    [
      "setKartDebugPose",
      ((event: CustomEvent<{ pose: KartDebugPose }>) => {
        api.setKartDebugPose(event.detail.pose);
      }) as EventListener,
    ],
  ];

  listeners.forEach(([eventName, listener]) => {
    canvas.addEventListener(eventName, listener);
  });

  return () => {
    listeners.forEach(([eventName, listener]) => {
      canvas.removeEventListener(eventName, listener);
    });
  };
}
