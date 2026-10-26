import * as pc from "playcanvas";

import {
  getApprovedEnclosure,
  NEUTRAL_WHITE,
  sceneLux,
} from "../enclosure/island-three";
import type { CourseDocument } from "./course-document";

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

/**
 * The mean illuminance, in lux, the course's floodlights put on its track
 * while on: at its start and checkpoints, from each lamp's top straight down
 * within its cone, counting full intensity out to the cone's edge. Eyes
 * adjust to it.
 */
export function courseLampLux(document: CourseDocument) {
  const lamps = document.objects.filter(
    (object) => object.lamp === "floodlight",
  );
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
 * is dim. They cast no shadows. Returns a cleanup for the lens material.
 */
export function addCourseLamps(
  entities: ReadonlyMap<string, pc.Entity>,
  document: CourseDocument,
  { lampsOn, steel }: { lampsOn: number; steel: pc.Material },
) {
  const lamps = document.objects.filter(
    (object) => object.lamp === "floodlight",
  );
  const definition = getApprovedEnclosure(document.enclosure);
  if (lamps.length === 0 || !definition) return () => {};

  // Scene illuminance of the lamp, per candela at 1 m, while it is on.
  const lux = sceneLux(definition) * lampsOn;
  const lens = new pc.StandardMaterial();
  lens.diffuse = new pc.Color(0, 0, 0);
  const [r, g, b] = LAMP_TINT;
  lens.emissive = new pc.Color(
    r / LAMP_TINT_PEAK,
    g / LAMP_TINT_PEAK,
    b / LAMP_TINT_PEAK,
  ).gamma();
  // Its luminance spreads the lamp's light over the lens.
  lens.emissiveIntensity =
    (LAMP_CANDELA / (LENS.x * LENS.z)) * Math.PI * lux * LAMP_TINT_PEAK;
  lens.update();

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
    const light = new pc.Entity(`${object.id}-light`);
    light.setLocalPosition(0, -HOUSING.y - LENS.y, -ARM.length);
    // Intensity 1 keeps the engine's colour linear; the colour carries the
    // light, since lower intensities are applied before linearising.
    const linear = LAMP_TINT.map(
      (channel) => (channel * LAMP_CANDELA * lux) / FALLOFF_SCALE,
    ) as [number, number, number];
    light.addComponent("light", {
      castShadows: false,
      color: new pc.Color(...linear).gamma(),
      falloffMode: pc.LIGHTFALLOFF_INVERSESQUARED,
      innerConeAngle: SPOT.inner,
      intensity: 1,
      outerConeAngle: SPOT.outer,
      range: SPOT.range,
      type: "spot",
    });
    head.addChild(light);
  });

  return () => lens.destroy();
}
