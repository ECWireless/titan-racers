import * as pc from "playcanvas";

import type {
  KartAssemblyDocument,
  KartAssemblyPrimitiveInstance,
} from "../kart/kart-assembly-document";
import {
  type ApprovedComponentDefinition,
  getApprovedKartComponent,
} from "../kart/kart-component-registry";
import {
  type KartEditorSelection,
  getKartEditorInstance,
  updateKartInstanceTransform,
  updateKartPrimitiveGeometry,
} from "./kart-editor-document";
import {
  createEditorTransformGizmos,
  EditorOrbitCamera,
  EditorSelectionRegistry,
  type EditorTransformTool,
} from "./editor-viewport";

type KartEditorSceneOptions = {
  mirrorPair: boolean;
  onCameraChange: () => void;
  onDocumentChange: (label: string, document: KartAssemblyDocument) => void;
  onSelectionChange: (selection: KartEditorSelection) => void;
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

const POINTER_MOVE_THRESHOLD = 5;

export function shouldTrackKartEditorPointerDown({
  defaultPrevented,
}: Pick<PointerEvent, "defaultPrevented">) {
  return !defaultPrevented;
}

export class KartEditorScene {
  private readonly app: pc.Application;
  private readonly camera: pc.Entity;
  private readonly componentMaterial = createMaterial(
    new pc.Color(0.28, 0.34, 0.39),
  );
  private readonly documentRoot: pc.Entity;
  private readonly editorCamera = new EditorOrbitCamera({
    distance: 1.25,
    maximumDistance: 5,
    minimumDistance: 0.35,
    pitch: 28,
    yaw: 38,
  });
  private readonly gizmoLayer: pc.Layer;
  private readonly picker: pc.Picker;
  private readonly pointers = new Map<number, PointerState>();
  private readonly resizeObserver: ResizeObserver;
  private readonly rotateGizmo: pc.RotateGizmo;
  private readonly scaleGizmo: pc.ScaleGizmo;
  private readonly selectionByNode =
    new EditorSelectionRegistry<KartEditorSelection>();
  private readonly suspensionMaterial = createMaterial(
    new pc.Color(1, 0.62, 0.08),
  );
  private readonly translateGizmo: pc.TranslateGizmo;
  private activeTransformDocument: KartAssemblyDocument | null = null;
  private canvas: HTMLCanvasElement;
  private currentDocument: KartAssemblyDocument;
  private instanceEntities = new Map<string, pc.Entity>();
  private lastTouchDistance: number | null = null;
  private lastTouchMidpoint: { x: number; y: number } | null = null;
  private options: KartEditorSceneOptions;
  private pointerCleanup: (() => void) | null = null;
  private primaryMaterial: pc.StandardMaterial;
  private accentMaterial: pc.StandardMaterial;
  private selection: KartEditorSelection | null;
  private tool: EditorTransformTool = "translate";

  constructor(
    canvas: HTMLCanvasElement,
    document: KartAssemblyDocument,
    selection: KartEditorSelection | null,
    options: KartEditorSceneOptions,
  ) {
    this.canvas = canvas;
    this.currentDocument = document;
    this.selection = selection;
    this.options = options;
    this.primaryMaterial = createMaterial(
      colorFromHex(document.visualIdentity.primaryColor),
    );
    this.accentMaterial = createMaterial(
      colorFromHex(document.visualIdentity.accentColor),
    );
    this.app = new pc.Application(canvas, {
      graphicsDeviceOptions: { alpha: false, antialias: true },
    });
    this.documentRoot = new pc.Entity("kart-editor-document");
    this.app.setCanvasResolution(pc.RESOLUTION_AUTO);
    this.app.setCanvasFillMode(pc.FILLMODE_NONE);
    this.app.scene.ambientLight = new pc.Color(0.46, 0.5, 0.55);
    this.app.root.addChild(this.documentRoot);

    this.camera = new pc.Entity("kart-editor-camera");
    this.camera.addComponent("camera", {
      clearColor: new pc.Color(0.025, 0.03, 0.035),
      farClip: 30,
      nearClip: 0.01,
    });
    this.app.root.addChild(this.camera);

    const light = new pc.Entity("kart-editor-light");
    light.addComponent("light", {
      castShadows: true,
      color: new pc.Color(1, 0.94, 0.84),
      intensity: 1.2,
      shadowResolution: 1024,
      type: "directional",
    });
    light.setEulerAngles(42, -35, 0);
    this.app.root.addChild(light);

    this.gizmoLayer = pc.Gizmo.createLayer(this.app, "Kart Editor Gizmos");
    const cameraComponent = this.camera.camera;
    if (!cameraComponent) {
      throw new Error("Kart editor camera is unavailable.");
    }
    const gizmos = createEditorTransformGizmos(
      cameraComponent,
      this.gizmoLayer,
      {
        onTransformEnd: () => this.commitRuntimeTransform(),
        onTransformStart: () => {
          this.activeTransformDocument = this.currentDocument;
        },
      },
    );
    this.translateGizmo = gizmos.translate;
    this.rotateGizmo = gizmos.rotate;
    this.scaleGizmo = gizmos.scale;
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
    this.primaryMaterial.destroy();
    this.accentMaterial.destroy();
    this.componentMaterial.destroy();
    this.suspensionMaterial.destroy();
    this.app.destroy();
  }

  frameSelection() {
    const entity = this.selection
      ? this.instanceEntities.get(this.selection.id)
      : null;
    if (entity) {
      this.editorCamera.pivot.copy(entity.getPosition());
    } else {
      this.editorCamera.pivot.set(0, 0.11, 0);
    }
    this.editorCamera.apply(this.camera);
  }

  setDocument(document: KartAssemblyDocument) {
    if (document === this.currentDocument) return;
    this.currentDocument = document;
    this.primaryMaterial.destroy();
    this.accentMaterial.destroy();
    this.primaryMaterial = createMaterial(
      colorFromHex(document.visualIdentity.primaryColor),
    );
    this.accentMaterial = createMaterial(
      colorFromHex(document.visualIdentity.accentColor),
    );
    this.rebuildDocument();
  }

  setOptions(options: KartEditorSceneOptions) {
    this.options = options;
  }

  setSelection(selection: KartEditorSelection | null) {
    this.selection = selection;
    this.refreshSelection();
  }

  setSnapEnabled(enabled: boolean) {
    this.translateGizmo.snap = enabled;
    this.rotateGizmo.snap = enabled;
    this.scaleGizmo.snap = enabled;
  }

  setTool(tool: EditorTransformTool) {
    this.tool = tool;
    this.refreshGizmo();
  }

  private attachPointerControls() {
    const onContextMenu = (event: MouseEvent) => event.preventDefault();
    const onPointerDown = (event: PointerEvent) => {
      if (!shouldTrackKartEditorPointerDown(event)) {
        return;
      }
      const state: PointerState = {
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
      };
      this.pointers.set(event.pointerId, state);
      if (event.isTrusted) {
        this.canvas.setPointerCapture(event.pointerId);
      }
      if (event.pointerType === "mouse" && event.button === 2) {
        this.canvas.style.cursor = "grabbing";
      } else if (
        event.pointerType === "mouse" &&
        (event.button === 1 || (event.button === 0 && event.shiftKey))
      ) {
        this.canvas.style.cursor = "move";
      }
      if (event.pointerType === "touch" && this.touchPointers().length >= 2) {
        this.consumeTouchGesture();
      }
    };
    const onPointerMove = (event: PointerEvent) => {
      const pointer = this.pointers.get(event.pointerId);
      if (!pointer) return;
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
        this.editorCamera.orbit(-xDelta * 0.28, yDelta * 0.28);
        this.editorCamera.apply(this.camera);
        this.options.onCameraChange();
      } else if (pan) {
        this.editorCamera.pan(xDelta, yDelta, 0.004);
        this.editorCamera.apply(this.camera);
        this.options.onCameraChange();
      }
    };
    const finishPointer = (event: PointerEvent, allowPick: boolean) => {
      const pointer = this.pointers.get(event.pointerId);
      this.pointers.delete(event.pointerId);
      if (this.canvas.hasPointerCapture(event.pointerId)) {
        this.canvas.releasePointerCapture(event.pointerId);
      }
      if (event.pointerType === "mouse") this.canvas.style.cursor = "default";
      this.rememberTouchGesture();
      if (
        pointer &&
        allowPick &&
        !pointer.gestureConsumed &&
        !pointer.moved &&
        (pointer.pointerType === "touch" || pointer.button === 0)
      ) {
        this.pickSelection(pointer.currentX, pointer.currentY);
      }
    };
    const onPointerUp = (event: PointerEvent) => finishPointer(event, true);
    const onPointerCancel = (event: PointerEvent) =>
      finishPointer(event, false);
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      this.editorCamera.zoom(event.deltaY * 0.0015);
      this.editorCamera.apply(this.camera);
      this.options.onCameraChange();
    };

    this.canvas.addEventListener("contextmenu", onContextMenu);
    this.canvas.addEventListener("pointerdown", onPointerDown);
    this.canvas.addEventListener("pointermove", onPointerMove);
    this.canvas.addEventListener("pointerup", onPointerUp);
    this.canvas.addEventListener("pointercancel", onPointerCancel);
    this.canvas.addEventListener("wheel", onWheel, { passive: false });
    this.pointerCleanup = () => {
      this.canvas.style.cursor = "";
      this.pointers.clear();
      this.canvas.removeEventListener("contextmenu", onContextMenu);
      this.canvas.removeEventListener("pointerdown", onPointerDown);
      this.canvas.removeEventListener("pointermove", onPointerMove);
      this.canvas.removeEventListener("pointerup", onPointerUp);
      this.canvas.removeEventListener("pointercancel", onPointerCancel);
      this.canvas.removeEventListener("wheel", onWheel);
    };
  }

  private commitRuntimeTransform() {
    const baseline = this.activeTransformDocument;
    this.activeTransformDocument = null;
    if (!baseline || !this.selection) return;
    const entity = this.instanceEntities.get(this.selection.id);
    if (!entity) return;

    let next = updateKartInstanceTransform(
      baseline,
      this.selection,
      {
        position: toVector(entity.getPosition()),
        rotationDegrees: toVector(entity.getEulerAngles()),
      },
      this.options.mirrorPair,
    );
    if (this.tool === "scale" && this.selection.kind === "primitive") {
      const scale = entity.getLocalScale();
      next = updatePrimitiveSize(
        next,
        this.selection.id,
        scale,
        this.options.mirrorPair,
      );
    }
    this.options.onDocumentChange(
      this.tool === "translate"
        ? "Move instance"
        : this.tool === "rotate"
          ? "Rotate instance"
          : "Resize primitive",
      next,
    );
  }

  private pickSelection(x: number, y: number) {
    const cameraComponent = this.camera.camera;
    if (!cameraComponent) return;
    this.picker.prepare(cameraComponent, this.app.scene);
    for (const meshInstance of this.picker.getSelection(x, y)) {
      if (!("node" in meshInstance)) continue;
      let node: pc.GraphNode | null = meshInstance.node;
      while (node) {
        const selection = this.selectionByNode.get(node);
        if (selection) {
          this.options.onSelectionChange(selection);
          return;
        }
        node = node.parent;
      }
    }
  }

  private rebuildDocument() {
    this.translateGizmo.detach();
    this.rotateGizmo.detach();
    this.scaleGizmo.detach();
    this.selectionByNode.clear();
    this.instanceEntities.clear();
    [...this.documentRoot.children].forEach((child) => child.destroy());

    for (const primitive of this.currentDocument.primitiveInstances) {
      const root = createPrimitiveEntity(
        primitive,
        primitive.role === "bodywork"
          ? this.primaryMaterial
          : primitive.role === "trim"
            ? this.accentMaterial
            : this.componentMaterial,
      );
      this.documentRoot.addChild(root);
      this.rememberSelection(root, { id: primitive.id, kind: "primitive" });
    }

    for (const instance of this.currentDocument.componentInstances) {
      const root = new pc.Entity(instance.id);
      root.setPosition(
        instance.transform.position.x,
        instance.transform.position.y,
        instance.transform.position.z,
      );
      root.setEulerAngles(
        instance.transform.rotationDegrees.x,
        instance.transform.rotationDegrees.y,
        instance.transform.rotationDegrees.z,
      );
      const definition = getApprovedKartComponent(instance.definition);
      if (definition) {
        definition.construction.forEach((construction, index) => {
          const visual = createConstructionEntity(
            `${instance.id}-construction-${index}`,
            construction,
            definition.category === "wheel-tire"
              ? this.primaryMaterial
              : this.componentMaterial,
          );
          root.addChild(visual);
        });
      }
      this.documentRoot.addChild(root);
      this.rememberSelection(root, { id: instance.id, kind: "component" });

      if (definition?.category === "suspension" && instance.suspensionMount) {
        const coilover = createCoilover(
          instance.id,
          instance.suspensionMount,
          this.suspensionMaterial,
        );
        this.documentRoot.addChild(coilover);
        this.rememberSelection(
          coilover,
          { id: instance.id, kind: "component" },
          false,
        );
      }
    }

    this.refreshSelection();
  }

  private rememberSelection(
    root: pc.Entity,
    selection: KartEditorSelection,
    primary = true,
  ) {
    if (primary) this.instanceEntities.set(selection.id, root);
    root.forEach((node) => this.selectionByNode.set(node, selection));
  }

  private refreshSelection() {
    const selectedId = this.selection?.id;
    for (const [id, root] of this.instanceEntities) {
      root.forEach((node) => {
        if (!(node instanceof pc.Entity)) return;
        node.model?.meshInstances?.forEach((mesh) => {
          if (id === selectedId) {
            mesh.setParameter("material_emissive", [0.08, 0.65, 0.9]);
          } else {
            mesh.deleteParameter("material_emissive");
          }
        });
      });
    }
    this.refreshGizmo();
  }

  private refreshGizmo() {
    this.translateGizmo.detach();
    this.rotateGizmo.detach();
    this.scaleGizmo.detach();
    if (!this.selection) return;
    const entity = this.instanceEntities.get(this.selection.id);
    if (!entity) return;
    const instance = getKartEditorInstance(
      this.currentDocument,
      this.selection,
    );
    if (this.tool === "translate") this.translateGizmo.attach([entity]);
    if (this.tool === "rotate") this.rotateGizmo.attach([entity]);
    if (
      this.tool === "scale" &&
      this.selection.kind === "primitive" &&
      instance?.kind === "primitive" &&
      instance.shape === "box"
    ) {
      this.scaleGizmo.attach([entity]);
    }
  }

  private rememberTouchGesture() {
    if (this.touchPointers().length < 2) {
      this.lastTouchDistance = null;
      this.lastTouchMidpoint = null;
    }
  }

  private resize() {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const width = Math.max(1, parent.clientWidth);
    const height = Math.max(1, parent.clientHeight);
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
      this.editorCamera.zoom(-(distance - this.lastTouchDistance) * 0.003);
    }
    if (this.lastTouchMidpoint) {
      this.editorCamera.pan(
        midpoint.x - this.lastTouchMidpoint.x,
        midpoint.y - this.lastTouchMidpoint.y,
        0.004,
      );
    }
    this.lastTouchDistance = distance;
    this.lastTouchMidpoint = midpoint;
    this.editorCamera.apply(this.camera);
  }
}

