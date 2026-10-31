import * as pc from "playcanvas";

/**
 * A PlayCanvas app that only draws: cameras, lights, and render and model
 * components, without physics. Editors and kart thumbnails use it so Ammo
 * finishing its load during their life cannot break their teardown:
 * PlayCanvas's rigid-body system frees an Ammo world on destroy whenever
 * Ammo is loaded, even one it never created, and a destroy that throws
 * leaves the app ticking. Races use a full application with physics.
 */
export function createRenderOnlyApplication(
  canvas: HTMLCanvasElement,
  deviceOptions: { alpha: boolean; antialias: boolean; preserveDrawingBuffer?: boolean },
) {
  const app = new pc.AppBase(canvas);
  const options = new pc.AppOptions();
  options.graphicsDevice = new pc.WebglGraphicsDevice(canvas, deviceOptions);
  options.componentSystems = [
    pc.CameraComponentSystem,
    pc.LightComponentSystem,
    pc.ModelComponentSystem,
    pc.RenderComponentSystem,
  ];
  app.init(options);
  return app;
}
