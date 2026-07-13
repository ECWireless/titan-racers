import type {
  KartMovementTuning,
  CourseTestObstacleId,
  Position3,
} from "../contracts";
import type { ChaseCameraDiagnostics } from "../camera/chase-camera";
import type {
  RaceProgressionResult,
  RaceSessionSnapshot,
} from "../race/race-session";

type CanvasPoint = { x: number; y: number } | null;

export type CollisionDebugState = {
  ambientLightB: number;
  ambientLightG: number;
  ambientLightR: number;
  barrelCollisionAxis: number | null;
  barrelCollisionHeight: number | null;
  barrelCollisionRadius: number | null;
  barrelMaterialMapped: boolean;
  barrelPhysicsFriction: number | null;
  barrelPhysicsGroup: number | null;
  barrelPhysicsMask: number | null;
  barrelPhysicsRestitution: number | null;
  courseEntityCount: number;
  directionalLightCount: number;
  fillLightCastsShadows: boolean | null;
  groundCollisionHalfExtentX: number | null;
  groundCollisionOffsetY: number | null;
  groundCollisionShape: string | null;
  groundIsDrivable: boolean;
  keyLightCastsShadows: boolean | null;
  keyLightIntensity: number | null;
  keyLightRotationX: number | null;
  keyLightRotationY: number | null;
  keyLightShadowResolution: number | null;
  obstacleAInteractionRadius: number | null;
  obstacleAX: number | null;
  obstacleBlocksKart: boolean;
  obstacleCount: number;
  rampCount: number;
  startClear: boolean;
  startLineHasCollision: boolean;
  startLineHasRigidBody: boolean;
};

export type CameraDebugState = ChaseCameraDiagnostics;

export type KartDebugState = {
  angularVelocity: Position3;
  airbornePitchActive: boolean;
  airbornePitchAngle: number;
  airbornePitchRate: number;
  airbornePitchTarget: number;
  airbornePitchTorque: number;
  angularSpeed: number;
  chassisClearance: number;
  forward: Position3;
  isOverGround: boolean;
  linearVelocity: Position3;
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
  up: Position3;
  verticalVelocity: number;
  wheelHubYs: Record<string, number>;
  wheelLoads: Record<string, number>;
  wheelSweepFractions: Record<string, number | null>;
  x: number;
  y: number;
  z: number;
};

export type KartDebugPose = {
  angularVelocity?: Position3;
  ccdEnabled?: boolean;
  linearVelocity?: Position3;
  position: Position3;
  rotation: Position3;
};

export type PresentationDebugState = {
  cameraTrackedPosition: Position3;
  physicsPosition: Position3;
  visualPosition: Position3;
};

export type RaceDebugState = RaceSessionSnapshot & {
  lastProgressionResult: RaceProgressionResult;
};

export type SuspensionDebugState = {
  maximumCompression: number;
  maximumSupportedWheels: number;
  minimumChassisClearance: number;
  minimumSupportedWheels: number;
};

export type CollisionResponseDebugState = {
  ccdMotionThreshold: number | null;
  ccdSweptSphereRadius: number | null;
  contactedEntityNames: string[];
  impactFrameCount: number;
  maximumAngularSpeedAfterImpact: number;
  maximumApproachSpeed: number;
  maximumImpulse: number;
  postLinearVelocity: Position3;
  preLinearVelocity: Position3;
};

export type SceneTestApi = {
  getCameraDebugState: () => CameraDebugState;
  getCollisionDebugState: () => CollisionDebugState;
  getCollisionResponseDebugState: () => CollisionResponseDebugState;
  getKartDebugState: () => KartDebugState;
  getKartScreenPoint: () => CanvasPoint;
  getPresentationDebugState: () => PresentationDebugState;
  getRaceDebugState: () => RaceDebugState;
  getSuspensionDebugState: () => SuspensionDebugState;
  requestRaceRecovery: () => void;
  resetKart: () => void;
  setCourseObjectDebugTransform: (
    objectId: CourseTestObstacleId,
    transform: { position?: Position3; rotation?: Position3 },
  ) => void;
  setKartDebugPose: (pose: KartDebugPose) => void;
  setKartMovementTuning: (tuning: Partial<KartMovementTuning>) => void;
  setRaceDebugMovement: (
    previousPosition: Position3,
    currentPosition: Position3,
    preserveMotion?: boolean,
  ) => void;
  setSimulationPaused: (paused: boolean) => void;
  setStartPosition: (position: Pick<Position3, "x" | "z">) => void;
  stepSimulation: (steps: number) => void;
};

