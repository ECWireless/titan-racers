"use client";

import * as pc from "playcanvas";
import { useEffect, useMemo, useRef, useState } from "react";

import { LiteEditorPanel } from "./lite-editor-panel";

import type {
  EditableObjectId,
  KartMovementTuning,
  KartMovementTuningKey,
  ObstacleObjectId,
  Position3,
  SceneApi,
  StartPosition,
  TransformAxis,
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
import { EDITOR_TRANSLATE_STEP } from "@/game/editor/editor-config";
import { KeyboardInput } from "@/game/input/keyboard-input";
import {
  DynamicKartController,
  type DynamicWheel,
} from "@/game/kart/dynamic-kart-controller";
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
import { attachSceneTestAdapter } from "@/game/testing/scene-test-adapter";

const KART_ROOT_HEIGHT = 0.43;
const KART_MASS = 120;
const KART_BODY_MASS = 70;
const KART_COCKPIT_MASS = KART_MASS - KART_BODY_MASS;
const KART_BODY_MASS_CENTER = { x: 0, y: -0.25, z: 0 } as const;
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
const KART_MAX_FORWARD_SPEED = 17;
const KART_MAX_REVERSE_SPEED = 3.4;
const KART_ACCELERATION = 9.5;
const KART_BRAKE_FORCE = 14;
const KART_DRAG = 4.2;
const KART_TURN_RATE = 116;
const KART_GRAVITY = 18;
const KART_RESET_FALL_Y = -10;
const EDITOR_CAMERA_START_DISTANCE = 28;
const EDITOR_CAMERA_MIN_DISTANCE = 4;
const EDITOR_CAMERA_MAX_DISTANCE = 56;
const EDITOR_CAMERA_PAN_SPEED = 5;
const EDITOR_CAMERA_FAST_MULTIPLIER = 2.5;
const EDITOR_CAMERA_ORBIT_SPEED = 0.25;
const EDITOR_CAMERA_PAN_PIXEL_SCALE = 0.0015;
const TRANSLATE_GIZMO_LENGTH = 2.2;
const TRANSLATE_GIZMO_HEAD_OFFSET = 2.55;
const TRANSLATE_GIZMO_PICK_RADIUS = 28;
const KART_COLLISION_RADIUS = 0.95;
const KART_CCD_CONFIGURATION = {
  motionThreshold: 0.12,
  sweptSphereRadius: 0.16,
} as const;

const DEFAULT_KART_MOVEMENT_TUNING = {
  acceleration: KART_ACCELERATION,
  brakeForce: KART_BRAKE_FORCE,
  drag: KART_DRAG,
  gravity: KART_GRAVITY,
  maxForwardSpeed: KART_MAX_FORWARD_SPEED,
  maxReverseSpeed: KART_MAX_REVERSE_SPEED,
  turnRate: KART_TURN_RATE,
};

function createMaterial(color: pc.Color) {
  const material = new pc.StandardMaterial();
  material.diffuse = color;
  material.update();

  return material;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
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

const KART_MOVEMENT_TUNING_MINIMUMS: Record<KartMovementTuningKey, number> = {
  acceleration: 0.5,
  brakeForce: 0.5,
  drag: 0,
  gravity: 0,
  maxForwardSpeed: 0.5,
  maxReverseSpeed: 0.5,
  turnRate: 1,
};
const ENABLE_SCENE_TEST_HOOKS = process.env.NODE_ENV !== "production";

type SceneInitializationTestControl = {
  forcePostRuntimeFailure?: boolean;
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
  const editorOpenRef = useRef(false);
  const sceneApiRef = useRef<SceneApi | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [driveCursorHidden, setDriveCursorHidden] = useState(false);
  const [gamePaused, setGamePaused] = useState(false);
  const [sceneStatus, setSceneStatus] = useState<
    "initializing" | "ready" | "failed"
  >("initializing");
  const [selectedObjectId, setSelectedObjectId] =
    useState<EditableObjectId>("start-position");
  const [selectedPosition, setSelectedPosition] = useState<Position3>({
    x: START_POSITION.x,
    y: START_POSITION.y,
    z: START_POSITION.z,
  });
  const [selectedRotation, setSelectedRotation] = useState<Position3>({
    x: START_ROTATION.x,
    y: START_ROTATION.y,
    z: START_ROTATION.z,
  });
  const [startPosition, setStartPosition] = useState<StartPosition>({
    x: START_POSITION.x,
    z: START_POSITION.z,
  });
  const [movementTuning, setMovementTuning] = useState<KartMovementTuning>(
    DEFAULT_KART_MOVEMENT_TUNING,
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.code !== "Escape" ||
        event.repeat ||
        sceneStatus !== "ready"
      ) {
        return;
      }

      event.preventDefault();

      if (editorOpenRef.current) {
        editorOpenRef.current = false;
        sceneApiRef.current?.setEditorMode(false);
        sceneApiRef.current?.setPaused(true);
        setEditorOpen(false);
        setGamePaused(true);
        setDriveCursorHidden(false);
        return;
      }

      const nextPaused = !gamePaused;

      sceneApiRef.current?.setPaused(nextPaused);
      setGamePaused(nextPaused);
      setDriveCursorHidden(!nextPaused);

      if (!nextPaused) {
        canvasRef.current?.focus();
      }
    };

    window.addEventListener("keydown", onKeyDown);

    return () => window.removeEventListener("keydown", onKeyDown);
  }, [gamePaused, sceneStatus]);

  useEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas) {
      return;
    }

    const activeCanvas = canvas;
    const sceneTestControl = getSceneInitializationTestControl();
    let cancelled = false;
    let activeRuntime: ReturnType<typeof createPlayCanvasRuntime> | null = null;

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

    rigidBodySystem.gravity.set(0, -KART_GRAVITY, 0);
    activeCanvas.focus();

    const kartMaterial = createMaterial(new pc.Color(0.95, 0.18, 0.08));
    const cockpitMaterial = createMaterial(new pc.Color(0.05, 0.08, 0.11));
    const wheelMaterial = createMaterial(new pc.Color(0.02, 0.025, 0.03));
    const wheelHubMaterial = createMaterial(new pc.Color(0.8, 0.82, 0.78));
    const suspensionArmMaterial = createMaterial(new pc.Color(0.48, 0.54, 0.57));
    const suspensionShockMaterial = createMaterial(new pc.Color(1, 0.67, 0.12));
    const asphaltMaterial = createMaterial(new pc.Color(0.08, 0.08, 0.09));
    const lineMaterial = createMaterial(new pc.Color(0.95, 0.92, 0.86));
    const markerMaterial = createMaterial(new pc.Color(1, 0.85, 0.15));
    const groundMaterial = createMaterial(new pc.Color(0.08, 0.36, 0.26));
    const obstacleBlockMaterial = createMaterial(new pc.Color(0.82, 0.78, 0.68));
    const obstacleBarrelMaterial = createMaterial(new pc.Color(0.96, 0.45, 0.12));
    const rampMaterial = createMaterial(new pc.Color(0.35, 0.39, 0.42));
    const selectionMaterial = createMaterial(new pc.Color(0.1, 0.82, 0.98));
    const gizmoXMaterial = createMaterial(new pc.Color(0.95, 0.14, 0.12));
    const gizmoYMaterial = createMaterial(new pc.Color(0.15, 0.82, 0.25));
    const gizmoZMaterial = createMaterial(new pc.Color(0.16, 0.42, 1));

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

    function createCone(
      name: string,
      position: pc.Vec3,
      scale: pc.Vec3,
      material: pc.StandardMaterial,
      eulerAngles = new pc.Vec3(0, 0, 0),
    ) {
      const entity = new pc.Entity(name);
      entity.addComponent("model", { type: "cone" });
      entity.setPosition(position);
      entity.setEulerAngles(eulerAngles);
      entity.setLocalScale(scale);
      entity.model?.meshInstances?.forEach((meshInstance) => {
        meshInstance.material = material;
      });
      app.root.addChild(entity);

      return entity;
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

    function syncObstacleCollision(id: ObstacleObjectId, position: pc.Vec3) {
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

    ([
      ["front-left", -0.78, -0.58],
      ["front-right", 0.78, -0.58],
      ["rear-left", -0.78, 0.62],
      ["rear-right", 0.78, 0.62],
    ] satisfies [string, number, number][]).forEach(([name, x, z]) => {
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
      angularDamping: 0.08,
      friction: 0.12,
      group: PHYSICS_GROUP.kart,
      linearDamping: 0.015,
      mask: PHYSICS_MASK.kart,
      mass: KART_MASS,
      restitution: 0.04,
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
    const interpolatedKartPosition = new pc.Vec3();
    const interpolatedKartVisualPosition = new pc.Vec3();
    const interpolatedKartRotation = new pc.Quat();
    const kartGeometryOffset = new pc.Vec3(
      KART_GEOMETRY_OFFSET.x,
      KART_GEOMETRY_OFFSET.y,
      KART_GEOMETRY_OFFSET.z,
    );

    function captureKartPresentationState() {
      kartPresentation.previousPosition.copy(kartPresentation.currentPosition);
      kartPresentation.previousRotation.copy(kartPresentation.currentRotation);
      kartPresentation.currentPosition.copy(kart.getPosition());
      kartPresentation.currentRotation.copy(kart.getRotation());
    }

    function snapKartPresentationState() {
      kartPresentation.currentPosition.copy(kart.getPosition());
      kartPresentation.currentRotation.copy(kart.getRotation());
      kartPresentation.previousPosition.copy(kartPresentation.currentPosition);
      kartPresentation.previousRotation.copy(kartPresentation.currentRotation);
      kartVisual.setLocalPosition(kartGeometryOffset);
      kartVisual.setLocalRotation(pc.Quat.IDENTITY);
      wheelPresentations.forEach((wheel) => {
        wheel.currentHubY = initialHubY;
        wheel.previousHubY = initialHubY;
      });
    }

    const selectionOutline = new pc.Entity("selection-outline");
    selectionOutline.enabled = false;
    app.root.addChild(selectionOutline);
    const selectionOutlineNorth = createChildBox(
      selectionOutline,
      "selection-outline-north",
      new pc.Vec3(0, 0, 1),
      new pc.Vec3(2.6, 0.06, 0.08),
      selectionMaterial,
    );
    const selectionOutlineSouth = createChildBox(
      selectionOutline,
      "selection-outline-south",
      new pc.Vec3(0, 0, -1),
      new pc.Vec3(2.6, 0.06, 0.08),
      selectionMaterial,
    );
    const selectionOutlineEast = createChildBox(
      selectionOutline,
      "selection-outline-east",
      new pc.Vec3(1.3, 0, 0),
      new pc.Vec3(0.08, 0.06, 2),
      selectionMaterial,
    );
    const selectionOutlineWest = createChildBox(
      selectionOutline,
      "selection-outline-west",
      new pc.Vec3(-1.3, 0, 0),
      new pc.Vec3(0.08, 0.06, 2),
      selectionMaterial,
    );

    const translateGizmo = new pc.Entity("translate-gizmo");
    translateGizmo.enabled = false;
    app.root.addChild(translateGizmo);

    const gizmoXShaft = createBox(
      "translate-gizmo-x-shaft",
      new pc.Vec3(TRANSLATE_GIZMO_LENGTH / 2, 0, 0),
      new pc.Vec3(TRANSLATE_GIZMO_LENGTH, 0.08, 0.08),
      gizmoXMaterial,
    );
    const gizmoXHead = createCone(
      "translate-gizmo-x-head",
      new pc.Vec3(TRANSLATE_GIZMO_HEAD_OFFSET, 0, 0),
      new pc.Vec3(0.34, 0.62, 0.34),
      gizmoXMaterial,
      new pc.Vec3(0, 0, -90),
    );
    const gizmoYShaft = createBox(
      "translate-gizmo-y-shaft",
      new pc.Vec3(0, TRANSLATE_GIZMO_LENGTH / 2, 0),
      new pc.Vec3(0.08, TRANSLATE_GIZMO_LENGTH, 0.08),
      gizmoYMaterial,
    );
    const gizmoYHead = createCone(
      "translate-gizmo-y-head",
      new pc.Vec3(0, TRANSLATE_GIZMO_HEAD_OFFSET, 0),
      new pc.Vec3(0.34, 0.62, 0.34),
      gizmoYMaterial,
    );
    const gizmoZShaft = createBox(
      "translate-gizmo-z-shaft",
      new pc.Vec3(0, 0, TRANSLATE_GIZMO_LENGTH / 2),
      new pc.Vec3(0.08, 0.08, TRANSLATE_GIZMO_LENGTH),
      gizmoZMaterial,
    );
    const gizmoZHead = createCone(
      "translate-gizmo-z-head",
      new pc.Vec3(0, 0, TRANSLATE_GIZMO_HEAD_OFFSET),
      new pc.Vec3(0.34, 0.62, 0.34),
      gizmoZMaterial,
      new pc.Vec3(90, 0, 0),
    );

    [
      gizmoXShaft,
      gizmoXHead,
      gizmoYShaft,
      gizmoYHead,
      gizmoZShaft,
      gizmoZHead,
    ].forEach((gizmoPart) => {
      translateGizmo.addChild(gizmoPart);
    });

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
    );

    const lightingEntities = buildCourseLighting(app, {
      document: COURSE_DOCUMENT,
    });

    let isEditorMode = false;
    let selectedEditableObjectId: EditableObjectId = "start-position";
    let activeEditorDrag:
      | {
          mode: "orbit" | "pan";
          pointerId: number;
          x: number;
          y: number;
        }
      | null = null;

    const editorCamera = {
      distance: EDITOR_CAMERA_START_DISTANCE,
      pitch: 68,
      pivot: new pc.Vec3(START_POSITION.x, 0, START_POSITION.z),
      yaw: 45,
    };
    let activeMovementTuning: KartMovementTuning = {
      ...DEFAULT_KART_MOVEMENT_TUNING,
    };
    const editableObjectRotations = new Map<EditableObjectId, pc.Vec3>([
      ["start-position", currentStartRotation.clone()],
      ["kart", START_ROTATION.clone()],
      ...[...obstacleEntities.entries()].map(
        ([id, entity]) => [id, entity.getEulerAngles().clone()] as const,
      ),
    ]);
    const editableObjectQuaternions = new Map<EditableObjectId, pc.Quat>([
      [
        "start-position",
        new pc.Quat().setFromEulerAngles(
          currentStartRotation.x,
          currentStartRotation.y,
          currentStartRotation.z,
        ),
      ],
      ["kart", kart.getRotation().clone()],
      ...[...obstacleEntities.entries()].map(
        ([id, entity]) => [id, entity.getRotation().clone()] as const,
      ),
    ]);

    function getEditableObjectPosition(objectId: EditableObjectId) {
      if (objectId === "kart") {
        return kartVisual.getPosition();
      }

      const obstacleEntity = obstacleEntities.get(objectId as ObstacleObjectId);

      if (obstacleEntity) {
        return obstacleEntity.getPosition();
      }

      return currentStartPosition.clone();
    }

    function getEditableObjectRotation(objectId: EditableObjectId) {
      return (
        editableObjectRotations.get(objectId)?.clone() ?? new pc.Vec3()
      );
    }

    function syncSelectedPosition(objectId = selectedEditableObjectId) {
      const position = getEditableObjectPosition(objectId);

      setSelectedPosition({
        x: toFixedStep(position.x),
        y: toFixedStep(position.y),
        z: toFixedStep(position.z),
      });
    }

    function syncSelectedRotation(objectId = selectedEditableObjectId) {
      const rotation = getEditableObjectRotation(objectId);

      setSelectedRotation({
        x: toFixedStep(rotation.x),
        y: toFixedStep(rotation.y),
        z: toFixedStep(rotation.z),
      });
    }

    function updateTranslateGizmo() {
      translateGizmo.enabled = isEditorMode;

      if (!isEditorMode) {
        return;
      }

      const selectedPosition = getEditableObjectPosition(
        selectedEditableObjectId,
      );
      const heightOffset =
        selectedEditableObjectId === "kart"
          ? 1.05
          : obstacleEntities.has(selectedEditableObjectId as ObstacleObjectId)
            ? 1.1
            : 0.42;

      translateGizmo.setPosition(
        selectedPosition.x,
        selectedPosition.y + heightOffset,
        selectedPosition.z,
      );
      translateGizmo.setEulerAngles(0, 0, 0);
    }

    function setSelectionOutline(
      position: pc.Vec3,
      rotation: pc.Vec3,
      width: number,
      depth: number,
    ) {
      const barThickness = 0.08;

      selectionOutline.setPosition(position);
      selectionOutline.setEulerAngles(rotation.x, rotation.y, rotation.z);
      selectionOutlineNorth.setLocalPosition(0, 0, depth / 2);
      selectionOutlineNorth.setLocalScale(width + barThickness, 0.06, barThickness);
      selectionOutlineSouth.setLocalPosition(0, 0, -depth / 2);
      selectionOutlineSouth.setLocalScale(width + barThickness, 0.06, barThickness);
      selectionOutlineEast.setLocalPosition(width / 2, 0, 0);
      selectionOutlineEast.setLocalScale(barThickness, 0.06, depth + barThickness);
      selectionOutlineWest.setLocalPosition(-width / 2, 0, 0);
      selectionOutlineWest.setLocalScale(barThickness, 0.06, depth + barThickness);
    }

    function updateSelectionMarker() {
      selectionOutline.enabled = isEditorMode;
      updateTranslateGizmo();

      if (!isEditorMode) {
        return;
      }

      if (selectedEditableObjectId === "kart") {
        const kartPosition = kartVisual.getPosition();
        setSelectionOutline(
          new pc.Vec3(kartPosition.x, kartPosition.y + 0.18, kartPosition.z),
          new pc.Vec3(0, kart.getEulerAngles().y, 0),
          2.25,
          2.85,
        );
        return;
      }

      const selectedObstacle = obstacleEntities.get(
        selectedEditableObjectId as ObstacleObjectId,
      );

      if (selectedObstacle) {
        const obstaclePosition = selectedObstacle.getPosition();
        const obstacleRotation = selectedObstacle.getEulerAngles();
        const collisionObstacle = collisionObstacles.find(
          (obstacle) => obstacle.id === selectedEditableObjectId,
        );
        const markerRadius = collisionObstacle
          ? collisionObstacle.radius * 2.35
          : 2.25;

        setSelectionOutline(
          new pc.Vec3(
            obstaclePosition.x,
            obstaclePosition.y + 0.18,
            obstaclePosition.z,
          ),
          obstacleRotation,
          markerRadius,
          markerRadius,
        );
        return;
      }

      setSelectionOutline(
        new pc.Vec3(
          currentStartPosition.x,
          currentStartPosition.y + 0.18,
          currentStartPosition.z,
        ),
        currentStartRotation,
        2.6,
        2,
      );
    }

    function selectEditableObject(objectId: EditableObjectId) {
      selectedEditableObjectId = objectId;
      setSelectedObjectId(objectId);
      syncSelectedPosition(objectId);
      syncSelectedRotation(objectId);
      updateSelectionMarker();
    }

    function editStaticRigidBody(
      entity: pc.Entity,
      editTransform: () => void,
    ) {
      const rigidBody = entity.rigidbody;

      if (rigidBody) {
        rigidBody.enabled = false;
      }

      editTransform();

      if (rigidBody) {
        rigidBody.enabled = true;
      }
    }

    function rotateSelected(axis: TransformAxis, delta: number) {
      const rotation = getEditableObjectRotation(selectedEditableObjectId);
      const currentQuaternion =
        editableObjectQuaternions.get(selectedEditableObjectId)?.clone() ??
        new pc.Quat().setFromEulerAngles(rotation.x, rotation.y, rotation.z);
      const nextRotation = rotation.clone();
      const worldAxis =
        axis === "x"
          ? pc.Vec3.RIGHT
          : axis === "y"
            ? pc.Vec3.UP
            : pc.Vec3.FORWARD;
      const deltaRotation = new pc.Quat().setFromAxisAngle(worldAxis, delta);
      const nextQuaternion = new pc.Quat().mul2(
        deltaRotation,
        currentQuaternion,
      );

      nextRotation[axis] = toFixedStep(rotation[axis] + delta);
      editableObjectRotations.set(selectedEditableObjectId, nextRotation);
      editableObjectQuaternions.set(selectedEditableObjectId, nextQuaternion);

      if (selectedEditableObjectId === "kart") {
        const chassisPosition = kartVisual.getPosition().clone();

        kart.setRotation(nextQuaternion);
        kart.setPosition(getKartRootPosition(chassisPosition, nextQuaternion));
        kartVisual.setLocalPosition(kartGeometryOffset);
      } else if (
        obstacleEntities.has(selectedEditableObjectId as ObstacleObjectId)
      ) {
        const obstacleEntity = obstacleEntities.get(
          selectedEditableObjectId as ObstacleObjectId,
        );

        if (obstacleEntity) {
          editStaticRigidBody(obstacleEntity, () => {
            obstacleEntity.setRotation(nextQuaternion);
          });
        }
      } else {
        currentStartRotation.copy(nextRotation);
        startMarker.setRotation(nextQuaternion);
      }

      syncSelectedRotation();
      updateSelectionMarker();
      activeCanvas.focus();
    }

    function translateSelected(axis: TransformAxis, delta: number) {
      if (selectedEditableObjectId === "kart") {
        const position = kartVisual.getPosition();
        const nextPosition = position.clone();

        nextPosition[axis] = toFixedStep(position[axis] + delta);
        kart.setPosition(
          getKartRootPosition(nextPosition, kart.getRotation().clone()),
        );
        kartVisual.setLocalPosition(kartGeometryOffset);
      } else if (
        obstacleEntities.has(selectedEditableObjectId as ObstacleObjectId)
      ) {
        const obstacleEntity = obstacleEntities.get(
          selectedEditableObjectId as ObstacleObjectId,
        );

        if (obstacleEntity) {
          const position = obstacleEntity.getPosition();
          const nextPosition = position.clone();

          nextPosition[axis] = toFixedStep(position[axis] + delta);
          editStaticRigidBody(obstacleEntity, () => {
            obstacleEntity.setPosition(nextPosition);
          });
          syncObstacleCollision(
            selectedEditableObjectId as ObstacleObjectId,
            nextPosition,
          );
        }
      } else {
        if (axis === "y") {
          syncSelectedPosition();
          updateSelectionMarker();
          activeCanvas.focus();
          return;
        }

        currentStartPosition[axis] = toFixedStep(
          currentStartPosition[axis] + delta,
        );
        startMarker.setPosition(
          currentStartPosition.x,
          currentStartPosition.y + 0.14,
          currentStartPosition.z,
        );
        setStartPosition({
          x: toFixedStep(currentStartPosition.x),
          z: toFixedStep(currentStartPosition.z),
        });

        if (isEditorMode) {
          editorCamera.pivot.set(
            currentStartPosition.x,
            currentStartPosition.y,
            currentStartPosition.z,
          );
          updateEditorCamera();
        }
      }

      syncSelectedPosition();
      updateSelectionMarker();
      activeCanvas.focus();
    }

    function worldToCanvasPoint(worldPosition: pc.Vec3) {
      const cameraComponent = camera.camera;

      if (!cameraComponent) {
        return null;
      }

      const rect = activeCanvas.getBoundingClientRect();
      const screenPosition = cameraComponent.worldToScreen(worldPosition);

      return {
        x: screenPosition.x / (activeCanvas.width / rect.width),
        y: screenPosition.y / (activeCanvas.height / rect.height),
      };
    }

    function pickTranslateGizmo(event: PointerEvent) {
      if (!isEditorMode) {
        return null;
      }

      const rect = activeCanvas.getBoundingClientRect();
      const pointerX = event.clientX - rect.left;
      const pointerY = event.clientY - rect.top;
      const origin = translateGizmo.getPosition();
      const samplePoints: Record<TransformAxis, pc.Vec3[]> = {
        x: [origin.clone().add(new pc.Vec3(TRANSLATE_GIZMO_HEAD_OFFSET, 0, 0))],
        y: [origin.clone().add(new pc.Vec3(0, TRANSLATE_GIZMO_HEAD_OFFSET, 0))],
        z: [origin.clone().add(new pc.Vec3(0, 0, TRANSLATE_GIZMO_HEAD_OFFSET))],
      };
      let closestAxis: TransformAxis | null = null;
      let closestDistance = Number.POSITIVE_INFINITY;

      (["x", "y", "z"] satisfies TransformAxis[]).forEach((axis) => {
        samplePoints[axis].forEach((samplePoint) => {
          const canvasPoint = worldToCanvasPoint(samplePoint);

          if (!canvasPoint) {
            return;
          }

          const distance = Math.hypot(
            canvasPoint.x - pointerX,
            canvasPoint.y - pointerY,
          );

          if (distance < closestDistance) {
            closestAxis = axis;
            closestDistance = distance;
          }
        });
      });

      if (closestDistance <= TRANSLATE_GIZMO_PICK_RADIUS) {
        return closestAxis;
      }

      return null;
    }

    function getTranslateGizmoScreenPoint(axis: TransformAxis) {
      return worldToCanvasPoint(
        translateGizmo
          .getPosition()
          .clone()
          .add(
            new pc.Vec3(
              axis === "x" ? TRANSLATE_GIZMO_HEAD_OFFSET : 0,
              axis === "y" ? TRANSLATE_GIZMO_HEAD_OFFSET : 0,
              axis === "z" ? TRANSLATE_GIZMO_HEAD_OFFSET : 0,
            ),
          ),
      );
    }

    function getEditableObjectScreenPoint(objectId: EditableObjectId) {
      const position = getEditableObjectPosition(objectId);

      return worldToCanvasPoint(
        new pc.Vec3(
          position.x,
          objectId === "kart"
            ? 0.65
            : obstacleEntities.has(objectId as ObstacleObjectId)
              ? position.y + 0.4
              : 0.2,
          position.z,
        ),
      );
    }

    function pickEditableObject(event: PointerEvent) {
      const rect = activeCanvas.getBoundingClientRect();
      const pointerX = event.clientX - rect.left;
      const pointerY = event.clientY - rect.top;
      const screenDistances = new Map<EditableObjectId, number>();

      ([
        "kart",
        "obstacle-barrel-a",
        "obstacle-barrel-b",
        "start-position",
      ] satisfies EditableObjectId[]).forEach((id) => {
        const objectPosition = getEditableObjectPosition(id);
        const worldPosition = new pc.Vec3(
          objectPosition.x,
          id === "kart"
            ? 0.65
            : obstacleEntities.has(id as ObstacleObjectId)
              ? objectPosition.y + 0.4
              : 0.2,
          objectPosition.z,
        );
        const canvasPoint = worldToCanvasPoint(worldPosition);

        if (!canvasPoint) {
          return;
        }

        screenDistances.set(
          id,
          Math.hypot(canvasPoint.x - pointerX, canvasPoint.y - pointerY),
        );
      });

      if ((screenDistances.get("kart") ?? Number.POSITIVE_INFINITY) <= 42) {
        return "kart";
      }

      const obstacleHit = ([
        "obstacle-barrel-a",
        "obstacle-barrel-b",
      ] satisfies ObstacleObjectId[]).find((id) => {
        const collisionObstacle = collisionObstacles.find(
          (obstacle) => obstacle.id === id,
        );
        const pickRadius = collisionObstacle
          ? clamp(collisionObstacle.radius * 42, 38, 58)
          : 44;

        return (
          (screenDistances.get(id) ?? Number.POSITIVE_INFINITY) <= pickRadius
        );
      });

      if (obstacleHit) {
        return obstacleHit;
      }

      if (
        (screenDistances.get("start-position") ?? Number.POSITIVE_INFINITY) <=
        78
      ) {
        return "start-position";
      }

      return null;
    }

    function getEditorForward() {
      const yawRadians = (editorCamera.yaw * Math.PI) / 180;

      return new pc.Vec3(Math.sin(yawRadians), 0, Math.cos(yawRadians))
        .normalize();
    }

    function getEditorRight() {
      const forward = getEditorForward();

      return new pc.Vec3(forward.z, 0, -forward.x).normalize();
    }

    function updateEditorCamera() {
      const yawRadians = (editorCamera.yaw * Math.PI) / 180;
      const pitchRadians = (editorCamera.pitch * Math.PI) / 180;
      const horizontalDistance =
        Math.cos(pitchRadians) * editorCamera.distance;
      const position = new pc.Vec3(
        editorCamera.pivot.x + Math.sin(yawRadians) * horizontalDistance,
        editorCamera.pivot.y + Math.sin(pitchRadians) * editorCamera.distance,
        editorCamera.pivot.z + Math.cos(yawRadians) * horizontalDistance,
      );

      camera.setPosition(position);
      camera.lookAt(editorCamera.pivot.x, 0, editorCamera.pivot.z);
    }

    function frameStartPosition() {
      editorCamera.pivot.set(
        currentStartPosition.x,
        currentStartPosition.y,
        currentStartPosition.z,
      );
      editorCamera.distance = EDITOR_CAMERA_START_DISTANCE;
      editorCamera.pitch = 68;
      updateEditorCamera();
    }

    function panEditorCamera(xDelta: number, zDelta: number) {
      const right = getEditorRight().mulScalar(xDelta);
      const forward = getEditorForward().mulScalar(zDelta);

      editorCamera.pivot.add(right).add(forward);
      updateEditorCamera();
    }

    function resetKart() {
      const resetRotation =
        editableObjectQuaternions.get("start-position")?.clone() ??
        new pc.Quat().setFromEulerAngles(
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

      if (isEditorMode) {
        kart.setPosition(resetPosition);
        kart.setRotation(resetRotation);
        editableObjectRotations.set("kart", currentStartRotation.clone());
        editableObjectQuaternions.set("kart", resetRotation.clone());
      } else {
        kart.rigidbody?.teleport(resetPosition, resetRotation);
      }

      kartController.reset();
      snapKartPresentationState();
      latestCameraImpact = null;
      keyboardInput.clear();
      if (isEditorMode) {
        frameStartPosition();
        syncSelectedPosition();
        syncSelectedRotation();
        updateSelectionMarker();
      } else {
        chaseCamera.snap(getChaseCameraSnapshot(dynamicWheels.length));
      }
      activeCanvas.focus();
    }

    function setSceneStartPosition(nextStartPosition: StartPosition) {
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
      if (selectedEditableObjectId === "start-position") {
        syncSelectedPosition("start-position");
      }
      updateSelectionMarker();

      if (isEditorMode) {
        frameStartPosition();
      }
    }

    function setEditorMode(nextEditorMode: boolean) {
      isEditorMode = nextEditorMode;
      kartController.reset();
      latestCameraImpact = null;
      keyboardInput.clear();

      if (isEditorMode) {
        editableObjectRotations.set("kart", kart.getEulerAngles().clone());
        editableObjectQuaternions.set("kart", kart.getRotation().clone());
        if (kart.rigidbody) {
          kart.rigidbody.type = pc.BODYTYPE_KINEMATIC;
          kart.rigidbody.group = PHYSICS_GROUP.kart;
          kart.rigidbody.mask = PHYSICS_MASK.kart;
        }
        frameStartPosition();
        updateSelectionMarker();
      } else {
        if (kart.rigidbody) {
          const editedPosition = kart.getPosition().clone();
          const editedRotation = kart.getRotation().clone();

          kart.rigidbody.type = pc.BODYTYPE_DYNAMIC;
          kart.rigidbody.group = PHYSICS_GROUP.kart;
          kart.rigidbody.mask = PHYSICS_MASK.kart;
          setExplicitRigidBodyInertia(kart, KART_MASS, KART_INERTIA);
          configureRigidBodyCcd(kart, KART_CCD_CONFIGURATION);
          kart.rigidbody.teleport(editedPosition, editedRotation);
          kartController.reset();
          snapKartPresentationState();
        }
        activeEditorDrag = null;
        updateSelectionMarker();
        chaseCamera.snap(getChaseCameraSnapshot(dynamicWheels.length));
      }

      activeCanvas.focus();
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
      onFallReset: resetKart,
      pitchInertia: KART_INERTIA.x,
      tuning: activeMovementTuning,
      wheels: dynamicWheels,
    });
    runtime.addCleanup(() => kartController.destroy());
    const collisionObserver = new KartCollisionObserver(rigidBodySystem, kart);
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
        kartController.state.wheelTelemetry.map((wheel) => [wheel.name, wheel]),
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

    function setSceneMovementTuning(nextMovementTuning: KartMovementTuning) {
      activeMovementTuning = { ...nextMovementTuning };
      kartController.setTuning(activeMovementTuning);
      activeCanvas.focus();
    }

    sceneApiRef.current = {
      getEditableObjectScreenPoint,
      getTranslateGizmoScreenPoint,
      rotateSelected,
      resetKart,
      setEditorMode,
      setMovementTuning: setSceneMovementTuning,
      setPaused: (paused) => {
        keyboardInput.clear();
        runtime.setPaused(paused);
      },
      setStartPosition: setSceneStartPosition,
      translateSelected,
    };

    const keyboardInput = new KeyboardInput(
      window,
      resetKart,
      frameStartPosition,
      () => isEditorMode,
    );
    keyboardInput.attach();
    runtime.addCleanup(() => keyboardInput.detach());

    const onContextMenu = (event: MouseEvent) => {
      if (isEditorMode) {
        event.preventDefault();
      }
    };

    const onPointerDown = (event: PointerEvent) => {
      if (!isEditorMode) {
        return;
      }

      if (event.button === 2) {
        activeEditorDrag = {
          mode: "orbit",
          pointerId: event.pointerId,
          x: event.clientX,
          y: event.clientY,
        };
      } else if (event.button === 1 || (event.button === 0 && event.shiftKey)) {
        activeEditorDrag = {
          mode: "pan",
          pointerId: event.pointerId,
          x: event.clientX,
          y: event.clientY,
        };
      } else {
        const pickedGizmoAxis = pickTranslateGizmo(event);

        if (pickedGizmoAxis) {
          translateSelected(pickedGizmoAxis, EDITOR_TRANSLATE_STEP);
          event.preventDefault();
          activeCanvas.focus();
          return;
        }

        const pickedObjectId = pickEditableObject(event);

        if (pickedObjectId) {
          selectEditableObject(pickedObjectId);
        }

        event.preventDefault();
        activeCanvas.focus();
        return;
      }

      event.preventDefault();
      activeCanvas.setPointerCapture(event.pointerId);
      activeCanvas.focus();
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!activeEditorDrag || activeEditorDrag.pointerId !== event.pointerId) {
        return;
      }

      const xDelta = event.clientX - activeEditorDrag.x;
      const yDelta = event.clientY - activeEditorDrag.y;
      activeEditorDrag.x = event.clientX;
      activeEditorDrag.y = event.clientY;

      if (activeEditorDrag.mode === "orbit") {
        editorCamera.yaw -= xDelta * EDITOR_CAMERA_ORBIT_SPEED;
        editorCamera.pitch = clamp(
          editorCamera.pitch + yDelta * EDITOR_CAMERA_ORBIT_SPEED,
          35,
          86,
        );
        updateEditorCamera();
      } else {
        const panScale =
          editorCamera.distance * EDITOR_CAMERA_PAN_PIXEL_SCALE;
        panEditorCamera(-xDelta * panScale, -yDelta * panScale);
      }
    };

    const onPointerUp = (event: PointerEvent) => {
      if (!activeEditorDrag || activeEditorDrag.pointerId !== event.pointerId) {
        return;
      }

      activeEditorDrag = null;
      activeCanvas.releasePointerCapture(event.pointerId);
    };

    const onWheel = (event: WheelEvent) => {
      if (!isEditorMode) {
        return;
      }

      event.preventDefault();
      editorCamera.distance = clamp(
        editorCamera.distance + event.deltaY * 0.01,
        EDITOR_CAMERA_MIN_DISTANCE,
        EDITOR_CAMERA_MAX_DISTANCE,
      );
      updateEditorCamera();
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
          ? collidesWithObstacle(new pc.Vec3(firstObstacle.x, 0, firstObstacle.z))
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
      const angularSpeed = kart.rigidbody?.angularVelocity.length() ?? 0;
      const supportCount = kartController.state.supportCount;
      const maximumLateralSpeed = Math.max(
        0,
        ...kartController.state.wheelTelemetry.map((wheel) =>
          Math.abs(wheel.lateralSpeed),
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
        chassisClearance: toFixedStep(kartVisual.getPosition().y - 0.26),
        forward: {
          x: toFixedStep(kart.forward.x),
          y: toFixedStep(kart.forward.y),
          z: toFixedStep(kart.forward.z),
        },
        isOverGround: supportCount !== 0,
        maximumLateralSpeed: toFixedStep(maximumLateralSpeed),
        maximumTireForceUtilization: toFixedStep(
          maximumTireForceUtilization,
        ),
        maxForwardSpeed: toFixedStep(activeMovementTuning.maxForwardSpeed),
        rotationX: toFixedStep(kartRotation.x),
        rotationY: toFixedStep(kartRotation.y),
        rotationZ: toFixedStep(kartRotation.z),
        speed: toFixedStep(kartController.state.speed),
        steerAngle: toFixedStep(kartController.state.steerAngle),
        supportCount,
        supportEntityNames: [...kartController.state.supportEntityNames],
        supportedWheelNames: [...kartController.state.supportedWheelNames],
        saturatedTireCount: kartController.state.wheelTelemetry.filter(
          (wheel) => wheel.tireForceUtilization >= 0.995,
        ).length,
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
      chaseCamera.snap(
        getChaseCameraSnapshot(
          pose.position.y > KART_ROOT_HEIGHT + 0.5
            ? 0
            : dynamicWheels.length,
        ),
      );
    };

    runtime.listen(activeCanvas, "contextmenu", onContextMenu);
    runtime.listen(activeCanvas, "pointerdown", onPointerDown);
    runtime.listen(activeCanvas, "pointermove", onPointerMove);
    runtime.listen(activeCanvas, "pointerup", onPointerUp);
    runtime.listen(activeCanvas, "pointercancel", onPointerUp);
    runtime.listen(activeCanvas, "wheel", onWheel, { passive: false });
    const detachSceneTestAdapter = ENABLE_SCENE_TEST_HOOKS
      ? attachSceneTestAdapter(activeCanvas, {
          getCameraDebugState: () => chaseCamera.getDiagnostics(),
          getCollisionDebugState,
          getCollisionResponseDebugState,
          getEditableObjectPoint: getEditableObjectScreenPoint,
          getKartDebugState,
          getPresentationDebugState,
          getSuspensionDebugState,
          getTranslateGizmoPoint: getTranslateGizmoScreenPoint,
          setKartDebugPose,
          setSimulationPaused: (paused) => runtime.setPaused(paused),
          stepSimulation: (steps) => runtime.stepFixed(steps),
        })
      : () => undefined;
    runtime.addCleanup(detachSceneTestAdapter);

    chaseCamera.snap(getChaseCameraSnapshot(dynamicWheels.length));

    runtime.onFixedStep((dt) => {
      collisionObserver.beginStep();

      if (!isEditorMode) {
        kartController.update(keyboardInput.getDrivingInput(), dt);
      }
    });

    runtime.onPostFixedStep((dt) => {
      collisionObserver.endStep();
      captureCollisionMetrics();
      captureCameraImpact();

      if (!isEditorMode) {
        kartController.postUpdate(keyboardInput.getDrivingInput(), dt);
      }
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

      if (!isEditorMode) {
        chaseCamera.update(frameSeconds, getChaseCameraSnapshot());
        latestCameraImpact = null;
      }
    });

    app.on("update", (dt) => {
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

      if (isEditorMode) {
        const editorMovement = keyboardInput.getEditorMovement();
        const moveSpeed =
          EDITOR_CAMERA_PAN_SPEED *
          (editorMovement.fast ? EDITOR_CAMERA_FAST_MULTIPLIER : 1);
        const lateralDirection = editorMovement.lateral;
        const forwardDirection = editorMovement.forward;

        if (lateralDirection !== 0 || forwardDirection !== 0) {
          panEditorCamera(
            lateralDirection * moveSpeed * dt,
            forwardDirection * moveSpeed * dt,
          );
        }

        return;
      }

      const drivingInput = keyboardInput.getDrivingInput();
      const turnDirection = drivingInput.steer;

      if (turnDirection !== 0) {
        updateSelectionMarker();
      }

    });

      if (editorOpenRef.current) {
        setEditorMode(true);
      }

      runtime.start();
      activeCanvas.dataset.sceneReady = "true";
      setSceneStatus("ready");
      setDriveCursorHidden(!editorOpenRef.current);
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
        setSceneStatus("failed");
      }
    });

    return () => {
      cancelled = true;
      sceneApiRef.current = null;
      activeRuntime?.destroy();
    };
  }, [COURSE_DOCUMENT, START_POSITION, START_ROTATION]);

  function updateStartPosition(nextStartPosition: StartPosition) {
    setStartPosition(nextStartPosition);
    sceneApiRef.current?.setStartPosition(nextStartPosition);
  }

  function updateMovementTuning(
    key: KartMovementTuningKey,
    nextValue: number,
  ) {
    const safeNextValue = Number.isFinite(nextValue)
      ? Math.max(nextValue, KART_MOVEMENT_TUNING_MINIMUMS[key])
      : KART_MOVEMENT_TUNING_MINIMUMS[key];

    setMovementTuning((currentMovementTuning) => {
      const nextMovementTuning = {
        ...currentMovementTuning,
        [key]: safeNextValue,
      };

      sceneApiRef.current?.setMovementTuning(nextMovementTuning);

      return nextMovementTuning;
    });
  }

  function resetMovementTuning() {
    setMovementTuning(DEFAULT_KART_MOVEMENT_TUNING);
    sceneApiRef.current?.setMovementTuning(DEFAULT_KART_MOVEMENT_TUNING);
  }

  function nudgeStartPosition(xDelta: number, zDelta: number) {
    updateStartPosition({
      x: toFixedStep(startPosition.x + xDelta),
      z: toFixedStep(startPosition.z + zDelta),
    });
  }

  function translateSelected(axis: TransformAxis, delta: number) {
    sceneApiRef.current?.translateSelected(axis, delta);
  }

  function rotateSelected(axis: TransformAxis, delta: number) {
    sceneApiRef.current?.rotateSelected(axis, delta);
  }

  function resetKart() {
    sceneApiRef.current?.resetKart();
  }

  function openEditorFromPause() {
    editorOpenRef.current = true;
    sceneApiRef.current?.setEditorMode(true);
    sceneApiRef.current?.setPaused(false);
    setGamePaused(false);
    setEditorOpen(true);
    setDriveCursorHidden(false);
    canvasRef.current?.focus();
  }

  function closeEditorToPause() {
    editorOpenRef.current = false;
    sceneApiRef.current?.setEditorMode(false);
    sceneApiRef.current?.setPaused(true);
    setEditorOpen(false);
    setGamePaused(true);
    setDriveCursorHidden(false);
  }

  function resumeRace() {
    sceneApiRef.current?.setPaused(false);
    setGamePaused(false);
    setDriveCursorHidden(true);
    canvasRef.current?.focus();
  }

  return (
    <main className="fixed inset-0 z-50 bg-black">
      <canvas
        ref={canvasRef}
        id="application"
        data-testid="solo-time-trial-canvas"
        aria-label="Solo Time Trial PlayCanvas test"
        tabIndex={0}
        className={`block h-[100dvh] w-[100dvw] ${
          driveCursorHidden &&
          !editorOpen &&
          !gamePaused &&
          sceneStatus === "ready"
            ? "cursor-none"
            : "cursor-default"
        }`}
        onBlur={() => setDriveCursorHidden(false)}
        onFocus={() => {
          setDriveCursorHidden(
            !editorOpenRef.current &&
              !gamePaused &&
              sceneStatus === "ready",
          );
        }}
        onPointerEnter={() => {
          setDriveCursorHidden(
            !editorOpenRef.current &&
              !gamePaused &&
              sceneStatus === "ready",
          );
        }}
        onPointerLeave={() => setDriveCursorHidden(false)}
        onPointerMove={() => {
          if (
            !editorOpenRef.current &&
            !gamePaused &&
            sceneStatus === "ready"
          ) {
            setDriveCursorHidden(true);
          }
        }}
      />
      {sceneStatus === "ready" ? (
        <>
          {editorOpen ? (
            <LiteEditorPanel
          editorOpen={editorOpen}
          movementTuning={movementTuning}
          onMovementTuningChange={updateMovementTuning}
          onMovementTuningReset={resetMovementTuning}
          onResetKart={resetKart}
          onRotateSelected={rotateSelected}
          onStartPositionChange={updateStartPosition}
          onStartPositionNudge={nudgeStartPosition}
          onToggleEditor={closeEditorToPause}
          onTranslateSelected={translateSelected}
          selectedObjectId={selectedObjectId}
          selectedPosition={selectedPosition}
          selectedRotation={selectedRotation}
          startPosition={startPosition}
            />
          ) : null}
          {gamePaused && !editorOpen ? (
            <div className="absolute inset-0 z-30 grid place-items-center bg-titan-black/72 px-6 text-center font-mono text-titan-ice backdrop-blur-sm">
              <div className="grid w-full max-w-sm gap-5 border border-titan-ice/20 bg-titan-black/94 p-7 shadow-[0_24px_90px_rgb(0_0_0/0.6)]">
                <div className="grid gap-2">
                  <p className="text-xs font-bold uppercase tracking-[0.2em] text-titan-hazard">
                    Paused
                  </p>
                  <p className="text-sm text-titan-ice/70">
                    Press Esc to resume
                  </p>
                </div>
                <div className="grid gap-3">
                  <button
                    type="button"
                    className="titan-button titan-button-primary"
                    onClick={resumeRace}
                  >
                    Resume
                  </button>
                  <button
                    type="button"
                    className="titan-button titan-button-secondary"
                    onClick={openEditorFromPause}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="titan-button titan-button-secondary"
                    onClick={onExit}
                  >
                    Exit
                  </button>
                </div>
              </div>
            </div>
          ) : null}
          {!editorOpen && !gamePaused ? (
            <div className="pointer-events-none absolute bottom-4 right-4 z-10 font-mono text-[0.68rem] font-bold uppercase tracking-[0.14em] text-titan-ice/55">
              Esc · Pause
            </div>
          ) : null}
        </>
      ) : (
        <div className="absolute inset-0 z-20 grid place-items-center bg-titan-black/88 px-6 text-center font-mono text-titan-ice">
          <div className="grid max-w-md gap-4 border border-titan-ice/20 bg-titan-black p-6 shadow-[0_20px_70px_rgb(0_0_0/0.5)]">
            {sceneStatus === "initializing" ? (
              <p role="status" aria-live="polite">
                Preparing kart physics…
              </p>
            ) : (
              <div className="grid gap-3" role="alert" aria-live="assertive">
                <p className="font-bold uppercase tracking-[0.12em] text-titan-hazard">
                  Unable to start the race
                </p>
                <p className="text-sm text-titan-ice/78">
                  The kart physics engine could not load. Reload the app, or
                  return to mode selection.
                </p>
              </div>
            )}
            <div className="flex flex-wrap justify-center gap-3">
              {sceneStatus === "failed" ? (
                <button
                  type="button"
                  className="titan-button titan-button-primary"
                  onClick={() => window.location.reload()}
                >
                  Reload
                </button>
              ) : null}
              <button
                type="button"
                className="titan-button titan-button-secondary"
                onClick={onExit}
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
