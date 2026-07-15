"use client";

import * as pc from "playcanvas";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { KartTuningDrawer } from "@/components/kart-tuning-drawer";
import type {
  DrivingInput,
  KartTuning,
  KartTuningKey,
  CourseTestObstacleId,
  Position3,
} from "@/game/contracts";
import { KartCollisionObserver } from "@/game/collision/kart-collision-observer";
import {
  calculateImpactStrength,
  ChaseCamera,
  selectStrongerImpact,
  type ChaseCameraImpact,
  type ChaseCameraSnapshot,
} from "@/game/camera/chase-camera";
import { buildCourseLighting } from "@/game/course/build-course-lighting";
import { buildRoughCourse } from "@/game/course/build-rough-course";
import {
  type CourseDocument,
  getCourseStartTransform,
  ROUGH_COURSE_DOCUMENT,
} from "@/game/course/course-document";
import { PlayerInputManager } from "@/game/input/player-input-manager";
import { isEditableKeyboardTarget } from "@/game/input/keyboard-input";
import { useControllerMenuNavigation } from "@/game/input/use-controller-menu-navigation";
import {
  normalizeTouchJoystick,
  type TouchPedalAction,
} from "@/game/input/touch-input";
import {
  DynamicKartController,
  type DynamicWheel,
} from "@/game/kart/dynamic-kart-controller";
import { KartDriftSmoke } from "@/game/kart/kart-drift-smoke";
import {
  getManualRightingAxis,
  getManualRightingTorqueScale,
} from "@/game/kart/kart-righting";
import {
  DEFAULT_KART_TUNING,
  normalizeKartTuning,
} from "@/game/kart/kart-tuning";
import {
  KART_SUSPENSION_MAX_COMPRESSION_Y,
  KART_SUSPENSION_REST_TRAVEL,
  KART_WHEEL_RADIUS,
  KART_WHEEL_WIDTH,
} from "@/game/kart/kart-dimensions";
import { PHYSICS_GROUP, PHYSICS_MASK } from "@/game/physics/collision-groups";
import {
  createPlayCanvasRuntime,
  loadAmmoPhysics,
} from "@/game/runtime/playcanvas-application";
import {
  calculateBoxInertia,
  configureRigidBodyCcd,
  getRigidBodyCcdConfiguration,
  setExplicitRigidBodyInertia,
} from "@/game/runtime/ammo-rigid-body";
import { createRaceSessionConfig } from "@/game/race/playcanvas-race-course";
import {
  createLoadingRacePresentationSnapshot,
  createRacePresentationSnapshot,
  racePresentationSnapshotsEqual,
  type RacePresentationSnapshot,
} from "@/game/race/race-presentation";
import {
  RaceSession,
  type RaceProgressionResult,
  type RaceTransform,
} from "@/game/race/race-session";
import { attachSceneTestAdapter } from "@/game/testing/scene-test-adapter";
import {
  GameplayRunTelemetry,
  httpGameplayTelemetrySink,
  type GameplayRunFailureCode,
} from "@/game/telemetry/gameplay-run-events";

const KART_ROOT_HEIGHT = 0.43;
const KART_MASS = 120;
const KART_BODY_MASS = 70;
const KART_COCKPIT_MASS = KART_MASS - KART_BODY_MASS;
const KART_BODY_MASS_CENTER = { x: 0, y: -0.18, z: 0 } as const;
const KART_COCKPIT_POSITION = { x: 0, y: 0.24, z: 0.48 } as const;
const KART_CENTER_OF_MASS_OFFSET = {
  x:
    (KART_BODY_MASS * KART_BODY_MASS_CENTER.x +
      KART_COCKPIT_MASS * KART_COCKPIT_POSITION.x) /
    KART_MASS,
  y:
    (KART_BODY_MASS * KART_BODY_MASS_CENTER.y +
      KART_COCKPIT_MASS * KART_COCKPIT_POSITION.y) /
    KART_MASS,
  z:
    (KART_BODY_MASS * KART_BODY_MASS_CENTER.z +
      KART_COCKPIT_MASS * KART_COCKPIT_POSITION.z) /
    KART_MASS,
} as const;
const KART_GEOMETRY_OFFSET = {
  x: -KART_CENTER_OF_MASS_OFFSET.x,
  y: -KART_CENTER_OF_MASS_OFFSET.y,
  z: -KART_CENTER_OF_MASS_OFFSET.z,
} as const;
const KART_CHASSIS_DIMENSIONS = { x: 1.25, y: 0.55, z: 1.85 } as const;
const KART_INERTIA = calculateBoxInertia(KART_MASS, KART_CHASSIS_DIMENSIONS);
const KART_RESET_FALL_Y = -10;
const MANUAL_RIGHTING_COOLDOWN_SECONDS = 0.45;
const MANUAL_RIGHTING_SUPPORT_PROBE_DISTANCE = 1.1;
const KART_TAP_MAX_DURATION_MS = 300;
const KART_TAP_MAX_MOVEMENT_PX = 12;
const KART_COLLISION_RADIUS = 0.95;
const KART_CCD_CONFIGURATION = {
  motionThreshold: 0.12,
  sweptSphereRadius: 0.16,
} as const;
const NEUTRAL_DRIVING_INPUT: DrivingInput = {
  brake: 0,
  handbrake: 0,
  reset: false,
  steer: 0,
  throttle: 0,
};

function createMaterial(color: pc.Color) {
  const material = new pc.StandardMaterial();
  material.diffuse = color;
  material.update();

  return material;
}

function toFixedStep(value: number) {
  const roundedValue = Number(value.toFixed(2));

  return Object.is(roundedValue, -0) ? 0 : roundedValue;
}

function offsetKartGeometry(position: pc.Vec3) {
  return position.add(
    new pc.Vec3(
      KART_GEOMETRY_OFFSET.x,
      KART_GEOMETRY_OFFSET.y,
      KART_GEOMETRY_OFFSET.z,
    ),
  );
}

function getKartRootPosition(chassisPosition: pc.Vec3, rotation: pc.Quat) {
  return chassisPosition.add(
    rotation.transformVector(
      new pc.Vec3(
        KART_CENTER_OF_MASS_OFFSET.x,
        KART_CENTER_OF_MASS_OFFSET.y,
        KART_CENTER_OF_MASS_OFFSET.z,
      ),
    ),
  );
}

const ENABLE_SCENE_TEST_HOOKS = process.env.NODE_ENV !== "production";

type SceneInitializationTestControl = {
  contextRestoreTimeoutMs?: number;
  forcePostRuntimeFailure?: boolean;
  forceRaceSessionFailure?: boolean;
  runtimeDestroyCount?: number;
};

function getSceneInitializationTestControl() {
  if (!ENABLE_SCENE_TEST_HOOKS) {
    return undefined;
  }

  return (
    globalThis as typeof globalThis & {
      __TITAN_RACERS_SCENE_TEST__?: SceneInitializationTestControl;
    }
  ).__TITAN_RACERS_SCENE_TEST__;
}

type SoloTimeTrialCanvasProps = {
  courseDocument?: CourseDocument;
  onExit: () => void;
};
type SoloSceneControls = {
  clearInput: () => void;
  pressTouchPedal: (pointerId: number, action: TouchPedalAction) => void;
  releaseTouch: (pointerId: number) => void;
  requestKartTapRighting: (clientX: number, clientY: number) => boolean;
  requestTouchReset: () => void;
  restartRace: () => boolean;
  setKartTuning: (tuning: Partial<KartTuning>) => void;
  setTouchJoystick: (pointerId: number, x: number, y: number) => void;
  setPaused: (paused: boolean) => void;
};
type KartTapCandidate = {
  pointerId: number;
  startedAt: number;
  startX: number;
  startY: number;
};

const TOUCH_KEYBOARD_POINTER_IDS: Record<TouchPedalAction, number> = {
  accelerate: -1,
  brakeReverse: -2,
};
const TOUCH_KEYBOARD_JOYSTICK_POINTER_ID = -3;

function ResetIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M6.3 7.2A7 7 0 1 1 5 14" />
      <path d="M6.3 3.8v3.4H2.9" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M8 6v12M16 6v12" />
    </svg>
  );
}

function AcceleratorIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M9.5 3.5h5l1.7 17h-8.4l1.7-17Z" />
      <path d="M10.2 8h4M9.7 12h4.6M9.3 16h5.4" />
    </svg>
  );
}

function BrakeIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <rect height="12" rx="3" width="18" x="3" y="6" />
      <path d="M7 10h10M7 14h10" />
    </svg>
  );
}

function setTouchPedalPresentation(
  elements: Partial<Record<TouchPedalAction, HTMLButtonElement>>,
  action: TouchPedalAction,
  active: boolean,
) {
  elements[action]?.setAttribute("aria-pressed", String(active));
}

function clearTouchPedalPresentation(
  elements: Partial<Record<TouchPedalAction, HTMLButtonElement>>,
) {
  setTouchPedalPresentation(elements, "accelerate", false);
  setTouchPedalPresentation(elements, "brakeReverse", false);
}

function setTouchJoystickPresentation(
  joystickElement: HTMLDivElement | null,
  knob: HTMLSpanElement | null,
  x: number,
  y: number,
) {
  const rawMagnitude = Math.hypot(x, y);
  const clampedScale = rawMagnitude > 1 ? 1 / rawMagnitude : 1;
  const visualX = Number.isFinite(x) ? x * clampedScale : 0;
  const visualY = Number.isFinite(y) ? y * clampedScale : 0;
  const joystick = normalizeTouchJoystick(x, y);
  if (joystickElement) {
    joystickElement.dataset.active = String(
      joystick.x !== 0 || joystick.y !== 0,
    );
    joystickElement.dataset.steer = String(Number(joystick.x.toFixed(2)));
    joystickElement.dataset.throttle = String(
      Number((-joystick.y).toFixed(2)),
    );
  }
  if (knob) {
    const maximumTravel = joystickElement
      ? Math.max((joystickElement.clientWidth - knob.offsetWidth) / 2, 0)
      : 0;
    knob.style.transform = `translate(-50%, -50%) translate(${visualX * maximumTravel}px, ${visualY * maximumTravel}px)`;
  }
}

