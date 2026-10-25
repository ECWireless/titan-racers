import * as pc from "playcanvas";

import {
  COURSE_LAWN_CLIPPING_COLOR,
  COURSE_TURF_CLIPPING_COLOR,
  getCourseSurfaceLayerDepthBias,
} from "../course/course-visual-policy";
import { HABITAT_WORLD_ENVIRONMENT } from "../physics/world-environment";
import type { DynamicWheelTelemetry } from "./dynamic-kart-controller";
import {
  getLateralScrubPower,
  KART_TIRE_SMOKE_POLICY,
} from "./kart-drift-smoke";

/**
 * Shared presentation policy. Marks and clippings follow tire contact and
 * slip but never feed back into the physics.
 */
export const KART_SURFACE_EFFECT_POLICY = Object.freeze({
  // Tires mark only from the same sideways scrub that makes tire smoke:
  // rubber laid on asphalt, torn turf on grass. Marks last for the race.
  markScrubFullWatts: KART_TIRE_SMOKE_POLICY.lateralScrubPowerFullWatts,
  marks: {
    // Light drifts leave no mark; committed slides do.
    asphalt: {
      capacity: 2048,
      maxOpacity: 0.25,
      scrubOnsetWatts: KART_TIRE_SMOKE_POLICY.lateralScrubPowerOnsetWatts * 2,
    },
    grass: {
      capacity: 1024,
      maxOpacity: 0.16,
      scrubOnsetWatts: KART_TIRE_SMOKE_POLICY.lateralScrubPowerOnsetWatts * 2,
    },
  },
  // The oldest quarter of a full pool fades before it is recycled.
  markPressureFraction: 0.25,
  // Long enough to keep hundreds of metres of marks in the pool, short
  // enough to follow any slide arc.
  markMinSegment: 0.15,
  // A longer jump between frames is a teleport, not a slide, even at top
  // speed through a slow frame.
  markMaxSegment: 2,
  clippingCapacity: 96,
  clippingRollingRate: 4.5,
  clippingRollingReferenceSpeed: 10,
  clippingScrubRate: 16,
  clippingLifetimeSeconds: 0.9,
  clippingFadeSeconds: 0.2,
  // Light clippings lose speed to air quickly; gravity is real.
  clippingDragPerSecond: 3,
  clippingMaxLaunchUp: 2.5,
  // Real mown clippings run 2–4 cm.
  clippingLength: 0.03,
  clippingWidth: 0.006,
});

type KartSurfaceEffectPolicy = typeof KART_SURFACE_EFFECT_POLICY;
type MarkSurface = keyof KartSurfaceEffectPolicy["marks"];

const ASPHALT_SURFACE_ID = "surface.standard-course";
const GRASS_COLORS: Readonly<Record<string, string>> = {
  "surface.lawn-grass": COURSE_LAWN_CLIPPING_COLOR,
  "surface.short-grass": COURSE_TURF_CLIPPING_COLOR,
};
const QUAD_INDICES = [0, 2, 1, 1, 2, 3];

type SurfaceEffectWheelSample = Pick<
  DynamicWheelTelemetry,
  | "appliedLateralTireForce"
  | "contactNormal"
  | "contactPoint"
  | "lateralSpeed"
  | "longitudinalSpeed"
  | "supported"
  | "surfaceMaterial"
>;

type SlipSample = Omit<
  SurfaceEffectWheelSample,
  "contactNormal" | "contactPoint"
>;

function clamp01(value: number) {
  return Math.min(Math.max(value, 0), 1);
}

function getMarkSurface(wheel: SlipSample): MarkSurface | null {
  const id = wheel.surfaceMaterial?.id ?? "";
  if (id === ASPHALT_SURFACE_ID) return "asphalt";
  return GRASS_COLORS[id] ? "grass" : null;
}

/**
 * Mark strength (0–1) for one wheel on `surface`; zero elsewhere or below
 * onset. A strip already being laid continues down to the smoke's release
 * ratio, so marks near the threshold do not break into dashes.
 */
