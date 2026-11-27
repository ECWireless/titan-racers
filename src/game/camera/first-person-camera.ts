import * as pc from "playcanvas";

import type { Position3 } from "../contracts";
import {
  type ChaseCamera,
  type ChaseCameraSnapshot,
  type ObstructionQuery,
  smoothFactor,
} from "./chase-camera";

// The onboard camera rides at the kart's nose, centred, on a short mast a
// hand's height above the parts there, as a nose camera on a real RC car
// does: none of the kart is in view, so no frame or body shell can block
// it, and it sees the road from about 26 cm up on the default kart. Looking behind cuts to a
// matching camera at the tail. Each sits a little beyond the kart so that,
// however far it settles from its mount, nothing of the kart is in front of
// the lens.
const NOSE_DEPTH = 0.15;
const MOUNT_AHEAD = 0.02;
// Half the centre band checked for parts, as a share of the kart's width;
// the wheels at its sides are outside it.
const MOUNT_BAND = 0.25;
const MOUNT_CLEARANCE = 0.11;
// Side to side on a wide screen, the least on an upright phone, and what
// top speed adds; tall views are capped so a phone isn't a fisheye.
const HORIZONTAL_FOV = 90;
const MINIMUM_HORIZONTAL_FOV = 70;
const SPEED_HORIZONTAL_FOV = 5;
const MAXIMUM_VERTICAL_FOV = 75;
const FOV_SHARPNESS = 4;
// Bumps and suspension settle over about a tenth of a second; a quarter of
// the kart's lean is kept, so a hard corner is felt but the horizon holds.
const SETTLE_SHARPNESS = 10;
// However the kart moves (a climb, a rise, a landing), the lens never
// strays further than this from its mount, so it can't sink into the body.
const MAXIMUM_LENS_DRIFT = 0.02;
const ROLL_KEPT = 0.25;
// The aim's pitch lags the kart's by no more than this, so a sudden flip of
// the nose can't swing the kart into view.
const MAXIMUM_PITCH_LAG = (20 * Math.PI) / 180;
// Against a wall or bank, the lens stops this far short of it, so the near
// clip never reaches through.
const WALL_MARGIN = 0.03;
// The chase's hit nudge, scaled for a camera on the kart.
const IMPACT_SHARE = 0.35;
// On its side or roof (tipped past about 70 degrees) the onboard view would
// roll with it: the chase shows until the kart is upright again for a
// moment. Spins and wall hits stay onboard.
const TUMBLE_UPRIGHT = 0.34;
const STEADY_UPRIGHT = 0.85;
const STEADY_SECONDS = 0.5;

/** Close enough that the ground just ahead of the nose draws. */
export const FIRST_PERSON_NEAR_CLIP = 0.01;

export type KartBox = { maximum: Position3; minimum: Position3 };

export type FirstPersonMounts = { front: Position3; rear: Position3 };

/**
 * Where the onboard cameras sit, facing forward at the nose and back at the
 * tail, in the kart visual's own frame (forward is -z), from the boxes of its
 * drawn parts.
 */
export function findFirstPersonMounts(
  boxes: readonly KartBox[],
): FirstPersonMounts {
  const minimum = { x: Infinity, y: Infinity, z: Infinity };
  const maximum = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const box of boxes) {
    for (const axis of ["x", "y", "z"] as const) {
      minimum[axis] = Math.min(minimum[axis], box.minimum[axis]);
      maximum[axis] = Math.max(maximum[axis], box.maximum[axis]);
    }
  }
  const x = (minimum.x + maximum.x) / 2;
  const depth = NOSE_DEPTH * (maximum.z - minimum.z);
  const band = MOUNT_BAND * (maximum.x - minimum.x);
  // Just above the centre parts within `depth` of the end, and ahead of it.
  const at = (end: "front" | "rear"): Position3 => {
    let top = -Infinity;
    for (const box of boxes) {
      const nearEnd =
        end === "front"
          ? box.minimum.z <= minimum.z + depth
          : box.maximum.z >= maximum.z - depth;
      if (nearEnd && box.minimum.x <= x + band && box.maximum.x >= x - band) {
        top = Math.max(top, box.maximum.y);
      }
    }
    return {
      x,
      y: (top === -Infinity ? maximum.y : top) + MOUNT_CLEARANCE,
      z: end === "front" ? minimum.z - MOUNT_AHEAD : maximum.z + MOUNT_AHEAD,
    };
  };
  return { front: at("front"), rear: at("rear") };
}

