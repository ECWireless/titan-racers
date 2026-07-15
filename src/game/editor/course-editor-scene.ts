import * as pc from "playcanvas";

import { buildCourseLighting } from "../course/build-course-lighting";
import {
  buildRoughCourse,
  type CourseObjectProjection,
} from "../course/build-rough-course";
import type {
  CourseDocument,
  CourseVisualMaterial,
} from "../course/course-document";
import {
  type CourseEditorGeometry,
  type CourseEditorSelection,
  type CourseEditorSelections,
  getSelectionGeometry,
  updateObjectSelectionPositions,
  updateSelectionGeometry,
} from "./course-editor-document";

export type CourseEditorTool = "translate" | "rotate" | "scale";

type CourseEditorSceneOptions = {
  onDocumentChange: (label: string, document: CourseDocument) => void;
  onSelectionChange: (
    selection: CourseEditorSelection,
    additive: boolean,
  ) => void;
};

type PointerState = {
  button: number;
  currentX: number;
  currentY: number;
  gestureConsumed: boolean;
  moved: boolean;
  pointerType: string;
  previousX: number;
  previousY: number;
  startX: number;
  startY: number;
};

const CAMERA_MIN_DISTANCE = 8;
const CAMERA_MAX_DISTANCE = 90;
const POINTER_MOVE_THRESHOLD = 5;

export class CourseEditorScene {
  private readonly app: pc.Application;
  private readonly camera: pc.Entity;
  private readonly collisionMaterial = createMaterial(
    new pc.Color(1, 0.38, 0.04),
    0.92,
    true,
    1,
  );
  private readonly checkpointMaterial = createMaterial(
    new pc.Color(0.2, 0.65, 1),
    0.16,
  );
  private readonly gizmoLayer: pc.Layer;
  private readonly materials: Record<
    CourseVisualMaterial,
    pc.StandardMaterial
  >;
  private readonly picker: pc.Picker;
  private readonly pointers = new Map<number, PointerState>();
  private readonly resizeObserver: ResizeObserver;
  private readonly rotateGizmo: pc.RotateGizmo;
  private readonly scaleGizmo: pc.ScaleGizmo;
  private readonly selectionMaterial = createMaterial(
    new pc.Color(0.1, 0.82, 0.98),
    0.9,
    true,
  );
  private readonly startMaterial = createMaterial(
    new pc.Color(1, 0.78, 0.18),
    0.45,
  );
  private readonly selectionByNode = new Map<pc.GraphNode, CourseEditorSelection>();
  private readonly translateGizmo: pc.TranslateGizmo;
  private activeDocumentRoot: pc.Entity | null = null;
  private activeTransformDocument: CourseDocument | null = null;
  private canvas: HTMLCanvasElement;
  private collisionVisible = false;
  private currentDocument: CourseDocument;
  private documentEntities = new Map<string, pc.Entity>();
  private editorCamera = {
    distance: 34,
    pitch: 62,
    pivot: new pc.Vec3(),
    yaw: 42,
  };
  private lastTouchDistance: number | null = null;
  private lastTouchMidpoint: { x: number; y: number } | null = null;
  private options: CourseEditorSceneOptions;
  private pointerCleanup: (() => void) | null = null;
  private selections: CourseEditorSelections;
  private selectionEntities: pc.Entity[] = [];
  private tool: CourseEditorTool = "translate";

