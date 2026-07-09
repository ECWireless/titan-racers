"use client";

import * as pc from "playcanvas";
import { useEffect, useRef, useState } from "react";

const START_POSITION = new pc.Vec3(0, 0, 0);
const START_YAW = 90;
const START_NUDGE_STEP = 0.5;
const ROTATE_NUDGE_STEP = 15;
const KART_GROUND_Y = 0;
const KART_MAX_FORWARD_SPEED = 8.5;
const KART_MAX_REVERSE_SPEED = 3.4;
const KART_ACCELERATION = 9.5;
const KART_BRAKE_FORCE = 14;
const KART_DRAG = 4.2;
const KART_TURN_RATE = 116;
const KART_BRAKE_TURN_MULTIPLIER = 1.18;
const KART_GRAVITY = 18;
const KART_FRONT_AXLE_OFFSET = 0.58;
const KART_MAX_STEER_ANGLE = 28;
const KART_RESET_FALL_Y = -10;
const CAMERA_FOLLOW_DISTANCE = 6;
const CAMERA_HEIGHT = 3;
const CAMERA_LOOK_AHEAD = 2;
const MOBILE_CAMERA_FOLLOW_DISTANCE = 8.5;
const MOBILE_CAMERA_HEIGHT = 4.2;
const MOBILE_CAMERA_LOOK_AHEAD = 2.8;
const DESKTOP_CAMERA_FOV = 45;
const MOBILE_CAMERA_FOV = 58;
const CAMERA_TURN_LOOK_OFFSET = 0.85;
const CAMERA_TURN_YAW_BIAS = 15;
const CAMERA_POSITION_SHARPNESS = 5.5;
const CAMERA_LOOK_SHARPNESS = 8;
const EDITOR_CAMERA_START_DISTANCE = 28;
const EDITOR_CAMERA_MIN_DISTANCE = 4;
const EDITOR_CAMERA_MAX_DISTANCE = 56;
const EDITOR_CAMERA_PAN_SPEED = 5;
const EDITOR_CAMERA_FAST_MULTIPLIER = 2.5;
const EDITOR_CAMERA_ORBIT_SPEED = 0.25;
const EDITOR_CAMERA_PAN_PIXEL_SCALE = 0.0015;
const COURSE_CENTER_Z = 8;
const COURSE_TURN_RADIUS = 8;
const COURSE_HALF_STRAIGHT = 20;
const COURSE_ROAD_WIDTH = 8;
const GROUND_WIDTH = 72;
const GROUND_DEPTH = 48;
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

