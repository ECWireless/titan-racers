import * as pc from "playcanvas";

import {
  getApprovedEnclosure,
  NEUTRAL_WHITE,
  sceneLux,
} from "../enclosure/island-three";
import { keepCourseVisualIndoors } from "./build-rough-course";
import {
  COURSE_INDOOR_LAMP_KINDS,
  type CourseDocument,
  type CourseLampKind,
  type CourseObject,
  type CoursePrimitiveObject,
  isCoursePrimitiveObject,
} from "./course-document";

// A sports floodlight, about 250,000 cd: a circuit is lit to over 1,000 lux.
const LAMP_CANDELA = 250_000;
const LAMP_TINT = NEUTRAL_WHITE;
const LAMP_TINT_PEAK = Math.max(...LAMP_TINT);
// A short arm carries the floodlight's housing and downward lens.
const ARM = { length: 0.6, thickness: 0.12 };
const HOUSING = { x: 0.7, y: 0.18, z: 0.7 };
const LENS = { x: 0.62, y: 0.02, z: 0.62 };
// PlayCanvas's inverse-square falloff lights at 16 / (d² + 1).
const FALLOFF_SCALE = 16;
// Floodlights spread wide; beyond 80 m their light is negligible.
const SPOT = { inner: 50, outer: 75, range: 80 };

// A tunnel's LED luminaire, about 27,000 lm: 8,600 cd straight down, fading
// out between 40° and 80° from straight down, so its pools overlap along a
// lit road.
const TUNNEL_LAMP = { candela: 8_600, inner: 40, outer: 80, range: 12 };
// Its lens fills most of the housing's underside.
const TUNNEL_LENS = { x: 0.92, y: 0.01, z: 0.78 };
// The youth's battery LED work light, about 4,700 lm from a near-Lambertian
// panel (Φ/π ≈ 1,500 cd). Hung every few metres along a low culvert, a string
// of them lights its floor about as brightly as the floodlit track outside.
const WORK_LAMP = { candela: 1_500, inner: 40, outer: 80, range: 6 };
const WORK_LENS = { x: 0.85, y: 0.005, z: 0.8 };
const INDOOR_LAMPS = {
  tunnel: { lens: TUNNEL_LENS, spot: TUNNEL_LAMP },
  work: { lens: WORK_LENS, spot: WORK_LAMP },
} as const;

// Lamps stand on boxes or cylinders, never arcs.
function isLamp(kind: CourseLampKind) {
  return (object: CourseObject): object is CoursePrimitiveObject =>
    object.lamp === kind && isCoursePrimitiveObject(object);
}
const isFloodlight = isLamp("floodlight");

/** A lens glowing with a lamp's light spread over its area. */
function createLensMaterial(candela: number, area: number, lux: number) {
  const lens = new pc.StandardMaterial();
  lens.diffuse = new pc.Color(0, 0, 0);
  const [r, g, b] = LAMP_TINT;
  lens.emissive = new pc.Color(
    r / LAMP_TINT_PEAK,
    g / LAMP_TINT_PEAK,
    b / LAMP_TINT_PEAK,
  ).gamma();
  lens.emissiveIntensity = (candela / area) * Math.PI * lux * LAMP_TINT_PEAK;
  lens.update();
  return lens;
}

/**
 * A lamp's downward spot light at real brightness. Intensity 1 keeps the
 * engine's colour linear; the colour carries the light, since lower
 * intensities are applied before linearising.
 */
function addSpotLight(
  parent: pc.Entity,
  name: string,
  position: [number, number, number],
  spot: { candela: number; inner: number; outer: number; range: number },
  lux: number,
  reachesIndoors: boolean,
) {
  const light = new pc.Entity(name);
  light.setLocalPosition(...position);
  const linear = LAMP_TINT.map(
    (channel) => (channel * spot.candela * lux) / FALLOFF_SCALE,
  ) as [number, number, number];
  light.addComponent("light", {
    // Indoor objects take only lights that reach indoors.
    affectLightmapped: reachesIndoors,
    castShadows: false,
    color: new pc.Color(...linear).gamma(),
    falloffMode: pc.LIGHTFALLOFF_INVERSESQUARED,
    innerConeAngle: spot.inner,
    intensity: 1,
    outerConeAngle: spot.outer,
    range: spot.range,
    type: "spot",
  });
  parent.addChild(light);
}

/**
 * The mean illuminance, in lux, the course's floodlights put on its track
 * while on: at its start and checkpoints, from each lamp's top straight down
 * within its cone, counting full intensity out to the cone's edge. Eyes
 * adjust to it.
 */
export function courseLampLux(document: CourseDocument) {
  const lamps = document.objects.filter(isFloodlight);
  const points = [
    document.start.position,
    ...document.checkpoints.map((checkpoint) => checkpoint.recovery.position),
  ];
  if (lamps.length === 0) return 0;
  const cosOuter = Math.cos((SPOT.outer * Math.PI) / 180);
  const total = points.reduce(
    (sum, point) =>
      sum +
      lamps.reduce((lux, lamp) => {
        const { position } = lamp.transform;
        const x = position.x - point.x;
        const y = position.y + lamp.visual.scale.y / 2 - point.y;
        const z = position.z - point.z;
        const distanceSquared = x * x + y * y + z * z;
        const cosine = y / Math.sqrt(distanceSquared);
        return cosine < cosOuter
          ? lux
          : lux + (LAMP_CANDELA * cosine) / distanceSquared;
      }, 0),
    0,
  );
  return total / points.length;
}