function createPrimitiveEntity(
  primitive: KartAssemblyPrimitiveInstance,
  material: pc.StandardMaterial,
) {
  const root = new pc.Entity(primitive.id);
  const visual = new pc.Entity(`${primitive.id}-visual`);
  visual.addComponent("model", { type: primitive.shape });
  root.setPosition(
    primitive.transform.position.x,
    primitive.transform.position.y,
    primitive.transform.position.z,
  );
  root.setEulerAngles(
    primitive.transform.rotationDegrees.x,
    primitive.transform.rotationDegrees.y,
    primitive.transform.rotationDegrees.z,
  );
  if (primitive.shape === "box") {
    root.setLocalScale(primitive.size.x, primitive.size.y, primitive.size.z);
  } else {
    visual.setLocalScale(
      primitive.radius * 2,
      primitive.height,
      primitive.radius * 2,
    );
    applyCylinderAxis(visual, primitive.axis);
  }
  visual.model?.meshInstances?.forEach((mesh) => {
    mesh.material = material;
  });
  root.addChild(visual);
  return root;
}

function createConstructionEntity(
  name: string,
  construction: ApprovedComponentDefinition["construction"][number],
  material: pc.StandardMaterial,
) {
  const entity = new pc.Entity(name);
  entity.addComponent("model", { type: construction.shape });
  entity.setLocalPosition(
    construction.transform.position.x,
    construction.transform.position.y,
    construction.transform.position.z,
  );
  entity.setLocalEulerAngles(
    construction.transform.rotationDegrees.x,
    construction.transform.rotationDegrees.y,
    construction.transform.rotationDegrees.z,
  );
  if (construction.shape === "box") {
    entity.setLocalScale(
      construction.size.x,
      construction.size.y,
      construction.size.z,
    );
  } else {
    entity.setLocalScale(
      construction.radius * 2,
      construction.height,
      construction.radius * 2,
    );
    applyCylinderAxis(entity, construction.axis);
  }
  entity.model?.meshInstances?.forEach((mesh) => {
    mesh.material = material;
  });
  return entity;
}

