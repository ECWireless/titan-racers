import * as pc from "playcanvas";

/**
 * The shared kart material until part visuals arrive: the authored color with
 * a coated, non-metallic finish (painted shells, anodized or powder-coated
 * frames, molded plastic). Callers own and destroy it.
 */
export function createKartVisualMaterial(visualColor: string) {
  const material = new pc.StandardMaterial();
  material.diffuse = new pc.Color().fromString(visualColor);
  material.useMetalness = true;
  material.metalness = 0;
  material.gloss = 0.5;
  material.update();
  return material;
}
