import * as pc from "playcanvas";

export type EditorTransformTool = "translate" | "rotate" | "scale";

export const EDITOR_TRANSLATE_SNAP = 0.25;
export const EDITOR_ROTATE_SNAP = 5;
export const EDITOR_SCALE_SNAP = 0.1;

export class EditorOrbitCamera {
  readonly pivot = new pc.Vec3();
  distance: number;
  pitch: number;
  yaw: number;
  private readonly maximumDistance: number;
  private readonly minimumDistance: number;
  private readonly maximumPitch: number;
  private readonly minimumPitch: number;

  constructor(options: {
    distance: number;
    maximumDistance: number;
    maximumPitch?: number;
    minimumDistance: number;
    minimumPitch?: number;
    pitch: number;
    yaw: number;
  }) {
    this.distance = options.distance;
    this.maximumDistance = options.maximumDistance;
    this.maximumPitch = options.maximumPitch ?? 86;
    this.minimumDistance = options.minimumDistance;
    this.minimumPitch = options.minimumPitch ?? 22;
    this.pitch = options.pitch;
    this.yaw = options.yaw;
  }

  apply(camera: pc.Entity) {
    const yaw = (this.yaw * Math.PI) / 180;
    const pitch = (this.pitch * Math.PI) / 180;
    const horizontal = Math.cos(pitch) * this.distance;
    camera.setPosition(
      this.pivot.x + Math.sin(yaw) * horizontal,
      this.pivot.y + Math.sin(pitch) * this.distance,
      this.pivot.z + Math.cos(yaw) * horizontal,
    );
    camera.lookAt(this.pivot);
  }

  orbit(yawDelta: number, pitchDelta: number) {
    this.yaw += yawDelta;
    this.pitch = clamp(
      this.pitch + pitchDelta,
      this.minimumPitch,
      this.maximumPitch,
    );
  }

  pan(xDelta: number, yDelta: number, scaleFactor = 0.0018) {
    const yaw = (this.yaw * Math.PI) / 180;
    const forward = new pc.Vec3(Math.sin(yaw), 0, Math.cos(yaw));
    const right = new pc.Vec3(forward.z, 0, -forward.x);
    const scale = this.distance * scaleFactor;
    this.pivot
      .add(right.mulScalar(-xDelta * scale))
      .add(forward.mulScalar(-yDelta * scale));
  }

  zoom(delta: number) {
    this.distance = clamp(
      this.distance + delta,
      this.minimumDistance,
      this.maximumDistance,
    );
  }
}

export function createEditorTransformGizmos(
  camera: pc.CameraComponent,
  layer: pc.Layer,
  options: {
    onTransformEnd: () => void;
    onTransformMove?: () => void;
    onTransformStart: () => void;
  },
) {
  const translate = new pc.TranslateGizmo(camera, layer);
  const rotate = new pc.RotateGizmo(camera, layer);
  const scale = new pc.ScaleGizmo(camera, layer);
  (["xy", "xz", "yz"] as const).forEach((axis) =>
    scale.enableShape(axis, false),
  );
  scale.axisCenterSize = 0.24;
  scale.axisLineTolerance = 0.12;
  translate.snapIncrement = EDITOR_TRANSLATE_SNAP;
  rotate.snapIncrement = EDITOR_ROTATE_SNAP;
  scale.snapIncrement = EDITOR_SCALE_SNAP;

  [translate, rotate, scale].forEach((gizmo) => {
    gizmo.size = 1.15;
    gizmo.mouseButtons[0] = true;
    gizmo.mouseButtons[1] = false;
    gizmo.mouseButtons[2] = false;
    gizmo.on(pc.TransformGizmo.EVENT_TRANSFORMSTART, options.onTransformStart);
    if (options.onTransformMove) {
      gizmo.on(pc.TransformGizmo.EVENT_TRANSFORMMOVE, options.onTransformMove);
    }
    gizmo.on(pc.TransformGizmo.EVENT_TRANSFORMEND, options.onTransformEnd);
  });

  return { rotate, scale, translate };
}

export class EditorSelectionRegistry<T> {
  private readonly selections = new Map<pc.GraphNode, T>();

  clear() {
    this.selections.clear();
  }

  delete(node: pc.GraphNode) {
    return this.selections.delete(node);
  }

  get(node: pc.GraphNode) {
    return this.selections.get(node);
  }

  set(node: pc.GraphNode, selection: T) {
    this.selections.set(node, selection);
  }

  get size() {
    return this.selections.size;
  }
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}