/** The drawn parts' boxes in `root`'s own frame. */
export function collectKartBoxes(root: pc.Entity): KartBox[] {
  const toRoot = root.getWorldTransform().clone().invert();
  const toRootFromNode = new pc.Mat4();
  const corner = new pc.Vec3();
  const boxes: KartBox[] = [];
  root.forEach((node) => {
    if (!(node instanceof pc.Entity)) return;
    node.render?.meshInstances?.forEach((instance) => {
      toRootFromNode.mul2(toRoot, instance.node.getWorldTransform());
      const { center, halfExtents } = instance.mesh.aabb;
      const box: KartBox = {
        maximum: { x: -Infinity, y: -Infinity, z: -Infinity },
        minimum: { x: Infinity, y: Infinity, z: Infinity },
      };
      for (let index = 0; index < 8; index += 1) {
        corner.set(
          center.x + (index & 1 ? 1 : -1) * halfExtents.x,
          center.y + (index & 2 ? 1 : -1) * halfExtents.y,
          center.z + (index & 4 ? 1 : -1) * halfExtents.z,
        );
        toRootFromNode.transformPoint(corner, corner);
        for (const axis of ["x", "y", "z"] as const) {
          box.minimum[axis] = Math.min(box.minimum[axis], corner[axis]);
          box.maximum[axis] = Math.max(box.maximum[axis], corner[axis]);
        }
      }
      boxes.push(box);
    });
  });
  return boxes;
}

function verticalFov(horizontalDegrees: number, aspect: number) {
  const half = (horizontalDegrees * Math.PI) / 360;
  return (360 / Math.PI) * Math.atan(Math.tan(half) / aspect);
}

/** The onboard camera's vertical field of view, degrees. */
export function firstPersonVerticalFov(aspect: number, speedRatio: number) {
  const speed = SPEED_HORIZONTAL_FOV * speedRatio;
  return Math.max(
    Math.min(verticalFov(HORIZONTAL_FOV + speed, aspect), MAXIMUM_VERTICAL_FOV),
    verticalFov(MINIMUM_HORIZONTAL_FOV + speed, aspect),
  );
}

/**
 * The onboard view. It follows the chase camera, which keeps running
 * underneath: the chase shows while the kart tumbles, and its snaps and
 * hit nudges carry over here.
 */
export class FirstPersonCamera {
  private readonly position = new pc.Vec3();
  private readonly mountPosition = new pc.Vec3();
  private readonly rearMountPosition = new pc.Vec3();
  private readonly lastKartPosition = new pc.Vec3();
  private readonly travel = new pc.Vec3();
  private readonly forward = new pc.Vec3();
  private readonly flatForward = new pc.Vec3();
  private readonly right = new pc.Vec3();
  private readonly kartAxis = new pc.Vec3();
  private readonly scratch = new pc.Vec3();
  private readonly viewUp = new pc.Vec3();
  private readonly target = new pc.Vec3();
  private readonly eye = new pc.Vec3();
  private readonly pivot = new pc.Vec3();
  private readonly probe = new pc.Vec3();
  private readonly mount: pc.Vec3;
  private readonly rearMount: pc.Vec3;
  private pitch = 0;
  private roll = 0;
  private fov = 60;
  private lastSnap = -1;
  private settled = false;
  private steadySeconds = 0;
  private tumbling = false;

  constructor(
    private readonly camera: pc.Entity,
    private readonly canvas: HTMLCanvasElement,
    private readonly chase: ChaseCamera,
    { front, rear }: FirstPersonMounts,
    private readonly queryObstruction: ObstructionQuery = () => null,
  ) {
    this.mount = new pc.Vec3(front.x, front.y, front.z);
    this.rearMount = new pc.Vec3(rear.x, rear.y, rear.z);
  }

  /** The widest view the camera opens to at speed, degrees. */
  get maximumFov() {
    return firstPersonVerticalFov(this.aspect(), 1);
  }

  /** Whether the onboard view shows, rather than the chase while tumbling. */
  get onboard() {
    return this.settled && !this.tumbling;
  }