function smoothFactor(sharpness: number, dt: number) {
  return 1 - Math.exp(-sharpness * dt);
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

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function approachValue(current: number, target: number, maxDelta: number) {
  if (current < target) {
    return Math.min(current + maxDelta, target);
  }

  return Math.max(current - maxDelta, target);
}

function toFixedStep(value: number) {
  return Number(value.toFixed(2));
}

type StartPosition = {
  x: number;
  z: number;
};

type Position3 = {
  x: number;
  y: number;
  z: number;
};

type KartMovementTuning = typeof DEFAULT_KART_MOVEMENT_TUNING;

type KartMovementTuningKey = keyof KartMovementTuning;

const KART_MOVEMENT_TUNING_MINIMUMS: Record<KartMovementTuningKey, number> = {
  acceleration: 0.5,
  brakeForce: 0.5,
  drag: 0,
  gravity: 0,
  maxForwardSpeed: 0.5,
  maxReverseSpeed: 0.5,
  turnRate: 1,
};

type TransformAxis = "x" | "y" | "z";

type ObstacleObjectId =
  | "obstacle-concrete-block-a"
  | "obstacle-barrel-a"
  | "obstacle-concrete-block-b"
  | "obstacle-barrel-b";

type EditableObjectId = "start-position" | "kart" | ObstacleObjectId;

type CollisionObstacle = {
  id: ObstacleObjectId;
  x: number;
  z: number;
  radius: number;
};

const EDITABLE_OBJECT_LABELS: Record<EditableObjectId, string> = {
  "obstacle-barrel-a": "Barrel A",
  "obstacle-barrel-b": "Barrel B",
  "obstacle-concrete-block-a": "Block A",
  "obstacle-concrete-block-b": "Block B",
  "start-position": "Start Position",
  kart: "Kart",
};

type SceneApi = {
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

export function SoloTimeTrialCanvas() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sceneApiRef = useRef<SceneApi | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
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
    const app = new pc.Application(activeCanvas);
    app.setCanvasResolution(pc.RESOLUTION_AUTO);
    app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
    app.start();
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

    const collisionObstacles: CollisionObstacle[] = [];
    const obstacleEntities = new Map<ObstacleObjectId, pc.Entity>();

    function addCollisionObstacle(
      id: ObstacleObjectId,
      position: pc.Vec3,
      radius: number,
    ) {
      collisionObstacles.push({
        id,
        radius,
        x: position.x,
        z: position.z,
      });
    }

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

    function createCylinder(
      name: string,
      position: pc.Vec3,
      scale: pc.Vec3,
      material: pc.StandardMaterial,
    ) {
      const entity = new pc.Entity(name);
      entity.addComponent("model", {
        type: "cylinder",
      });
      entity.setPosition(position);
      entity.setLocalScale(scale);
      const meshInstances = entity.model?.meshInstances;
      meshInstances?.forEach((meshInstance) => {
        meshInstance.material = material;
      });
      app.root.addChild(entity);

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
      entity.addComponent("model", {
        type: "cone",
      });
      entity.setPosition(position);
      entity.setEulerAngles(eulerAngles);
      entity.setLocalScale(scale);
      const meshInstances = entity.model?.meshInstances;
      meshInstances?.forEach((meshInstance) => {
        meshInstance.material = material;
      });
      app.root.addChild(entity);

      return entity;
    }

    createBox(
      "ground",
      new pc.Vec3(0, -0.06, COURSE_CENTER_Z),
      new pc.Vec3(GROUND_WIDTH, 0.1, GROUND_DEPTH),
      groundMaterial,
    );

    function createPillCourse() {
      const outerRadius = COURSE_TURN_RADIUS + COURSE_ROAD_WIDTH / 2;
      const innerRadius = COURSE_TURN_RADIUS - COURSE_ROAD_WIDTH / 2;

      createBox(
        "course-outer-straight",
        new pc.Vec3(0, 0.01, COURSE_CENTER_Z),
        new pc.Vec3(COURSE_HALF_STRAIGHT * 2, 0.08, outerRadius * 2),
        asphaltMaterial,
      );
      createCylinder(
        "course-left-cap",
        new pc.Vec3(-COURSE_HALF_STRAIGHT, 0.01, COURSE_CENTER_Z),
        new pc.Vec3(outerRadius * 2, 0.08, outerRadius * 2),
        asphaltMaterial,
      );
      createCylinder(
        "course-right-cap",
        new pc.Vec3(COURSE_HALF_STRAIGHT, 0.01, COURSE_CENTER_Z),
        new pc.Vec3(outerRadius * 2, 0.08, outerRadius * 2),
        asphaltMaterial,
      );

      createBox(
        "course-inner-straight",
        new pc.Vec3(0, 0.08, COURSE_CENTER_Z),
        new pc.Vec3(COURSE_HALF_STRAIGHT * 2, 0.08, innerRadius * 2),
        groundMaterial,
      );
      createCylinder(
        "course-left-cutout",
        new pc.Vec3(-COURSE_HALF_STRAIGHT, 0.08, COURSE_CENTER_Z),
        new pc.Vec3(innerRadius * 2, 0.08, innerRadius * 2),
        groundMaterial,
      );
      createCylinder(
        "course-right-cutout",
        new pc.Vec3(COURSE_HALF_STRAIGHT, 0.08, COURSE_CENTER_Z),
        new pc.Vec3(innerRadius * 2, 0.08, innerRadius * 2),
        groundMaterial,
      );

      createBox(
        "start-finish-line",
        new pc.Vec3(0, 0.14, 0),
        new pc.Vec3(0.18, 0.08, COURSE_ROAD_WIDTH + 0.4),
        lineMaterial,
      );
    }

    createPillCourse();

    function createObstacleSet() {
      const blockOnePosition = new pc.Vec3(8, 0.42, -1.45);
      const blockOne = createBox(
        "obstacle-concrete-block-a",
        blockOnePosition,
        new pc.Vec3(1.5, 0.7, 1),
        obstacleBlockMaterial,
        18,
      );
      obstacleEntities.set("obstacle-concrete-block-a", blockOne);
      addCollisionObstacle("obstacle-concrete-block-a", blockOnePosition, 1.05);

      const barrelOnePosition = new pc.Vec3(14.5, 0.46, 2);
      const barrelOne = createCylinder(
        "obstacle-barrel-a",
        barrelOnePosition,
        new pc.Vec3(0.9, 0.9, 0.9),
        obstacleBarrelMaterial,
      );
      obstacleEntities.set("obstacle-barrel-a", barrelOne);
      addCollisionObstacle("obstacle-barrel-a", barrelOnePosition, 0.9);

      const blockTwoPosition = new pc.Vec3(-9, 0.42, 16.4);
      const blockTwo = createBox(
        "obstacle-concrete-block-b",
        blockTwoPosition,
        new pc.Vec3(1.2, 0.7, 1.45),
        obstacleBlockMaterial,
        -22,
      );
      obstacleEntities.set("obstacle-concrete-block-b", blockTwo);
      addCollisionObstacle("obstacle-concrete-block-b", blockTwoPosition, 1);

      const barrelTwoPosition = new pc.Vec3(20.6, 0.46, 8.4);
      const barrelTwo = createCylinder(
        "obstacle-barrel-b",
        barrelTwoPosition,
        new pc.Vec3(0.85, 0.9, 0.85),
        obstacleBarrelMaterial,
      );
      obstacleEntities.set("obstacle-barrel-b", barrelTwo);
      addCollisionObstacle("obstacle-barrel-b", barrelTwoPosition, 0.85);
    }

    createObstacleSet();

    const startMarker = createBox(
      "start-position",
      new pc.Vec3(START_POSITION.x, 0.14, START_POSITION.z),
      new pc.Vec3(2.2, 0.04, 1.6),
      markerMaterial,
      START_YAW,
    );

    const kart = new pc.Entity("box-kart");
    kart.setPosition(START_POSITION);
    kart.setEulerAngles(0, START_YAW, 0);
    app.root.addChild(kart);
    const currentStartPosition = START_POSITION.clone();
    const currentStartRotation = new pc.Vec3(0, START_YAW, 0);

    const body = createBox(
      "kart-body",
      new pc.Vec3(0, 0.35, 0),
      new pc.Vec3(1.25, 0.45, 1.85),
      kartMaterial,
    );
    const cockpit = createBox(
      "kart-cockpit",
      new pc.Vec3(0, 0.78, -0.2),
      new pc.Vec3(0.72, 0.42, 0.78),
      cockpitMaterial,
    );
    kart.addChild(body);
    kart.addChild(cockpit);

    const frontWheelPivots: pc.Entity[] = [];

    ([
      ["front-left", -0.78, -0.58],
      ["front-right", 0.78, -0.58],
      ["rear-left", -0.78, 0.62],
      ["rear-right", 0.78, 0.62],
    ] satisfies [string, number, number][]).forEach(([name, x, z]) => {
      const wheelPivot = new pc.Entity(`kart-wheel-pivot-${name}`);
      wheelPivot.setLocalPosition(x, 0.26, z);
      kart.addChild(wheelPivot);

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

      if (name.startsWith("front")) {
        frontWheelPivots.push(wheelPivot);
      }
    });

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

    const light = new pc.Entity();
    light.addComponent("light");
    light.setEulerAngles(45, 45, 0);
    app.root.addChild(light);

    const pressedKeys = new Set<string>();

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
    const kartController = {
      speed: 0,
      steerAngle: 0,
      verticalVelocity: 0,
    };

    function updateFrontWheelSteering(steerAngle: number) {
      kartController.steerAngle = steerAngle;
      frontWheelPivots.forEach((wheelPivot) => {
        wheelPivot.setLocalEulerAngles(0, steerAngle, 0);
      });
    }

    function rotateKartAroundSteeringAxle(yawDelta: number) {
      const frontAxlePosition = kart
        .getPosition()
        .clone()
        .add(kart.forward.clone().mulScalar(KART_FRONT_AXLE_OFFSET));

      kart.rotate(0, yawDelta, 0);

      const movedFrontAxlePosition = kart
        .getPosition()
        .clone()
        .add(kart.forward.clone().mulScalar(KART_FRONT_AXLE_OFFSET));

      kart.setPosition(
        kart
          .getPosition()
          .clone()
          .add(frontAxlePosition.sub(movedFrontAxlePosition)),
      );
    }

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
          obstacleEntity.setEulerAngles(nextRotation);
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
          obstacleEntity.setPosition(nextPosition);
          syncObstacleCollision(
            selectedEditableObjectId as ObstacleObjectId,
            nextPosition,
          );
        }
      } else {
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
      kart.setPosition(currentStartPosition);
      kart.setEulerAngles(
        currentStartRotation.x,
        currentStartRotation.y,
        currentStartRotation.z,
      );
      kartController.speed = 0;
      kartController.verticalVelocity = 0;
      updateFrontWheelSteering(0);
      pressedKeys.clear();
      if (isEditorMode) {
        frameStartPosition();
        syncSelectedPosition();
        syncSelectedRotation();
        updateSelectionMarker();
      } else {
        updateCamera(1, 0);
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
      kartController.speed = 0;
      kartController.verticalVelocity = 0;
      updateFrontWheelSteering(0);
      pressedKeys.clear();

      if (isEditorMode) {
        frameStartPosition();
        updateSelectionMarker();
      } else {
        activeEditorDrag = null;
        updateSelectionMarker();
        updateCamera(1, 0);
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

    function isOverGroundPlane(position: pc.Vec3) {
      const groundHalfWidth = GROUND_WIDTH / 2;
      const groundHalfDepth = GROUND_DEPTH / 2;

      return (
        position.x >= -groundHalfWidth &&
        position.x <= groundHalfWidth &&
        position.z >= COURSE_CENTER_Z - groundHalfDepth &&
        position.z <= COURSE_CENTER_Z + groundHalfDepth
      );
    }

    function setSceneMovementTuning(nextMovementTuning: KartMovementTuning) {
      activeMovementTuning = { ...nextMovementTuning };
      kartController.speed = clamp(
        kartController.speed,
        -activeMovementTuning.maxReverseSpeed,
        activeMovementTuning.maxForwardSpeed,
      );
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

    const movementKeys = new Set([
      "ArrowUp",
      "ArrowDown",
      "ArrowLeft",
      "ArrowRight",
      "KeyW",
      "KeyA",
      "KeyS",
      "KeyD",
      "KeyR",
      "KeyF",
      "ShiftLeft",
      "ShiftRight",
    ]);

    const onKeyDown = (event: KeyboardEvent) => {
      if (!movementKeys.has(event.code)) {
        return;
      }

      event.preventDefault();

      if (event.code === "KeyR") {
        resetKart();
        return;
      }

      if (event.code === "KeyF" && isEditorMode) {
        frameStartPosition();
        return;
      }

      pressedKeys.add(event.code);
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (!movementKeys.has(event.code)) {
        return;
      }

      event.preventDefault();
      pressedKeys.delete(event.code);
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

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
          translateSelected(pickedGizmoAxis, START_NUDGE_STEP);
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

    const onGetTranslateGizmoPoint = (event: Event) => {
      const customEvent = event as CustomEvent<{
        axis: TransformAxis;
        respond: (point: { x: number; y: number } | null) => void;
      }>;

      customEvent.detail.respond(
        getTranslateGizmoScreenPoint(customEvent.detail.axis),
      );
    };

    const onGetEditableObjectPoint = (event: Event) => {
      const customEvent = event as CustomEvent<{
        objectId: EditableObjectId;
        respond: (point: { x: number; y: number } | null) => void;
      }>;

      customEvent.detail.respond(
        getEditableObjectScreenPoint(customEvent.detail.objectId),
      );
    };

    const onGetCollisionDebugState = (event: Event) => {
      const customEvent = event as CustomEvent<{
        respond: (state: {
          blockAX: number | null;
          obstacleBlocksKart: boolean;
          obstacleCount: number;
          startClear: boolean;
        }) => void;
      }>;
      const firstObstacle = collisionObstacles[0];
      const blockA = collisionObstacles.find(
        (obstacle) => obstacle.id === "obstacle-concrete-block-a",
      );

      customEvent.detail.respond({
        blockAX: blockA ? toFixedStep(blockA.x) : null,
        obstacleBlocksKart: firstObstacle
          ? collidesWithObstacle(new pc.Vec3(firstObstacle.x, 0, firstObstacle.z))
          : false,
        obstacleCount: collisionObstacles.length,
        startClear: !collidesWithObstacle(START_POSITION),
      });
    };

    const onGetKartDebugState = (event: Event) => {
      const customEvent = event as CustomEvent<{
        respond: (state: {
          isOverGround: boolean;
          maxForwardSpeed: number;
          speed: number;
          steerAngle: number;
          verticalVelocity: number;
          x: number;
          y: number;
          z: number;
        }) => void;
      }>;
      const kartPosition = kart.getPosition();

      customEvent.detail.respond({
        isOverGround: isOverGroundPlane(kartPosition),
        maxForwardSpeed: toFixedStep(activeMovementTuning.maxForwardSpeed),
        speed: toFixedStep(kartController.speed),
        steerAngle: toFixedStep(kartController.steerAngle),
        verticalVelocity: toFixedStep(kartController.verticalVelocity),
        x: toFixedStep(kartPosition.x),
        y: toFixedStep(kartPosition.y),
        z: toFixedStep(kartPosition.z),
      });
    };

    const onSetKartDebugPosition = (event: Event) => {
      const customEvent = event as CustomEvent<{
        position: Position3;
      }>;

      kart.setPosition(
        customEvent.detail.position.x,
        customEvent.detail.position.y,
        customEvent.detail.position.z,
      );
      kartController.speed = 0;
      kartController.verticalVelocity = 0;
      updateCamera(1, 0);
    };

    activeCanvas.addEventListener("contextmenu", onContextMenu);
    activeCanvas.addEventListener("pointerdown", onPointerDown);
    activeCanvas.addEventListener("pointermove", onPointerMove);
    activeCanvas.addEventListener("pointerup", onPointerUp);
    activeCanvas.addEventListener("pointercancel", onPointerUp);
    activeCanvas.addEventListener("wheel", onWheel, { passive: false });
    activeCanvas.addEventListener(
      "getTranslateGizmoPoint",
      onGetTranslateGizmoPoint,
    );
    activeCanvas.addEventListener(
      "getEditableObjectPoint",
      onGetEditableObjectPoint,
    );
    activeCanvas.addEventListener(
      "getCollisionDebugState",
      onGetCollisionDebugState,
    );
    activeCanvas.addEventListener("getKartDebugState", onGetKartDebugState);
    activeCanvas.addEventListener("setKartDebugPosition", onSetKartDebugPosition);

    const smoothedCameraPosition = new pc.Vec3();
    const smoothedLookTarget = new pc.Vec3();
    const desiredCameraPosition = new pc.Vec3();
    const desiredLookTarget = new pc.Vec3();

    function getChaseCameraSettings() {
      const isPortrait =
        activeCanvas.clientHeight > activeCanvas.clientWidth * 1.15;

      return {
        distance: isPortrait
          ? MOBILE_CAMERA_FOLLOW_DISTANCE
          : CAMERA_FOLLOW_DISTANCE,
        fov: isPortrait ? MOBILE_CAMERA_FOV : DESKTOP_CAMERA_FOV,
        height: isPortrait ? MOBILE_CAMERA_HEIGHT : CAMERA_HEIGHT,
        lookAhead: isPortrait
          ? MOBILE_CAMERA_LOOK_AHEAD
          : CAMERA_LOOK_AHEAD,
      };
    }

    function updateCamera(dt: number, turnDirection: number) {
      const cameraComponent = camera.camera;
      const cameraSettings = getChaseCameraSettings();
      const kartPosition = kart.getPosition();
      const kartForward = kart.forward.clone().normalize();
      const kartRight = kart.right.clone().normalize();
      const biasedForward = rotateY(
        kartForward,
        turnDirection * CAMERA_TURN_YAW_BIAS,
      ).normalize();

      if (cameraComponent) {
        cameraComponent.fov = cameraSettings.fov;
      }

      desiredCameraPosition
        .copy(kartPosition)
        .sub(biasedForward.mulScalar(cameraSettings.distance));
      desiredCameraPosition.y += cameraSettings.height;
      desiredCameraPosition.add(
        kartRight.mulScalar(turnDirection * CAMERA_TURN_LOOK_OFFSET),
      );

      desiredLookTarget
        .copy(kartPosition)
        .add(kartForward.mulScalar(cameraSettings.lookAhead));
      desiredLookTarget.y += 0.45;
      desiredLookTarget.add(
        kartRight.mulScalar(turnDirection * CAMERA_TURN_LOOK_OFFSET),
      );

      smoothedCameraPosition.lerp(
        smoothedCameraPosition,
        desiredCameraPosition,
        smoothFactor(CAMERA_POSITION_SHARPNESS, dt),
      );
      smoothedLookTarget.lerp(
        smoothedLookTarget,
        desiredLookTarget,
        smoothFactor(CAMERA_LOOK_SHARPNESS, dt),
      );

      camera.setPosition(smoothedCameraPosition);
      camera.lookAt(smoothedLookTarget);
    }

    updateCamera(1, 0);

    app.on("update", (dt) => {
      if (isEditorMode) {
        const moveSpeed =
          EDITOR_CAMERA_PAN_SPEED *
          (pressedKeys.has("ShiftLeft") || pressedKeys.has("ShiftRight")
            ? EDITOR_CAMERA_FAST_MULTIPLIER
            : 1);
        const lateralDirection =
          Number(pressedKeys.has("ArrowRight") || pressedKeys.has("KeyD")) -
          Number(pressedKeys.has("ArrowLeft") || pressedKeys.has("KeyA"));
        const forwardDirection =
          Number(pressedKeys.has("ArrowUp") || pressedKeys.has("KeyW")) -
          Number(pressedKeys.has("ArrowDown") || pressedKeys.has("KeyS"));

        if (lateralDirection !== 0 || forwardDirection !== 0) {
          panEditorCamera(
            lateralDirection * moveSpeed * dt,
            forwardDirection * moveSpeed * dt,
          );
        }

        return;
      }

      const turnDirection =
        Number(pressedKeys.has("ArrowLeft") || pressedKeys.has("KeyA")) -
        Number(pressedKeys.has("ArrowRight") || pressedKeys.has("KeyD"));
      const throttleDirection =
        Number(pressedKeys.has("ArrowUp") || pressedKeys.has("KeyW")) -
        Number(pressedKeys.has("ArrowDown") || pressedKeys.has("KeyS"));
      const isBraking =
        throttleDirection < 0 && kartController.speed > 0.1;
      const targetSpeed =
        throttleDirection > 0
          ? activeMovementTuning.maxForwardSpeed
          : throttleDirection < 0
            ? -activeMovementTuning.maxReverseSpeed
            : 0;
      const acceleration =
        isBraking || throttleDirection < 0
          ? activeMovementTuning.brakeForce
          : throttleDirection > 0
            ? activeMovementTuning.acceleration
            : activeMovementTuning.drag;

      kartController.speed = approachValue(
        kartController.speed,
        targetSpeed,
        acceleration * dt,
      );

      const steerAngle = turnDirection * KART_MAX_STEER_ANGLE;
      updateFrontWheelSteering(steerAngle);

      if (turnDirection !== 0) {
        const speedRatio = clamp(
          Math.abs(kartController.speed) / activeMovementTuning.maxForwardSpeed,
          throttleDirection !== 0 ? 0.28 : 0,
          1,
        );
        const reverseSteering = kartController.speed < -0.1 ? -1 : 1;
        const brakeTurnBoost = isBraking ? KART_BRAKE_TURN_MULTIPLIER : 1;

        rotateKartAroundSteeringAxle(
          turnDirection *
            reverseSteering *
            activeMovementTuning.turnRate *
            speedRatio *
            brakeTurnBoost *
            dt,
        );
        updateSelectionMarker();
      }

      const nextPosition = kart
        .getPosition()
        .clone()
        .add(kart.forward.clone().mulScalar(kartController.speed * dt));
      kartController.verticalVelocity -= activeMovementTuning.gravity * dt;
      nextPosition.y += kartController.verticalVelocity * dt;

      if (isOverGroundPlane(nextPosition) && nextPosition.y <= KART_GROUND_Y) {
        nextPosition.y = KART_GROUND_Y;
        kartController.verticalVelocity = 0;
      }

      if (nextPosition.y <= KART_RESET_FALL_Y) {
        resetKart();
        return;
      }

      if (Math.abs(kartController.speed) > 0.01) {
        if (!collidesWithObstacle(nextPosition)) {
          kart.setPosition(nextPosition);
        } else {
          kartController.speed = 0;
        }
      } else if (kart.getPosition().y !== nextPosition.y) {
        kart.setPosition(nextPosition);
      }

      updateCamera(dt, turnDirection);
    });

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      activeCanvas.removeEventListener("contextmenu", onContextMenu);
      activeCanvas.removeEventListener("pointerdown", onPointerDown);
      activeCanvas.removeEventListener("pointermove", onPointerMove);
      activeCanvas.removeEventListener("pointerup", onPointerUp);
      activeCanvas.removeEventListener("pointercancel", onPointerUp);
      activeCanvas.removeEventListener("wheel", onWheel);
      activeCanvas.removeEventListener(
        "getTranslateGizmoPoint",
        onGetTranslateGizmoPoint,
      );
      activeCanvas.removeEventListener(
        "getEditableObjectPoint",
        onGetEditableObjectPoint,
      );
      activeCanvas.removeEventListener(
        "getCollisionDebugState",
        onGetCollisionDebugState,
      );
      activeCanvas.removeEventListener(
        "getKartDebugState",
        onGetKartDebugState,
      );
      activeCanvas.removeEventListener(
        "setKartDebugPosition",
        onSetKartDebugPosition,
      );
      sceneApiRef.current = null;
      app.destroy();
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
      <div className="pointer-events-none fixed bottom-4 left-4 top-auto z-10 max-h-[42dvh] w-[min(21rem,calc(100vw-2rem))] overflow-y-auto font-mono sm:bottom-auto sm:top-4 sm:max-h-[calc(100dvh-2rem)] sm:overflow-y-auto">
        <div className="pointer-events-auto border border-titan-ice/20 bg-titan-black/82 p-3 shadow-[0_20px_70px_rgb(0_0_0/0.45)] backdrop-blur">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-titan-hazard">
              Lite Editor
            </p>
            <button
              type="button"
              className="border border-titan-ice/25 px-3 py-2 text-xs font-bold uppercase tracking-[0.14em] text-titan-ice/86 transition hover:border-titan-hazard hover:text-titan-hazard focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-titan-hazard"
              onClick={toggleEditorMode}
            >
              {editorOpen ? "Drive" : "Edit"}
            </button>
          </div>

          {editorOpen ? (
            <div className="mt-3 grid gap-3">
              <div className="border border-titan-ice/15 bg-titan-ice/[0.04] px-3 py-2">
                <p className="text-[0.68rem] font-bold uppercase tracking-[0.14em] text-titan-muted">
                  Selected
                </p>
                <p
                  className="mt-1 text-sm font-bold text-titan-ice"
                  data-testid="selected-editor-object"
                >
                  {EDITABLE_OBJECT_LABELS[selectedObjectId]}
                </p>
                <div className="mt-2 grid grid-cols-3 gap-2 text-[0.68rem] font-bold uppercase tracking-[0.1em] text-titan-muted">
                  <span data-testid="selected-position-x">
                    X {selectedPosition.x}
                  </span>
                  <span data-testid="selected-position-y">
                    Y {selectedPosition.y}
                  </span>
                  <span data-testid="selected-position-z">
                    Z {selectedPosition.z}
                  </span>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2 text-[0.68rem] font-bold uppercase tracking-[0.1em] text-titan-muted">
                  <span data-testid="selected-rotation-x">
                    RX {selectedRotation.x}
                  </span>
                  <span data-testid="selected-rotation-y">
                    RY {selectedRotation.y}
                  </span>
                  <span data-testid="selected-rotation-z">
                    RZ {selectedRotation.z}
                  </span>
                </div>
              </div>

              <div className="grid gap-2 border border-titan-ice/15 bg-titan-ice/[0.04] p-2">
                <p className="text-[0.68rem] font-bold uppercase tracking-[0.14em] text-titan-muted">
                  Translate
                </p>
                <div className="grid grid-cols-3 gap-2">
                  {(["x", "y", "z"] satisfies TransformAxis[]).map((axis) => (
                    <div key={axis} className="grid grid-cols-2 gap-1">
                      <button
                        type="button"
                        aria-label={`Move selected negative ${axis.toUpperCase()}`}
                        className="h-9 border border-titan-ice/20 text-xs font-bold uppercase text-titan-ice/86 hover:border-titan-hazard hover:text-titan-hazard focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-titan-hazard"
                        onClick={() =>
                          translateSelected(axis, -START_NUDGE_STEP)
                        }
                      >
                        {axis}-
                      </button>
                      <button
                        type="button"
                        aria-label={`Move selected positive ${axis.toUpperCase()}`}
                        className="h-9 border border-titan-ice/20 text-xs font-bold uppercase text-titan-ice/86 hover:border-titan-hazard hover:text-titan-hazard focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-titan-hazard"
                        onClick={() =>
                          translateSelected(axis, START_NUDGE_STEP)
                        }
                      >
                        {axis}+
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid gap-2 border border-titan-ice/15 bg-titan-ice/[0.04] p-2">
                <p className="text-[0.68rem] font-bold uppercase tracking-[0.14em] text-titan-muted">
                  Rotate
                </p>
                <div className="grid grid-cols-3 gap-2">
                  {(["x", "y", "z"] satisfies TransformAxis[]).map((axis) => (
                    <div key={axis} className="grid grid-cols-2 gap-1">
                      <button
                        type="button"
                        aria-label={`Rotate selected negative ${axis.toUpperCase()}`}
                        className="h-9 border border-titan-ice/20 text-xs font-bold uppercase text-titan-ice/86 hover:border-titan-hazard hover:text-titan-hazard focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-titan-hazard"
                        onClick={() =>
                          rotateSelected(axis, -ROTATE_NUDGE_STEP)
                        }
                      >
                        {axis}-
                      </button>
                      <button
                        type="button"
                        aria-label={`Rotate selected positive ${axis.toUpperCase()}`}
                        className="h-9 border border-titan-ice/20 text-xs font-bold uppercase text-titan-ice/86 hover:border-titan-hazard hover:text-titan-hazard focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-titan-hazard"
                        onClick={() =>
                          rotateSelected(axis, ROTATE_NUDGE_STEP)
                        }
                      >
                        {axis}+
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid gap-2 border border-titan-ice/15 bg-titan-ice/[0.04] p-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[0.68rem] font-bold uppercase tracking-[0.14em] text-titan-muted">
                    Movement
                  </p>
                  <button
                    type="button"
                    className="border border-titan-ice/20 px-2 py-1 text-[0.62rem] font-bold uppercase tracking-[0.1em] text-titan-ice/78 hover:border-titan-hazard hover:text-titan-hazard focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-titan-hazard"
                    onClick={resetMovementTuning}
                  >
                    Defaults
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {(
                    [
                      ["maxForwardSpeed", "Max", 0.5, 0.5],
                      ["acceleration", "Accel", 0.5, 0.5],
                      ["brakeForce", "Brake", 0.5, 0.5],
                      ["drag", "Drag", 0.1, 0],
                      ["turnRate", "Turn", 1, 1],
                      ["gravity", "Gravity", 0.5, 0],
                    ] satisfies [
                      KartMovementTuningKey,
                      string,
                      number,
                      number,
                    ][]
                  ).map(([key, label, step, min]) => (
                    <label
                      key={key}
                      className="grid min-w-0 gap-1 text-[0.62rem] font-bold uppercase tracking-[0.1em] text-titan-muted"
                    >
                      {label}
                      <input
                        className="h-9 w-full min-w-0 border border-titan-ice/20 bg-titan-black px-2 text-sm text-titan-ice outline-none focus:border-titan-hazard"
                        data-testid={`movement-${key}`}
                        inputMode="decimal"
                        min={min}
                        type="number"
                        step={step}
                        value={movementTuning[key]}
                        onChange={(event) =>
                          updateMovementTuning(key, Number(event.target.value))
                        }
                      />
                    </label>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2">
                <label className="grid min-w-0 gap-1 text-[0.68rem] font-bold uppercase tracking-[0.14em] text-titan-muted">
                  X
                  <input
                    className="h-10 w-full min-w-0 border border-titan-ice/20 bg-titan-black px-2 text-sm text-titan-ice outline-none focus:border-titan-hazard"
                    data-testid="start-position-x"
                    inputMode="decimal"
                    type="number"
                    step={START_NUDGE_STEP}
                    value={startPosition.x}
                    onChange={(event) =>
                      updateStartPosition({
                        x: Number(event.target.value),
                        z: startPosition.z,
                      })
                    }
                  />
                </label>
                <label className="grid min-w-0 gap-1 text-[0.68rem] font-bold uppercase tracking-[0.14em] text-titan-muted">
                  Z
                  <input
                    className="h-10 w-full min-w-0 border border-titan-ice/20 bg-titan-black px-2 text-sm text-titan-ice outline-none focus:border-titan-hazard"
                    data-testid="start-position-z"
                    inputMode="decimal"
                    type="number"
                    step={START_NUDGE_STEP}
                    value={startPosition.z}
                    onChange={(event) =>
                      updateStartPosition({
                        x: startPosition.x,
                        z: Number(event.target.value),
                      })
                    }
                  />
                </label>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <span />
                <button
                  type="button"
                  aria-label="Move start position forward"
                  className="h-10 border border-titan-ice/20 text-sm font-bold text-titan-ice/86 hover:border-titan-hazard hover:text-titan-hazard focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-titan-hazard"
                  onClick={() => nudgeStartPosition(0, -START_NUDGE_STEP)}
                >
                  ↑
                </button>
                <span />
                <button
                  type="button"
                  aria-label="Move start position left"
                  className="h-10 border border-titan-ice/20 text-sm font-bold text-titan-ice/86 hover:border-titan-hazard hover:text-titan-hazard focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-titan-hazard"
                  onClick={() => nudgeStartPosition(-START_NUDGE_STEP, 0)}
                >
                  ←
                </button>
                <button
                  type="button"
                  className="h-10 border border-titan-orange/70 bg-titan-orange px-2 text-[0.68rem] font-bold uppercase tracking-[0.12em] text-titan-black hover:bg-titan-hazard focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-titan-hazard"
                  onClick={resetKart}
                >
                  Reset
                </button>
                <button
                  type="button"
                  aria-label="Move start position right"
                  className="h-10 border border-titan-ice/20 text-sm font-bold text-titan-ice/86 hover:border-titan-hazard hover:text-titan-hazard focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-titan-hazard"
                  onClick={() => nudgeStartPosition(START_NUDGE_STEP, 0)}
                >
                  →
                </button>
                <span />
                <button
                  type="button"
                  aria-label="Move start position backward"
                  className="h-10 border border-titan-ice/20 text-sm font-bold text-titan-ice/86 hover:border-titan-hazard hover:text-titan-hazard focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-titan-hazard"
                  onClick={() => nudgeStartPosition(0, START_NUDGE_STEP)}
                >
                  ↓
                </button>
                <span />
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </main>
  );
}