/**
 * Adds a floodlight's arm, luminaire, and downward spot light to each course
 * floodlight object, at the top of its mast and reaching along its local
 * -Z. Lamps shine at real brightness, scaled by how far the habitat's lamps
 * are on, so they are dark by day and their pools show only once the habitat
 * is dim. They cast no shadows. Tunnel and work lamps light too when
 * `tunnelLampsOn`.
 * Returns a cleanup for the lens materials.
 */
export function addCourseLamps(
  entities: ReadonlyMap<string, pc.Entity>,
  document: CourseDocument,
  {
    lampsOn,
    steel,
    tunnelLampsOn = false,
  }: { lampsOn: number; steel: pc.Material; tunnelLampsOn?: boolean },
) {
  const definition = getApprovedEnclosure(document.enclosure);
  if (!definition) return () => {};
  const releaseIndoorLamps = addIndoorLamps(entities, document, {
    lux: tunnelLampsOn ? sceneLux(definition) : 0,
  });
  const lamps = document.objects.filter(isFloodlight);
  if (lamps.length === 0) return releaseIndoorLamps;

  // Scene illuminance of the lamp, per candela at 1 m, while it is on.
  const lux = sceneLux(definition) * lampsOn;
  const lens = createLensMaterial(LAMP_CANDELA, LENS.x * LENS.z, lux);

  lamps.forEach((object) => {
    const mast = entities.get(object.id);
    if (!mast) return;
    const { x, y, z } = object.visual.scale;
    // The mast is scaled to its visual size; the head undoes it.
    const head = new pc.Entity(`${object.id}-head`);
    head.setLocalPosition(0, 0.5, 0);
    head.setLocalScale(1 / x, 1 / y, 1 / z);
    mast.addChild(head);

    const box = (
      name: string,
      material: pc.Material,
      size: { x: number; y: number; z: number },
      position: [number, number, number],
    ) => {
      const part = new pc.Entity(`${object.id}-${name}`);
      part.addComponent("render", { material, type: "box" });
      part.setLocalPosition(...position);
      part.setLocalScale(size.x, size.y, size.z);
      head.addChild(part);
    };
    box("arm", steel, { x: ARM.thickness, y: ARM.thickness, z: ARM.length }, [
      0,
      -ARM.thickness / 2,
      -ARM.length / 2,
    ]);
    box("housing", steel, HOUSING, [0, -HOUSING.y / 2, -ARM.length]);
    box("lens", lens, LENS, [0, -HOUSING.y - LENS.y / 2, -ARM.length]);

    if (lampsOn <= 0) return;
    addSpotLight(
      head,
      `${object.id}-light`,
      [0, -HOUSING.y - LENS.y, -ARM.length],
      { candela: LAMP_CANDELA, ...SPOT },
      lux,
      false,
    );
  });

  return () => {
    lens.destroy();
    releaseIndoorLamps();
  };
}

/**
 * Adds a glowing lens and a downward spot light under each tunnel and work
 * lamp object, which is the luminaire's housing. Indoor lamps light both the
 * inside and, through a portal, the outside, and burn day and night; `lux`
 * is the scene light per lux, or 0 to show them off. Returns a cleanup for
 * the lens materials.
 */
function addIndoorLamps(
  entities: ReadonlyMap<string, pc.Entity>,
  document: CourseDocument,
  { lux }: { lux: number },
) {
  const lenses = new Map<string, pc.StandardMaterial>();
  const lamps = COURSE_INDOOR_LAMP_KINDS.flatMap((kind) =>
    document.objects.filter(isLamp(kind)).map((object) => ({ kind, object })),
  );
  lamps.forEach(({ kind, object }) => {
    const { lens: lensShare, spot } = INDOOR_LAMPS[kind];
    const housing = entities.get(object.id);
    if (!housing) return;
    const { x, y, z } = object.visual.scale;
    // The housing is scaled to its visual size; the lens's frame undoes it.
    const underside = new pc.Entity(`${object.id}-underside`);
    underside.setLocalPosition(0, -0.5, 0);
    underside.setLocalScale(1 / x, 1 / y, 1 / z);
    housing.addChild(underside);

    const size = {
      x: x * lensShare.x,
      y: lensShare.y,
      z: z * lensShare.z,
    };
    const key = `${kind}:${size.x}:${size.z}`;
    let material = lenses.get(key);
    if (!material) {
      material = createLensMaterial(spot.candela, size.x * size.z, lux);
      lenses.set(key, material);
    }
    const lens = new pc.Entity(`${object.id}-lens`);
    lens.addComponent("render", { material, type: "box" });
    lens.setLocalPosition(0, -size.y / 2, 0);
    lens.setLocalScale(size.x, size.y, size.z);
    underside.addChild(lens);
    // Indoor lamps always stand indoors.
    keepCourseVisualIndoors(lens);

    if (lux <= 0) return;
    addSpotLight(
      underside,
      `${object.id}-light`,
      [0, -size.y, 0],
      spot,
      lux,
      true,
    );
  });
  return () => lenses.forEach((material) => material.destroy());
}
