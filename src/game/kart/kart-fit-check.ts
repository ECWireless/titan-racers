import type { KartAssemblyDocument } from "./kart-assembly-document";
import { checkKartAssemblyFit } from "./kart-assembly-fit";

export type KartFitCheck = {
  /** Parts that clash, standing or through travel and steering. */
  clashes: string[];
  /** Attachments not yet snapped by their mounting points. */
  unsnapped: number;
};

/**
 * What the save gate will say of a kart, for the builder to show as you
 * edit. Null if the assembly does not derive.
 */
export function runKartFitCheck(
  document: KartAssemblyDocument,
): KartFitCheck | null {
  try {
    const issues = checkKartAssemblyFit(document);
    return {
      clashes: issues
        .filter(({ code }) => code === "parts-clash")
        .map(({ message }) => message),
      unsnapped: issues.filter(({ code }) => code === "unnamed-mount").length,
    };
  } catch {
    return null;
  }
}
