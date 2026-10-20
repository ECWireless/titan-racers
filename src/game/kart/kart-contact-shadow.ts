import * as pc from "playcanvas";

import { getCourseSurfaceLayerDepthBias } from "../course/course-visual-policy";

// The habitat light comes from the whole environment, and the renderer does
// not occlude it. The kart darkens the ground beneath it here instead, the way
// a real chassis blocks surrounding light, and the effect fades as it lifts.
const MAX_OPACITY = 0.55;
const FADE_HEIGHT = 0.5;
const MAX_GROUND_ABOVE_CONTACT = 0.05;
const FOOTPRINT_MARGIN = 1.15;
const FALLOFF_SIZE = 64;

let falloffPixels: Uint8Array | undefined;

function getFalloffPixels() {
  if (falloffPixels) return falloffPixels;
  const pixels = new Uint8Array(FALLOFF_SIZE * FALLOFF_SIZE * 4);
  for (let y = 0; y < FALLOFF_SIZE; y++) {
    for (let x = 0; x < FALLOFF_SIZE; x++) {
      const u = ((x + 0.5) / FALLOFF_SIZE) * 2 - 1;
      const v = ((y + 0.5) / FALLOFF_SIZE) * 2 - 1;
      // A soft rounded rectangle: dark in the middle, clear at the edges.
      const edge = (u ** 4 + v ** 4) ** 0.25;
      const falloff = 1 - Math.min(1, Math.max(0, (edge - 0.45) / 0.55));
      const value = Math.round(255 * falloff * falloff);
      pixels.fill(value, (y * FALLOFF_SIZE + x) * 4, (y * FALLOFF_SIZE + x) * 4 + 4);
    }
  }
  falloffPixels = pixels;
  return pixels;
}

export type KartContactFootprint = {
  centerX: number;
  centerZ: number;
  contactPlaneY: number;
  length: number;
  width: number;
};

/** Footprint in kart assembly space, from the wheel stations. */
export function getKartContactFootprint(
  wheels: ReadonlyArray<{
    position: { x: number; y: number; z: number };
    radius: number;
  }>,
): KartContactFootprint {
  const xs = wheels.map((wheel) => wheel.position.x);
  const zs = wheels.map((wheel) => wheel.position.z);
  const radius = Math.max(...wheels.map((wheel) => wheel.radius));
  return {
    centerX: (Math.min(...xs) + Math.max(...xs)) / 2,
    centerZ: (Math.min(...zs) + Math.max(...zs)) / 2,
    contactPlaneY:
      wheels.reduce((sum, wheel) => sum + wheel.position.y - wheel.radius, 0) /
      wheels.length,
    length: (Math.max(...zs) - Math.min(...zs) + radius * 2) * FOOTPRINT_MARGIN,
    width: (Math.max(...xs) - Math.min(...xs) + radius) * FOOTPRINT_MARGIN,
  };
}

export type KartContactShadowGround = (
  from: pc.Vec3,
  to: pc.Vec3,
) => { normal: pc.Vec3; point: pc.Vec3 } | null;

export class KartContactShadow {
  readonly entity: pc.Entity;
  private readonly material: pc.StandardMaterial;
  private readonly meshInstance: pc.MeshInstance;
  private readonly texture: pc.Texture;
  private readonly center = new pc.Vec3();
  private readonly contact = new pc.Vec3();
  private readonly rayFrom = new pc.Vec3();
  private readonly rayTo = new pc.Vec3();
  private readonly forward = new pc.Vec3();
  private readonly target = new pc.Vec3();

  constructor(
    app: pc.AppBase,
    private readonly footprint: KartContactFootprint,
  ) {
    const device = app.graphicsDevice;
    this.texture = new pc.Texture(device, {
      name: "kart-contact-shadow",
      width: FALLOFF_SIZE,
      height: FALLOFF_SIZE,
      format: pc.PIXELFORMAT_RGBA8,
      levels: [getFalloffPixels()],
      mipmaps: true,
      addressU: pc.ADDRESS_CLAMP_TO_EDGE,
      addressV: pc.ADDRESS_CLAMP_TO_EDGE,
    });
    this.material = new pc.StandardMaterial();
    this.material.useLighting = false;
    this.material.useSkybox = false;
    this.material.diffuse = new pc.Color(0, 0, 0);
    this.material.emissive = new pc.Color(0, 0, 0);
    this.material.opacityMap = this.texture;
    this.material.opacityMapChannel = "r";
    this.material.blendType = pc.BLEND_NORMAL;
    this.material.depthWrite = false;
    this.material.depthBias = getCourseSurfaceLayerDepthBias("contactShadow");
    this.material.slopeDepthBias = this.material.depthBias;
    this.material.update();

    const mesh = pc.Mesh.fromGeometry(
      device,
      new pc.PlaneGeometry({ halfExtents: new pc.Vec2(0.5, 0.5) }),
    );
    this.meshInstance = new pc.MeshInstance(mesh, this.material);
    this.entity = new pc.Entity("kart-contact-shadow");
    this.entity.addComponent("render", {
      castShadows: false,
      meshInstances: [this.meshInstance],
      receiveShadows: false,
    });
    this.entity.setLocalScale(footprint.width, 1, footprint.length);
    app.root.addChild(this.entity);
  }

  /** Lays the shadow on the ground beneath the kart's presented pose. */
  update(kartVisual: pc.GraphNode, findGround: KartContactShadowGround) {
    const transform = kartVisual.getWorldTransform();
    transform.transformPoint(
      this.contact.set(
        this.footprint.centerX,
        this.footprint.contactPlaneY,
        this.footprint.centerZ,
      ),
      this.center,
    );
    this.rayFrom.set(this.center.x, this.center.y + 0.5, this.center.z);
    this.rayTo.set(this.center.x, this.center.y - FADE_HEIGHT - 1, this.center.z);
    const found = findGround(this.rayFrom, this.rayTo);
    // A surface above the contact plane is something the kart is under.
    const ground =
      found && found.point.y <= this.center.y + MAX_GROUND_ABOVE_CONTACT
        ? found
        : null;
    const gap = ground ? Math.max(0, this.center.y - ground.point.y) : Infinity;
    const opacity = MAX_OPACITY * pc.math.clamp(1 - gap / FADE_HEIGHT, 0, 1);

    this.entity.enabled = opacity > 0;
    if (!ground || opacity <= 0) return;

    this.meshInstance.setParameter("material_opacity", opacity);
    // Keep the kart's heading, laid flat on the surface it is over.
    const normal = ground.normal;
    this.forward.copy(kartVisual.forward);
    this.forward.sub(
      this.target.copy(normal).mulScalar(this.forward.dot(normal)),
    );
    if (this.forward.lengthSq() < 1e-6) return;
    this.forward.normalize();
    this.entity.setPosition(ground.point);
    this.entity.lookAt(this.target.add2(ground.point, this.forward), normal);
  }

  destroy() {
    this.entity.destroy();
    this.material.destroy();
    this.texture.destroy();
  }
}