  constructor(
    canvas: HTMLCanvasElement,
    document: CourseDocument,
    selections: CourseEditorSelections,
    options: CourseEditorSceneOptions,
  ) {
    this.canvas = canvas;
    this.currentDocument = document;
    this.selections = selections;
    this.options = options;
    this.app = new pc.Application(canvas, {
      graphicsDeviceOptions: { alpha: false, antialias: true },
    });
    this.app.setCanvasResolution(pc.RESOLUTION_AUTO);
    this.app.setCanvasFillMode(pc.FILLMODE_NONE);

    this.camera = new pc.Entity("course-editor-camera");
    this.camera.addComponent("camera", {
      clearColor: new pc.Color(0.025, 0.03, 0.035),
      farClip: 500,
      nearClip: 0.1,
    });
    this.app.root.addChild(this.camera);

    this.materials = createCourseMaterials();
    this.gizmoLayer = pc.Gizmo.createLayer(this.app, "Course Editor Gizmos");
    const cameraComponent = this.camera.camera;
    if (!cameraComponent) {
      throw new Error("Course editor camera is unavailable.");
    }

    this.translateGizmo = new pc.TranslateGizmo(
      cameraComponent,
      this.gizmoLayer,
    );
    this.rotateGizmo = new pc.RotateGizmo(cameraComponent, this.gizmoLayer);
    this.scaleGizmo = new pc.ScaleGizmo(cameraComponent, this.gizmoLayer);
    (["xy", "xz", "yz"] as const).forEach((axis) =>
      this.scaleGizmo.enableShape(axis, false),
    );
    this.scaleGizmo.axisCenterSize = 0.24;
    this.scaleGizmo.axisLineTolerance = 0.12;
    this.translateGizmo.snapIncrement = 0.25;
    this.rotateGizmo.snapIncrement = 5;
    this.scaleGizmo.snapIncrement = 0.1;
    this.collisionMaterial.depthTest = false;
    this.collisionMaterial.update();

    [this.translateGizmo, this.rotateGizmo, this.scaleGizmo].forEach(
      (gizmo) => {
        gizmo.size = 1.15;
        gizmo.mouseButtons[0] = true;
        gizmo.mouseButtons[1] = false;
        gizmo.mouseButtons[2] = false;
        gizmo.on(pc.TransformGizmo.EVENT_TRANSFORMSTART, () => {
          this.activeTransformDocument = this.currentDocument;
        });
        gizmo.on(pc.TransformGizmo.EVENT_TRANSFORMEND, () => {
          this.commitRuntimeTransform();
        });
      },
    );

    this.picker = new pc.Picker(this.app, 1, 1);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement ?? canvas);
    this.attachPointerControls();
    this.rebuildDocument();
    this.frameSelection();
    this.app.start();
    this.resize();
  }

  destroy() {
    this.resizeObserver.disconnect();
    this.pointerCleanup?.();
    this.pointerCleanup = null;
    this.translateGizmo.destroy();
    this.rotateGizmo.destroy();
    this.scaleGizmo.destroy();
    this.picker.destroy();
    Object.values(this.materials).forEach((material) => material.destroy());
    this.checkpointMaterial.destroy();
    this.collisionMaterial.destroy();
    this.selectionMaterial.destroy();
    this.startMaterial.destroy();
    this.app.destroy();
  }

  frameSelection() {
    const geometries = this.selections
      .map((selection) => getSelectionGeometry(this.currentDocument, selection))
      .filter((geometry): geometry is CourseEditorGeometry => Boolean(geometry));
    if (geometries.length === 0) {
      return;
    }

    this.editorCamera.pivot.set(
      geometries.reduce((sum, geometry) => sum + geometry.position.x, 0) /
        geometries.length,
      geometries.reduce((sum, geometry) => sum + geometry.position.y, 0) /
        geometries.length,
      geometries.reduce((sum, geometry) => sum + geometry.position.z, 0) /
        geometries.length,
    );
    this.updateCamera();
  }

  getSelectionCanvasPoint(selection: CourseEditorSelection) {
    const entity = this.documentEntities.get(selectionKey(selection));
    const cameraComponent = this.camera.camera;
    if (!entity || !cameraComponent) {
      return null;
    }

    const screen = cameraComponent.worldToScreen(entity.getPosition());
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: screen.x / (this.canvas.width / rect.width),
      y: screen.y / (this.canvas.height / rect.height),
    };
  }

  getTranslateGizmoCanvasPoints(axis: "x" | "y" | "z") {
    const head = this.translateGizmo.root.findByName(`head:${axis}`);
    if (!head) {
      return null;
    }

    return {
      head: this.worldToCanvasPoint(head.getPosition()),
      origin: this.worldToCanvasPoint(this.translateGizmo.root.getPosition()),
    };
  }

  getScaleGizmoCanvasPoints(axis: "x" | "y" | "z") {
    const handle = this.scaleGizmo.root.findByName(`box:${axis}`);
    if (!handle) {
      return null;
    }

    return {
      handle: this.worldToCanvasPoint(handle.getPosition()),
      origin: this.worldToCanvasPoint(this.scaleGizmo.root.getPosition()),
    };
  }

  setCollisionVisible(visible: boolean) {
    if (this.collisionVisible === visible) {
      return;
    }

    this.collisionVisible = visible;
    const collisionVisuals =
      this.activeDocumentRoot?.findByTag("collision-visual") ?? [];
    if (visible && this.activeDocumentRoot && collisionVisuals.length === 0) {
      this.createCollisionVisuals(
        this.activeDocumentRoot,
        this.currentDocument,
      );
      return;
    }

    collisionVisuals.forEach((entity) => {
      this.selectionByNode.delete(entity);
      entity.destroy();
    });
  }

  setDocument(document: CourseDocument) {
    if (this.currentDocument === document) {
      return;
    }

    this.currentDocument = document;
    this.rebuildDocument();
  }

  setOptions(options: CourseEditorSceneOptions) {
    this.options = options;
  }

  setSelections(selections: CourseEditorSelections) {
    if (sameSelections(this.selections, selections)) {
      return;
    }

    this.selections = selections;
    this.refreshSelectionPresentation();
  }

  setSnapEnabled(enabled: boolean) {
    this.translateGizmo.snap = enabled;
    this.rotateGizmo.snap = enabled;
    this.scaleGizmo.snap = enabled;
  }

  getSelectionMappingCount() {
    return this.selectionByNode.size;
  }

  setTool(tool: CourseEditorTool) {
    this.tool = tool;
    this.refreshGizmo();
  }

  private attachPointerControls() {
    const onContextMenu = (event: MouseEvent) => event.preventDefault();
    const onPointerDown = (event: PointerEvent) => {
      if (event.defaultPrevented) {
        return;
      }

      if (event.isTrusted) {
        this.canvas.setPointerCapture(event.pointerId);
      }
      if (event.pointerType === "mouse") {
        const isPan =
          event.button === 1 || (event.button === 0 && event.shiftKey);
        const isOrbit = event.button === 2;
        this.canvas.style.cursor = isPan
          ? "move"
          : isOrbit
            ? "grabbing"
            : "default";
      }
      this.pointers.set(event.pointerId, {
        button: event.button,
        currentX: event.offsetX,
        currentY: event.offsetY,
        gestureConsumed: false,
        moved: false,
        pointerType: event.pointerType,
        previousX: event.offsetX,
        previousY: event.offsetY,
        startX: event.offsetX,
        startY: event.offsetY,
      });

      if (event.pointerType === "touch" && this.touchPointers().length === 2) {
        this.consumeTouchGesture();
        this.rememberTouchGesture();
      }
    };
    const onPointerMove = (event: PointerEvent) => {
      const pointer = this.pointers.get(event.pointerId);
      if (!pointer) {
        return;
      }

      pointer.previousX = pointer.currentX;
      pointer.previousY = pointer.currentY;
      pointer.currentX = event.offsetX;
      pointer.currentY = event.offsetY;
      pointer.moved ||=
        Math.hypot(
          pointer.currentX - pointer.startX,
          pointer.currentY - pointer.startY,
        ) >= POINTER_MOVE_THRESHOLD;

      const touches = this.touchPointers();
      if (event.pointerType === "touch" && touches.length >= 2) {
        this.consumeTouchGesture();
        this.updateTwoFingerGesture(touches);
        event.preventDefault();
        return;
      }

      const xDelta = pointer.currentX - pointer.previousX;
      const yDelta = pointer.currentY - pointer.previousY;
      const orbit =
        (event.pointerType === "mouse" && pointer.button === 2) ||
        (event.pointerType === "touch" && pointer.moved);
      const pan =
        event.pointerType === "mouse" &&
        (pointer.button === 1 || (pointer.button === 0 && event.shiftKey));

      if (orbit) {
        this.editorCamera.yaw -= xDelta * 0.28;
        this.editorCamera.pitch = clamp(
          this.editorCamera.pitch + yDelta * 0.28,
          22,
          86,
        );
        this.updateCamera();
      } else if (pan) {
        this.panCamera(xDelta, yDelta);
      }
    };
    const finishPointer = (event: PointerEvent, allowPick: boolean) => {
      const pointer = this.pointers.get(event.pointerId);
      this.pointers.delete(event.pointerId);
      if (this.canvas.hasPointerCapture(event.pointerId)) {
        this.canvas.releasePointerCapture(event.pointerId);
      }
      if (event.pointerType === "mouse") {
        this.canvas.style.cursor = "default";
      }
      this.rememberTouchGesture();

      if (
        pointer &&
        allowPick &&
        !pointer.gestureConsumed &&
        !pointer.moved &&
        (pointer.pointerType === "touch" || pointer.button === 0)
      ) {
        this.pickSelection(
          pointer.currentX,
          pointer.currentY,
          pointer.pointerType === "mouse" && event.shiftKey,
        );
      }
    };
    const onPointerUp = (event: PointerEvent) => finishPointer(event, true);
    const onPointerCancel = (event: PointerEvent) => finishPointer(event, false);
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      this.editorCamera.distance = clamp(
        this.editorCamera.distance + event.deltaY * 0.025,
        CAMERA_MIN_DISTANCE,
        CAMERA_MAX_DISTANCE,
      );
      this.updateCamera();
    };

    this.canvas.addEventListener("contextmenu", onContextMenu);
    this.canvas.addEventListener("pointerdown", onPointerDown);
    this.canvas.addEventListener("pointermove", onPointerMove);
    this.canvas.addEventListener("pointerup", onPointerUp);
    this.canvas.addEventListener("pointercancel", onPointerCancel);
    this.canvas.addEventListener("wheel", onWheel, { passive: false });
    this.pointerCleanup = () => {
      this.canvas.style.cursor = "";
      this.canvas.removeEventListener("contextmenu", onContextMenu);
      this.canvas.removeEventListener("pointerdown", onPointerDown);
      this.canvas.removeEventListener("pointermove", onPointerMove);
      this.canvas.removeEventListener("pointerup", onPointerUp);
      this.canvas.removeEventListener("pointercancel", onPointerCancel);
      this.canvas.removeEventListener("wheel", onWheel);
    };
  }

  private commitRuntimeTransform() {
    const before = this.activeTransformDocument;
    this.activeTransformDocument = null;
    if (!before) {
      return;
    }

    if (this.selections.length > 1) {
      const updates = this.selections.flatMap((selection) => {
        const entity = this.entityForSelection(selection);
        if (!entity || selection.kind !== "object") {
          return [];
        }
        const position = entity.getPosition();
        return [
          {
            id: selection.id,
            position: { x: position.x, y: position.y, z: position.z },
          },
        ];
      });
      const next = updateObjectSelectionPositions(before, updates);
      if (JSON.stringify(before) !== JSON.stringify(next)) {
        this.options.onDocumentChange(
          `Move ${this.selections.length} objects`,
          next,
        );
      }
      return;
    }

    const entity = this.entityForSelection();
    if (!entity) {
      return;
    }

    const position = entity.getPosition();
    const rotation = entity.getEulerAngles();
    const scale = entity.getLocalScale();
    const selection = this.primarySelection;
    const geometry: CourseEditorGeometry = {
      position: { x: position.x, y: position.y, z: position.z },
      rotation: { x: rotation.x, y: rotation.y, z: rotation.z },
      ...(selection.kind === "start"
        ? {}
        : { scale: { x: scale.x, y: scale.y, z: scale.z } }),
    };
    const next = updateSelectionGeometry(before, selection, geometry);
    if (JSON.stringify(before) !== JSON.stringify(next)) {
      this.options.onDocumentChange(`Transform ${selection.id}`, next);
    }
  }

  private createCollisionVisuals(
    root: pc.Entity,
    document: CourseDocument,
  ) {
    document.objects.forEach((object) => {
      const collision = object.collision;
      if (!collision) {
        return;
      }

      const transformRoot = new pc.Entity(`${object.id}-collision-root`);
      transformRoot.tags.add("collision-visual");
      transformRoot.enabled = this.collisionVisible;
      transformRoot.setPosition(
        object.transform.position.x,
        object.transform.position.y,
        object.transform.position.z,
      );
      transformRoot.setEulerAngles(
        object.transform.rotation.x,
        object.transform.rotation.y,
        object.transform.rotation.z,
      );
      if (object.editable) {
        this.selectionByNode.set(transformRoot, {
          id: object.id,
          kind: "object",
        });
      }
      root.addChild(transformRoot);

      const offset = new pc.Entity(`${object.id}-collision-offset`);
      offset.setLocalPosition(
        collision.offset.position.x,
        collision.offset.position.y,
        collision.offset.position.z,
      );
      offset.setLocalEulerAngles(
        collision.offset.rotation.x,
        collision.offset.rotation.y,
        collision.offset.rotation.z,
      );
      transformRoot.addChild(offset);

      const shape = new pc.Entity(`${object.id}-collision-shape`);
      shape.addComponent("model", { type: collision.shape });
      shape.model?.meshInstances?.forEach((meshInstance) => {
        meshInstance.material = this.collisionMaterial;
        meshInstance.renderStyle = pc.RENDERSTYLE_WIREFRAME;
      });
      if (collision.shape === "box") {
        shape.setLocalScale(
          collision.halfExtents.x * 2,
          collision.halfExtents.y * 2,
          collision.halfExtents.z * 2,
        );
      } else {
        shape.setLocalScale(
          collision.radius * 2,
          collision.height,
          collision.radius * 2,
        );
        if (collision.axis === 0) {
          shape.setLocalEulerAngles(0, 0, 90);
        } else if (collision.axis === 2) {
          shape.setLocalEulerAngles(90, 0, 0);
        }
      }
      offset.addChild(shape);
    });
  }

  private createMarkerEntities(root: pc.Entity, document: CourseDocument) {
    const start = new pc.Entity("start-position-transform");
    start.setPosition(
      document.start.position.x,
      document.start.position.y,
      document.start.position.z,
    );
    start.setEulerAngles(
      document.start.rotation.x,
      document.start.rotation.y,
      document.start.rotation.z,
    );
    const startVisual = createVisualEntity(
      "start",
      "start-position-marker",
      { x: 1.8, y: 0.18, z: 2.6 },
      this.startMaterial,
    );
    startVisual.setLocalPosition(0, 0.09, 0);
    start.addChild(startVisual);
    this.documentEntities.set(selectionKey({ id: document.start.id, kind: "start" }), start);
    this.selectionByNode.set(start, { id: document.start.id, kind: "start" });
    root.addChild(start);

    document.checkpoints.forEach((checkpoint) => {
      const entity = createVisualEntity(
        "box",
        checkpoint.id,
        {
          x: checkpoint.halfExtents.x * 2,
          y: checkpoint.halfExtents.y * 2,
          z: checkpoint.halfExtents.z * 2,
        },
        this.checkpointMaterial,
      );
      entity.setPosition(
        checkpoint.position.x,
        checkpoint.position.y,
        checkpoint.position.z,
      );
      entity.setEulerAngles(
        checkpoint.rotation.x,
        checkpoint.rotation.y,
        checkpoint.rotation.z,
      );
      const selection = { id: checkpoint.id, kind: "checkpoint" } as const;
      this.documentEntities.set(selectionKey(selection), entity);
      this.selectionByNode.set(entity, selection);
      root.addChild(entity);
    });
  }

  private get primarySelection() {
    return this.selections[0];
  }

  private entityForSelection(selection = this.primarySelection) {
    return this.documentEntities.get(selectionKey(selection)) ?? null;
  }

  private frameDocumentStart() {
    this.editorCamera.pivot.set(
      this.currentDocument.start.position.x,
      this.currentDocument.start.position.y,
      this.currentDocument.start.position.z,
    );
    this.updateCamera();
  }

  private panCamera(xDelta: number, yDelta: number) {
    const yaw = (this.editorCamera.yaw * Math.PI) / 180;
    const forward = new pc.Vec3(Math.sin(yaw), 0, Math.cos(yaw));
    const right = new pc.Vec3(forward.z, 0, -forward.x);
    const scale = this.editorCamera.distance * 0.0018;
    this.editorCamera.pivot
      .add(right.mulScalar(-xDelta * scale))
      .add(forward.mulScalar(-yDelta * scale));
    this.updateCamera();
  }

  private pickSelection(x: number, y: number, additive: boolean) {
    const cameraComponent = this.camera.camera;
    if (!cameraComponent) {
      return;
    }

    this.picker.prepare(cameraComponent, this.app.scene);
    const picked = this.picker.getSelection(x, y);
    for (const meshInstance of picked) {
      if (!("node" in meshInstance)) {
        continue;
      }

      let node: pc.GraphNode | null = meshInstance.node;
      while (node) {
        const selection = this.selectionByNode.get(node);
        if (selection) {
          this.options.onSelectionChange(selection, additive);
          return;
        }
        node = node.parent;
      }
    }
  }

  private rebuildDocument() {
    this.activeDocumentRoot?.destroy();
    this.activeDocumentRoot = new pc.Entity("course-editor-document");
    this.app.root.addChild(this.activeDocumentRoot);
    this.documentEntities.clear();
    this.selectionByNode.clear();

    const { courseEntities } = buildRoughCourse(this.app, {
      createEntity: (projection, material) =>
        createProjectionEntity(projection, material),
      document: this.currentDocument,
      materials: this.materials,
    });
    courseEntities.forEach((entity, id) => {
      const selection = { id, kind: "object" } as const;
      this.activeDocumentRoot?.addChild(entity);
      this.documentEntities.set(selectionKey(selection), entity);
      if (this.currentDocument.objects.find((object) => object.id === id)?.editable) {
        this.selectionByNode.set(entity, selection);
      }
    });
    const lights = buildCourseLighting(this.app, { document: this.currentDocument });
    lights.forEach((entity) => this.activeDocumentRoot?.addChild(entity));
    this.createMarkerEntities(this.activeDocumentRoot, this.currentDocument);
    if (this.collisionVisible) {
      this.createCollisionVisuals(this.activeDocumentRoot, this.currentDocument);
    }

    if (!this.entityForSelection()) {
      const fallback = {
        id: this.currentDocument.start.id,
        kind: "start",
      } as const;
      this.selections = [fallback];
      this.options.onSelectionChange(fallback, false);
    }
    this.refreshSelectionPresentation();
  }

  private refreshGizmo() {
    this.translateGizmo.detach();
    this.rotateGizmo.detach();
    this.scaleGizmo.detach();
    const entities = this.selections
      .map((selection) => this.entityForSelection(selection))
      .filter((entity): entity is pc.Entity => Boolean(entity));
    if (entities.length !== this.selections.length) {
      return;
    }

    if (this.tool === "translate") {
      this.translateGizmo.attach(entities);
    } else if (this.selections.length > 1) {
      return;
    } else if (this.tool === "rotate") {
      this.rotateGizmo.attach(entities);
    } else if (this.primarySelection.kind !== "start") {
      this.configureScaleGizmo();
      this.scaleGizmo.attach(entities);
    }
  }

  private configureScaleGizmo() {
    const selectedObject =
      this.primarySelection.kind === "object"
        ? this.currentDocument.objects.find(
            ({ id }) => id === this.primarySelection.id,
          )
        : null;
    const cylinderAxis =
      selectedObject?.collision?.shape === "cylinder"
        ? selectedObject.collision.axis
        : null;
    const cylinder = cylinderAxis !== null;

    this.scaleGizmo.uniform = cylinder;
    (["x", "y", "z"] as const).forEach((axis, index) =>
      this.scaleGizmo.enableShape(axis, !cylinder || index === cylinderAxis),
    );
    const radialPlane =
      cylinderAxis === 0 ? "yz" : cylinderAxis === 1 ? "xz" : "xy";
    (["xy", "xz", "yz"] as const).forEach((plane) =>
      this.scaleGizmo.enableShape(plane, cylinder && plane === radialPlane),
    );
  }

  private refreshSelectionPresentation() {
    this.selectionEntities.forEach((entity) => entity.destroy());
    this.selectionEntities = [];
    this.selections.forEach((selection) => {
      const entity = this.entityForSelection(selection);
      const geometry = getSelectionGeometry(this.currentDocument, selection);
      if (!entity || !geometry) {
        return;
      }

      const sourceShape =
        selection.kind === "object"
          ? this.currentDocument.objects.find(({ id }) => id === selection.id)
              ?.visual.shape ?? "box"
          : "box";
      const scale = geometry.scale ?? { x: 1.9, y: 0.22, z: 2.7 };
      const outline = createVisualEntity(
        sourceShape,
        `course-editor-selection-${selection.id}`,
        { x: scale.x * 1.04, y: scale.y * 1.04, z: scale.z * 1.04 },
        this.selectionMaterial,
        true,
      );
      outline.setPosition(
        geometry.position.x,
        geometry.position.y,
        geometry.position.z,
      );
      outline.setEulerAngles(
        geometry.rotation.x,
        geometry.rotation.y,
        geometry.rotation.z,
      );
      this.app.root.addChild(outline);
      this.selectionEntities.push(outline);
    });
    this.refreshGizmo();
  }

  private rememberTouchGesture() {
    const touches = this.touchPointers();
    if (touches.length !== 2) {
      this.lastTouchDistance = null;
      this.lastTouchMidpoint = null;
      return;
    }

    this.lastTouchDistance = Math.hypot(
      touches[0].currentX - touches[1].currentX,
      touches[0].currentY - touches[1].currentY,
    );
    this.lastTouchMidpoint = {
      x: (touches[0].currentX + touches[1].currentX) / 2,
      y: (touches[0].currentY + touches[1].currentY) / 2,
    };
  }

  private resize() {
    const container = this.canvas.parentElement ?? this.canvas;
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    this.app.resizeCanvas(width, height);
    this.picker.resize(width, height);
  }

  private touchPointers() {
    return [...this.pointers.values()].filter(
      ({ pointerType }) => pointerType === "touch",
    );
  }

  private consumeTouchGesture() {
    this.touchPointers().forEach((pointer) => {
      pointer.gestureConsumed = true;
    });
  }

  private updateCamera() {
    const yaw = (this.editorCamera.yaw * Math.PI) / 180;
    const pitch = (this.editorCamera.pitch * Math.PI) / 180;
    const horizontal = Math.cos(pitch) * this.editorCamera.distance;
    this.camera.setPosition(
      this.editorCamera.pivot.x + Math.sin(yaw) * horizontal,
      this.editorCamera.pivot.y + Math.sin(pitch) * this.editorCamera.distance,
      this.editorCamera.pivot.z + Math.cos(yaw) * horizontal,
    );
    this.camera.lookAt(this.editorCamera.pivot);
  }

  private updateTwoFingerGesture(touches: PointerState[]) {
    const distance = Math.hypot(
      touches[0].currentX - touches[1].currentX,
      touches[0].currentY - touches[1].currentY,
    );
    const midpoint = {
      x: (touches[0].currentX + touches[1].currentX) / 2,
      y: (touches[0].currentY + touches[1].currentY) / 2,
    };

    if (this.lastTouchDistance !== null) {
      this.editorCamera.distance = clamp(
        this.editorCamera.distance - (distance - this.lastTouchDistance) * 0.08,
        CAMERA_MIN_DISTANCE,
        CAMERA_MAX_DISTANCE,
      );
    }
    if (this.lastTouchMidpoint) {
      this.panCamera(
        midpoint.x - this.lastTouchMidpoint.x,
        midpoint.y - this.lastTouchMidpoint.y,
      );
    }
    this.lastTouchDistance = distance;
    this.lastTouchMidpoint = midpoint;
    this.updateCamera();
  }

  private worldToCanvasPoint(position: pc.Vec3) {
    const cameraComponent = this.camera.camera;
    if (!cameraComponent) {
      return null;
    }

    const screen = cameraComponent.worldToScreen(position);
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: screen.x / (this.canvas.width / rect.width),
      y: screen.y / (this.canvas.height / rect.height),
    };
  }
}

