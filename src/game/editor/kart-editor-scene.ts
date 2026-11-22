import * as pc from "playcanvas";

import {
  createKartAssemblyVisual,
  createKartCablesEntity,
  getRenderedKartColor,
  KART_CABLES_ID,
  getRenderedKartBounds,
  poseKartWheelVisual,
  type KartWheelVisual,
} from "../kart/kart-assembly-visual";
import type { KartAssemblyDocument } from "../kart/kart-assembly-document";
import {
  rotationMatrix,
  type KartVector,
} from "../kart/kart-construction-geometry";
import { getKartExplodeOffsets } from "../kart/kart-explode";
import { rotationDegreesFromMatrix } from "../kart/kart-mount-snapping";
import type { KartPartFinish } from "../kart/kart-part-visual-geometry";
import { createKartVisualMaterial } from "../kart/kart-visual-material";
import { createRenderOnlyApplication } from "../render/render-only-application";
import { applySceneLook, applyShadowPolicy } from "../render/scene-look";
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

/** A measured gap as the builder reads it out. */
export function formatKartGap(distance: number) {
  return Math.abs(distance) <= MEASURE_TOUCHING
    ? "Touching"
    : distance < 0
      ? `Overlap ${(-distance * 1000).toFixed(1)} mm`
      : `${(distance * 1000).toFixed(1)} mm`;
}

/** The builder's tools: the transform gizmos, and measuring between parts. */
export type KartEditorTool = EditorTransformTool | "measure";

/**
 * How the builder shows the kart, for viewing only: pulled apart (`explode`
 * from 0 to 1, eased toward), posed (each wheel's travel and steering), and
 * see-through, with a measured gap between the selection and another part.
 */
export type KartEditorView = {
  /** Whether parts may be dragged: only in Build, with the kart at rest. */
  editable: boolean;
  explode: number;
  measureTargetId: string | null;
  measurement: {
    distance: number;
    pointA: KartVector;
    pointB: KartVector;
  } | null;
  wheelPoses: ReadonlyMap<
    string,
    { steerDegrees: number; travel: number }
  > | null;
  xray: boolean;
};

export const KART_EDITOR_ASSEMBLED_VIEW: KartEditorView = {
  editable: true,
  explode: 0,
  measureTargetId: null,
  measurement: null,
  wheelPoses: null,
  xray: false,
};

/** How see-through x-ray leaves the parts it looks past. */
const XRAY_OPACITY = 0.14;
/** The time constant the exploded view eases with, in seconds. */
const EXPLODE_EASING_SECONDS = 0.09;
/** Within this, a gap reads as parts touching, in metres. */
const MEASURE_TOUCHING = 0.0002;
/** Gaps under this read as tight, in metres. */
const MEASURE_TIGHT = 0.002;

