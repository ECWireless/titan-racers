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
  isOverGround: boolean;
  maxForwardSpeed: number;
  speed: number;
  steerAngle: number;
  verticalVelocity: number;
  x: number;
  y: number;
  z: number;
};

export type SceneTestApi = {
  getCollisionDebugState: () => CollisionDebugState;
  getEditableObjectPoint: (objectId: EditableObjectId) => CanvasPoint;
  getKartDebugState: () => KartDebugState;
  getTranslateGizmoPoint: (axis: TransformAxis) => CanvasPoint;
  setKartDebugPosition: (position: Position3) => void;
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
      "setKartDebugPosition",
      ((event: CustomEvent<{ position: Position3 }>) => {
        api.setKartDebugPosition(event.detail.position);
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