export function getTireMarkStrength(
  wheel: SlipSample,
  surface: MarkSurface,
  marking = false,
) {
  if (!wheel.supported || getMarkSurface(wheel) !== surface) return 0;
  const policy = KART_SURFACE_EFFECT_POLICY;
  const onset = policy.marks[surface].scrubOnsetWatts;
  const threshold = marking
    ? onset * KART_TIRE_SMOKE_POLICY.releaseThresholdRatio
    : onset;
  const scrub = getLateralScrubPower(wheel);
  if (scrub < threshold) return 0;
  return Math.max(
    clamp01((scrub - onset) / (policy.markScrubFullWatts - onset)),
    0.05,
  );
}

/** Clippings per second thrown by one wheel; zero off grass. */
export function getClippingRate(wheel: SlipSample) {
  const policy = KART_SURFACE_EFFECT_POLICY;
  if (!wheel.supported || !GRASS_COLORS[wheel.surfaceMaterial?.id ?? ""]) {
    return 0;
  }
  const rolling = clamp01(
    Math.abs(wheel.longitudinalSpeed) / policy.clippingRollingReferenceSpeed,
  );
  const scrub = clamp01(
    getLateralScrubPower(wheel) / policy.markScrubFullWatts,
  );
  return (
    rolling * policy.clippingRollingRate + scrub * policy.clippingScrubRate
  );
}

type Vec3Like = { x: number; y: number; z: number };

type TrailState = {
  active: boolean;
  hasEdges: boolean;
  point: Vec3Like;
  normal: Vec3Like;
  left: Vec3Like;
  right: Vec3Like;
};

const vec = (): Vec3Like => ({ x: 0, y: 0, z: 0 });

function copy(target: Vec3Like, source: Vec3Like) {
  target.x = source.x;
  target.y = source.y;
  target.z = source.z;
}

function dot(a: Vec3Like, b: Vec3Like) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

/** target = a + b × scale */
function addScaled(target: Vec3Like, a: Vec3Like, b: Vec3Like, scale: number) {
  target.x = a.x + b.x * scale;
  target.y = a.y + b.y * scale;
  target.z = a.z + b.z * scale;
}

/**
 * A fixed ring of mark quads shared by every wheel. Each wheel extends its own
 * strip; consecutive quads share edges, so a strip has no gaps or overlaps.
 */
export class TireMarkTrails {
  readonly positions: Float32Array;
  private readonly strengths: Float32Array;
  private readonly trails: TrailState[];
  private readonly side = vec();
  private nextSlot = 0;
  private written = 0;
  readonly capacity: number;
  private readonly maxOpacity: number;
  private readonly policy = KART_SURFACE_EFFECT_POLICY;

  constructor(wheelCount: number, surface: MarkSurface) {
    this.capacity = this.policy.marks[surface].capacity;
    this.maxOpacity = this.policy.marks[surface].maxOpacity;
    this.positions = new Float32Array(this.capacity * 12);
    this.strengths = new Float32Array(this.capacity);
    this.trails = Array.from({ length: wheelCount }, () => ({
      active: false,
      hasEdges: false,
      left: vec(),
      normal: vec(),
      point: vec(),
      right: vec(),
    }));
  }

  isMarking(wheelIndex: number) {
    return this.trails[wheelIndex].active;
  }

  get isEmpty() {
    return this.written === 0;
  }

