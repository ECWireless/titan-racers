import * as pc from "playcanvas";

import {
  createKartComponentVisualEntity,
  createKartPrimitiveVisualEntity,
  getRenderedKartBounds,
} from "../kart/kart-assembly-visual";
import type { KartAssemblyDocument } from "../kart/kart-assembly-document";
import { validateKartAssembly } from "../kart/kart-assembly-validation";
import {
  canAttachKartInstanceAtCurrentPosition,
  type KartEditorSelection,
  getKartEditorInstance,
  getKartMirrorCounterpartIds,
  updateKartInstanceTransformAndAttachment,
  updateKartPrimitiveGeometry,
} from "./kart-editor-document";
import {
  createEditorTransformGizmos,
  EditorOrbitCamera,
  EditorSelectionRegistry,
  resolveScreenRelativeEditorTranslation,
  type EditorTransformTool,
} from "./editor-viewport";
import type {
  EditorControllerCameraInput,
  EditorControllerDirection,
} from "./editor-controller-viewport";

type KartEditorSceneOptions = {
  attachmentParentId: string;
  mirrorPair: boolean;
  onCameraChange: (pivot: { x: number; y: number; z: number }) => void;
  onDocumentChange: (label: string, document: KartAssemblyDocument) => void;
  onDocumentBoundsChange: (center: { x: number; y: number; z: number }) => void;
  onSelectionChange: (selection: KartEditorSelection | null) => void;
  onTransformStateChange: (
    state: "attachable" | "invalid" | "valid" | null,
  ) => void;
  retainedIds: ReadonlySet<string>;
  selectionState: "attachable" | "invalid" | "valid";
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
export const KART_EDITOR_TRANSLATE_SNAP = 0.005;

export function shouldTrackKartEditorPointerDown({
  defaultPrevented,
}: Pick<PointerEvent, "defaultPrevented">) {
  return !defaultPrevented;
}

export class KartEditorScene {
  private readonly app: pc.Application;
  private readonly camera: pc.Entity;
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
  private readonly translateGizmo: pc.TranslateGizmo;
  private activeTransformDocument: KartAssemblyDocument | null = null;
  private canvas: HTMLCanvasElement;
  private currentDocument: KartAssemblyDocument;
  private instanceEntities = new Map<string, pc.Entity>();
  private instanceMaterialById = new Map<string, pc.StandardMaterial>();
  private instanceMaterials: pc.StandardMaterial[] = [];
  private interactionEnabled = true;
  private lastTouchDistance: number | null = null;
  private lastTouchMidpoint: { x: number; y: number } | null = null;
  private options: KartEditorSceneOptions;
  private pointerCleanup: (() => void) | null = null;
  private previewedInstanceIds = new Set<string>();
  private selection: KartEditorSelection | null;
  private tool: EditorTransformTool = "translate";
  private transformPreviewState: "attachable" | "invalid" | "valid" | null =
    null;

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
        onTransformMove: () => this.previewRuntimeTransform(),
        onTransformStart: () => {
          this.activeTransformDocument = this.currentDocument;
          this.previewRuntimeTransform();
        },
      },
    );
    this.translateGizmo = gizmos.translate;
    this.translateGizmo.snapIncrement = KART_EDITOR_TRANSLATE_SNAP;
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
    this.destroyInstanceMaterials();
    this.app.destroy();
  }

  frameSelection() {
    const entity = this.selection
      ? this.instanceEntities.get(this.selection.id)
      : this.documentRoot;
    const center = entity ? getRenderedKartBounds(entity)?.center : null;
    this.editorCamera.pivot.copy(center ?? new pc.Vec3(0, 0.11, 0));
    this.editorCamera.apply(this.camera);
    this.options.onCameraChange(toVector(this.editorCamera.pivot));
  }

  applyControllerCamera(
    input: EditorControllerCameraInput,
    deltaSeconds: number,
  ) {
    if (this.editorCamera.applyControllerInput(input, deltaSeconds, 0.004)) {
      this.editorCamera.apply(this.camera);
      this.options.onCameraChange(toVector(this.editorCamera.pivot));
    }
  }

  getInstanceVisualColor(instanceId: string) {
    const root = this.instanceEntities.get(instanceId);
    if (!root) return null;
    let color: { x: number; y: number; z: number } | null = null;
    root.forEach((node) => {
      if (color || !(node instanceof pc.Entity)) return;
      const material = node.model?.meshInstances?.[0]?.material;
      if (!(material instanceof pc.StandardMaterial)) return;
      color = {
        x: material.diffuse.r,
        y: material.diffuse.g,
        z: material.diffuse.b,
      };
    });
    return color;
  }

  getInstanceVisualDebugState(instanceId: string) {
    const root = this.instanceEntities.get(instanceId);
    const coilover = root?.findByName(`${instanceId}-coilover`) as
      | pc.Entity
      | null
      | undefined;
    const damper = coilover?.findByName(`${instanceId}-damper`) as
      | pc.Entity
      | null
      | undefined;
    const material = damper?.model?.meshInstances?.[0]
      ?.material as pc.StandardMaterial | undefined;
    const emissive = material?.emissive;
    return {
      coiloverEmissive: emissive
        ? [emissive.r, emissive.g, emissive.b]
        : null,
      coiloverParentName: coilover?.parent?.name ?? null,
    };
  }

  getTranslateGizmoCanvasPoints(axis: "x" | "y" | "z") {
    const head = this.translateGizmo.root.findByName(`head:${axis}`);
    if (!head) return null;
    return {
      head: this.worldToCanvasPoint(head.getPosition()),
      origin: this.worldToCanvasPoint(this.translateGizmo.root.getPosition()),
    };
  }

  setDocument(document: KartAssemblyDocument) {
    if (document === this.currentDocument) return;
    this.currentDocument = document;
    this.rebuildDocument();
  }

  setInteractionEnabled(enabled: boolean) {
    if (enabled === this.interactionEnabled) return;
    this.interactionEnabled = enabled;
    this.activeTransformDocument = null;
    this.pointers.clear();
    this.canvas.style.cursor = "";
    if (enabled) {
      this.refreshGizmo();
      return;
    }
    this.rebuildDocument();
  }

  setOptions(options: KartEditorSceneOptions) {
    const selectionStateChanged =
      options.selectionState !== this.options.selectionState;
    this.options = options;
    if (selectionStateChanged) this.refreshSelectionHighlight();
  }

  setSelection(selection: KartEditorSelection | null) {
    this.clearTransformPreview(true);
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

  selectAtCenter() {
    const rect = this.canvas.getBoundingClientRect();
    this.pickSelection(rect.width / 2, rect.height / 2);
  }

  resolveControllerTranslation(direction: EditorControllerDirection) {
    const cameraComponent = this.camera.camera;
    return cameraComponent
      ? resolveScreenRelativeEditorTranslation(
          cameraComponent,
          this.editorCamera.pivot,
          direction,
        )
      : null;
  }

  private attachPointerControls() {
    const onContextMenu = (event: MouseEvent) => event.preventDefault();
    const onPointerDown = (event: PointerEvent) => {
      if (
        !this.interactionEnabled ||
        !shouldTrackKartEditorPointerDown(event)
      ) {
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
      if (!this.interactionEnabled) return;
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
        this.options.onCameraChange(toVector(this.editorCamera.pivot));
      } else if (pan) {
        this.editorCamera.pan(xDelta, yDelta, 0.004);
        this.editorCamera.apply(this.camera);
        this.options.onCameraChange(toVector(this.editorCamera.pivot));
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
      if (!this.interactionEnabled) return;
      event.preventDefault();
      this.editorCamera.zoom(event.deltaY * 0.0015);
      this.editorCamera.apply(this.camera);
      this.options.onCameraChange(toVector(this.editorCamera.pivot));
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
    if (!this.interactionEnabled || !baseline || !this.selection) return;
    const next = this.buildRuntimeTransformDocument(baseline);
    if (!next) return;
    this.clearTransformPreview(false);
    this.options.onDocumentChange(
      this.tool === "translate"
        ? "Move instance"
        : this.tool === "rotate"
          ? "Rotate instance"
          : "Resize primitive",
      next,
    );
  }

  private buildRuntimeTransformDocument(baseline: KartAssemblyDocument) {
    if (!this.selection) return null;
    const entity = this.instanceEntities.get(this.selection.id);
    if (!entity) return null;
    let next = updateKartInstanceTransformAndAttachment(
      baseline,
      this.selection,
      {
        position: toVector(entity.getPosition()),
        rotationDegrees: toVector(entity.getEulerAngles()),
      },
      this.options.attachmentParentId,
      this.options.retainedIds,
      this.options.mirrorPair,
    );
    if (this.tool === "scale" && this.selection.kind === "primitive") {
      next = updatePrimitiveSize(
        next,
        this.selection.id,
        entity.getLocalScale(),
        this.options.mirrorPair,
      );
    }
    return next;
  }

  private applyPreviewDocument(document: KartAssemblyDocument) {
    for (const instance of [
      ...document.primitiveInstances,
      ...document.componentInstances,
    ]) {
      if (instance.id === this.selection?.id) continue;
      const entity = this.instanceEntities.get(instance.id);
      if (!entity) continue;
      entity.setPosition(
        instance.transform.position.x,
        instance.transform.position.y,
        instance.transform.position.z,
      );
      entity.setEulerAngles(
        instance.transform.rotationDegrees.x,
        instance.transform.rotationDegrees.y,
        instance.transform.rotationDegrees.z,
      );
      if (instance.kind === "primitive" && instance.shape === "box") {
        entity.setLocalScale(instance.size.x, instance.size.y, instance.size.z);
      }
      this.previewedInstanceIds.add(instance.id);
    }
  }

  private restorePreviewedInstances() {
    for (const id of this.previewedInstanceIds) {
      const instance = [
        ...this.currentDocument.primitiveInstances,
        ...this.currentDocument.componentInstances,
      ].find((candidate) => candidate.id === id);
      const entity = this.instanceEntities.get(id);
      if (!instance || !entity) continue;
      entity.setPosition(
        instance.transform.position.x,
        instance.transform.position.y,
        instance.transform.position.z,
      );
      entity.setEulerAngles(
        instance.transform.rotationDegrees.x,
        instance.transform.rotationDegrees.y,
        instance.transform.rotationDegrees.z,
      );
      if (instance.kind === "primitive" && instance.shape === "box") {
        entity.setLocalScale(instance.size.x, instance.size.y, instance.size.z);
      }
    }
    this.previewedInstanceIds.clear();
  }

  private previewRuntimeTransform() {
    const baseline = this.activeTransformDocument;
    if (!this.interactionEnabled || !baseline) return;
    const next = this.buildRuntimeTransformDocument(baseline);
    if (!next) return;
    const attached = next.structuralAttachments.some(
      ({ child }) => child.instanceId === this.selection?.id,
    );
    const state = attached
      ? validateKartAssembly(next).success
        ? "valid"
        : "invalid"
      : this.selection &&
          this.options.attachmentParentId &&
          canAttachKartInstanceAtCurrentPosition(
            next,
            this.selection,
            this.options.attachmentParentId,
            this.options.retainedIds,
          )
        ? "attachable"
        : this.options.attachmentParentId === "" &&
            this.options.selectionState === "valid"
          ? "valid"
          : "invalid";
    this.applyPreviewDocument(next);
    this.transformPreviewState = state;
    this.options.onTransformStateChange(state);
    this.refreshSelectionHighlight();
  }

  private clearTransformPreview(restoreInstances = true) {
    if (restoreInstances) this.restorePreviewedInstances();
    else this.previewedInstanceIds.clear();
    this.transformPreviewState = null;
    this.options.onTransformStateChange(null);
    this.refreshSelectionHighlight();
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
    this.options.onSelectionChange(null);
  }

  private rebuildDocument() {
    this.translateGizmo.detach();
    this.rotateGizmo.detach();
    this.scaleGizmo.detach();
    this.selectionByNode.clear();
    this.instanceEntities.clear();
    this.instanceMaterialById.clear();
    [...this.documentRoot.children].forEach((child) => child.destroy());
    this.destroyInstanceMaterials();

    for (const primitive of this.currentDocument.primitiveInstances) {
      const material = this.createInstanceMaterial(
        primitive.id,
        primitive.visualColor,
      );
      const root = createKartPrimitiveVisualEntity(primitive, material);
      this.documentRoot.addChild(root);
      this.rememberSelection(root, { id: primitive.id, kind: "primitive" });
    }

    for (const instance of this.currentDocument.componentInstances) {
      const material = this.createInstanceMaterial(
        instance.id,
        instance.visualColor,
      );
      const root = createKartComponentVisualEntity(instance, material);
      this.documentRoot.addChild(root);
      this.rememberSelection(root, { id: instance.id, kind: "component" });
    }

    const documentCenter = getRenderedKartBounds(this.documentRoot)?.center;
    if (documentCenter) {
      this.options.onDocumentBoundsChange(toVector(documentCenter));
    }
    this.refreshSelection();
  }

  private createInstanceMaterial(instanceId: string, visualColor: string) {
    const material = createMaterial(colorFromHex(visualColor));
    this.instanceMaterialById.set(instanceId, material);
    this.instanceMaterials.push(material);
    return material;
  }

  private destroyInstanceMaterials() {
    this.instanceMaterials.forEach((material) => material.destroy());
    this.instanceMaterialById.clear();
    this.instanceMaterials = [];
  }

  private rememberSelection(root: pc.Entity, selection: KartEditorSelection) {
    this.instanceEntities.set(selection.id, root);
    root.forEach((node) => this.selectionByNode.set(node, selection));
  }

  private refreshSelection() {
    this.refreshSelectionHighlight();
    this.refreshGizmo();
  }

  private refreshSelectionHighlight() {
    const selectedId = this.selection?.id;
    const selectionState =
      this.transformPreviewState ?? this.options.selectionState;
    const mirrorCounterpartIds = new Set(
      this.selection
        ? getKartMirrorCounterpartIds(this.currentDocument, this.selection)
        : [],
    );
    for (const [id, root] of this.instanceEntities) {
      const material = this.instanceMaterialById.get(id);
      const emissive =
        id === selectedId && selectionState === "invalid"
          ? [0.95, 0.03, 0.02]
          : id === selectedId && selectionState === "attachable"
            ? [0.95, 0.55, 0.03]
            : id === selectedId
              ? [0.08, 0.65, 0.9]
              : mirrorCounterpartIds.has(id)
                ? [1, 0.36, 0.04]
                : [0, 0, 0];
      if (material) {
        material.emissive.set(emissive[0], emissive[1], emissive[2]);
        material.update();
      }
      root.forEach((node) => {
        if (!(node instanceof pc.Entity)) return;
        node.model?.meshInstances?.forEach((mesh) => {
          mesh.deleteParameter("material_emissive");
        });
      });
    }
  }

  private refreshGizmo() {
    this.translateGizmo.detach();
    this.rotateGizmo.detach();
    this.scaleGizmo.detach();
    if (!this.interactionEnabled || !this.selection) return;
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

  private worldToCanvasPoint(position: pc.Vec3) {
    const cameraComponent = this.camera.camera;
    if (!cameraComponent) return null;
    const screen = cameraComponent.worldToScreen(position);
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: screen.x / (this.canvas.width / rect.width),
      y: screen.y / (this.canvas.height / rect.height),
    };
  }
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

function createMaterial(color: pc.Color) {
  const material = new pc.StandardMaterial();
  material.diffuse = color;
  material.emissive = color.clone().mulScalar(0);
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