function createCoilover(
  id: string,
  mount: NonNullable<
    KartAssemblyDocument["componentInstances"][number]["suspensionMount"]
  >,
  material: pc.StandardMaterial,
) {
  const root = new pc.Entity(`${id}-coilover`);
  root.addChild(
    createBarBetween(
      `${id}-damper`,
      mount.chassisAnchor,
      mount.springArmAnchor,
      0.009,
      material,
    ),
  );
  root.addChild(
    createBarBetween(
      `${id}-arm`,
      mount.armPivot,
      mount.hubAnchor,
      0.004,
      material,
    ),
  );

  const turns = 8;
  const segments = 32;
  const start = new pc.Vec3(
    mount.chassisAnchor.x,
    mount.chassisAnchor.y,
    mount.chassisAnchor.z,
  );
  const end = new pc.Vec3(
    mount.springArmAnchor.x,
    mount.springArmAnchor.y,
    mount.springArmAnchor.z,
  );
  const axis = new pc.Vec3().sub2(end, start);
  const length = Math.max(axis.length(), 0.001);
  axis.normalize();
  const reference = Math.abs(axis.y) < 0.9 ? pc.Vec3.UP : pc.Vec3.RIGHT;
  const side = new pc.Vec3().cross(axis, reference).normalize();
  const up = new pc.Vec3().cross(side, axis).normalize();
  let previous = start.clone();
  for (let index = 1; index <= segments; index += 1) {
    const t = index / segments;
    const angle = t * Math.PI * 2 * turns;
    const center = start.clone().add(axis.clone().mulScalar(length * t));
    const point = center
      .add(side.clone().mulScalar(Math.cos(angle) * 0.014))
      .add(up.clone().mulScalar(Math.sin(angle) * 0.014));
    root.addChild(
      createBarBetween(
        `${id}-coil-${index}`,
        toVector(previous),
        toVector(point),
        0.0017,
        material,
      ),
    );
    previous = point;
  }
  return root;
}