  /**
   * Extends a wheel's strip to `point` on a surface with `normal`, or ends it
   * when `strength` is zero. Returns whether a quad was written.
   */
  sample(
    wheelIndex: number,
    point: Vec3Like,
    normal: Vec3Like,
    halfWidth: number,
    strength: number,
  ) {
    const trail = this.trails[wheelIndex];
    if (strength <= 0) {
      trail.active = false;
      return false;
    }
    const dx = point.x - trail.point.x;
    const dy = point.y - trail.point.y;
    const dz = point.z - trail.point.z;
    const distance = trail.active ? Math.hypot(dx, dy, dz) : 0;
    if (
      !trail.active ||
      distance > this.policy.markMaxSegment ||
      dot(trail.normal, normal) < 0.999
    ) {
      trail.active = true;
      trail.hasEdges = false;
      copy(trail.point, point);
      copy(trail.normal, normal);
      return false;
    }
    if (distance < this.policy.markMinSegment) return false;

    // Half the tire width across the direction of travel, on the surface.
    // Crossing with the normal drops any travel along it.
    this.side.x = dy * normal.z - dz * normal.y;
    this.side.y = dz * normal.x - dx * normal.z;
    this.side.z = dx * normal.y - dy * normal.x;
    const sideLength = Math.hypot(this.side.x, this.side.y, this.side.z);
    if (sideLength < 1e-6) return false;
    const sideScale = halfWidth / sideLength;
    if (!trail.hasEdges) {
      addScaled(trail.left, trail.point, this.side, -sideScale);
      addScaled(trail.right, trail.point, this.side, sideScale);
    }
    const slot = this.nextSlot;
    const offset = slot * 12;
    writeVec3(this.positions, offset, trail.left);
    writeVec3(this.positions, offset + 3, trail.right);
    addScaled(trail.left, point, this.side, -sideScale);
    addScaled(trail.right, point, this.side, sideScale);
    writeVec3(this.positions, offset + 6, trail.left);
    writeVec3(this.positions, offset + 9, trail.right);
    this.strengths[slot] = strength;
    this.nextSlot = (slot + 1) % this.capacity;
    this.written++;
    trail.hasEdges = true;
    copy(trail.point, point);
    return true;
  }

  /** Opacity of a quad: its strength, faded only as the pool runs out. */
  getAlpha(slot: number) {
    const strength = this.strengths[slot];
    if (strength <= 0) return 0;
    const capacity = this.capacity;
    const rank = (this.nextSlot - 1 - slot + capacity) % capacity;
    const pressureFade = clamp01(
      (capacity - 1 - rank) / (capacity * this.policy.markPressureFraction),
    );
    return strength * this.maxOpacity * pressureFade;
  }

  clear() {
    this.trails.forEach((trail) => {
      trail.active = false;
    });
    this.positions.fill(0);
    this.strengths.fill(0);
    this.nextSlot = 0;
    this.written = 0;
  }
}

/** A fixed pool of ballistic clippings that land on the surface they left. */
export class GrassClippingPool {
  readonly positions: Float32Array;
  readonly colors: Uint8Array;
  readonly spins: Float32Array;
  private readonly velocities: Float32Array;
  private readonly ages: Float32Array;
  private readonly planes: Float32Array;
  private live = 0;
  private seed = 20_461;
  // Habitat gravity near the kart and the spin vector (rad/s) for Coriolis.
  private readonly gravity: Vec3Like = {
    x: 0,
    y: -HABITAT_WORLD_ENVIRONMENT.gravity,
    z: 0,
  };
  private readonly habitatSpin = vec();

  private readonly policy = KART_SURFACE_EFFECT_POLICY;

  constructor() {
    const capacity = this.policy.clippingCapacity;
    this.positions = new Float32Array(capacity * 3);
    this.colors = new Uint8Array(capacity * 4);
    this.spins = new Float32Array(capacity);
    this.velocities = new Float32Array(capacity * 3);
    this.ages = new Float32Array(capacity);
    this.planes = new Float32Array(capacity * 4);
  }

  get count() {
    return this.live;
  }

  /** A repeatable 0–1 sequence, so effects never touch gameplay randomness. */
  random() {
    this.seed = (Math.imul(this.seed, 1_664_525) + 1_013_904_223) >>> 0;
    return this.seed / 4_294_967_296;
  }

  /** Returns false when the pool is full. */
  spawn(
    point: Vec3Like,
    normal: Vec3Like,
    velocity: Vec3Like,
    color: { r: number; g: number; b: number },
  ) {
    if (this.live >= this.policy.clippingCapacity) return false;
    const index = this.live++;
    writeVec3(this.positions, index * 3, point);
    writeVec3(this.velocities, index * 3, velocity);
    writeVec3(this.planes, index * 4, normal);
    this.planes[index * 4 + 3] = dot(normal, point);
    this.ages[index] = 0;
    this.spins[index] = this.random() * Math.PI;
    // Clippings vary a little in tone: some sun-dried, some fresh.
    const tone = 0.85 + this.random() * 0.3;
    this.colors[index * 4] = Math.min(255, color.r * 255 * tone);
    this.colors[index * 4 + 1] = Math.min(255, color.g * 255 * tone);
    this.colors[index * 4 + 2] = Math.min(255, color.b * 255 * tone);
    this.colors[index * 4 + 3] = 255;
    return true;
  }