type KartEditorSceneOptions = {
  attachmentParentId: string;
  mirrorPair: boolean;
  onCameraChange: (pivot: { x: number; y: number; z: number }) => void;
  onDocumentChange: (label: string, document: KartAssemblyDocument) => void;
  onDocumentBoundsChange: (center: { x: number; y: number; z: number }) => void;
  /** The lowest drawn part but the tires above the ground, at rest. */
  onGroundClearanceChange: (meters: number | null) => void;
  /** Measuring, the part clicked to measure the selection against. */
  onMeasureTargetChange: (target: KartEditorSelection | null) => void;
  onSelectionChange: (selection: KartEditorSelection | null) => void;
  /** The selected part's drawn size along its own axes, in metres. */
  onSelectionSizeChange: (size: KartVector | null) => void;
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
  private readonly app: pc.AppBase;
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
  /** What the active drag last asked for (`readGizmoTransform`). */
  private gizmoTransform: KartAssemblyDocument["componentInstances"][number]["transform"] | null = null;
  private canvas: HTMLCanvasElement;
  private currentDocument: KartAssemblyDocument;
  private instanceEntities = new Map<string, pc.Entity>();
  private instanceMaterialById = new Map<string, pc.StandardMaterial[]>();
  private instanceMaterials: pc.StandardMaterial[] = [];
  /** The kart's cables, rebuilt alone as a drag moves the parts they join. */
  private cables: pc.Entity | null = null;
  /** The drawn kart's root, which the cables hang from. */
  private kartRoot: pc.Entity | null = null;
  /** A drag's latest preview, its cables routed once per frame. */
  private pendingCables: KartAssemblyDocument | null = null;
  /** Routing ran slow twice running this drag (a big draft): cables wait for the drop. */
  private cablesHeldForDrag = false;
  private slowCableRoutes = 0;
  private cableMaterials = new Map<KartPartFinish, pc.StandardMaterial>();
  private readonly releaseSceneLook: () => void;
  private interactionEnabled = true;
  private lastTouchDistance: number | null = null;
  private lastTouchMidpoint: { x: number; y: number } | null = null;
  private options: KartEditorSceneOptions;
  private pointerCleanup: (() => void) | null = null;
  private previewedInstanceIds = new Set<string>();
  private selection: KartEditorSelection | null;
  private tool: KartEditorTool = "translate";
  private view: KartEditorView = KART_EDITOR_ASSEMBLED_VIEW;
  private wheels: KartWheelVisual[] = [];
  /** Each instance root's assembled position, and its fully exploded offset. */
  private assembledPositions = new Map<string, pc.Vec3>();
  private explodeOffsets = new Map<string, KartVector>();
  private explodeShown = 0;
  private ghostedIds = new Set<string>();
  /** Each part's drawn size along its own axes, measured at rest. */
  private readonly restSizes = new Map<string, KartVector | null>();
  private readonly ghostedMaterials = new Set<pc.StandardMaterial>();
  private readonly measureLabel: HTMLDivElement;
  private readonly onUpdate = (deltaSeconds: number) =>
    this.updateView(deltaSeconds);
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
    // Editors draw only; a kart test drive races in its own application.
    this.app = createRenderOnlyApplication(canvas, { alpha: false, antialias: true });
    this.documentRoot = new pc.Entity("kart-editor-document");
    this.app.setCanvasResolution(pc.RESOLUTION_AUTO);
    this.app.setCanvasFillMode(pc.FILLMODE_NONE);
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
    applyShadowPolicy(light.light!);
    this.app.root.addChild(light);

    this.gizmoLayer = pc.Gizmo.createLayer(this.app, "Kart Editor Gizmos");
    const cameraComponent = this.camera.camera;
    if (!cameraComponent) {
      throw new Error("Kart editor camera is unavailable.");
    }
    this.releaseSceneLook = applySceneLook(this.app, cameraComponent);
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
    this.measureLabel = createMeasureLabel();
    canvas.parentElement?.appendChild(this.measureLabel);
    this.app.on("update", this.onUpdate);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement ?? canvas);
    this.attachPointerControls();
    this.rebuildDocument();
    this.frameSelection();
    this.app.start();
    this.resize();
  }

  destroy() {
    this.app.off("update", this.onUpdate);
    this.measureLabel.remove();
    this.resizeObserver.disconnect();
    this.pointerCleanup?.();
    this.pointerCleanup = null;
    this.translateGizmo.destroy();
    this.rotateGizmo.destroy();
    this.scaleGizmo.destroy();
    this.picker.destroy();
    this.destroyInstanceMaterials();
    this.releaseSceneLook();
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
    const hex = getRenderedKartColor(root);
    if (!hex) return null;
    const color = new pc.Color().fromString(hex);
    return { x: color.r, y: color.g, z: color.b };
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
    const material = damper?.render?.meshInstances?.[0]
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

  setTool(tool: KartEditorTool) {
    this.tool = tool;
    this.refreshGizmo();
  }

  /** Whether parts may be moved: in Build, at rest, and fully assembled. */
  canEdit() {
    return (
      this.interactionEnabled &&
      this.view.editable &&
      this.explodeShown === 0 &&
      this.view.wheelPoses === null
    );
  }

  setView(view: KartEditorView) {
    if (view === this.view) return;
    const posed = view.wheelPoses !== this.view.wheelPoses;
    this.view = view;
    // Leaving Build mid-drag drops the drag and its preview.
    if (!view.editable && this.activeTransformDocument) {
      this.activeTransformDocument = null;
      this.gizmoTransform = null;
      this.clearTransformPreview(true);
    }
    if (posed) this.applyWheelPoses();
    this.refreshXray();
    this.refreshGizmo();
  }

  /** For browser tests: where an instance is drawn, and how. */
  getInstanceViewState(instanceId: string) {
    const root = this.instanceEntities.get(instanceId);
    const wheel = this.wheels.find((candidate) => candidate.instanceId === instanceId);
    return root
      ? {
          /** The kart's cables, which belong to no one instance. */
          cablesShown: this.cables?.enabled ?? null,
          ghosted: this.ghostedIds.has(instanceId),
          hubY: wheel?.pivot.getLocalPosition().y ?? null,
          gizmoAttached:
            this.translateGizmo.nodes.length +
              this.rotateGizmo.nodes.length +
              this.scaleGizmo.nodes.length >
            0,
          linkagesShown: wheel
            ? (wheel.tieRod?.rod.enabled ?? true) &&
              (wheel.driveshaft?.bone.enabled ?? true)
            : null,
          position: toVector(root.getLocalPosition()),
          steerDegrees: wheel?.pivot.getLocalEulerAngles().y ?? null,
        }
      : null;
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
    const asked = this.gizmoTransform;
    this.activeTransformDocument = null;
    this.gizmoTransform = null;
    if (!this.view.editable) {
      this.clearTransformPreview(true);
      return;
    }
    if (!this.interactionEnabled || !baseline || !this.selection) return;
    const next = this.buildRuntimeTransformDocument(
      baseline,
      asked ?? this.readGizmoTransform(baseline),
    );
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

  /**
   * The transform the gizmo asks for, as it drags. The preview poses the
   * entity where the part would stand, so only what the active gizmo drives
   * is read back from it: translate re-applies its drag to the position and
   * rotate to the rotation (each from where the drag began), and the rest
   * comes from where the part stood. The last one read is kept, so the
   * drag's end commits what was asked, not the previewed pose.
   */
  private readGizmoTransform(baseline: KartAssemblyDocument) {
    if (!this.selection) return null;
    const entity = this.instanceEntities.get(this.selection.id);
    const instance = [
      ...baseline.componentInstances,
      ...baseline.primitiveInstances,
    ].find(({ id }) => id === this.selection?.id);
    if (!entity || !instance) return null;
    this.gizmoTransform = {
      position:
        this.tool === "translate"
          ? toVector(entity.getPosition())
          : instance.transform.position,
      // PlayCanvas reads Y back within ±90°; the angles nearest the part's
      // own are kept, so turning it past 90° doesn't fold them.
      rotationDegrees:
        this.tool === "rotate"
          ? rotationDegreesFromMatrix(
              rotationMatrix(toVector(entity.getEulerAngles())),
              instance.transform.rotationDegrees,
            )
          : instance.transform.rotationDegrees,
    };
    return this.gizmoTransform;
  }

  private buildRuntimeTransformDocument(
    baseline: KartAssemblyDocument,
    asked = this.readGizmoTransform(baseline),
  ) {
    if (!this.selection || !asked) return null;
    const entity = this.instanceEntities.get(this.selection.id);
    if (!entity) return null;
    let next = updateKartInstanceTransformAndAttachment(
      baseline,
      this.selection,
      asked,
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
      // The selection shows where it would stand too: a snapped part keeps
      // to its mounting points while dragged, and a free one snaps near
      // its parent's (the gizmo re-applies its drag from where it began).
      // The rotate gizmo measures its angle about where the part stands,
      // so while rotating, the selection keeps its place.
      const entity = this.instanceEntities.get(instance.id);
      if (!entity) continue;
      if (instance.id !== this.selection?.id || this.tool !== "rotate") {
        entity.setPosition(
          instance.transform.position.x,
          instance.transform.position.y,
          instance.transform.position.z,
        );
      }
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
    if (!this.cablesHeldForDrag) this.pendingCables = document;
  }

  /** Rebuilds the cables alone, routed for `document`'s parts. */
  private showCables(document: KartAssemblyDocument) {
    const parent = this.kartRoot;
    if (!parent) return;
    this.cables?.destroy();
    this.cables = createKartCablesEntity(
      document,
      (finish) => this.getCableMaterial(finish),
      this.app.graphicsDevice,
    );
    if (this.cables) {
      this.cables.enabled = this.explodeShown === 0;
      // Looked past in X-ray, they cast no shadow until shown again.
      const render = this.cables.render;
      if (this.ghostedIds.has(KART_CABLES_ID) && render) {
        castsShadow.set(render, render.castShadows);
        render.castShadows = false;
      }
      parent.addChild(this.cables);
    }
  }

  private getCableMaterial(finish: KartPartFinish) {
    let material = this.cableMaterials.get(finish);
    if (!material) {
      material = this.createInstanceMaterial(KART_CABLES_ID, finish);
      this.cableMaterials.set(finish, material);
      // A finish first drawn mid-drag in X-ray fades with the rest.
      if (this.ghostedIds.has(KART_CABLES_ID)) this.setMaterialGhosted(material, true);
    }
    return material;
  }

  /** An instance's root, or the cables for their material key. */
  private getXrayEntity(id: string) {
    return id === KART_CABLES_ID ? this.cables : this.instanceEntities.get(id);
  }

  private restorePreviewedInstances() {
    this.pendingCables = null;
    this.cablesHeldForDrag = false;
    this.slowCableRoutes = 0;
    if (this.previewedInstanceIds.size > 0) this.showCables(this.currentDocument);
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
    this.pendingCables = null;
    this.cablesHeldForDrag = false;
    this.slowCableRoutes = 0;
    if (this.cables) this.cables.enabled = this.explodeShown === 0;
    this.transformPreviewState = null;
    this.options.onTransformStateChange(null);
    this.refreshSelectionHighlight();
  }

  private pickSelection(x: number, y: number) {
    // X-ray picks the solid parts it shows through the ones it looks past,
    // and those only where nothing solid is.
    const picked =
      (this.ghostedIds.size > 0 ? this.pickAt(x, y, true) : null) ??
      this.pickAt(x, y, false);
    if (this.tool === "measure" && this.selection) {
      if (picked?.id === this.selection.id) return;
      if (picked || this.view.measureTargetId) {
        this.options.onMeasureTargetChange(picked);
        return;
      }
    }
    this.options.onSelectionChange(picked);
  }

  private pickAt(
    x: number,
    y: number,
    solidOnly: boolean,
  ): KartEditorSelection | null {
    const cameraComponent = this.camera.camera;
    if (!cameraComponent) return null;
    const skipped: pc.MeshInstance[] = [];
    if (solidOnly) {
      for (const id of this.ghostedIds) {
        this.getXrayEntity(id)?.forEach((node) => {
          if (!(node instanceof pc.Entity)) return;
          node.render?.meshInstances?.forEach((mesh) => {
            if (!mesh.pick) return;
            mesh.pick = false;
            skipped.push(mesh);
          });
        });
      }
    }
    try {
      this.picker.prepare(cameraComponent, this.app.scene);
    } finally {
      skipped.forEach((mesh) => {
        mesh.pick = true;
      });
    }
    for (const meshInstance of this.picker.getSelection(x, y)) {
      if (!("node" in meshInstance)) continue;
      let node: pc.GraphNode | null = meshInstance.node;
      while (node) {
        const selection = this.selectionByNode.get(node);
        if (selection) return selection;
        node = node.parent;
      }
    }
    return null;
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

    this.ghostedIds.clear();
    this.ghostedMaterials.clear();
    this.cableMaterials.clear();
    this.pendingCables = null;
    this.cablesHeldForDrag = false;
    this.slowCableRoutes = 0;
    const { cables, instanceRoots, root, wheels } = createKartAssemblyVisual(
      this.currentDocument,
      (finish, instanceId) =>
        instanceId === KART_CABLES_ID
          ? this.getCableMaterial(finish)
          : this.createInstanceMaterial(instanceId, finish),
      this.app.graphicsDevice,
    );
    this.documentRoot.addChild(root);
    this.kartRoot = root;
    this.cables = cables;
    this.wheels = wheels;
    this.assembledPositions = new Map(
      [...instanceRoots].map(([id, entity]) => [
        id,
        entity.getLocalPosition().clone(),
      ]),
    );
    this.explodeOffsets = getKartExplodeOffsets(this.currentDocument);
    // Measured as drawn at rest, before any view poses or explodes it.
    this.options.onGroundClearanceChange(measureGroundClearance(root, wheels));
    this.restSizes.clear();
    for (const [id, entity] of instanceRoots) {
      // A wheel is measured on its own axle (its root also carries its tie
      // rod and driveshaft, and its pivot steers); a part, on its root's.
      const wheel = wheels.find(({ instanceId }) => instanceId === id);
      this.restSizes.set(
        id,
        wheel
          ? measureLocalSize(wheel.spin, wheel.spin)
          : measureLocalSize(entity, entity),
      );
    }
    for (const primitive of this.currentDocument.primitiveInstances) {
      this.rememberSelection(instanceRoots.get(primitive.id)!, {
        id: primitive.id,
        kind: "primitive",
      });
    }
    for (const instance of this.currentDocument.componentInstances) {
      this.rememberSelection(instanceRoots.get(instance.id)!, {
        id: instance.id,
        kind: "component",
      });
    }

    const documentCenter = getRenderedKartBounds(this.documentRoot)?.center;
    if (documentCenter) {
      this.options.onDocumentBoundsChange(toVector(documentCenter));
    }
    if (this.explodeShown > 0) this.applyExplode();
    this.applyWheelPoses();
    this.refreshSelection();
  }

  /** Eases the exploded view toward its target, and draws the gap measured. */
  private updateView(deltaSeconds: number) {
    if (this.pendingCables) {
      const started = performance.now();
      this.showCables(this.pendingCables);
      this.pendingCables = null;
      // One slow route (a pause for garbage collection) isn't a big draft.
      this.slowCableRoutes =
        performance.now() - started > SLOW_CABLE_ROUTING_MS
          ? this.slowCableRoutes + 1
          : 0;
      if (this.slowCableRoutes >= 2) {
        this.cablesHeldForDrag = true;
        if (this.cables) this.cables.enabled = false;
      }
    }
    const target = this.view.explode;
    if (this.explodeShown !== target) {
      const eased =
        this.explodeShown +
        (target - this.explodeShown) *
          (1 - Math.exp(-deltaSeconds / EXPLODE_EASING_SECONDS));
      this.explodeShown = Math.abs(target - eased) < 0.002 ? target : eased;
      this.applyExplode();
      if (this.explodeShown === 0) this.refreshGizmo();
    }
    this.drawMeasurement();
  }

  private applyExplode() {
    const amount = this.explodeShown;
    for (const [id, entity] of this.instanceEntities) {
      const assembled = this.assembledPositions.get(id);
      const offset = this.explodeOffsets.get(id);
      if (!assembled || !offset) continue;
      entity.setLocalPosition(
        assembled.x + offset.x * amount,
        assembled.y + offset.y * amount,
        assembled.z + offset.z * amount,
      );
    }
    // Tie rods, driveshafts, and cables join parts that move apart, so
    // they hide.
    for (const wheel of this.wheels) {
      if (wheel.tieRod) wheel.tieRod.rod.enabled = amount === 0;
      if (wheel.driveshaft) wheel.driveshaft.bone.enabled = amount === 0;
    }
    if (this.cables) this.cables.enabled = amount === 0;
  }

  private applyWheelPoses() {
    const poses = this.view.wheelPoses;
    // Every steered pivot turns first: a tie rod aims from the horn, which
    // turns with all of them.
    for (const wheel of this.wheels) {
      wheel.pivot.setLocalEulerAngles(
        0,
        poses?.get(wheel.instanceId)?.steerDegrees ?? 0,
        0,
      );
    }
    for (const wheel of this.wheels) {
      poseKartWheelVisual(
        wheel,
        wheel.hub.y + (poses?.get(wheel.instanceId)?.travel ?? 0),
      );
    }
  }

  /**
   * X-ray looks past every part but the selection and the part it is
   * measured against, or with neither, past the authored structure.
   */
  private refreshXray() {
    const focus = new Set(
      [this.selection?.id, this.view.measureTargetId].filter(
        (id): id is string => Boolean(id),
      ),
    );
    const structure = new Set(
      this.currentDocument.primitiveInstances.map(({ id }) => id),
    );
    const ghosted = new Set(
      this.view.xray
        ? [...this.instanceEntities.keys()].filter((id) =>
            focus.size > 0 ? !focus.has(id) : structure.has(id),
          )
        : [],
    );
    // Cables fade with the parts around a focus, and show through structure.
    if (this.view.xray && focus.size > 0) ghosted.add(KART_CABLES_ID);
    for (const [id, materials] of this.instanceMaterialById) {
      const ghost = ghosted.has(id);
      for (const material of materials) this.setMaterialGhosted(material, ghost);
      if (ghost !== this.ghostedIds.has(id)) {
        this.getXrayEntity(id)?.forEach((node) => {
          const render = node instanceof pc.Entity ? node.render : null;
          if (!render) return;
          // Parts looked past cast no shadow; each keeps its own otherwise.
          // The render component also keeps the layers' caster lists.
          if (ghost) {
            castsShadow.set(render, render.castShadows);
            render.castShadows = false;
          } else {
            render.castShadows = castsShadow.get(render) ?? render.castShadows;
            // The setter lists a hidden part's casters too (a linkage hidden
            // while exploded); showing it lists them again.
            if (!render.entity.enabled || !render.enabled) {
              for (const layerId of render.layers) {
                this.app.scene.layers
                  .getLayerById(layerId)
                  ?.removeShadowCasters([...render.meshInstances]);
              }
            }
          }
        });
      }
    }
    this.ghostedIds = ghosted;
  }

  private setMaterialGhosted(material: pc.StandardMaterial, ghost: boolean) {
    if (ghost === this.ghostedMaterials.has(material)) return;
    if (ghost) this.ghostedMaterials.add(material);
    else this.ghostedMaterials.delete(material);
    material.blendType = ghost ? pc.BLEND_NORMAL : pc.BLEND_NONE;
    material.opacity = ghost ? XRAY_OPACITY : 1;
    material.depthWrite = !ghost;
    material.update();
  }

  private drawMeasurement() {
    const measurement = this.view.measurement;
    if (!measurement || this.explodeShown > 0) {
      this.measureLabel.hidden = true;
      return;
    }
    const { distance, pointA, pointB } = measurement;
    const color =
      distance < -MEASURE_TOUCHING
        ? MEASURE_COLORS.overlap
        : distance < MEASURE_TIGHT
          ? MEASURE_COLORS.tight
          : MEASURE_COLORS.clear;
    const line = measureLineColor(color);
    const start = new pc.Vec3(pointA.x, pointA.y, pointA.z);
    const end = new pc.Vec3(pointB.x, pointB.y, pointB.z);
    this.app.drawLine(start, end, line, false);
    for (const point of [start, end]) {
      for (const axis of [pc.Vec3.RIGHT, pc.Vec3.UP, pc.Vec3.BACK]) {
        const arm = axis.clone().mulScalar(0.003);
        this.app.drawLine(
          point.clone().sub(arm),
          point.clone().add(arm),
          line,
          false,
        );
      }
    }
    const middle = this.worldToCanvasPoint(start.clone().add(end).mulScalar(0.5));
    if (!middle) {
      this.measureLabel.hidden = true;
      return;
    }
    const text = formatKartGap(distance);
    if (this.measureLabel.textContent !== text) {
      this.measureLabel.textContent = text;
    }
    this.measureLabel.style.borderColor = color.css;
    this.measureLabel.style.color = color.css;
    this.measureLabel.style.transform = `translate(${middle.x + 10}px, ${middle.y - 12}px)`;
    this.measureLabel.hidden = false;
  }

  // Per instance, so selection highlights one instance's finishes.
  private createInstanceMaterial(instanceId: string, finish: KartPartFinish) {
    const material = createKartVisualMaterial(finish);
    this.instanceMaterialById.set(instanceId, [
      ...(this.instanceMaterialById.get(instanceId) ?? []),
      material,
    ]);
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
    this.refreshXray();
    this.refreshGizmo();
    this.options.onSelectionSizeChange(
      this.selection ? (this.restSizes.get(this.selection.id) ?? null) : null,
    );
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
      const materials = this.instanceMaterialById.get(id) ?? [];
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
      materials.forEach((material) => {
        material.emissive.set(emissive[0], emissive[1], emissive[2]);
        material.update();
      });
      root.forEach((node) => {
        if (!(node instanceof pc.Entity)) return;
        node.render?.meshInstances?.forEach((mesh) => {
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
    // Pulled apart or posed, the kart shows parts where they don't stand.
    if (!this.canEdit()) return;
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

function toVector(value: { x: number; y: number; z: number }) {
  return { x: value.x, y: value.y, z: value.z };
}

const castsShadow = new WeakMap<pc.RenderComponent, boolean>();
// Routing slower than this mid-drag would stutter it.
const SLOW_CABLE_ROUTING_MS = 12;

// Specs import this module without a working PlayCanvas, so the colors are
// made when first drawn.
const MEASURE_COLORS = {
  clear: { css: "#8fd0ff", rgb: [0.56, 0.82, 1] },
  overlap: { css: "#ff6a5f", rgb: [1, 0.42, 0.37] },
  tight: { css: "#f5c04a", rgb: [0.96, 0.75, 0.29] },
} as const;
const measureLineColors = new Map<string, pc.Color>();
function measureLineColor({ css, rgb }: (typeof MEASURE_COLORS)[keyof typeof MEASURE_COLORS]) {
  let color = measureLineColors.get(css);
  if (!color) {
    color = new pc.Color(rgb[0], rgb[1], rgb[2]);
    measureLineColors.set(css, color);
  }
  return color;
}

function createMeasureLabel() {
  const label = document.createElement("div");
  label.hidden = true;
  // The inspector reads the gap out; this label only shows it.
  label.dataset.testid = "kart-measure-label";
  label.setAttribute("aria-hidden", "true");
  Object.assign(label.style, {
    background: "rgb(0 0 0 / 0.86)",
    border: "1px solid",
    font: "700 11px/1.2 var(--font-mono, ui-monospace, monospace)",
    left: "0",
    padding: "3px 6px",
    pointerEvents: "none",
    position: "absolute",
    top: "0",
    whiteSpace: "nowrap",
    zIndex: "5",
  });
  return label;
}

const meshPositions = new WeakMap<pc.Mesh, number[]>();

/**
 * Visits each drawn vertex under `part` in the frame `toFrame` maps world
 * space into (world space without it). Vertices, not bounding boxes, so a
 * turned piece's box never reads as larger than the piece.
 */
function forEachVertex(
  part: pc.Entity,
  toFrame: pc.Mat4 | null,
  visit: (point: pc.Vec3, node: pc.Entity) => void,
) {
  const transform = new pc.Mat4();
  const point = new pc.Vec3();
  part.forEach((node) => {
    if (!(node instanceof pc.Entity) || !node.enabled) return;
    node.render?.meshInstances?.forEach((meshInstance) => {
      let positions = meshPositions.get(meshInstance.mesh);
      if (!positions) {
        positions = [];
        meshInstance.mesh.getPositions(positions);
        meshPositions.set(meshInstance.mesh, positions);
      }
      if (toFrame) transform.mul2(toFrame, meshInstance.node.getWorldTransform());
      else transform.copy(meshInstance.node.getWorldTransform());
      for (let index = 0; index + 2 < positions.length; index += 3) {
        point.set(positions[index], positions[index + 1], positions[index + 2]);
        transform.transformPoint(point, point);
        visit(point, node);
      }
    });
  });
}

/** The size of what `part` draws, along `frame`'s own axes. */
function measureLocalSize(frame: pc.Entity, part: pc.Entity) {
  const toFrame = new pc.Mat4()
    .setTRS(frame.getPosition(), frame.getRotation(), pc.Vec3.ONE)
    .invert();
  const minimum = new pc.Vec3(Infinity, Infinity, Infinity);
  const maximum = new pc.Vec3(-Infinity, -Infinity, -Infinity);
  forEachVertex(part, toFrame, (point) => {
    minimum.min(point);
    maximum.max(point);
  });
  if (!Number.isFinite(minimum.x)) return null;
  return {
    x: maximum.x - minimum.x,
    y: maximum.y - minimum.y,
    z: maximum.z - minimum.z,
  };
}

/**
 * How high the lowest drawn part but the tires stands above the ground the
 * tires rest on, at rest.
 */
function measureGroundClearance(root: pc.Entity, wheels: KartWheelVisual[]) {
  const tires = new Set<pc.GraphNode>();
  wheels.forEach(({ spin }) => spin.forEach((node) => tires.add(node)));
  let ground = Number.POSITIVE_INFINITY;
  let lowest = Number.POSITIVE_INFINITY;
  forEachVertex(root, null, (point, node) => {
    if (tires.has(node)) ground = Math.min(ground, point.y);
    else lowest = Math.min(lowest, point.y);
  });
  return Number.isFinite(ground) && Number.isFinite(lowest)
    ? lowest - ground
    : null;
}