export function attachSceneTestAdapter(
  canvas: HTMLCanvasElement,
  api: SceneTestApi,
) {
  const listeners: Array<[string, EventListener]> = [
    [
      "getCameraDebugState",
      ((
        event: CustomEvent<{
          respond: (state: CameraDebugState) => void;
        }>,
      ) => {
        event.detail.respond(api.getCameraDebugState());
      }) as EventListener,
    ],
    [
      "getCollisionDebugState",
      ((
        event: CustomEvent<{
          respond: (state: CollisionDebugState) => void;
        }>,
      ) => {
        event.detail.respond(api.getCollisionDebugState());
      }) as EventListener,
    ],
    [
      "getCollisionResponseDebugState",
      ((
        event: CustomEvent<{
          respond: (state: CollisionResponseDebugState) => void;
        }>,
      ) => {
        event.detail.respond(api.getCollisionResponseDebugState());
      }) as EventListener,
    ],
    [
      "getKartDebugState",
      ((
        event: CustomEvent<{
          respond: (state: KartDebugState) => void;
        }>,
      ) => {
        event.detail.respond(api.getKartDebugState());
      }) as EventListener,
    ],
    [
      "getKartScreenPoint",
      ((
        event: CustomEvent<{
          respond: (point: CanvasPoint) => void;
        }>,
      ) => {
        event.detail.respond(api.getKartScreenPoint());
      }) as EventListener,
    ],
    [
      "getPresentationDebugState",
      ((
        event: CustomEvent<{
          respond: (state: PresentationDebugState) => void;
        }>,
      ) => {
        event.detail.respond(api.getPresentationDebugState());
      }) as EventListener,
    ],
    [
      "getRaceDebugState",
      ((
        event: CustomEvent<{
          respond: (state: RaceDebugState) => void;
        }>,
      ) => {
        event.detail.respond(api.getRaceDebugState());
      }) as EventListener,
    ],
    [
      "getSuspensionDebugState",
      ((
        event: CustomEvent<{
          respond: (state: SuspensionDebugState) => void;
        }>,
      ) => {
        event.detail.respond(api.getSuspensionDebugState());
      }) as EventListener,
    ],
    [
      "requestRaceRecovery",
      (() => {
        api.requestRaceRecovery();
      }) as EventListener,
    ],
    [
      "resetKart",
      (() => {
        api.resetKart();
      }) as EventListener,
    ],
    [
      "setRaceDebugMovement",
      ((
        event: CustomEvent<{
          currentPosition: Position3;
          preserveMotion?: boolean;
          previousPosition: Position3;
        }>,
      ) => {
        api.setRaceDebugMovement(
          event.detail.previousPosition,
          event.detail.currentPosition,
          event.detail.preserveMotion,
        );
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
    [
      "setKartMovementTuning",
      ((event: CustomEvent<{ tuning: Partial<KartMovementTuning> }>) => {
        api.setKartMovementTuning(event.detail.tuning);
      }) as EventListener,
    ],
    [
      "setStartPosition",
      ((event: CustomEvent<{ position: Pick<Position3, "x" | "z"> }>) => {
        api.setStartPosition(event.detail.position);
      }) as EventListener,
    ],
    [
      "setCourseObjectDebugTransform",
      ((
        event: CustomEvent<{
          objectId: CourseTestObstacleId;
          transform: { position?: Position3; rotation?: Position3 };
        }>,
      ) => {
        api.setCourseObjectDebugTransform(
          event.detail.objectId,
          event.detail.transform,
        );
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