  setHabitat(gravity: Vec3Like, spin: Vec3Like) {
    copy(this.gravity, gravity);
    copy(this.habitatSpin, spin);
  }

  step(seconds: number) {
    const { gravity, habitatSpin: spin } = this;
    const {
      clippingDragPerSecond,
      clippingFadeSeconds,
      clippingLifetimeSeconds,
    } = this.policy;
    const drag = Math.exp(-clippingDragPerSecond * seconds);
    for (let index = this.live - 1; index >= 0; index--) {
      const p = index * 3;
      const vx = this.velocities[p];
      const vy = this.velocities[p + 1];
      const vz = this.velocities[p + 2];
      // Gravity plus Coriolis, −2ω × v.
      this.velocities[p] +=
        (gravity.x - 2 * (spin.y * vz - spin.z * vy)) * seconds;
      this.velocities[p + 1] +=
        (gravity.y - 2 * (spin.z * vx - spin.x * vz)) * seconds;
      this.velocities[p + 2] +=
        (gravity.z - 2 * (spin.x * vy - spin.y * vx)) * seconds;
      for (let axis = 0; axis < 3; axis++) {
        this.velocities[p + axis] *= drag;
        this.positions[p + axis] += this.velocities[p + axis] * seconds;
      }
      this.ages[index] += seconds;
      const plane = index * 4;
      const height =
        this.positions[p] * this.planes[plane] +
        this.positions[p + 1] * this.planes[plane + 1] +
        this.positions[p + 2] * this.planes[plane + 2] -
        this.planes[plane + 3];
      const age = this.ages[index];
      if (age >= clippingLifetimeSeconds || (height < 0 && age > 0.05)) {
        this.remove(index);
        continue;
      }
      this.colors[index * 4 + 3] = Math.round(
        255 * clamp01((clippingLifetimeSeconds - age) / clippingFadeSeconds),
      );
    }
  }

  clear() {
    this.live = 0;
  }

  private remove(index: number) {
    const last = --this.live;
    if (index === last) return;
    this.positions.copyWithin(index * 3, last * 3, last * 3 + 3);
    this.velocities.copyWithin(index * 3, last * 3, last * 3 + 3);
    this.planes.copyWithin(index * 4, last * 4, last * 4 + 4);
    this.colors.copyWithin(index * 4, last * 4, last * 4 + 4);
    this.ages[index] = this.ages[last];
    this.spins[index] = this.spins[last];
  }
}

function writeVec3(target: Float32Array, offset: number, vector: Vec3Like) {
  target[offset] = vector.x;
  target[offset + 1] = vector.y;
  target[offset + 2] = vector.z;
}

type SurfaceEffectWheelMount = {
  pivot: pc.GraphNode;
  width: number;
};

type DynamicQuadMesh = {
  entity: pc.Entity;
  material: pc.StandardMaterial;
  mesh: pc.Mesh;
};

function createQuadMesh(
  app: pc.AppBase,
  name: string,
  quadCount: number,
  material: pc.StandardMaterial,
  withNormals: boolean,
): DynamicQuadMesh {
  const mesh = new pc.Mesh(app.graphicsDevice);
  mesh.clear(true, false, quadCount * 4, quadCount * 6);
  const indices = new Uint16Array(quadCount * 6);
  for (let quad = 0; quad < quadCount; quad++) {
    QUAD_INDICES.forEach((corner, index) => {
      indices[quad * 6 + index] = quad * 4 + corner;
    });
  }
  mesh.setPositions(new Float32Array(quadCount * 12));
  if (withNormals) mesh.setNormals(new Float32Array(quadCount * 12));
  mesh.setColors32(new Uint8Array(quadCount * 16));
  mesh.setIndices(indices);
  mesh.update(pc.PRIMITIVE_TRIANGLES, false);
  const meshInstance = new pc.MeshInstance(mesh, material);
  // Quads span the whole course, so culling by a stale box would hide them.
  meshInstance.cull = false;
  const entity = new pc.Entity(name);
  entity.addComponent("render", {
    castShadows: false,
    meshInstances: [meshInstance],
    receiveShadows: false,
  });
  app.root.addChild(entity);
  return { entity, material, mesh };
}

