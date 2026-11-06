import * as pc from "playcanvas";

import { getBatchMeshInstances } from "../course/course-interior";
import {
  createKartAssemblyVisual,
  poseKartWheelVisual,
} from "../kart/kart-assembly-visual";
import type { KartPartFinish } from "../kart/kart-part-visual-geometry";
import type { GhostKart } from "./device-ghost";
import type { GhostPose } from "./ghost-playback";

/** The site's technical blue, so the ghost reads as a readout, not a kart. */
const GHOST_COLOR = new pc.Color(0x42 / 255, 0xa5 / 255, 0xff / 255);
const GHOST_OPACITY = 0.45;

/**
 * One see-through material for every ghost part. Opacity is dithered (a
 * fixed fine pattern of drawn and skipped pixels) rather than blended, so
 * overlapping parts need no sorting and cannot flicker. It is unlit, so it
 * shows the site blue the same outdoors or in a tunnel.
 */
export function createGhostMaterial(sceneExposure: number) {
  const material = new pc.StandardMaterial();
  material.name = "ghost-kart";
  material.useLighting = false;
  material.useSkybox = false;
  material.useFog = false;
  material.diffuse = new pc.Color(0, 0, 0);
  material.emissive = GHOST_COLOR;
  // Tone mapping multiplies by the exposure; dividing first cancels it.
  material.emissiveIntensity = 1 / sceneExposure;
  material.opacity = GHOST_OPACITY;
  material.opacityDither = pc.DITHER_BAYER8;
  material.update();
  return material;
}

/**
 * A ghost kart drawn from its own document, posed from recorded samples. It
 * has no physics, sound, or shadow, and draws as one dynamic batch. A room
 * opponent is drawn the same way in its own kart's materials.
 */
export function createGhostKartVisual(
  app: pc.AppBase,
  kart: GhostKart,
  material:
    | pc.StandardMaterial
    | ((finish: KartPartFinish) => pc.StandardMaterial),
) {
  const { root: visual, wheels: wheelVisuals } = createKartAssemblyVisual(
    kart.document,
    material instanceof pc.StandardMaterial ? () => material : material,
    app.graphicsDevice,
  );
  const batchGroup = app.batcher.addGroup(
    "ghost-kart",
    true,
    Number.POSITIVE_INFINITY,
  );
  visual.forEach((node) => {
    if (node instanceof pc.Entity && node.render) {
      node.render.castShadows = false;
      node.render.receiveShadows = false;
      node.render.batchGroupId = batchGroup.id;
    }
  });
  const root = new pc.Entity("ghost-kart");
  root.addChild(visual);
  root.enabled = false;
  app.root.addChild(root);

  const geometryOffset = new pc.Vec3(
    -kart.centerOfMass.x,
    -kart.centerOfMass.y,
    -kart.centerOfMass.z,
  );
  const wheels = kart.wheels.flatMap((station) => {
    const wheelVisual = wheelVisuals.find(
      ({ instanceId }) => instanceId === station.id,
    );
    if (!wheelVisual) return [];
    poseKartWheelVisual(wheelVisual, wheelVisual.hub.y);
    return [{ ...station, spinAngle: 0, visual: wheelVisual }];
  });
  const rotation = new pc.Quat();
  const position = new pc.Vec3();
  let faded = false;

  return {
    /**
     * Shows the ghost at `pose`, or hides it for null. `fade` hides its
     * batched draw while it stays enabled, for hiding it often: disabling
     * it would rebuild its batch each time.
     */
    update(pose: GhostPose | null, raceSeconds: number, fade = false) {
      const wasEnabled = root.enabled;
      root.enabled = pose !== null;
      if (!pose) return;
      // Enabling marks the batch for a rebuild at the next render; run it
      // now, so the fade applies from the first frame. The batcher may also
      // replace its draws later, so they are looked up every frame.
      if (!wasEnabled) app.batcher.updateAll();
      faded = fade;
      for (const instance of getBatchMeshInstances(app, batchGroup.id)) {
        instance.visible = !fade;
      }
      rotation.set(pose.rotation.x, pose.rotation.y, pose.rotation.z, pose.rotation.w);
      rotation.transformVector(geometryOffset, position);
      position.x += pose.position.x;
      position.y += pose.position.y;
      position.z += pose.position.z;
      visual.setPosition(position);
      visual.setRotation(rotation);
      // Both steered wheels take the centre angle; Ackermann's spread of a
      // degree or two does not read on a ghost.
      for (const wheel of wheels) {
        if (wheel.steered) {
          wheel.visual.pivot.setLocalEulerAngles(0, pose.steerDegrees, 0);
        }
        wheel.spinAngle += (pose.speed * raceSeconds) / wheel.radius;
        wheel.spinAngle %= 2 * Math.PI;
        wheel.visual.spin.setLocalEulerAngles(
          (-wheel.spinAngle * 180) / Math.PI,
          0,
          0,
        );
      }
    },
    visible: () => root.enabled && !faded,
    /** The kart as drawn, in its assembly's axes, for its contact shadow. */
    node: visual,
    destroy() {
      root.destroy();
      app.batcher.removeGroup(batchGroup.id);
    },
  };
}

export type GhostKartVisual = ReturnType<typeof createGhostKartVisual>;