function createBarBetween(
  name: string,
  start: { x: number; y: number; z: number },
  end: { x: number; y: number; z: number },
  radius: number,
  material: pc.StandardMaterial,
) {
  const entity = new pc.Entity(name);
  entity.addComponent("model", { type: "cylinder" });
  const startVector = new pc.Vec3(start.x, start.y, start.z);
  const endVector = new pc.Vec3(end.x, end.y, end.z);
  const midpoint = startVector.clone().add(endVector).mulScalar(0.5);
  const length = Math.max(startVector.distance(endVector), 0.0001);
  entity.setPosition(midpoint);
  entity.setLocalScale(radius * 2, length, radius * 2);
  entity.lookAt(endVector);
  entity.rotateLocal(90, 0, 0);
  entity.model?.meshInstances?.forEach((mesh) => {
    mesh.material = material;
  });
  return entity;
}

function updatePrimitiveSize(
  document: KartAssemblyDocument,
  instanceId: string,
  scale: pc.Vec3,
  mirrorPair: boolean,
) {
  return updateKartPrimitiveGeometry(
    document,
    instanceId,
    {
      shape: "box",
      size: {
        x: Math.abs(scale.x),
        y: Math.abs(scale.y),
        z: Math.abs(scale.z),
      },
    },
    mirrorPair,
  );
}

function applyCylinderAxis(entity: pc.Entity, axis: "x" | "y" | "z") {
  if (axis === "x") entity.rotateLocal(0, 0, 90);
  if (axis === "z") entity.rotateLocal(90, 0, 0);
}

function createMaterial(
  color: pc.Color,
  emissiveStrength = 0,
  wireframe = false,
) {
  const material = new pc.StandardMaterial();
  material.diffuse = color;
  material.emissive = color.clone().mulScalar(emissiveStrength);
  if (wireframe) material.opacity = 0.55;
  material.update();
  return material;
}

function colorFromHex(value: string) {
  const number = Number.parseInt(value.slice(1), 16);
  return new pc.Color(
    ((number >> 16) & 255) / 255,
    ((number >> 8) & 255) / 255,
    (number & 255) / 255,
  );
}

function toVector(value: { x: number; y: number; z: number }) {
  return { x: value.x, y: value.y, z: value.z };
}