export function SoloTimeTrialCanvas({
  courseDocument = ROUGH_COURSE_DOCUMENT,
  onExit,
}: SoloTimeTrialCanvasProps) {
  const COURSE_DOCUMENT = courseDocument;
  const { START_POSITION, START_ROTATION } = useMemo(() => {
    const startTransform = getCourseStartTransform(COURSE_DOCUMENT);
    return {
      START_POSITION: new pc.Vec3(
        startTransform.position.x,
        startTransform.position.y,
        startTransform.position.z,
      ),
      START_ROTATION: new pc.Vec3(
        startTransform.rotation.x,
        startTransform.rotation.y,
        startTransform.rotation.z,
      ),
    };
  }, [COURSE_DOCUMENT]);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const finishMenuRef = useRef<HTMLDivElement | null>(null);
  const restartButtonRef = useRef<HTMLButtonElement | null>(null);
  const pauseMenuRef = useRef<HTMLDivElement | null>(null);
  const resumeButtonRef = useRef<HTMLButtonElement | null>(null);
  const sceneApiRef = useRef<SoloSceneControls | null>(null);
  const statusMenuRef = useRef<HTMLDivElement | null>(null);
  const touchPedalElementsRef = useRef<
    Partial<Record<TouchPedalAction, HTMLButtonElement>>
  >({});
  const touchJoystickElementRef = useRef<HTMLDivElement | null>(null);
  const touchJoystickKnobRef = useRef<HTMLSpanElement | null>(null);
  const touchJoystickPointerRef = useRef<number | null>(null);
  const kartTapCandidateRef = useRef<KartTapCandidate | null>(null);
  const gameplayTelemetryStartedRef = useRef(false);
  const [gameplayTelemetry] = useState(
    () => new GameplayRunTelemetry(httpGameplayTelemetrySink),
  );
  const [driveCursorHidden, setDriveCursorHidden] = useState(false);
  const [gamePaused, setGamePaused] = useState(false);
  const [kartTuningOpen, setKartTuningOpen] = useState(false);
  const [kartTuning, setKartTuning] = useState<KartTuning>(() => ({
    ...DEFAULT_KART_TUNING,
  }));
  const kartTuningRef = useRef(kartTuning);
  const [racePresentation, setRacePresentation] =
    useState<RacePresentationSnapshot>(createLoadingRacePresentationSnapshot);
  const [sceneStatus, setSceneStatus] = useState<
    "initializing" | "ready" | "context_lost" | "failed"
  >("initializing");
  const [sceneFailureCode, setSceneFailureCode] =
    useState<GameplayRunFailureCode | null>(null);

  useControllerMenuNavigation({
    containerRef: pauseMenuRef,
    enabled: gamePaused && sceneStatus === "ready",
    onBack: resumeRace,
    onMenu: resumeRace,
  });
  useControllerMenuNavigation({
    containerRef: finishMenuRef,
    enabled: racePresentation.state === "finished",
    onBack: exitRace,
  });
  useControllerMenuNavigation({
    containerRef: statusMenuRef,
    enabled: sceneStatus !== "ready",
    onBack: exitRace,
  });

  useEffect(() => {
    if (!gameplayTelemetryStartedRef.current) {
      gameplayTelemetryStartedRef.current = true;
      gameplayTelemetry.start(COURSE_DOCUMENT.courseId);
    }
  }, [COURSE_DOCUMENT.courseId, gameplayTelemetry]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.code !== "Escape" ||
        event.repeat ||
        sceneStatus !== "ready" ||
        !gamePaused
      ) {
        return;
      }

      event.preventDefault();
      sceneApiRef.current?.setPaused(false);
      setGamePaused(false);
      setDriveCursorHidden(true);
      requestAnimationFrame(() => canvasRef.current?.focus());
    };

    window.addEventListener("keydown", onKeyDown);

    return () => window.removeEventListener("keydown", onKeyDown);
  }, [gamePaused, sceneStatus]);

  useEffect(() => {
    if (gamePaused && sceneStatus === "ready") {
      requestAnimationFrame(() => resumeButtonRef.current?.focus());
    }
  }, [gamePaused, sceneStatus]);

  useEffect(() => {
    if (racePresentation.state !== "finished") {
      return;
    }

    requestAnimationFrame(() => restartButtonRef.current?.focus());
  }, [racePresentation.state]);

  useEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas) {
      return;
    }

    const activeCanvas = canvas;
    const sceneTestControl = getSceneInitializationTestControl();
    let cancelled = false;
    let activeRuntime: ReturnType<typeof createPlayCanvasRuntime> | null = null;
    let contextRestoreTimeoutId: number | null = null;

    const initializeScene = async () => {
      await loadAmmoPhysics();

      if (cancelled) {
        return;
      }

    const runtime = createPlayCanvasRuntime(activeCanvas);
    activeRuntime = runtime;
    runtime.initialize();

    if (sceneTestControl?.forcePostRuntimeFailure) {
      throw new Error("Forced post-runtime scene initialization failure");
    }

    const { app } = runtime;
    const rigidBodySystem = app.systems.rigidbody;

    if (!rigidBodySystem) {
      throw new Error("PlayCanvas rigid-body system is unavailable");
    }
    const activeRigidBodySystem = rigidBodySystem;
    let activeKartTuning = normalizeKartTuning(kartTuningRef.current);

    rigidBodySystem.gravity.set(0, -activeKartTuning.gravity, 0);
    activeCanvas.focus();

    if (sceneTestControl?.forceRaceSessionFailure) {
      throw new Error("Forced race-session initialization failure");
    }

    const raceSession = new RaceSession(
      createRaceSessionConfig(COURSE_DOCUMENT),
    );
    let raceStartReported = false;
    let lastRaceProgressionResult: RaceProgressionResult = { kind: "none" };
    let lastRaceAnnouncementResult: RaceProgressionResult = { kind: "none" };
    let lastRacePresentation = createRacePresentationSnapshot(
      raceSession.snapshot,
      lastRaceAnnouncementResult,
    );

    function publishRacePresentation() {
      const nextPresentation = createRacePresentationSnapshot(
        raceSession.snapshot,
        lastRaceAnnouncementResult,
      );

      if (
        racePresentationSnapshotsEqual(lastRacePresentation, nextPresentation)
      ) {
        return;
      }

      lastRacePresentation = nextPresentation;
      setRacePresentation(nextPresentation);
    }

    const kartMaterial = createMaterial(new pc.Color(0.95, 0.18, 0.08));
    const cockpitMaterial = createMaterial(new pc.Color(0.05, 0.08, 0.11));
    const wheelMaterial = createMaterial(new pc.Color(0.02, 0.025, 0.03));
    const wheelHubMaterial = createMaterial(new pc.Color(0.8, 0.82, 0.78));
    const suspensionArmMaterial = createMaterial(
      new pc.Color(0.48, 0.54, 0.57),
    );
    const suspensionShockMaterial = createMaterial(
      new pc.Color(1, 0.67, 0.12),
    );
    const asphaltMaterial = createMaterial(new pc.Color(0.08, 0.08, 0.09));
    const lineMaterial = createMaterial(new pc.Color(0.95, 0.92, 0.86));
    const markerMaterial = createMaterial(new pc.Color(1, 0.85, 0.15));
    const groundMaterial = createMaterial(new pc.Color(0.08, 0.36, 0.26));
    const obstacleBlockMaterial = createMaterial(
      new pc.Color(0.82, 0.78, 0.68),
    );
    const obstacleBarrelMaterial = createMaterial(
      new pc.Color(0.96, 0.45, 0.12),
    );
    const rampMaterial = createMaterial(new pc.Color(0.35, 0.39, 0.42));

    function createBox(
      name: string,
      position: pc.Vec3,
      scale: pc.Vec3,
      material: pc.StandardMaterial,
      rotationY = 0,
    ) {
      const entity = new pc.Entity(name);
      entity.addComponent("model", {
        type: "box",
      });
      entity.setPosition(position);
      entity.setEulerAngles(0, rotationY, 0);
      entity.setLocalScale(scale);
      const meshInstances = entity.model?.meshInstances;
      meshInstances?.forEach((meshInstance) => {
        meshInstance.material = material;
      });
      app.root.addChild(entity);

      return entity;
    }

    function createChildBox(
      parent: pc.Entity,
      name: string,
      position: pc.Vec3,
      scale: pc.Vec3,
      material: pc.StandardMaterial,
    ) {
      const entity = new pc.Entity(name);
      entity.addComponent("model", {
        type: "box",
      });
      entity.setLocalPosition(position);
      entity.setLocalScale(scale);
      const meshInstances = entity.model?.meshInstances;
      meshInstances?.forEach((meshInstance) => {
        meshInstance.material = material;
      });
      parent.addChild(entity);

      return entity;
    }

    function createChildCollisionBox(
      parent: pc.Entity,
      name: string,
      position: pc.Vec3,
      halfExtents: pc.Vec3,
    ) {
      const entity = new pc.Entity(name);

      entity.setLocalPosition(position);
      entity.addComponent("collision", {
        halfExtents,
        type: "box",
      });
      parent.addChild(entity);

      return entity;
    }

    function createChildCollisionCapsule(
      parent: pc.Entity,
      name: string,
      position: pc.Vec3,
      axis: number,
      height: number,
      radius: number,
    ) {
      const entity = new pc.Entity(name);

      entity.setLocalPosition(position);
      entity.addComponent("collision", {
        axis,
        height,
        radius,
        type: "capsule",
      });
      parent.addChild(entity);

      return entity;
    }

    function createChildCylinder(
      parent: pc.Entity,
      name: string,
      position: pc.Vec3,
      scale: pc.Vec3,
      material: pc.StandardMaterial,
      eulerAngles = new pc.Vec3(0, 0, 0),
    ) {
      const entity = new pc.Entity(name);
      entity.addComponent("model", {
        type: "cylinder",
      });
      entity.setLocalPosition(position);
      entity.setLocalEulerAngles(eulerAngles);
      entity.setLocalScale(scale);
      const meshInstances = entity.model?.meshInstances;
      meshInstances?.forEach((meshInstance) => {
        meshInstance.material = material;
      });
      parent.addChild(entity);

      return entity;
    }

    function createSuspensionBar(
      parent: pc.Entity,
      name: string,
      material: pc.StandardMaterial,
      radius: number,
    ) {
      const entity = new pc.Entity(name);

      entity.addComponent("model", { type: "cylinder" });
      entity.model?.meshInstances?.forEach((meshInstance) => {
        meshInstance.material = material;
      });
      entity.setLocalScale(radius * 2, 0.5, radius * 2);
      parent.addChild(entity);

      return entity;
    }

    function placeSuspensionBar(
      bar: pc.Entity,
      start: pc.Vec3,
      end: pc.Vec3,
      radius: number,
    ) {
      const direction = end.clone().sub(start);
      const length = direction.length();

      if (length <= 0.0001) {
        bar.enabled = false;
        return;
      }

      bar.enabled = true;
      bar.setLocalPosition(start.clone().add(end).mulScalar(0.5));
      bar.setLocalRotation(
        new pc.Quat().setFromDirections(pc.Vec3.UP, direction.normalize()),
      );
      bar.setLocalScale(radius * 2, length, radius * 2);
    }

    const {
      cameraFixtureEntities,
      collisionFixtureEntities,
      collisionObstacles,
      courseEntities,
      obstacleEntities,
      rampEntities,
    } = buildRoughCourse(app, {
      materials: {
        asphalt: asphaltMaterial,
        ground: groundMaterial,
        line: lineMaterial,
        obstacleBarrel: obstacleBarrelMaterial,
        obstacleBlock: obstacleBlockMaterial,
        ramp: rampMaterial,
      },
      document: COURSE_DOCUMENT,
      includeCollisionFixtures:
        ENABLE_SCENE_TEST_HOOKS &&
        new URLSearchParams(window.location.search).has("collision-fixtures"),
    });

    function syncObstacleCollision(
      id: CourseTestObstacleId,
      position: pc.Vec3,
    ) {
      const collisionObstacle = collisionObstacles.find(
        (obstacle) => obstacle.id === id,
      );

      if (!collisionObstacle) {
        return;
      }

      collisionObstacle.x = position.x;
      collisionObstacle.z = position.z;
    }

    const startMarker = createBox(
      "start-position",
      new pc.Vec3(
        START_POSITION.x,
        START_POSITION.y + 0.14,
        START_POSITION.z,
      ),
      new pc.Vec3(2.2, 0.04, 1.6),
      markerMaterial,
      START_ROTATION.y,
    );
    startMarker.setEulerAngles(START_ROTATION);

    const kart = new pc.Entity("box-kart");
    const initialKartRotation = new pc.Quat().setFromEulerAngles(
      START_ROTATION.x,
      START_ROTATION.y,
      START_ROTATION.z,
    );
    kart.setPosition(
      getKartRootPosition(
        new pc.Vec3(
          START_POSITION.x,
          START_POSITION.y + KART_ROOT_HEIGHT,
          START_POSITION.z,
        ),
        initialKartRotation,
      ),
    );
    kart.setRotation(initialKartRotation);
    kart.addComponent("collision", { type: "compound" });
    app.root.addChild(kart);
    const kartVisual = new pc.Entity("kart-visual");

    kart.addChild(kartVisual);
    const currentStartPosition = START_POSITION.clone();
    const currentStartRotation = START_ROTATION.clone();

    createChildBox(
      kartVisual,
      "kart-body",
      new pc.Vec3(0, -0.03, 0),
      new pc.Vec3(1.22, 0.28, 1.72),
      kartMaterial,
    );
    createChildBox(
      kartVisual,
      "kart-cockpit",
      new pc.Vec3(
        KART_COCKPIT_POSITION.x,
        KART_COCKPIT_POSITION.y,
        KART_COCKPIT_POSITION.z,
      ),
      new pc.Vec3(0.72, 0.42, 0.78),
      cockpitMaterial,
    );
    createChildCollisionBox(
      kart,
      "kart-body-collision",
      offsetKartGeometry(new pc.Vec3(0, -0.08, 0)),
      new pc.Vec3(0.58, 0.14, 0.55),
    );
    createChildCollisionCapsule(
      kart,
      "kart-front-bumper-collision",
      offsetKartGeometry(new pc.Vec3(0, -0.08, -0.68)),
      0,
      1.52,
      0.18,
    );
    createChildCollisionCapsule(
      kart,
      "kart-rear-bumper-collision",
      offsetKartGeometry(new pc.Vec3(0, -0.08, 0.68)),
      0,
      1.52,
      0.18,
    );
    createChildCollisionCapsule(
      kart,
      "kart-left-wheel-guard-collision",
      offsetKartGeometry(new pc.Vec3(-0.75, -0.07, 0)),
      2,
      1.55,
      0.16,
    );
    createChildCollisionCapsule(
      kart,
      "kart-right-wheel-guard-collision",
      offsetKartGeometry(new pc.Vec3(0.75, -0.07, 0)),
      2,
      1.55,
      0.16,
    );
    createChildCollisionBox(
      kart,
      "kart-cockpit-collision",
      offsetKartGeometry(
        new pc.Vec3(
          KART_COCKPIT_POSITION.x,
          KART_COCKPIT_POSITION.y,
          KART_COCKPIT_POSITION.z,
        ),
      ),
      new pc.Vec3(0.36, 0.21, 0.39),
    );

    const dynamicWheels: DynamicWheel[] = [];
    const wheelPresentations: Array<{
      armForward: pc.Entity;
      armRear: pc.Entity;
      chassisForwardAnchor: pc.Vec3;
      chassisRearAnchor: pc.Vec3;
      chassisShockAnchor: pc.Vec3;
      currentHubY: number;
      hubX: number;
      hubZ: number;
      pivot: pc.Entity;
      previousHubY: number;
      shock: pc.Entity;
      side: number;
      wheelName: string;
    }> = [];
    const initialHubY =
      KART_SUSPENSION_MAX_COMPRESSION_Y - KART_SUSPENSION_REST_TRAVEL;

    (
      [
        ["front-left", -0.78, -0.58],
        ["front-right", 0.78, -0.58],
        ["rear-left", -0.78, 0.62],
        ["rear-right", 0.78, 0.62],
      ] satisfies [string, number, number][]
    ).forEach(([name, x, z]) => {
      const wheelPivot = new pc.Entity(`kart-wheel-pivot-${name}`);
      const visualLocalPosition = new pc.Vec3(x, initialHubY, z);
      const localPosition = offsetKartGeometry(visualLocalPosition.clone());

      wheelPivot.setLocalPosition(visualLocalPosition);
      kartVisual.addChild(wheelPivot);

      createChildCylinder(
        wheelPivot,
        `kart-wheel-${name}`,
        new pc.Vec3(0, 0, 0),
        new pc.Vec3(
          KART_WHEEL_RADIUS * 2,
          KART_WHEEL_WIDTH,
          KART_WHEEL_RADIUS * 2,
        ),
        wheelMaterial,
        new pc.Vec3(0, 0, 90),
      );
      createChildCylinder(
        wheelPivot,
        `kart-wheel-hub-${name}`,
        new pc.Vec3(0, 0, 0),
        new pc.Vec3(0.24, KART_WHEEL_WIDTH + 0.025, 0.24),
        wheelHubMaterial,
        new pc.Vec3(0, 0, 90),
      );

      dynamicWheels.push({
        driven: name.startsWith("rear"),
        localPosition,
        name,
        pivot: wheelPivot,
        steered: name.startsWith("front"),
      });

      const side = Math.sign(x);
      const armForward = createSuspensionBar(
        kartVisual,
        `${name}-lower-arm-forward`,
        suspensionArmMaterial,
        0.035,
      );
      const armRear = createSuspensionBar(
        kartVisual,
        `${name}-lower-arm-rear`,
        suspensionArmMaterial,
        0.035,
      );
      const shock = createSuspensionBar(
        kartVisual,
        `${name}-shock`,
        suspensionShockMaterial,
        0.045,
      );

      wheelPresentations.push({
        armForward,
        armRear,
        chassisForwardAnchor: new pc.Vec3(side * 0.61, -0.07, z - 0.2),
        chassisRearAnchor: new pc.Vec3(side * 0.61, -0.07, z + 0.2),
        chassisShockAnchor: new pc.Vec3(side * 0.61, 0.02, z),
        currentHubY: initialHubY,
        hubX: x,
        hubZ: z,
        pivot: wheelPivot,
        previousHubY: initialHubY,
        shock,
        side,
        wheelName: name,
      });
    });

    kart.addComponent("rigidbody", {
      angularDamping: activeKartTuning.angularDamping,
      friction: activeKartTuning.chassisFriction,
      group: PHYSICS_GROUP.kart,
      linearDamping: activeKartTuning.linearDamping,
      mask: PHYSICS_MASK.kart,
      mass: KART_MASS,
      restitution: activeKartTuning.chassisRestitution,
      type: pc.BODYTYPE_DYNAMIC,
    });
    setExplicitRigidBodyInertia(kart, KART_MASS, KART_INERTIA);
    configureRigidBodyCcd(kart, KART_CCD_CONFIGURATION);

    const kartPresentation = {
      currentPosition: kart.getPosition().clone(),
      currentRotation: kart.getRotation().clone(),
      previousPosition: kart.getPosition().clone(),
      previousRotation: kart.getRotation().clone(),
    };
    const previousRacePosition = kart.getPosition().clone();
    const interpolatedKartPosition = new pc.Vec3();
    const interpolatedKartVisualPosition = new pc.Vec3();
    const interpolatedKartRotation = new pc.Quat();
    const kartGeometryOffset = new pc.Vec3(
      KART_GEOMETRY_OFFSET.x,
      KART_GEOMETRY_OFFSET.y,
      KART_GEOMETRY_OFFSET.z,
    );

    function captureKartPresentationState() {
      kartPresentation.previousPosition.copy(
        kartPresentation.currentPosition,
      );
      kartPresentation.previousRotation.copy(
        kartPresentation.currentRotation,
      );
      kartPresentation.currentPosition.copy(kart.getPosition());
      kartPresentation.currentRotation.copy(kart.getRotation());
    }

    function snapKartPresentationState() {
      kartPresentation.currentPosition.copy(kart.getPosition());
      kartPresentation.currentRotation.copy(kart.getRotation());
      kartPresentation.previousPosition.copy(
        kartPresentation.currentPosition,
      );
      kartPresentation.previousRotation.copy(
        kartPresentation.currentRotation,
      );
      kartVisual.setLocalPosition(kartGeometryOffset);
      kartVisual.setLocalRotation(pc.Quat.IDENTITY);
      wheelPresentations.forEach((wheel) => {
        wheel.currentHubY = initialHubY;
        wheel.previousHubY = initialHubY;
      });
    }

    const camera = new pc.Entity();
    camera.addComponent("camera", {
      clearColor: new pc.Color(0.52, 0.7, 0.86),
    });
    app.root.addChild(camera);
    const chaseCamera = new ChaseCamera(
      camera,
      activeCanvas,
      (pivot, desiredPosition) => {
        const hit = rigidBodySystem.raycastFirst(pivot, desiredPosition, {
          filterCollisionGroup: PHYSICS_GROUP.kart,
          filterCollisionMask: PHYSICS_MASK.kart,
          filterCallback: (entity: pc.Entity) =>
            entity !== kart &&
            (entity.tags.has("obstacle") ||
              entity.tags.has("drivable-surface")),
        });

        return hit
          ? {
              normal: hit.normal.clone(),
              point: hit.point.clone(),
            }
          : null;
      },
      Math.max(
        activeKartTuning.maxForwardSpeed,
        activeKartTuning.maxReverseSpeed,
      ),
    );
    let kartTapRightingRequested = false;
    let manualRightingCooldownSeconds = 0;
    let manualRightingCount = 0;

    const lightingEntities = buildCourseLighting(app, {
      document: COURSE_DOCUMENT,
    });

    let driftSmoke: KartDriftSmoke | null = null;
    let inputManager: PlayerInputManager | null = null;

    function editStaticRigidBody(
      entity: pc.Entity,
      editTransform: () => void,
    ) {
      if (entity.rigidbody) {
        entity.rigidbody.enabled = false;
      }

      editTransform();

      if (entity.rigidbody) {
        entity.rigidbody.enabled = true;
      }
    }

    function setCourseObjectDebugTransform(
      objectId: CourseTestObstacleId,
      transform: { position?: Position3; rotation?: Position3 },
    ) {
      const entity = obstacleEntities.get(objectId);
      if (!entity) {
        return;
      }

      editStaticRigidBody(entity, () => {
        if (transform.position) {
          entity.setPosition(
            transform.position.x,
            transform.position.y,
            transform.position.z,
          );
        }
        if (transform.rotation) {
          entity.setEulerAngles(
            transform.rotation.x,
            transform.rotation.y,
            transform.rotation.z,
          );
        }
      });

      if (transform.position) {
        syncObstacleCollision(
          objectId,
          new pc.Vec3(
            transform.position.x,
            transform.position.y,
            transform.position.z,
          ),
        );
      }
    }

    function resetKart() {
      const resetRotation = new pc.Quat().setFromEulerAngles(
        currentStartRotation.x,
        currentStartRotation.y,
        currentStartRotation.z,
      );
      const resetPosition = getKartRootPosition(
        new pc.Vec3(
          currentStartPosition.x,
          currentStartPosition.y + KART_ROOT_HEIGHT,
          currentStartPosition.z,
        ),
        resetRotation,
      );

      kart.rigidbody?.teleport(resetPosition, resetRotation);
      if (kart.rigidbody) {
        kart.rigidbody.linearVelocity = new pc.Vec3();
        kart.rigidbody.angularVelocity = new pc.Vec3();
        kart.rigidbody.activate();
      }
      kartController.reset();
      driftSmoke?.stop();
      snapKartPresentationState();
      previousRacePosition.copy(kart.getPosition());
      latestCameraImpact = null;
      inputManager?.clear();
      chaseCamera.snap(getChaseCameraSnapshot(dynamicWheels.length));
      activeCanvas.focus();
    }

    function findSupportedRecoveryTransform(transform: RaceTransform) {
      const rayStart = new pc.Vec3(
        transform.position.x,
        transform.position.y + 2,
        transform.position.z,
      );
      const rayEnd = new pc.Vec3(
        transform.position.x,
        transform.position.y - 2,
        transform.position.z,
      );
      const hit = activeRigidBodySystem.raycastFirst(rayStart, rayEnd, {
        filterCollisionGroup: PHYSICS_GROUP.kart,
        filterCollisionMask: PHYSICS_MASK.kart,
        filterCallback: (entity: pc.Entity) =>
          entity !== kart && entity.tags.has("drivable-surface"),
      });

      if (!hit) {
        return null;
      }

      return {
        position: {
          x: transform.position.x,
          y: hit.point.y,
          z: transform.position.z,
        },
        rotation: { ...transform.rotation },
      } satisfies RaceTransform;
    }

    function hasManualRightingSupport() {
      const position = kart.getPosition();
      const rayStart = position.clone().add(new pc.Vec3(0, 0.2, 0));
      const rayEnd = position
        .clone()
        .add(new pc.Vec3(0, -MANUAL_RIGHTING_SUPPORT_PROBE_DISTANCE, 0));
      const hit = activeRigidBodySystem.raycastFirst(rayStart, rayEnd, {
        filterCollisionGroup: PHYSICS_GROUP.kart,
        filterCollisionMask: PHYSICS_MASK.kart,
        filterCallback: (entity: pc.Entity) =>
          entity !== kart && entity.tags.has("drivable-surface"),
      });

      return hit !== null;
    }

    function requestManualKartRighting() {
      const rigidBody = kart.rigidbody;
      if (!rigidBody) {
        return false;
      }
      const axis = getManualRightingAxis(
        kart.up,
        kart.forward,
        activeKartTuning.manualRightingMinimumInversionDegrees,
      );
      if (!axis || !hasManualRightingSupport()) {
        return false;
      }
      if (manualRightingCooldownSeconds > 0) {
        return true;
      }

      const torqueScale =
        getManualRightingTorqueScale(
          kart.up,
          activeKartTuning.manualRightingMinimumInversionDegrees,
          activeKartTuning.manualRightingAngledTorqueBoost,
        ) ?? 1;
      const torqueImpulse =
        activeKartTuning.manualRightingTorqueImpulse * torqueScale;

      rigidBody.applyTorqueImpulse(
        axis.x * torqueImpulse,
        axis.y * torqueImpulse,
        axis.z * torqueImpulse,
      );
      rigidBody.applyImpulse(0, activeKartTuning.manualRightingLiftImpulse, 0);
      rigidBody.activate();
      manualRightingCooldownSeconds = MANUAL_RIGHTING_COOLDOWN_SECONDS;
      manualRightingCount += 1;
      gameplayTelemetry.recordRecovery();
      return true;
    }

    function requestRaceRecovery() {
      const sessionSnapshot = raceSession.snapshot;
      const requestedTransform = raceSession.requestRecovery();

      if (!requestedTransform) {
        if (
          sessionSnapshot.state === "loading" ||
          sessionSnapshot.state === "ready" ||
          sessionSnapshot.state === "countdown"
        ) {
          resetKart();
          clearTouchPresentation();
          return true;
        }

        return false;
      }

      gameplayTelemetry.recordRecovery();

      lastRaceAnnouncementResult = { kind: "none" };

      const candidates = sessionSnapshot.recoveryCandidates;
      const recoveryTransform =
        candidates
          .map(({ transform }) => findSupportedRecoveryTransform(transform))
          .find((transform) => transform !== null) ??
        candidates.at(-1)?.transform ??
        requestedTransform;
      const resetRotation = new pc.Quat().setFromEulerAngles(
        recoveryTransform.rotation.x,
        recoveryTransform.rotation.y,
        recoveryTransform.rotation.z,
      );
      const resetPosition = getKartRootPosition(
        new pc.Vec3(
          recoveryTransform.position.x,
          recoveryTransform.position.y + KART_ROOT_HEIGHT,
          recoveryTransform.position.z,
        ),
        resetRotation,
      );

      kart.rigidbody?.teleport(resetPosition, resetRotation);
      if (kart.rigidbody) {
        kart.rigidbody.linearVelocity = new pc.Vec3();
        kart.rigidbody.angularVelocity = new pc.Vec3();
        kart.rigidbody.activate();
      }
      kartController.reset();
      driftSmoke?.stop();
      resetSuspensionMetrics();
      resetCollisionMetrics();
      snapKartPresentationState();
      previousRacePosition.copy(kart.getPosition());
      latestCameraImpact = null;
      inputManager?.clear();
      clearTouchPresentation();
      chaseCamera.snap(getChaseCameraSnapshot(dynamicWheels.length));
      activeCanvas.focus();
      return true;
    }

    function requestPlayerRecovery() {
      if (raceSession.acceptsDriving && requestManualKartRighting()) {
        return true;
      }

      return requestRaceRecovery();
    }

    function requestKartTapRighting(clientX: number, clientY: number) {
      if (!camera.camera || !raceSession.acceptsDriving) {
        return false;
      }
      const rect = activeCanvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        return false;
      }
      const screenX =
        (clientX - rect.left) * (activeCanvas.width / rect.width);
      const screenY =
        (clientY - rect.top) * (activeCanvas.height / rect.height);
      const rayStart = camera.camera.screenToWorld(
        screenX,
        screenY,
        camera.camera.nearClip,
      );
      const rayEnd = camera.camera.screenToWorld(
        screenX,
        screenY,
        camera.camera.farClip,
      );
      const hit = activeRigidBodySystem.raycastFirst(rayStart, rayEnd, {
        filterCollisionGroup: PHYSICS_GROUP.drivableSurface,
        filterCollisionMask: PHYSICS_GROUP.kart,
        filterCallback: (entity: pc.Entity) =>
          entity === kart || entity.isDescendantOf(kart),
      });

      if (!hit) {
        return false;
      }
      kartTapRightingRequested = true;
      return true;
    }

    function setSceneStartPosition(
      nextStartPosition: Pick<Position3, "x" | "z">,
    ) {
      currentStartPosition.set(
        nextStartPosition.x,
        currentStartPosition.y,
        nextStartPosition.z,
      );
      startMarker.setPosition(
        currentStartPosition.x,
        currentStartPosition.y + 0.14,
        currentStartPosition.z,
      );
    }

    function collidesWithObstacle(position: pc.Vec3) {
      return collisionObstacles.some((obstacle) => {
        const distance = Math.hypot(
          position.x - obstacle.x,
          position.z - obstacle.z,
        );

        return distance < KART_COLLISION_RADIUS + obstacle.radius;
      });
    }

    const kartController = new DynamicKartController({
      app,
      fallResetY: KART_RESET_FALL_Y,
      kart,
      mass: KART_MASS,
      onFallReset: requestRaceRecovery,
      pitchInertia: KART_INERTIA.x,
      tuning: activeKartTuning,
      wheels: dynamicWheels,
    });
    runtime.addCleanup(() => kartController.destroy());
    driftSmoke = new KartDriftSmoke(dynamicWheels, activeKartTuning);
    const activeDriftSmoke = driftSmoke;
    runtime.addCleanup(() => activeDriftSmoke.destroy());
    const collisionObserver = new KartCollisionObserver(
      rigidBodySystem,
      kart,
    );
    runtime.addCleanup(() => collisionObserver.destroy());
    let cameraImpactId = 0;
    let latestCameraImpact: ChaseCameraImpact | null = null;
    const chaseCameraSnapshot: ChaseCameraSnapshot = {
      impact: null,
      linearVelocity: new pc.Vec3(),
      position: new pc.Vec3(),
      rotation: new pc.Quat(),
      supportCount: 0,
    };
    const suspensionMetrics = {
      maximumCompression: 0,
      maximumSupportedWheels: 0,
      minimumChassisClearance: Number.POSITIVE_INFINITY,
      minimumSupportedWheels: dynamicWheels.length,
    };
    const collisionEntityNames = new Set([
      ...cameraFixtureEntities.map((entity) => entity.name),
      ...collisionFixtureEntities.map((entity) => entity.name),
      ...obstacleEntities.keys(),
    ]);
    const collisionMetrics = {
      contactedEntityNames: new Set<string>(),
      impactFrameCount: 0,
      maximumAngularSpeedAfterImpact: 0,
      maximumApproachSpeed: 0,
      maximumImpulse: 0,
      postLinearVelocity: { x: 0, y: 0, z: 0 },
      preLinearVelocity: { x: 0, y: 0, z: 0 },
    };

    function resetSuspensionMetrics() {
      suspensionMetrics.maximumCompression = 0;
      suspensionMetrics.maximumSupportedWheels = 0;
      suspensionMetrics.minimumChassisClearance = Number.POSITIVE_INFINITY;
      suspensionMetrics.minimumSupportedWheels = dynamicWheels.length;
    }

    function resetCollisionMetrics() {
      collisionMetrics.contactedEntityNames.clear();
      collisionMetrics.impactFrameCount = 0;
      collisionMetrics.maximumAngularSpeedAfterImpact = 0;
      collisionMetrics.maximumApproachSpeed = 0;
      collisionMetrics.maximumImpulse = 0;
      collisionMetrics.postLinearVelocity = { x: 0, y: 0, z: 0 };
      collisionMetrics.preLinearVelocity = { x: 0, y: 0, z: 0 };
    }

    function captureCameraImpact() {
      const solidContacts = collisionObserver.lastFrame?.contacts.filter(
        (contact) => collisionEntityNames.has(contact.otherEntityName),
      );

      if (!solidContacts || solidContacts.length === 0) {
        return;
      }

      const strongestContact = solidContacts.reduce((strongest, contact) =>
        contact.approachSpeed > strongest.approachSpeed ? contact : strongest,
      );

      if (calculateImpactStrength(strongestContact.approachSpeed) <= 0) {
        return;
      }

      cameraImpactId += 1;
      latestCameraImpact = selectStrongerImpact(latestCameraImpact, {
        approachSpeed: strongestContact.approachSpeed,
        id: cameraImpactId,
        normal: strongestContact.normal,
      });
    }

    function getChaseCameraSnapshot(
      supportCount = kartController.state.supportCount,
    ): ChaseCameraSnapshot {
      chaseCameraSnapshot.impact = latestCameraImpact;
      chaseCameraSnapshot.linearVelocity.copy(
        kart.rigidbody?.linearVelocity ?? pc.Vec3.ZERO,
      );
      chaseCameraSnapshot.position.copy(kartVisual.getPosition());
      chaseCameraSnapshot.rotation.copy(kartVisual.getRotation());
      chaseCameraSnapshot.supportCount = supportCount;

      return chaseCameraSnapshot;
    }

    function captureCollisionMetrics() {
      const frame = collisionObserver.lastFrame;
      const solidContacts = frame?.contacts.filter((contact) =>
        collisionEntityNames.has(contact.otherEntityName),
      );

      if (!frame || !solidContacts || solidContacts.length === 0) {
        return;
      }

      collisionMetrics.impactFrameCount += 1;
      solidContacts.forEach((contact) => {
        collisionMetrics.contactedEntityNames.add(contact.otherEntityName);
        collisionMetrics.maximumApproachSpeed = Math.max(
          collisionMetrics.maximumApproachSpeed,
          contact.approachSpeed,
        );
        collisionMetrics.maximumImpulse = Math.max(
          collisionMetrics.maximumImpulse,
          contact.impulse,
        );
      });
      collisionMetrics.maximumAngularSpeedAfterImpact = Math.max(
        collisionMetrics.maximumAngularSpeedAfterImpact,
        Math.hypot(
          frame.postAngularVelocity.x,
          frame.postAngularVelocity.y,
          frame.postAngularVelocity.z,
        ),
      );
      collisionMetrics.preLinearVelocity = { ...frame.preLinearVelocity };
      collisionMetrics.postLinearVelocity = { ...frame.postLinearVelocity };
    }

    function captureWheelPresentationState() {
      const telemetryByName = new Map(
        kartController.state.wheelTelemetry.map((wheel) => [
          wheel.name,
          wheel,
        ]),
      );

      wheelPresentations.forEach((wheel) => {
        wheel.previousHubY = wheel.currentHubY;
        wheel.currentHubY =
          telemetryByName.get(wheel.wheelName)?.hubLocalY ?? initialHubY;
      });
    }

    function renderWheelPresentation(accumulatorFraction: number) {
      wheelPresentations.forEach((wheel) => {
        const hubY = pc.math.lerp(
          wheel.previousHubY,
          wheel.currentHubY,
          accumulatorFraction,
        );
        const hub = new pc.Vec3(wheel.hubX, hubY, wheel.hubZ);
        const armHub = new pc.Vec3(
          wheel.hubX - wheel.side * 0.08,
          hubY,
          wheel.hubZ,
        );

        wheel.pivot.setLocalPosition(hub);
        placeSuspensionBar(
          wheel.armForward,
          wheel.chassisForwardAnchor,
          armHub,
          0.035,
        );
        placeSuspensionBar(
          wheel.armRear,
          wheel.chassisRearAnchor,
          armHub,
          0.035,
        );
        placeSuspensionBar(
          wheel.shock,
          wheel.chassisShockAnchor,
          armHub,
          0.045,
        );
      });
    }

    function setSceneKartTuning(nextTuning: Partial<KartTuning>) {
      activeKartTuning = normalizeKartTuning({
        ...activeKartTuning,
        ...nextTuning,
      });
      kartTuningRef.current = activeKartTuning;
      setKartTuning({ ...activeKartTuning });
      kartController.setTuning(activeKartTuning);
      activeRigidBodySystem.gravity.set(0, -activeKartTuning.gravity, 0);
      chaseCamera.setMaximumSpeed(
        Math.max(
          activeKartTuning.maxForwardSpeed,
          activeKartTuning.maxReverseSpeed,
        ),
      );
      if (kart.rigidbody) {
        kart.rigidbody.angularDamping = activeKartTuning.angularDamping;
        kart.rigidbody.friction = activeKartTuning.chassisFriction;
        kart.rigidbody.linearDamping = activeKartTuning.linearDamping;
        kart.rigidbody.restitution = activeKartTuning.chassisRestitution;
      }
      driftSmoke?.setTuning(activeKartTuning);
    }

    const getGamepads = () => navigator.getGamepads?.() ?? [];
    inputManager = new PlayerInputManager(window, getGamepads, (family) =>
      gameplayTelemetry.recordInputFamily(family),
    );
    inputManager.attach();
    runtime.addCleanup(() => inputManager.detach());
    const clearTouchPresentation = () => {
      touchJoystickPointerRef.current = null;
      clearTouchPedalPresentation(touchPedalElementsRef.current);
      setTouchJoystickPresentation(
        touchJoystickElementRef.current,
        touchJoystickKnobRef.current,
        0,
        0,
      );
    };

    const setScenePaused = (paused: boolean) => {
      const changed = paused ? raceSession.pause() : raceSession.resume();
      if (!changed) {
        return false;
      }
      if (paused) {
        driftSmoke?.stop();
      }
      inputManager.setEnabled(false);
      previousRacePosition.copy(kart.getPosition());
      runtime.setPaused(paused);
      if (!paused) {
        queueMicrotask(() => inputManager.setEnabled(true));
      }
      return changed;
    };

    const pauseForInterruption = () => {
      inputManager.clear();
      clearTouchPresentation();
      if (!setScenePaused(true)) {
        return false;
      }
      gameplayTelemetry.recordAutomaticPause();
      setKartTuningOpen(false);
      setGamePaused(true);
      setDriveCursorHidden(false);
      publishRacePresentation();
      return true;
    };

    runtime.listen(window, "blur", pauseForInterruption);
    runtime.listen(document, "visibilitychange", () => {
      if (!document.hidden) {
        return;
      }
      pauseForInterruption();
      gameplayTelemetry.flushRuntimeHealth();
    });
    runtime.listen(window, "resize", () => runtime.resizeCanvas());
    runtime.listen(window, "orientationchange", () => runtime.resizeCanvas());

    const failGraphicsRuntime = (failureCode: GameplayRunFailureCode) => {
      if (contextRestoreTimeoutId !== null) {
        window.clearTimeout(contextRestoreTimeoutId);
        contextRestoreTimeoutId = null;
      }
      gameplayTelemetry.fail("runtime_failed", failureCode);
      runtime.destroy();
      activeRuntime = null;
      sceneApiRef.current = null;
      setSceneFailureCode(failureCode);
      setSceneStatus("failed");
      setGamePaused(false);
      setDriveCursorHidden(false);
    };

    runtime.listen<WebGLContextEvent>(
      activeCanvas,
      "webglcontextlost",
      () => {
        pauseForInterruption();
        runtime.setRenderingSuspended(true);
        setSceneStatus("context_lost");
        setDriveCursorHidden(false);
        contextRestoreTimeoutId = window.setTimeout(
          () => failGraphicsRuntime("webgl_context_lost"),
          sceneTestControl?.contextRestoreTimeoutMs ?? 10_000,
        );
      },
    );
    runtime.listen<WebGLContextEvent>(
      activeCanvas,
      "webglcontextrestored",
      () => {
        if (contextRestoreTimeoutId !== null) {
          window.clearTimeout(contextRestoreTimeoutId);
          contextRestoreTimeoutId = null;
        }
        try {
          runtime.restoreRendering();
          setSceneStatus("ready");
        } catch {
          failGraphicsRuntime("webgl_context_restore_failed");
        }
      },
    );
    runtime.addCleanup(() => {
      if (contextRestoreTimeoutId !== null) {
        window.clearTimeout(contextRestoreTimeoutId);
        contextRestoreTimeoutId = null;
      }
    });

    sceneApiRef.current = {
      clearInput: () => inputManager.clear(),
      pressTouchPedal: (pointerId, action) =>
        inputManager.pressTouchPedal(pointerId, action),
      releaseTouch: (pointerId) => inputManager.releaseTouch(pointerId),
      requestKartTapRighting,
      requestTouchReset: () => inputManager.requestTouchReset(),
      restartRace: () => {
        if (!raceSession.restart()) {
          return false;
        }

        gameplayTelemetry.start(COURSE_DOCUMENT.courseId);
        gameplayTelemetry.markRuntimeLoaded();
        raceStartReported = false;
        lastRaceProgressionResult = { kind: "none" };
        lastRaceAnnouncementResult = { kind: "none" };
        resetKart();
        runtime.setPaused(false);
        setGamePaused(false);
        inputManager.setEnabled(true);
        previousRacePosition.copy(kart.getPosition());
        publishRacePresentation();
        return true;
      },
      setKartTuning: (nextTuning) => setSceneKartTuning(nextTuning),
      setTouchJoystick: (pointerId, x, y) =>
        inputManager.setTouchJoystick(pointerId, x, y),
      setPaused: (paused) => {
        setScenePaused(paused);
      },
    };

    const getCollisionDebugState = () => {
      const firstObstacle = collisionObstacles[0];
      const obstacleA = collisionObstacles.find(
        (obstacle) => obstacle.id === "obstacle-barrel-a",
      );
      const obstacleAEntity = obstacleEntities.get("obstacle-barrel-a");
      const ground = courseEntities.get("ground");
      const keyLight = lightingEntities.get("warm-key-light");
      const fillLight = lightingEntities.get("cool-fill-light");
      const startFinishLine = courseEntities.get("start-finish-line");

      return {
        barrelCollisionAxis: obstacleAEntity?.collision?.axis ?? null,
        barrelCollisionHeight: obstacleAEntity?.collision?.height ?? null,
        barrelCollisionRadius: obstacleAEntity?.collision?.radius ?? null,
        barrelMaterialMapped:
          obstacleAEntity?.model?.meshInstances?.[0]?.material ===
          obstacleBarrelMaterial,
        barrelPhysicsFriction: obstacleAEntity?.rigidbody?.friction ?? null,
        barrelPhysicsGroup: obstacleAEntity?.rigidbody?.group ?? null,
        barrelPhysicsMask: obstacleAEntity?.rigidbody?.mask ?? null,
        barrelPhysicsRestitution:
          obstacleAEntity?.rigidbody?.restitution ?? null,
        ambientLightB: app.scene.ambientLight.b,
        ambientLightG: app.scene.ambientLight.g,
        ambientLightR: app.scene.ambientLight.r,
        courseEntityCount: courseEntities.size,
        directionalLightCount: lightingEntities.size,
        fillLightCastsShadows: fillLight?.light?.castShadows ?? null,
        groundCollisionHalfExtentX: ground?.collision?.halfExtents?.x ?? null,
        groundCollisionOffsetY: ground?.collision?.linearOffset?.y ?? null,
        groundCollisionShape: ground?.collision?.type ?? null,
        groundIsDrivable: ground?.tags.has("drivable-surface") ?? false,
        keyLightCastsShadows: keyLight?.light?.castShadows ?? null,
        keyLightIntensity: keyLight?.light?.intensity ?? null,
        keyLightRotationX: keyLight?.getEulerAngles().x ?? null,
        keyLightRotationY: keyLight?.getEulerAngles().y ?? null,
        keyLightShadowResolution: keyLight?.light?.shadowResolution ?? null,
        obstacleAInteractionRadius: obstacleA?.radius ?? null,
        obstacleAX: obstacleA ? toFixedStep(obstacleA.x) : null,
        obstacleBlocksKart: firstObstacle
          ? collidesWithObstacle(
              new pc.Vec3(firstObstacle.x, 0, firstObstacle.z),
            )
          : false,
        obstacleCount: collisionObstacles.length,
        rampCount: rampEntities.length,
        startClear: !collidesWithObstacle(currentStartPosition),
        startLineHasCollision: Boolean(startFinishLine?.collision),
        startLineHasRigidBody: Boolean(startFinishLine?.rigidbody),
      };
    };

    const getKartDebugState = () => {
      const kartPosition = kart.getPosition();
      const kartRotation = kart.getEulerAngles();
      const angularVelocity = kart.rigidbody?.angularVelocity ?? pc.Vec3.ZERO;
      const linearVelocity = kart.rigidbody?.linearVelocity ?? pc.Vec3.ZERO;
      const angularSpeed = angularVelocity.length();
      const supportCount = kartController.state.supportCount;
      const maximumLateralSpeed = Math.max(
        0,
        ...kartController.state.wheelTelemetry.map((wheel) =>
          Math.abs(wheel.lateralSpeed),
        ),
      );
      const maximumSlipAngle = Math.max(
        0,
        ...kartController.state.wheelTelemetry.map(
          (wheel) => wheel.slipAngle,
        ),
      );
      const maximumTireForceUtilization = Math.max(
        0,
        ...kartController.state.wheelTelemetry.map(
          (wheel) => wheel.tireForceUtilization,
        ),
      );

      return {
        airbornePitchActive: kartController.state.airbornePitch.active,
        airbornePitchAngle: toFixedStep(
          kartController.state.airbornePitch.angle,
        ),
        airbornePitchRate: toFixedStep(
          kartController.state.airbornePitch.rate,
        ),
        airbornePitchTarget: toFixedStep(
          kartController.state.airbornePitch.target,
        ),
        airbornePitchTorque: toFixedStep(
          kartController.state.airbornePitch.appliedTorque,
        ),
        angularSpeed: toFixedStep(angularSpeed),
        angularVelocity: {
          x: toFixedStep(angularVelocity.x),
          y: toFixedStep(angularVelocity.y),
          z: toFixedStep(angularVelocity.z),
        },
        chassisClearance: toFixedStep(kartVisual.getPosition().y - 0.26),
        driftSmokeLevels: driftSmoke?.levelsByWheel ?? {},
        forward: {
          x: toFixedStep(kart.forward.x),
          y: toFixedStep(kart.forward.y),
          z: toFixedStep(kart.forward.z),
        },
        isOverGround: supportCount !== 0,
        linearVelocity: {
          x: toFixedStep(linearVelocity.x),
          y: toFixedStep(linearVelocity.y),
          z: toFixedStep(linearVelocity.z),
        },
        maximumLateralSpeed: toFixedStep(maximumLateralSpeed),
        maximumSteerAngle: toFixedStep(
          kartController.state.maximumSteerAngle,
        ),
        maximumSlipAngle: toFixedStep(maximumSlipAngle),
        maximumTireForceUtilization: toFixedStep(maximumTireForceUtilization),
        maxForwardSpeed: toFixedStep(activeKartTuning.maxForwardSpeed),
        manualRightingCooldownSeconds: toFixedStep(
          manualRightingCooldownSeconds,
        ),
        manualRightingCount,
        rotationX: toFixedStep(kartRotation.x),
        rotationY: toFixedStep(kartRotation.y),
        rotationZ: toFixedStep(kartRotation.z),
        speed: toFixedStep(kartController.state.speed),
        steerAngle: toFixedStep(kartController.state.steerAngle),
        driftSmokeWheelNames: driftSmoke?.activeWheelNames ?? [],
        supportCount,
        supportEntityNames: [...kartController.state.supportEntityNames],
        supportedWheelNames: [...kartController.state.supportedWheelNames],
        saturatedTireCount: kartController.state.wheelTelemetry.filter(
          (wheel) => wheel.tireForceUtilization >= 0.995,
        ).length,
        tuning: { ...activeKartTuning },
        up: {
          x: toFixedStep(kart.up.x),
          y: toFixedStep(kart.up.y),
          z: toFixedStep(kart.up.z),
        },
        verticalVelocity: toFixedStep(kartController.state.verticalVelocity),
        wheelHubYs: Object.fromEntries(
          kartController.state.wheelTelemetry.map((wheel) => [
            wheel.name,
            toFixedStep(wheel.hubLocalY),
          ]),
        ),
        wheelSlipAngles: Object.fromEntries(
          kartController.state.wheelTelemetry.map((wheel) => [
            wheel.name,
            toFixedStep(wheel.slipAngle),
          ]),
        ),
        wheelLoads: Object.fromEntries(
          kartController.state.wheelTelemetry.map((wheel) => [
            wheel.name,
            toFixedStep(wheel.suspensionLoad),
          ]),
        ),
        wheelSweepFractions: Object.fromEntries(
          kartController.state.wheelTelemetry.map((wheel) => [
            wheel.name,
            wheel.sweepFraction === null
              ? null
              : toFixedStep(wheel.sweepFraction),
          ]),
        ),
        x: toFixedStep(kartPosition.x),
        y: toFixedStep(kartPosition.y),
        z: toFixedStep(kartPosition.z),
      };
    };

    const getCollisionResponseDebugState = () => {
      const ccdConfiguration = getRigidBodyCcdConfiguration(kart);

      return {
        ccdMotionThreshold: ccdConfiguration
          ? toFixedStep(ccdConfiguration.motionThreshold)
          : null,
        ccdSweptSphereRadius: ccdConfiguration
          ? toFixedStep(ccdConfiguration.sweptSphereRadius)
          : null,
        contactedEntityNames: [...collisionMetrics.contactedEntityNames],
        impactFrameCount: collisionMetrics.impactFrameCount,
        maximumAngularSpeedAfterImpact: toFixedStep(
          collisionMetrics.maximumAngularSpeedAfterImpact,
        ),
        maximumApproachSpeed: toFixedStep(
          collisionMetrics.maximumApproachSpeed,
        ),
        maximumImpulse: toFixedStep(collisionMetrics.maximumImpulse),
        postLinearVelocity: {
          x: toFixedStep(collisionMetrics.postLinearVelocity.x),
          y: toFixedStep(collisionMetrics.postLinearVelocity.y),
          z: toFixedStep(collisionMetrics.postLinearVelocity.z),
        },
        preLinearVelocity: {
          x: toFixedStep(collisionMetrics.preLinearVelocity.x),
          y: toFixedStep(collisionMetrics.preLinearVelocity.y),
          z: toFixedStep(collisionMetrics.preLinearVelocity.z),
        },
      };
    };

    const getPresentationDebugState = () => {
      const physicsPosition = kart.getPosition();
      const visualPosition = kartVisual.getPosition();
      const cameraTrackedPosition = chaseCamera.getTrackedPosition();

      return {
        cameraTrackedPosition: {
          x: toFixedStep(cameraTrackedPosition.x),
          y: toFixedStep(cameraTrackedPosition.y),
          z: toFixedStep(cameraTrackedPosition.z),
        },
        physicsPosition: {
          x: toFixedStep(physicsPosition.x),
          y: toFixedStep(physicsPosition.y),
          z: toFixedStep(physicsPosition.z),
        },
        visualPosition: {
          x: toFixedStep(visualPosition.x),
          y: toFixedStep(visualPosition.y),
          z: toFixedStep(visualPosition.z),
        },
      };
    };

    const getSuspensionDebugState = () => ({
      maximumCompression: toFixedStep(suspensionMetrics.maximumCompression),
      maximumSupportedWheels: suspensionMetrics.maximumSupportedWheels,
      minimumChassisClearance: Number.isFinite(
        suspensionMetrics.minimumChassisClearance,
      )
        ? toFixedStep(suspensionMetrics.minimumChassisClearance)
        : 0,
      minimumSupportedWheels: suspensionMetrics.minimumSupportedWheels,
    });

    const setKartDebugPose = (pose: {
      angularVelocity?: Position3;
      ccdEnabled?: boolean;
      linearVelocity?: Position3;
      position: Position3;
      rotation: Position3;
    }) => {
      kart.rigidbody?.teleport(
        new pc.Vec3(pose.position.x, pose.position.y, pose.position.z),
        new pc.Quat().setFromEulerAngles(
          pose.rotation.x,
          pose.rotation.y,
          pose.rotation.z,
        ),
      );
      kartController.reset();
      driftSmoke?.stop();
      resetSuspensionMetrics();
      resetCollisionMetrics();
      latestCameraImpact = null;

      configureRigidBodyCcd(kart, {
        ...KART_CCD_CONFIGURATION,
        motionThreshold:
          pose.ccdEnabled === false
            ? 0
            : KART_CCD_CONFIGURATION.motionThreshold,
      });

      if (kart.rigidbody && pose.linearVelocity) {
        kart.rigidbody.linearVelocity = new pc.Vec3(
          pose.linearVelocity.x,
          pose.linearVelocity.y,
          pose.linearVelocity.z,
        );
      }

      if (kart.rigidbody && pose.angularVelocity) {
        kart.rigidbody.angularVelocity = new pc.Vec3(
          pose.angularVelocity.x,
          pose.angularVelocity.y,
          pose.angularVelocity.z,
        );
      }

      snapKartPresentationState();
      previousRacePosition.copy(kart.getPosition());
      chaseCamera.snap(
        getChaseCameraSnapshot(
          pose.position.y > KART_ROOT_HEIGHT + 0.5 ? 0 : dynamicWheels.length,
        ),
      );
    };

    const setRaceDebugMovement = (
      previousPosition: Position3,
      currentPosition: Position3,
      preserveMotion = false,
    ) => {
      previousRacePosition.set(
        previousPosition.x,
        previousPosition.y,
        previousPosition.z,
      );
      kart.rigidbody?.teleport(
        new pc.Vec3(currentPosition.x, currentPosition.y, currentPosition.z),
        kart.getRotation(),
      );
      if (kart.rigidbody && !preserveMotion) {
        kart.rigidbody.linearVelocity = new pc.Vec3();
        kart.rigidbody.angularVelocity = new pc.Vec3();
        kart.rigidbody.activate();
      }
      if (!preserveMotion) {
        kartController.reset();
        driftSmoke?.stop();
      }
      snapKartPresentationState();
    };

    const getKartScreenPoint = () => {
      if (!camera.camera) {
        return null;
      }
      const rect = activeCanvas.getBoundingClientRect();
      const screenPosition = camera.camera.worldToScreen(
        kartVisual.getPosition(),
      );
      return {
        x: screenPosition.x / (activeCanvas.width / rect.width),
        y: screenPosition.y / (activeCanvas.height / rect.height),
      };
    };

    const detachSceneTestAdapter = ENABLE_SCENE_TEST_HOOKS
      ? attachSceneTestAdapter(activeCanvas, {
          getCameraDebugState: () => chaseCamera.getDiagnostics(),
          getCollisionDebugState,
          getCollisionResponseDebugState,
          getKartDebugState,
          getKartScreenPoint,
          getPresentationDebugState,
          getRaceDebugState: () => ({
            ...raceSession.snapshot,
            lastProgressionResult: lastRaceProgressionResult,
          }),
          getSuspensionDebugState,
          requestRaceRecovery,
          resetKart,
          setCourseObjectDebugTransform,
          setKartDebugPose,
          setKartMovementTuning: setSceneKartTuning,
          setRaceDebugMovement,
          setSimulationPaused: (paused) => runtime.setPaused(paused),
          setStartPosition: setSceneStartPosition,
          stepSimulation: (steps) => runtime.stepFixed(steps),
          stepSimulationWithKartSamples: (steps) =>
            runtime.stepFixed(steps, getKartDebugState),
        })
      : () => undefined;
    runtime.addCleanup(detachSceneTestAdapter);

    chaseCamera.snap(getChaseCameraSnapshot(dynamicWheels.length));

    let latestRequestedDrivingInput =
      inputManager.sampleDrivingInput().driving;
    let latestDrivingInput = latestRequestedDrivingInput;
    let pauseAfterFixedStep = false;
    let raceFinishedThisFrame = false;

    runtime.onFixedStep((dt) => {
      collisionObserver.beginStep();
      manualRightingCooldownSeconds = Math.max(
        0,
        manualRightingCooldownSeconds - dt,
      );

      const sample = inputManager.sampleDrivingInput();
      latestRequestedDrivingInput = sample.driving;
      pauseAfterFixedStep =
        sample.actions.pauseRequested &&
        raceSession.snapshot.state !== "finished";
      raceSession.advanceTime(dt);
      if (!raceStartReported && raceSession.snapshot.state === "racing") {
        raceStartReported = true;
        gameplayTelemetry.markRaceStarted();
      }

      if (pauseAfterFixedStep) {
        inputManager.setEnabled(false);
        clearTouchPresentation();
      }

      if (kartTapRightingRequested) {
        kartTapRightingRequested = false;
        requestManualKartRighting();
      }

      if (sample.actions.resetRequested) {
        requestPlayerRecovery();
      }

      latestDrivingInput =
        raceSession.acceptsDriving && !pauseAfterFixedStep
          ? sample.driving
          : NEUTRAL_DRIVING_INPUT;
      kartController.update(latestDrivingInput, dt);
    });

    runtime.onPostFixedStep((dt) => {
      collisionObserver.endStep();
      captureCollisionMetrics();
      captureCameraImpact();

      kartController.postUpdate(latestDrivingInput, dt);

      const currentRacePosition = kart.getPosition();
      if (raceSession.acceptsDriving) {
        const progressionResult = raceSession.processMovement(
          {
            x: previousRacePosition.x,
            y: previousRacePosition.y,
            z: previousRacePosition.z,
          },
          {
            x: currentRacePosition.x,
            y: currentRacePosition.y,
            z: currentRacePosition.z,
          },
        );
        lastRaceProgressionResult = progressionResult;
        if (progressionResult.kind !== "none") {
          lastRaceAnnouncementResult = progressionResult;
        }
        if (lastRaceProgressionResult.kind === "finished") {
          raceFinishedThisFrame = true;
          inputManager.setEnabled(false);
          clearTouchPresentation();
          setKartTuningOpen(false);
          setDriveCursorHidden(false);
        }
      }
      previousRacePosition.copy(currentRacePosition);

      if (pauseAfterFixedStep) {
        const paused = raceSession.pause();
        pauseAfterFixedStep = false;
        if (paused) {
          runtime.requestPauseAtFixedStepBoundary();
          setKartTuningOpen(false);
          setGamePaused(true);
          setDriveCursorHidden(false);
        }
      }

      const raceState = raceSession.snapshot.state;
      driftSmoke?.update(kartController.state.wheelTelemetry, {
        brake: raceState === "racing" ? latestDrivingInput.brake : 0,
        countdownThrottle:
          raceState === "countdown"
            ? Math.max(latestRequestedDrivingInput.throttle, 0)
            : 0,
      });

      publishRacePresentation();
    });

    runtime.onDiscardedTime((discardedSeconds) => {
      if (raceFinishedThisFrame) {
        raceSession.accountFinalFrameDiscardedTime(discardedSeconds);
      } else {
        raceSession.advanceTime(discardedSeconds);
      }
      gameplayTelemetry.recordDiscardedTime(discardedSeconds);
    });

    runtime.onFrameEnd(() => {
      if (!raceFinishedThisFrame) {
        return;
      }
      raceFinishedThisFrame = false;
      gameplayTelemetry.complete(
        Math.round(raceSession.snapshot.elapsedRaceMicroseconds / 1_000),
      );
      publishRacePresentation();
    });

    runtime.onRender(({ accumulatorFraction, frameSeconds }) => {
      interpolatedKartPosition.lerp(
        kartPresentation.previousPosition,
        kartPresentation.currentPosition,
        accumulatorFraction,
      );
      interpolatedKartRotation.slerp(
        kartPresentation.previousRotation,
        kartPresentation.currentRotation,
        accumulatorFraction,
      );
      interpolatedKartRotation.transformVector(
        kartGeometryOffset,
        interpolatedKartVisualPosition,
      );
      interpolatedKartVisualPosition.add(interpolatedKartPosition);
      kartVisual.setPosition(interpolatedKartVisualPosition);
      kartVisual.setRotation(interpolatedKartRotation);
      renderWheelPresentation(accumulatorFraction);

      chaseCamera.update(frameSeconds, getChaseCameraSnapshot());
      latestCameraImpact = null;
      publishRacePresentation();
    });

    app.on("update", () => {
      captureKartPresentationState();
      captureWheelPresentationState();
      suspensionMetrics.maximumCompression = Math.max(
        suspensionMetrics.maximumCompression,
        ...kartController.state.wheelTelemetry.map(
          (wheel) => wheel.suspensionCompression,
        ),
      );
      suspensionMetrics.maximumSupportedWheels = Math.max(
        suspensionMetrics.maximumSupportedWheels,
        kartController.state.supportCount,
      );
      suspensionMetrics.minimumSupportedWheels = Math.min(
        suspensionMetrics.minimumSupportedWheels,
        kartController.state.supportCount,
      );
      suspensionMetrics.minimumChassisClearance = Math.min(
        suspensionMetrics.minimumChassisClearance,
        kartVisual.getPosition().y - 0.26,
      );
    });

    raceSession.markReady();
    raceSession.startCountdown();
    publishRacePresentation();
    runtime.start();
    activeCanvas.dataset.sceneReady = "true";
    setSceneFailureCode(null);
    setSceneStatus("ready");
    gameplayTelemetry.markRuntimeLoaded();
    setDriveCursorHidden(true);
    if (document.hidden || !document.hasFocus()) {
      pauseForInterruption();
      gameplayTelemetry.flushRuntimeHealth();
    }
    runtime.addCleanup(() => {
      delete activeCanvas.dataset.sceneReady;
    });
  };

    void initializeScene().catch((error: unknown) => {
      const failedRuntime = activeRuntime;

      failedRuntime?.destroy();
      activeRuntime = null;
      sceneApiRef.current = null;

      if (failedRuntime && sceneTestControl) {
        sceneTestControl.runtimeDestroyCount =
          (sceneTestControl.runtimeDestroyCount ?? 0) + 1;
      }

      if (!cancelled) {
        console.error("Unable to initialize the PlayCanvas scene", error);
        gameplayTelemetry.fail(
          "load_failed",
          failedRuntime ? "scene_initialization_failed" : "physics_load_failed",
        );
        setSceneFailureCode(
          failedRuntime ? "scene_initialization_failed" : "physics_load_failed",
        );
        setSceneStatus("failed");
      }
    });

    return () => {
      cancelled = true;
      sceneApiRef.current = null;
      activeRuntime?.destroy();
    };
  }, [COURSE_DOCUMENT, START_POSITION, START_ROTATION, gameplayTelemetry]);

  function updateKartTuning(key: KartTuningKey, value: number) {
    const nextTuning = normalizeKartTuning({
      ...kartTuningRef.current,
      [key]: value,
    });
    kartTuningRef.current = nextTuning;
    setKartTuning(nextTuning);
    sceneApiRef.current?.setKartTuning(nextTuning);
  }

  const updateKartTuningOpen = useCallback((open: boolean) => {
    setKartTuningOpen(open);
    if (!open) {
      requestAnimationFrame(() => canvasRef.current?.focus());
      return;
    }
    sceneApiRef.current?.clearInput();
    touchJoystickPointerRef.current = null;
    clearTouchPedalPresentation(touchPedalElementsRef.current);
    setTouchJoystickPresentation(
      touchJoystickElementRef.current,
      touchJoystickKnobRef.current,
      0,
      0,
    );
  }, []);

  useEffect(() => {
    const toggleKartTuning = (event: KeyboardEvent) => {
      if (
        event.code !== "KeyT" ||
        event.repeat ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        isEditableKeyboardTarget(event.target) ||
        gamePaused ||
        racePresentation.state === "finished" ||
        sceneStatus !== "ready"
      ) {
        return;
      }

      event.preventDefault();
      updateKartTuningOpen(!kartTuningOpen);
    };

    window.addEventListener("keydown", toggleKartTuning);
    return () => window.removeEventListener("keydown", toggleKartTuning);
  }, [
    gamePaused,
    kartTuningOpen,
    racePresentation.state,
    sceneStatus,
    updateKartTuningOpen,
  ]);

  function resetKartTuning() {
    const defaults = { ...DEFAULT_KART_TUNING };
    kartTuningRef.current = defaults;
    setKartTuning(defaults);
    sceneApiRef.current?.setKartTuning(defaults);
  }

  function pauseRace() {
    sceneApiRef.current?.setPaused(true);
    touchJoystickPointerRef.current = null;
    clearTouchPedalPresentation(touchPedalElementsRef.current);
    setTouchJoystickPresentation(
      touchJoystickElementRef.current,
      touchJoystickKnobRef.current,
      0,
      0,
    );
    setKartTuningOpen(false);
    setGamePaused(true);
    setDriveCursorHidden(false);
  }

  function exitRace() {
    gameplayTelemetry.exit();
    onExit();
  }

  function pressTouchControl(
    event: ReactPointerEvent<HTMLButtonElement>,
    action: TouchPedalAction,
  ) {
    event.preventDefault();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic browser tests may not create an active native pointer stream.
      // The adapter still receives the same semantic press and release events.
    }
    sceneApiRef.current?.pressTouchPedal(event.pointerId, action);
    setTouchPedalPresentation(touchPedalElementsRef.current, action, true);
  }

  function releaseTouchControl(
    event: ReactPointerEvent<HTMLButtonElement>,
    action: TouchPedalAction,
  ) {
    sceneApiRef.current?.releaseTouch(event.pointerId);
    setTouchPedalPresentation(touchPedalElementsRef.current, action, false);
  }

  function pressTouchControlFromKeyboard(
    event: ReactKeyboardEvent<HTMLButtonElement>,
    action: TouchPedalAction,
  ) {
    if ((event.key !== " " && event.key !== "Enter") || event.repeat) {
      return;
    }
    event.preventDefault();
    sceneApiRef.current?.pressTouchPedal(
      TOUCH_KEYBOARD_POINTER_IDS[action],
      action,
    );
    setTouchPedalPresentation(touchPedalElementsRef.current, action, true);
  }

  function releaseTouchControlFromKeyboard(
    event: ReactKeyboardEvent<HTMLButtonElement>,
    action: TouchPedalAction,
  ) {
    if (event.key !== " " && event.key !== "Enter") {
      return;
    }
    event.preventDefault();
    sceneApiRef.current?.releaseTouch(TOUCH_KEYBOARD_POINTER_IDS[action]);
    setTouchPedalPresentation(touchPedalElementsRef.current, action, false);
  }

  function blurTouchControl(action: TouchPedalAction) {
    sceneApiRef.current?.releaseTouch(TOUCH_KEYBOARD_POINTER_IDS[action]);
    setTouchPedalPresentation(touchPedalElementsRef.current, action, false);
  }

  function updateTouchJoystick(pointerId: number, x: number, y: number) {
    sceneApiRef.current?.setTouchJoystick(pointerId, x, y);
    setTouchJoystickPresentation(
      touchJoystickElementRef.current,
      touchJoystickKnobRef.current,
      x,
      y,
    );
  }

  function getTouchJoystickFromPointer(
    event: ReactPointerEvent<HTMLDivElement>,
  ) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const maximumTravel = bounds.width * 0.3;
    if (maximumTravel <= 0) {
      return { x: 0, y: 0 };
    }
    const centerX = bounds.left + bounds.width / 2;
    const centerY = bounds.top + bounds.height / 2;
    return {
      x: (event.clientX - centerX) / maximumTravel,
      y: (event.clientY - centerY) / maximumTravel,
    };
  }

  function pressTouchJoystick(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    touchJoystickPointerRef.current = event.pointerId;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic browser tests may not create an active native pointer stream.
    }
    const value = getTouchJoystickFromPointer(event);
    updateTouchJoystick(event.pointerId, value.x, value.y);
  }

  function moveTouchJoystick(event: ReactPointerEvent<HTMLDivElement>) {
    if (touchJoystickPointerRef.current !== event.pointerId) {
      return;
    }
    event.preventDefault();
    const value = getTouchJoystickFromPointer(event);
    updateTouchJoystick(event.pointerId, value.x, value.y);
  }

  function releaseTouchJoystick(event: ReactPointerEvent<HTMLDivElement>) {
    if (touchJoystickPointerRef.current !== event.pointerId) {
      return;
    }
    sceneApiRef.current?.releaseTouch(event.pointerId);
    touchJoystickPointerRef.current = null;
    setTouchJoystickPresentation(
      touchJoystickElementRef.current,
      touchJoystickKnobRef.current,
      0,
      0,
    );
  }

  function pressTouchJoystickFromKeyboard(
    event: ReactKeyboardEvent<HTMLDivElement>,
  ) {
    if (
      !["ArrowDown", "ArrowLeft", "ArrowRight", "ArrowUp"].includes(
        event.key,
      ) ||
      event.repeat
    ) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const value = {
      ArrowDown: { x: 0, y: 1 },
      ArrowLeft: { x: -1, y: 0 },
      ArrowRight: { x: 1, y: 0 },
      ArrowUp: { x: 0, y: -1 },
    }[event.key];
    if (value) {
      updateTouchJoystick(
        TOUCH_KEYBOARD_JOYSTICK_POINTER_ID,
        value.x,
        value.y,
      );
    }
  }

  function releaseTouchJoystickFromKeyboard(
    event: ReactKeyboardEvent<HTMLDivElement>,
  ) {
    if (
      !["ArrowDown", "ArrowLeft", "ArrowRight", "ArrowUp"].includes(event.key)
    ) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    sceneApiRef.current?.releaseTouch(TOUCH_KEYBOARD_JOYSTICK_POINTER_ID);
    setTouchJoystickPresentation(
      touchJoystickElementRef.current,
      touchJoystickKnobRef.current,
      0,
      0,
    );
  }

  function blurTouchJoystick() {
    sceneApiRef.current?.releaseTouch(TOUCH_KEYBOARD_JOYSTICK_POINTER_ID);
    if (touchJoystickPointerRef.current !== null) {
      return;
    }
    setTouchJoystickPresentation(
      touchJoystickElementRef.current,
      touchJoystickKnobRef.current,
      0,
      0,
    );
  }

  function resetTouchKart() {
    sceneApiRef.current?.requestTouchReset();
    touchJoystickPointerRef.current = null;
    clearTouchPedalPresentation(touchPedalElementsRef.current);
    setTouchJoystickPresentation(
      touchJoystickElementRef.current,
      touchJoystickKnobRef.current,
      0,
      0,
    );
  }

  function beginKartTap(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (event.pointerType !== "touch" || event.button !== 0) {
      return;
    }

    kartTapCandidateRef.current = {
      pointerId: event.pointerId,
      startedAt: event.timeStamp,
      startX: event.clientX,
      startY: event.clientY,
    };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic pointer fixtures can still exercise the bounded tap path.
    }
  }

  function moveRacePointer(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (
      !gamePaused &&
      racePresentation.state !== "finished" &&
      sceneStatus === "ready"
    ) {
      setDriveCursorHidden(true);
    }

    const candidate = kartTapCandidateRef.current;
    if (
      candidate?.pointerId === event.pointerId &&
      Math.hypot(
        event.clientX - candidate.startX,
        event.clientY - candidate.startY,
      ) > KART_TAP_MAX_MOVEMENT_PX
    ) {
      kartTapCandidateRef.current = null;
    }
  }

  function cancelKartTap(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (kartTapCandidateRef.current?.pointerId === event.pointerId) {
      kartTapCandidateRef.current = null;
    }
  }

  function finishKartTap(event: ReactPointerEvent<HTMLCanvasElement>) {
    const candidate = kartTapCandidateRef.current;
    if (candidate?.pointerId !== event.pointerId) {
      return;
    }
    kartTapCandidateRef.current = null;
    const duration = event.timeStamp - candidate.startedAt;
    const movement = Math.hypot(
      event.clientX - candidate.startX,
      event.clientY - candidate.startY,
    );

    if (
      duration < 0 ||
      duration > KART_TAP_MAX_DURATION_MS ||
      movement > KART_TAP_MAX_MOVEMENT_PX
    ) {
      return;
    }

    sceneApiRef.current?.requestKartTapRighting(
      event.clientX,
      event.clientY,
    );
  }

  function resumeRace() {
    sceneApiRef.current?.setPaused(false);
    setGamePaused(false);
    setDriveCursorHidden(true);
    requestAnimationFrame(() => canvasRef.current?.focus());
  }

  function restartRace() {
    if (!sceneApiRef.current?.restartRace()) {
      return;
    }

    setGamePaused(false);
    setDriveCursorHidden(true);
    requestAnimationFrame(() => canvasRef.current?.focus());
  }

  function handleDialogKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Tab") {
      return;
    }
    const buttons = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>(
        "button:not(:disabled)",
      ),
    );
    const first = buttons[0];
    const last = buttons.at(-1);
    if (!first || !last) {
      return;
    }
    if (event.shiftKey && window.document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && window.document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <main className="fixed inset-0 z-50 bg-black">
      <canvas
        aria-keyshortcuts={
          !gamePaused &&
          racePresentation.state !== "finished" &&
          sceneStatus === "ready"
            ? "T"
            : undefined
        }
        ref={canvasRef}
        id="application"
        data-testid="solo-time-trial-canvas"
        aria-label="Solo Time Trial race"
        inert={
          gamePaused ||
          racePresentation.state === "finished" ||
          sceneStatus !== "ready"
        }
        tabIndex={0}
        className={`block h-[100dvh] w-[100dvw] touch-manipulation ${
          driveCursorHidden &&
          !gamePaused &&
          racePresentation.state !== "finished" &&
          sceneStatus === "ready"
            ? "cursor-none"
            : "cursor-default"
        }`}
        onBlur={() => setDriveCursorHidden(false)}
        onLostPointerCapture={cancelKartTap}
        onPointerCancel={cancelKartTap}
        onPointerDown={beginKartTap}
        onFocus={() => {
          setDriveCursorHidden(
            !gamePaused &&
              racePresentation.state !== "finished" &&
              sceneStatus === "ready",
          );
        }}
        onPointerEnter={() => {
          setDriveCursorHidden(
            !gamePaused &&
              racePresentation.state !== "finished" &&
              sceneStatus === "ready",
          );
        }}
        onPointerLeave={() => setDriveCursorHidden(false)}
        onPointerMove={moveRacePointer}
        onPointerUp={finishKartTap}
      />
      {sceneStatus === "ready" ? (
        <>
          {kartTuningOpen &&
          !gamePaused &&
          racePresentation.state !== "finished" ? (
            <KartTuningDrawer
              onChange={updateKartTuning}
              onClose={() => updateKartTuningOpen(false)}
              onReset={resetKartTuning}
              tuning={kartTuning}
            />
          ) : null}
          {racePresentation.state !== "finished" ? (
            <section
              aria-label="Race status"
              className="race-status-hud pointer-events-none absolute inset-x-0 top-0 z-10 font-mono text-titan-ice"
            >
              <div className="race-status-cluster">
                <div className="race-status-lap">
                  <span>Lap</span>
                  <strong>
                    <b>
                      {String(racePresentation.currentLap).padStart(2, "0")}
                    </b>
                    <i>/</i>
                    <small>
                      {String(racePresentation.lapCount).padStart(2, "0")}
                    </small>
                  </strong>
                </div>
                <span aria-hidden="true" className="race-status-divider" />
                <div className="race-status-time">
                  <span>Race time</span>
                  <time
                    dateTime={`PT${racePresentation.elapsedTime.replace(":", "M")}S`}
                  >
                    {racePresentation.elapsedTime}
                  </time>
                </div>
              </div>
            </section>
          ) : null}
          <p
            aria-atomic="true"
            aria-live="polite"
            className="sr-only"
            role="status"
          >
            {racePresentation.announcement}
          </p>
          {!gamePaused && racePresentation.cue ? (
            <div
              aria-hidden="true"
              className="race-lifecycle-cue pointer-events-none absolute inset-0 z-10 grid place-items-center font-mono font-black uppercase text-titan-ice"
            >
              <span
                className={
                  racePresentation.cue === "Go!"
                    ? "race-lifecycle-cue-motion race-lifecycle-cue-go"
                    : racePresentation.cue.startsWith("Lap ")
                      ? "race-lifecycle-cue-motion race-lifecycle-cue-lap"
                      : undefined
                }
              >
                {racePresentation.cue}
              </span>
            </div>
          ) : null}
          {gamePaused ? (
            <div
              aria-labelledby="pause-dialog-title"
              aria-modal="true"
              className="absolute inset-0 z-30 grid place-items-center bg-titan-black/72 px-6 text-center font-mono text-titan-ice backdrop-blur-sm"
              role="dialog"
              onKeyDown={handleDialogKeyDown}
            >
              <div
                className="grid w-full max-w-sm gap-5 border border-titan-ice/20 bg-titan-black/94 p-7 shadow-[0_24px_90px_rgb(0_0_0/0.6)]"
                ref={pauseMenuRef}
              >
                <div className="grid gap-2">
                  <p
                    className="text-xs font-bold uppercase tracking-[0.2em] text-titan-hazard"
                    id="pause-dialog-title"
                  >
                    Paused
                  </p>
                  <p className="text-sm text-titan-ice/70">
                    Resume when you&apos;re ready
                  </p>
                </div>
                <div className="grid gap-3">
                  <button
                    type="button"
                    className="titan-button titan-button-primary"
                    data-controller-default="true"
                    ref={resumeButtonRef}
                    onClick={resumeRace}
                  >
                    Resume
                  </button>
                  <button
                    type="button"
                    className="titan-button titan-button-secondary"
                    onClick={exitRace}
                  >
                    Exit
                  </button>
                </div>
              </div>
            </div>
          ) : null}
          {racePresentation.state === "finished" ? (
            <div
              aria-labelledby="finish-dialog-title"
              aria-modal="true"
              className="absolute inset-0 z-30 grid place-items-center bg-titan-black/76 px-6 text-center font-mono text-titan-ice backdrop-blur-sm"
              role="dialog"
              onKeyDown={handleDialogKeyDown}
            >
              <div
                className="grid w-full max-w-sm gap-5 border border-titan-hazard/50 bg-titan-black/96 p-7 shadow-[0_24px_90px_rgb(0_0_0/0.7)]"
                ref={finishMenuRef}
              >
                <div className="grid gap-2">
                  <p
                    className="text-xs font-bold uppercase tracking-[0.2em] text-titan-hazard"
                    id="finish-dialog-title"
                  >
                    Finish
                  </p>
                  <p className="text-4xl font-black tabular-nums tracking-tight">
                    {racePresentation.elapsedTime}
                  </p>
                </div>
                <ol
                  aria-label="Lap times"
                  className="grid gap-2 border-y border-titan-ice/15 py-3 text-sm"
                >
                  {racePresentation.lapTimes.map((lapTime, index) => (
                    <li
                      className="flex items-center justify-between gap-4"
                      key={`${index + 1}-${lapTime}`}
                    >
                      <span className="uppercase tracking-[0.12em] text-titan-ice/60">
                        Lap {index + 1}
                      </span>
                      <span className="font-bold tabular-nums">{lapTime}</span>
                    </li>
                  ))}
                </ol>
                <div className="grid gap-3">
                  <button
                    type="button"
                    className="titan-button titan-button-primary"
                    data-controller-default="true"
                    ref={restartButtonRef}
                    onClick={restartRace}
                  >
                    Race again
                  </button>
                  <button
                    type="button"
                    className="titan-button titan-button-secondary"
                    onClick={exitRace}
                  >
                    Exit
                  </button>
                </div>
              </div>
            </div>
          ) : null}
          {!gamePaused && racePresentation.state !== "finished" ? (
            <>
              <button
                aria-label="Reset kart"
                className="race-touch-reset race-touch-utility absolute left-[max(0.75rem,env(safe-area-inset-left))] top-[max(0.75rem,env(safe-area-inset-top))] z-20"
                type="button"
                onClick={resetTouchKart}
              >
                <ResetIcon />
              </button>
              <button
                aria-label="Pause race"
                className="race-pause-button race-touch-utility absolute right-[max(0.75rem,env(safe-area-inset-right))] top-[max(0.75rem,env(safe-area-inset-top))] z-20"
                type="button"
                onClick={pauseRace}
              >
                <PauseIcon />
              </button>
              {!kartTuningOpen ? (
                <div
                  aria-label="Touch driving controls"
                  className="race-touch-controls absolute inset-x-0 bottom-0 z-20 justify-between px-[max(1rem,env(safe-area-inset-left))] pb-[max(1rem,env(safe-area-inset-bottom))] pr-[max(1rem,env(safe-area-inset-right))]"
                  role="group"
                >
                <div
                  aria-describedby="touch-joystick-instructions"
                  aria-label="Drive joystick"
                  aria-roledescription="two-axis joystick"
                  className="race-touch-joystick"
                  data-active="false"
                  data-steer="0"
                  data-throttle="0"
                  onBlur={blurTouchJoystick}
                  onContextMenu={(event) => event.preventDefault()}
                  onKeyDown={pressTouchJoystickFromKeyboard}
                  onKeyUp={releaseTouchJoystickFromKeyboard}
                  onLostPointerCapture={releaseTouchJoystick}
                  onPointerCancel={releaseTouchJoystick}
                  onPointerDown={pressTouchJoystick}
                  onPointerMove={moveTouchJoystick}
                  onPointerUp={releaseTouchJoystick}
                  role="group"
                  ref={touchJoystickElementRef}
                  tabIndex={0}
                >
                  <span
                    className="sr-only"
                    id="touch-joystick-instructions"
                  >
                    Drag up to accelerate, down to brake or reverse, and left
                    or right to steer. While moving forward, hold Brake / Reverse
                    and steer strongly to progressively rear-brake for a drift.
                    Arrow keys provide the same basic joystick controls.
                  </span>
                  <span aria-hidden="true" className="race-touch-joystick-directions">
                    <span className="race-touch-joystick-up">↑</span>
                    <span className="race-touch-joystick-right">→</span>
                    <span className="race-touch-joystick-down">↓</span>
                    <span className="race-touch-joystick-left">←</span>
                  </span>
                  <span
                    aria-hidden="true"
                    className="race-touch-joystick-knob"
                    ref={touchJoystickKnobRef}
                    style={{
                      transform: "translate(-50%, -50%) translate(0, 0)",
                    }}
                  >
                    <span />
                  </span>
                </div>
                <div className="race-touch-pedals">
                  {(
                    [
                      ["brakeReverse", "Brake / Reverse"],
                      ["accelerate", "Accelerate"],
                    ] as const
                  ).map(([action, label]) => (
                    <button
                      key={action}
                      aria-label={label}
                      aria-pressed="false"
                      className={`race-touch-action race-touch-pedal ${action === "accelerate" ? "race-touch-accelerator" : "race-touch-brake"}`}
                      ref={(element) => {
                        if (element) {
                          touchPedalElementsRef.current[action] = element;
                        } else {
                          delete touchPedalElementsRef.current[action];
                        }
                      }}
                      type="button"
                      onBlur={() => blurTouchControl(action)}
                      onContextMenu={(event) => event.preventDefault()}
                      onKeyDown={(event) =>
                        pressTouchControlFromKeyboard(event, action)
                      }
                      onKeyUp={(event) =>
                        releaseTouchControlFromKeyboard(event, action)
                      }
                      onLostPointerCapture={(event) =>
                        releaseTouchControl(event, action)
                      }
                      onPointerCancel={(event) =>
                        releaseTouchControl(event, action)
                      }
                      onPointerDown={(event) =>
                        pressTouchControl(event, action)
                      }
                      onPointerUp={(event) =>
                        releaseTouchControl(event, action)
                      }
                    >
                      {action === "accelerate" ? (
                        <AcceleratorIcon />
                      ) : (
                        <BrakeIcon />
                      )}
                    </button>
                  ))}
                </div>
                </div>
              ) : null}
              <div className="pointer-events-none absolute bottom-4 right-4 z-10 hidden font-mono text-[0.68rem] font-bold uppercase tracking-[0.14em] text-titan-ice/55 lg:block">
                T · Tuning&nbsp;&nbsp; Esc · Pause
              </div>
            </>
          ) : null}
        </>
      ) : (
        <div className="absolute inset-0 z-20 grid place-items-center bg-titan-black/88 px-6 text-center font-mono text-titan-ice">
          <div
            className="grid max-w-md gap-4 border border-titan-ice/20 bg-titan-black p-6 shadow-[0_20px_70px_rgb(0_0_0/0.5)]"
            ref={statusMenuRef}
          >
            {sceneStatus === "initializing" ? (
              <p role="status" aria-live="polite">
                Preparing kart physics…
              </p>
            ) : sceneStatus === "context_lost" ? (
              <div className="grid gap-3" role="status" aria-live="polite">
                <p className="font-bold uppercase tracking-[0.12em] text-titan-hazard">
                  Restoring graphics
                </p>
                <p className="text-sm text-titan-ice/78">
                  The race is safely paused while the browser restores the
                  graphics context.
                </p>
              </div>
            ) : (
              <div className="grid gap-3" role="alert" aria-live="assertive">
                <p className="font-bold uppercase tracking-[0.12em] text-titan-hazard">
                  {sceneFailureCode?.startsWith("webgl_")
                    ? "Unable to continue the race"
                    : "Unable to start the race"}
                </p>
                <p className="text-sm text-titan-ice/78">
                  {sceneFailureCode?.startsWith("webgl_")
                    ? "Graphics could not be restored. Reload the app, or return to mode selection."
                    : "The kart physics engine could not load. Reload the app, or return to mode selection."}
                </p>
              </div>
            )}
            <div className="flex flex-wrap justify-center gap-3">
              {sceneStatus === "failed" ? (
                <button
                  type="button"
                  className="titan-button titan-button-primary"
                  data-controller-default="true"
                  onClick={() => window.location.reload()}
                >
                  Reload
                </button>
              ) : null}
              <button
                type="button"
                className="titan-button titan-button-secondary"
                data-controller-default={
                  sceneStatus !== "failed" ? "true" : undefined
                }
                onClick={exitRace}
              >
                Exit
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
