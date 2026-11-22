import type { KartAssemblyDocument } from "@/game/kart/kart-assembly-document";
import { runKartFitCheck } from "@/game/kart/kart-assembly-fit";

// The clash check takes a few hundred milliseconds, so it runs here, off the
// thread that draws the builder.
self.onmessage = (
  event: MessageEvent<{ document: KartAssemblyDocument; id: number }>,
) => {
  const { document, id } = event.data;
  self.postMessage({ id, result: runKartFitCheck(document) });
};