type MarkLayer = DynamicQuadMesh & {
  colors: Uint8Array;
  dirty: boolean;
  surface: MarkSurface;
  trails: TireMarkTrails;
};

/**
 * Race-only surface effects: marks where tires slide (rubber on asphalt,
 * torn turf on grass) that last for the race, and clippings thrown by wheels
 * on grass. Each draws as one mesh whose buffers are allocated once and
 * rewritten in place.
 */
export class KartSurfaceEffects {
  private readonly markLayers: MarkLayer[];
  private readonly clippings = new GrassClippingPool();
  private readonly flakes: DynamicQuadMesh;
  private readonly flakePositions: Float32Array;
  private readonly flakeNormals: Float32Array;
  private readonly flakeColors: Uint8Array;
  private readonly spawnDebt: Float32Array;
  private readonly grassColors = new Map(
    Object.entries(GRASS_COLORS).map(([id, hex]) => [
      id,
      new pc.Color().fromString(hex),
    ]),
  );
  private readonly point = new pc.Vec3();
  private readonly launch = new pc.Vec3();
  private readonly offset = new pc.Vec3();
  private readonly along = new pc.Vec3();
  private readonly across = new pc.Vec3();
  // Every effect draws once, empty, as the race starts, so its shader
  // compiles then instead of stalling the first slide.
  private warmUp: "pending" | "drawn" | "done" = "pending";

  /** `lightLevel` is the course's light relative to a low sun's (at most 1). */
  constructor(
    app: pc.AppBase,
    private readonly wheels: readonly SurfaceEffectWheelMount[],
    lightLevel = 1,
  ) {
    const policy = KART_SURFACE_EFFECT_POLICY;
    this.spawnDebt = new Float32Array(wheels.length);
    // Both marks darken what is beneath them: rubber on the road, and torn,
    // flattened blades on grass. Unlit, they dim with the course's light.
    this.markLayers = (["asphalt", "grass"] as const).map((surface) => {
      const trails = new TireMarkTrails(wheels.length, surface);
      const material = new pc.StandardMaterial();
      material.useLighting = false;
      material.useSkybox = false;
      material.diffuse = new pc.Color(0, 0, 0);
      material.emissive = new pc.Color(0.02, 0.02, 0.02);
      // Colours are linearised; intensity scales the linear light.
      material.emissiveIntensity = lightLevel;
      material.opacityVertexColor = true;
      material.opacityVertexColorChannel = "a";
      material.blendType = pc.BLEND_NORMAL;
      material.depthWrite = false;
      material.cull = pc.CULLFACE_NONE;
      material.depthBias = getCourseSurfaceLayerDepthBias("tireMark");
      material.slopeDepthBias = material.depthBias;
      material.update();
      return {
        ...createQuadMesh(
          app,
          `kart-${surface}-marks`,
          trails.capacity,
          material,
          false,
        ),
        colors: new Uint8Array(trails.capacity * 16),
        dirty: false,
        surface,
        trails,
      };
    });

    const flakeMaterial = new pc.StandardMaterial();
    flakeMaterial.diffuseVertexColor = true;
    // Documented option missing from the 2.20 typings: sRGB vertex colors.
    (
      flakeMaterial as pc.StandardMaterial & { vertexColorGamma: boolean }
    ).vertexColorGamma = true;
    flakeMaterial.useMetalness = true;
    flakeMaterial.metalness = 0;
    flakeMaterial.gloss = 0.08;
    flakeMaterial.opacityVertexColor = true;
    flakeMaterial.opacityVertexColorChannel = "a";
    flakeMaterial.blendType = pc.BLEND_NORMAL;
    flakeMaterial.depthWrite = false;
    flakeMaterial.cull = pc.CULLFACE_NONE;
    flakeMaterial.update();
    this.flakes = createQuadMesh(
      app,
      "kart-grass-clippings",
      policy.clippingCapacity,
      flakeMaterial,
      true,
    );
    this.flakePositions = new Float32Array(policy.clippingCapacity * 12);
    this.flakeNormals = new Float32Array(policy.clippingCapacity * 12);
    this.flakeColors = new Uint8Array(policy.clippingCapacity * 16);
  }