  /**
   * Places the onboard view after the chase has updated this frame, unless
   * the kart is tumbling, when the chase's view stays.
   */
  update(deltaSeconds: number, snapshot: ChaseCameraSnapshot) {
    const frameSeconds = Math.min(Math.max(deltaSeconds, 0), 0.1);
    const up = snapshot.up;
    // A snap (reset, recovery, teleport) starts afresh, tumble included.
    if (this.chase.snaps !== this.lastSnap) {
      this.lastSnap = this.chase.snaps;
      this.reset();
    }
    snapshot.rotation.transformVector(pc.Vec3.UP, this.kartAxis);
    const upright = this.kartAxis.dot(up);
    if (!this.tumbling && upright < TUMBLE_UPRIGHT) {
      this.tumbling = true;
      this.steadySeconds = 0;
    } else if (this.tumbling) {
      const steady = upright > STEADY_UPRIGHT;
      this.steadySeconds = steady ? this.steadySeconds + frameSeconds : 0;
      if (this.steadySeconds >= STEADY_SECONDS) {
        this.tumbling = false;
        this.settled = false;
      }
    }
    if (this.tumbling) return;

    snapshot.rotation.transformVector(this.mount, this.mountPosition);
    this.mountPosition.add(snapshot.position);
    snapshot.rotation.transformVector(this.rearMount, this.rearMountPosition);
    this.rearMountPosition.add(snapshot.position);
    snapshot.rotation.transformVector(pc.Vec3.FORWARD, this.forward);
    const pitch = Math.asin(Math.min(Math.max(this.forward.dot(up), -1), 1));
    snapshot.rotation.transformVector(pc.Vec3.RIGHT, this.kartAxis);
    const roll = -Math.asin(Math.min(Math.max(this.kartAxis.dot(up), -1), 1));
    const fov = firstPersonVerticalFov(this.aspect(), this.chase.speedRatio);

    if (!this.settled) {
      this.position.copy(this.mountPosition);
      this.pitch = pitch;
      this.roll = roll;
      this.fov = fov;
      this.settled = true;
    } else {
      // Across the ground the camera stays on the kart; bumps, bounce, and
      // the mount swinging as the kart pitches settle out.
      this.travel.copy(snapshot.position).sub(this.lastKartPosition);
      this.travel.sub(this.scratch.copy(up).mulScalar(this.travel.dot(up)));
      const settle = smoothFactor(SETTLE_SHARPNESS, frameSeconds);
      this.position
        .add(this.travel)
        .lerp(this.position, this.mountPosition, settle);
      this.holdNear(this.position, this.mountPosition);

      this.pitch += (pitch - this.pitch) * settle;
      this.pitch = Math.min(
        Math.max(this.pitch, pitch - MAXIMUM_PITCH_LAG),
        pitch + MAXIMUM_PITCH_LAG,
      );
      this.roll += (roll - this.roll) * settle;
      this.fov += (fov - this.fov) * smoothFactor(FOV_SHARPNESS, frameSeconds);
    }
    this.lastKartPosition.copy(snapshot.position);
    this.apply(up, snapshot.lookBehind);
  }

  /** Off: the next update places the view afresh. */
  reset() {
    this.settled = false;
    this.tumbling = false;
  }

  /** Cuts to the forward onboard view at once, as when a race pauses. */
  lookForward(up: pc.Vec3) {
    if (this.onboard) this.apply(up, false);
  }

  private apply(up: pc.Vec3, lookBehind: boolean) {
    // Heading follows the kart at once; pitch follows slopes; a quarter of
    // the lean tilts the horizon.
    this.flatForward
      .copy(this.forward)
      .sub(this.scratch.copy(up).mulScalar(this.forward.dot(up)));
    if (this.flatForward.lengthSq() < 1e-8) return;
    this.flatForward.normalize();
    this.right.cross(this.flatForward, up).normalize();
    const lean = ROLL_KEPT * this.roll;
    this.viewUp
      .copy(up)
      .mulScalar(Math.cos(lean))
      .add(this.scratch.copy(this.right).mulScalar(Math.sin(lean)));
    this.target
      .copy(this.flatForward)
      .mulScalar(Math.cos(this.pitch))
      .add(this.scratch.copy(up).mulScalar(Math.sin(this.pitch)));
    // Looking behind, the tail camera faces back, settled as the nose one.
    const mount = lookBehind ? this.rearMountPosition : this.mountPosition;
    if (lookBehind) this.target.mulScalar(-1);
    this.eye
      .copy(this.chase.impactNudge)
      .mulScalar(IMPACT_SHARE)
      .add(this.position)
      .sub(this.mountPosition)
      .add(mount);
    this.holdNear(this.eye, mount);
    this.holdShortOfWalls();
    this.camera.setPosition(this.eye);
    this.camera.lookAt(this.target.add(this.eye), this.viewUp);
    if (this.camera.camera) this.camera.camera.fov = this.fov;
  }

  // From the kart's middle at lens height out past the lens: a wall or bank
  // within the margin of the lens (the nose pressed to a wall, square or
  // not) holds the lens that far short of it.
  private holdShortOfWalls() {
    this.pivot
      .copy(this.mountPosition)
      .add(this.rearMountPosition)
      .mulScalar(0.5);
    this.scratch.copy(this.eye).sub(this.pivot);
    const reach = this.scratch.length();
    if (reach < 1e-6) return;
    this.scratch.mulScalar(1 / reach);
    this.probe
      .copy(this.scratch)
      .mulScalar(reach + WALL_MARGIN)
      .add(this.pivot);
    const hit = this.queryObstruction(this.pivot, this.probe);
    if (!hit) return;
    const clear = Math.max(hit.point.distance(this.pivot) - WALL_MARGIN, 0);
    if (clear < reach) {
      this.eye.copy(this.pivot).add(this.scratch.mulScalar(clear));
    }
  }

  private holdNear(lens: pc.Vec3, mount: pc.Vec3) {
    const drift = this.scratch.copy(lens).sub(mount);
    if (drift.length() > MAXIMUM_LENS_DRIFT) {
      lens.copy(mount).add(drift.normalize().mulScalar(MAXIMUM_LENS_DRIFT));
    }
  }

  private aspect() {
    const height = this.canvas.clientHeight;
    return height > 0 ? this.canvas.clientWidth / height : 16 / 9;
  }
}
