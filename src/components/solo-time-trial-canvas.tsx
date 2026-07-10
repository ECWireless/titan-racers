"use client";

import * as pc from "playcanvas";
import { useEffect, useRef, useState } from "react";

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
import { ChaseCamera } from "@/game/camera/chase-camera";
import { buildRoughCourse } from "@/game/course/build-rough-course";
import { EDITOR_TRANSLATE_STEP } from "@/game/editor/editor-config";
import { KeyboardInput } from "@/game/input/keyboard-input";
import {
  DynamicKartController,
  type DynamicWheel,
} from "@/game/kart/dynamic-kart-controller";
import {
  createPlayCanvasRuntime,
  loadAmmoPhysics,
} from "@/game/runtime/playcanvas-application";
import {
  calculateBoxInertia,
  setExplicitRigidBodyInertia,
} from "@/game/runtime/ammo-rigid-body";
import { attachSceneTestAdapter } from "@/game/testing/scene-test-adapter";

const START_POSITION = new pc.Vec3(0, 0, 0);
const START_YAW = 90;
const KART_ROOT_HEIGHT = 0.28;
const KART_MASS = 120;
const KART_CHASSIS_DIMENSIONS = { x: 1.25, y: 0.55, z: 1.85 } as const;
const KART_INERTIA = calculateBoxInertia(KART_MASS, KART_CHASSIS_DIMENSIONS);
const KART_MAX_FORWARD_SPEED = 8.5;
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
  onExit: () => void;
};