function createCourseMaterials() {
  return {
    asphalt: createMaterial(new pc.Color(0.08, 0.08, 0.09)),
    ground: createMaterial(new pc.Color(0.08, 0.36, 0.26)),
    line: createMaterial(new pc.Color(0.95, 0.92, 0.86)),
    obstacleBarrel: createMaterial(new pc.Color(0.96, 0.45, 0.12)),
    obstacleBlock: createMaterial(new pc.Color(0.82, 0.78, 0.68)),
    ramp: createMaterial(new pc.Color(0.35, 0.39, 0.42)),
  } satisfies Record<CourseVisualMaterial, pc.StandardMaterial>;
}

function createMaterial(
  color: pc.Color,
  opacity = 1,
  wireframe = false,
  emissiveStrength = wireframe ? 0.3 : 0,
) {
  const material = new pc.StandardMaterial();
  material.diffuse = color;
  material.emissive = color.clone().mulScalar(emissiveStrength);
  material.opacity = opacity;
  if (opacity < 1) {
    material.blendType = pc.BLEND_NORMAL;
    material.depthWrite = false;
  }
  material.update();
  return material;
}

function createProjectionEntity(
  projection: CourseObjectProjection,
  material: pc.StandardMaterial,
) {
  const entity = createVisualEntity(
    projection.visual.shape,
    projection.id,
    projection.visual.scale,
    material,
  );
  entity.setPosition(
    projection.transform.position.x,
    projection.transform.position.y,
    projection.transform.position.z,
  );
  entity.setEulerAngles(
    projection.transform.rotation.x,
    projection.transform.rotation.y,
    projection.transform.rotation.z,
  );
  return entity;
}

function createVisualEntity(
  shape: "box" | "cylinder" | string,
  name: string,
  scale: { x: number; y: number; z: number },
  material: pc.StandardMaterial,
  wireframe = false,
) {
  const entity = new pc.Entity(name);
  entity.addComponent("model", { type: shape === "start" ? "box" : shape });
  entity.setLocalScale(scale.x, scale.y, scale.z);
  entity.model?.meshInstances?.forEach((meshInstance) => {
    meshInstance.material = material;
    if (wireframe) {
      meshInstance.renderStyle = pc.RENDERSTYLE_WIREFRAME;
    }
  });
  return entity;
}

function selectionKey(selection: CourseEditorSelection) {
  return `${selection.kind}:${selection.id}`;
}

function sameSelections(
  left: CourseEditorSelections,
  right: CourseEditorSelections,
) {
  return (
    left.length === right.length &&
    left.every(
      (selection, index) =>
        selection.kind === right[index].kind && selection.id === right[index].id,
    )
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