  /** Habitat gravity near the kart and the spin vector, rad/s. */
  setHabitat(gravity: Vec3Like, spin: Vec3Like) {
    this.clippings.setHabitat(gravity, spin);
  }

  /**
   * Advances the effects by simulated time and samples each wheel at its
   * drawn hub, projected onto the surface it touches. Call once per rendered
   * frame after the wheels are posed; pass zero seconds while paused.
   */
  update(
    seconds: number,
    telemetry: readonly SurfaceEffectWheelSample[],
    kartVelocity: pc.Vec3,
    camera: pc.GraphNode,
  ) {
    if (this.warmUp === "pending") {
      this.warmUp = "drawn";
      return;
    }
    if (this.warmUp === "drawn") {
      this.warmUp = "done";
      [...this.markLayers, this.flakes].forEach(({ entity }) => {
        entity.enabled = false;
      });
    }
    if (seconds > 0) {
      this.wheels.forEach((wheel, index) =>
        this.sampleWheel(index, wheel, telemetry[index], kartVelocity, seconds),
      );
      this.clippings.step(seconds);
      this.renderClippings(camera);
    }
    this.markLayers.forEach((layer) => this.renderMarks(layer));
  }

  /** Clears marks and clippings for a new race. */
  clear() {
    this.markLayers.forEach((layer) => {
      layer.trails.clear();
      layer.dirty = true;
    });
    this.clippings.clear();
    this.flakes.entity.enabled = false;
    this.spawnDebt.fill(0);
  }

  destroy() {
    [...this.markLayers, this.flakes].forEach(({ entity, material, mesh }) => {
      entity.destroy();
      material.destroy();
      mesh.destroy();
    });
  }

  private sampleWheel(
    index: number,
    wheel: SurfaceEffectWheelMount,
    sample: SurfaceEffectWheelSample | undefined,
    kartVelocity: pc.Vec3,
    seconds: number,
  ) {
    const normal = sample?.contactNormal;
    const contact = sample?.contactPoint;
    if (!sample?.supported || !normal || !contact) {
      this.markLayers.forEach(({ trails }) =>
        trails.sample(index, this.point, pc.Vec3.UP, 0, 0),
      );
      this.spawnDebt[index] = 0;
      return;
    }
    // The drawn hub dropped onto the contact plane: marks end under the tire
    // as it is drawn, not where the last physics step left it.
    this.offset.sub2(wheel.pivot.getPosition(), contact);
    this.point
      .copy(wheel.pivot.getPosition())
      .sub(this.launch.copy(normal).mulScalar(this.offset.dot(normal)));

    for (const layer of this.markLayers) {
      const strength = getTireMarkStrength(
        sample,
        layer.surface,
        layer.trails.isMarking(index),
      );
      if (
        layer.trails.sample(
          index,
          this.point,
          normal,
          wheel.width / 2,
          strength,
        )
      ) {
        layer.dirty = true;
      }
    }

    const color = this.grassColors.get(sample.surfaceMaterial?.id ?? "");
    const rate = color ? getClippingRate(sample) : 0;
    if (!color || rate <= 0) {
      this.spawnDebt[index] = 0;
      return;
    }
    this.spawnDebt[index] += rate * seconds;
    const policy = KART_SURFACE_EFFECT_POLICY;
    const planarSpeed = Math.hypot(
      sample.longitudinalSpeed,
      sample.lateralSpeed,
    );
    // Tread rising behind the contact patch lifts a clipping at roughly
    // speed × sin θ and carries it forward by speed × (1 − cos θ); a sliding
    // tire drags it sideways with the slide. The kart's velocity stands in
    // for the contact patch's, and the model has no wheelspin, which in
    // reality throws the most turf.
    const slide =
      planarSpeed > 0.1 ? Math.abs(sample.lateralSpeed) / planarSpeed : 0;
    while (this.spawnDebt[index] >= 1) {
      this.spawnDebt[index] -= 1;
      const angle = (8 + this.clippings.random() * 12) * pc.math.DEG_TO_RAD;
      const carry = pc.math.lerp(1 - Math.cos(angle), 0.8, slide);
      const lift = Math.min(
        Math.abs(sample.longitudinalSpeed) * Math.sin(angle),
        policy.clippingMaxLaunchUp,
      );
      this.launch
        .copy(normal)
        .mulScalar(-normal.dot(kartVelocity))
        .add(kartVelocity)
        .mulScalar(carry)
        // A small minimum hop so slow-rolling clippings clear the surface.
        .add(this.offset.copy(normal).mulScalar(lift + 0.2));
      this.launch.x += (this.clippings.random() - 0.5) * 0.4;
      this.launch.z += (this.clippings.random() - 0.5) * 0.4;
      this.clippings.spawn(this.point, normal, this.launch, color);
    }
  }