export function SoloTimeTrialCanvas({ onExit }: SoloTimeTrialCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const editorOpenRef = useRef(false);
  const sceneApiRef = useRef<SceneApi | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
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
    x: 0,
    y: START_YAW,
    z: 0,
  });
  const [startPosition, setStartPosition] = useState<StartPosition>({
    x: START_POSITION.x,
    z: START_POSITION.z,
  });
  const [movementTuning, setMovementTuning] = useState<KartMovementTuning>(
    DEFAULT_KART_MOVEMENT_TUNING,
  );

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
    const asphaltMaterial = createMaterial(new pc.Color(0.08, 0.08, 0.09));
    const lineMaterial = createMaterial(new pc.Color(0.95, 0.92, 0.86));
    const markerMaterial = createMaterial(new pc.Color(1, 0.85, 0.15));
    const groundMaterial = createMaterial(new pc.Color(0.08, 0.36, 0.26));
    const obstacleBlockMaterial = createMaterial(new pc.Color(0.82, 0.78, 0.68));
    const obstacleBarrelMaterial = createMaterial(new pc.Color(0.96, 0.45, 0.12));
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

    const { collisionObstacles, obstacleEntities } = buildRoughCourse(app, {
      asphalt: asphaltMaterial,
      ground: groundMaterial,
      line: lineMaterial,
      obstacleBarrel: obstacleBarrelMaterial,
      obstacleBlock: obstacleBlockMaterial,
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
      new pc.Vec3(START_POSITION.x, 0.14, START_POSITION.z),
      new pc.Vec3(2.2, 0.04, 1.6),
      markerMaterial,
      START_YAW,
    );

    const kart = new pc.Entity("box-kart");
    kart.setPosition(
      START_POSITION.x,
      START_POSITION.y + KART_ROOT_HEIGHT,
      START_POSITION.z,
    );
    kart.setEulerAngles(0, START_YAW, 0);
    kart.addComponent("collision", { type: "compound" });
    app.root.addChild(kart);
    const kartVisual = new pc.Entity("kart-visual");

    kart.addChild(kartVisual);
    const currentStartPosition = START_POSITION.clone();
    const currentStartRotation = new pc.Vec3(0, START_YAW, 0);

    createChildBox(
      kartVisual,
      "kart-body",
      new pc.Vec3(0, 0.07, 0),
      new pc.Vec3(1.25, 0.45, 1.85),
      kartMaterial,
    );
    createChildBox(
      kartVisual,
      "kart-cockpit",
      new pc.Vec3(0, 0.5, -0.2),
      new pc.Vec3(0.72, 0.42, 0.78),
      cockpitMaterial,
    );
    createChildCollisionBox(
      kart,
      "kart-body-collision",
      new pc.Vec3(0, 0.07, 0),
      new pc.Vec3(0.625, 0.225, 0.925),
    );
    createChildCollisionBox(
      kart,
      "kart-cockpit-collision",
      new pc.Vec3(0, 0.5, -0.2),
      new pc.Vec3(0.36, 0.21, 0.39),
    );

    const dynamicWheels: DynamicWheel[] = [];

    ([
      ["front-left", -0.78, -0.58],
      ["front-right", 0.78, -0.58],
      ["rear-left", -0.78, 0.62],
      ["rear-right", 0.78, 0.62],
    ] satisfies [string, number, number][]).forEach(([name, x, z]) => {
      const wheelPivot = new pc.Entity(`kart-wheel-pivot-${name}`);
      const localPosition = new pc.Vec3(x, -0.02, z);

      wheelPivot.setLocalPosition(localPosition);
      kartVisual.addChild(wheelPivot);

      createChildCylinder(
        wheelPivot,
        `kart-wheel-${name}`,
        new pc.Vec3(0, 0, 0),
        new pc.Vec3(0.42, 0.26, 0.42),
        wheelMaterial,
        new pc.Vec3(0, 0, 90),
      );
      createChildCylinder(
        wheelPivot,
        `kart-wheel-hub-${name}`,
        new pc.Vec3(0, 0, 0),
        new pc.Vec3(0.18, 0.28, 0.18),
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
    });

    kart.addComponent("rigidbody", {
      angularDamping: 0.08,
      friction: 0.12,
      linearDamping: 0.015,
      mass: KART_MASS,
      restitution: 0.04,
      type: pc.BODYTYPE_DYNAMIC,
    });
    setExplicitRigidBodyInertia(kart, KART_MASS, KART_INERTIA);

    const kartPresentation = {
      currentPosition: kart.getPosition().clone(),
      currentRotation: kart.getRotation().clone(),
      previousPosition: kart.getPosition().clone(),
      previousRotation: kart.getRotation().clone(),
    };
    const interpolatedKartPosition = new pc.Vec3();
    const interpolatedKartRotation = new pc.Quat();

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
      kartVisual.setLocalPosition(0, 0, 0);
      kartVisual.setLocalRotation(pc.Quat.IDENTITY);
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
    const chaseCamera = new ChaseCamera(camera, kartVisual, activeCanvas);

    const light = new pc.Entity();
    light.addComponent("light");
    light.setEulerAngles(45, 45, 0);
    app.root.addChild(light);

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

    function getEditableObjectPosition(objectId: EditableObjectId) {
      if (objectId === "kart") {
        return kart.getPosition();
      }

      const obstacleEntity = obstacleEntities.get(objectId as ObstacleObjectId);

      if (obstacleEntity) {
        return obstacleEntity.getPosition();
      }

      return currentStartPosition.clone();
    }

    function getEditableObjectRotation(objectId: EditableObjectId) {
      if (objectId === "kart") {
        return kart.getEulerAngles();
      }

      const obstacleEntity = obstacleEntities.get(objectId as ObstacleObjectId);

      if (obstacleEntity) {
        return obstacleEntity.getEulerAngles();
      }

      return currentStartRotation.clone();
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
        const kartPosition = kart.getPosition();
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
      if (selectedEditableObjectId === "kart") {
        const rotation = kart.getEulerAngles();
        const nextRotation = rotation.clone();

        nextRotation[axis] = toFixedStep(rotation[axis] + delta);
        kart.setEulerAngles(nextRotation);
      } else if (
        obstacleEntities.has(selectedEditableObjectId as ObstacleObjectId)
      ) {
        const obstacleEntity = obstacleEntities.get(
          selectedEditableObjectId as ObstacleObjectId,
        );

        if (obstacleEntity) {
          const rotation = obstacleEntity.getEulerAngles();
          const nextRotation = rotation.clone();

          nextRotation[axis] = toFixedStep(rotation[axis] + delta);
          editStaticRigidBody(obstacleEntity, () => {
            obstacleEntity.setEulerAngles(nextRotation);
          });
        }
      } else {
        currentStartRotation[axis] = toFixedStep(
          currentStartRotation[axis] + delta,
        );
        startMarker.setEulerAngles(
          currentStartRotation.x,
          currentStartRotation.y,
          currentStartRotation.z,
        );
      }

      syncSelectedRotation();
      updateSelectionMarker();
      activeCanvas.focus();
    }

    function translateSelected(axis: TransformAxis, delta: number) {
      if (selectedEditableObjectId === "kart") {
        const position = kart.getPosition();
        const nextPosition = position.clone();

        nextPosition[axis] = toFixedStep(position[axis] + delta);
        kart.setPosition(nextPosition);
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
        "obstacle-concrete-block-a",
        "obstacle-barrel-a",
        "obstacle-concrete-block-b",
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
        "obstacle-concrete-block-a",
        "obstacle-barrel-a",
        "obstacle-concrete-block-b",
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
      const resetPosition = new pc.Vec3(
        currentStartPosition.x,
        currentStartPosition.y + KART_ROOT_HEIGHT,
        currentStartPosition.z,
      );
      const resetRotation = new pc.Quat().setFromEulerAngles(
        currentStartRotation.x,
        currentStartRotation.y,
        currentStartRotation.z,
      );

      if (isEditorMode) {
        kart.setPosition(resetPosition);
        kart.setRotation(resetRotation);
      } else {
        kart.rigidbody?.teleport(resetPosition, resetRotation);
      }

      kartController.reset();
      snapKartPresentationState();
      keyboardInput.clear();
      if (isEditorMode) {
        frameStartPosition();
        syncSelectedPosition();
        syncSelectedRotation();
        updateSelectionMarker();
      } else {
        chaseCamera.update(1, 0);
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
      keyboardInput.clear();

      if (isEditorMode) {
        if (kart.rigidbody) {
          kart.rigidbody.type = pc.BODYTYPE_KINEMATIC;
        }
        frameStartPosition();
        updateSelectionMarker();
      } else {
        if (kart.rigidbody) {
          const editedPosition = kart.getPosition().clone();
          const editedRotation = kart.getRotation().clone();

          kart.rigidbody.type = pc.BODYTYPE_DYNAMIC;
          setExplicitRigidBodyInertia(kart, KART_MASS, KART_INERTIA);
          kart.rigidbody.teleport(editedPosition, editedRotation);
          kartController.reset();
          snapKartPresentationState();
        }
        activeEditorDrag = null;
        updateSelectionMarker();
        chaseCamera.update(1, 0);
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
      tuning: activeMovementTuning,
      wheels: dynamicWheels,
    });

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
      const blockA = collisionObstacles.find(
        (obstacle) => obstacle.id === "obstacle-concrete-block-a",
      );

      return {
        blockAX: blockA ? toFixedStep(blockA.x) : null,
        obstacleBlocksKart: firstObstacle
          ? collidesWithObstacle(new pc.Vec3(firstObstacle.x, 0, firstObstacle.z))
          : false,
        obstacleCount: collisionObstacles.length,
        startClear: !collidesWithObstacle(currentStartPosition),
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
        angularSpeed: toFixedStep(angularSpeed),
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
        verticalVelocity: toFixedStep(kartController.state.verticalVelocity),
        wheelLoads: Object.fromEntries(
          kartController.state.wheelTelemetry.map((wheel) => [
            wheel.name,
            toFixedStep(wheel.suspensionLoad),
          ]),
        ),
        x: toFixedStep(kartPosition.x),
        y: toFixedStep(kartPosition.y),
        z: toFixedStep(kartPosition.z),
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

    const setKartDebugPose = (pose: {
      angularVelocity?: Position3;
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
      chaseCamera.update(1, 0);
    };

    runtime.listen(activeCanvas, "contextmenu", onContextMenu);
    runtime.listen(activeCanvas, "pointerdown", onPointerDown);
    runtime.listen(activeCanvas, "pointermove", onPointerMove);
    runtime.listen(activeCanvas, "pointerup", onPointerUp);
    runtime.listen(activeCanvas, "pointercancel", onPointerUp);
    runtime.listen(activeCanvas, "wheel", onWheel, { passive: false });
    const detachSceneTestAdapter = ENABLE_SCENE_TEST_HOOKS
      ? attachSceneTestAdapter(activeCanvas, {
          getCollisionDebugState,
          getEditableObjectPoint: getEditableObjectScreenPoint,
          getKartDebugState,
          getPresentationDebugState,
          getTranslateGizmoPoint: getTranslateGizmoScreenPoint,
          setKartDebugPose,
          setSimulationPaused: (paused) => runtime.setPaused(paused),
          stepSimulation: (steps) => runtime.stepFixed(steps),
        })
      : () => undefined;
    runtime.addCleanup(detachSceneTestAdapter);

    chaseCamera.update(1, 0);

    runtime.onFixedStep((dt) => {
      if (!isEditorMode) {
        kartController.update(keyboardInput.getDrivingInput(), dt);
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
      kartVisual.setPosition(interpolatedKartPosition);
      kartVisual.setRotation(interpolatedKartRotation);

      if (!isEditorMode) {
        chaseCamera.update(
          frameSeconds,
          keyboardInput.getDrivingInput().steer,
        );
      }
    });

    app.on("update", (dt) => {
      captureKartPresentationState();

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
  }, []);

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

  function toggleEditorMode() {
    setEditorOpen((isOpen) => {
      const nextIsOpen = !isOpen;

      editorOpenRef.current = nextIsOpen;
      sceneApiRef.current?.setEditorMode(nextIsOpen);
      canvasRef.current?.focus();

      return nextIsOpen;
    });
  }

  return (
    <main className="fixed inset-0 z-50 bg-black">
      <canvas
        ref={canvasRef}
        id="application"
        data-testid="solo-time-trial-canvas"
        aria-label="Solo Time Trial PlayCanvas test"
        tabIndex={0}
        className="block h-[100dvh] w-[100dvw]"
      />
      {sceneStatus === "ready" ? (
        <LiteEditorPanel
          editorOpen={editorOpen}
          movementTuning={movementTuning}
          onMovementTuningChange={updateMovementTuning}
          onMovementTuningReset={resetMovementTuning}
          onResetKart={resetKart}
          onRotateSelected={rotateSelected}
          onStartPositionChange={updateStartPosition}
          onStartPositionNudge={nudgeStartPosition}
          onToggleEditor={toggleEditorMode}
          onTranslateSelected={translateSelected}
          selectedObjectId={selectedObjectId}
          selectedPosition={selectedPosition}
          selectedRotation={selectedRotation}
          startPosition={startPosition}
        />
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