  // Marks change only when a quad is written or the race clears them, so
  // their buffers upload only then.
  private renderMarks(layer: MarkLayer) {
    if (!layer.dirty) return;
    layer.dirty = false;
    const { colors, mesh, trails } = layer;
    layer.entity.enabled = !trails.isEmpty;
    for (let slot = 0; slot < trails.capacity; slot++) {
      const alpha = Math.round(255 * trails.getAlpha(slot));
      for (let corner = 0; corner < 4; corner++) {
        colors[slot * 16 + corner * 4 + 3] = alpha;
      }
    }
    mesh.setPositions(trails.positions);
    mesh.setColors32(colors);
    mesh.update(pc.PRIMITIVE_TRIANGLES, false);
  }

  private renderClippings(camera: pc.GraphNode) {
    const count = this.clippings.count;
    this.flakes.entity.enabled = count > 0;
    if (count === 0) return;
    const { clippingLength, clippingWidth } = KART_SURFACE_EFFECT_POLICY;
    const right = camera.right;
    const up = camera.up;
    const forward = camera.forward;
    this.flakePositions.fill(0);
    this.flakeColors.fill(0);
    for (let index = 0; index < count; index++) {
      const spin = this.clippings.spins[index];
      const cos = Math.cos(spin);
      const sin = Math.sin(spin);
      this.along
        .copy(right)
        .mulScalar(cos)
        .add(this.launch.copy(up).mulScalar(sin))
        .mulScalar(clippingLength / 2);
      this.across
        .copy(up)
        .mulScalar(cos)
        .sub(this.launch.copy(right).mulScalar(sin))
        .mulScalar(clippingWidth / 2);
      const p = index * 3;
      this.point.set(
        this.clippings.positions[p],
        this.clippings.positions[p + 1],
        this.clippings.positions[p + 2],
      );
      for (let corner = 0; corner < 4; corner++) {
        const a = corner % 2 === 0 ? -1 : 1;
        const b = corner < 2 ? -1 : 1;
        const v = index * 12 + corner * 3;
        this.flakePositions[v] =
          this.point.x + this.along.x * a + this.across.x * b;
        this.flakePositions[v + 1] =
          this.point.y + this.along.y * a + this.across.y * b;
        this.flakePositions[v + 2] =
          this.point.z + this.along.z * a + this.across.z * b;
        // Lit as if facing the camera.
        this.flakeNormals[v] = -forward.x;
        this.flakeNormals[v + 1] = -forward.y;
        this.flakeNormals[v + 2] = -forward.z;
        for (let channel = 0; channel < 4; channel++) {
          this.flakeColors[index * 16 + corner * 4 + channel] =
            this.clippings.colors[index * 4 + channel];
        }
      }
    }
    const mesh = this.flakes.mesh;
    mesh.setPositions(this.flakePositions);
    mesh.setNormals(this.flakeNormals);
    mesh.setColors32(this.flakeColors);
    mesh.update(pc.PRIMITIVE_TRIANGLES, false);
  }
}
