import { getHabitatLight } from "../enclosure/habitat-light";
import type { CourseDocument } from "./course-document";
import { courseLampLux } from "./course-lamps";
import { getCourseSignGlyphs } from "./course-sign";
import { prewarmCourseSurfacePixels } from "./course-surface-materials";
import {
  createCourseHedgeGeometry,
  createNurseryStakeGeometry,
  createNurseryTreeGeometry,
  NURSERY_TREE_VARIANTS,
} from "./course-tree-geometry";

/**
 * Builds the CPU-side parts of a race on this course while the page is
 * otherwise idle, such as the home screen while a kart is chosen: the
 * finishes' pixels, the habitat's light and its environment atlas, the
 * planting's geometry, and its signs' letters. Each is cached per page, so
 * a race on the same course finds it ready. Steps run one at a time while
 * the page is idle; the returned function stops any not yet run.
 */
export function prewarmCourseScene(document: CourseDocument) {
  const steps: Array<() => unknown> = [
    ...prewarmCourseSurfacePixels,
    () => getHabitatLight(document.enclosure, courseLampLux(document)).atlasPixels(),
    ...Array.from(
      { length: NURSERY_TREE_VARIANTS },
      (_, variant) => () => createNurseryTreeGeometry(variant),
    ),
    createNurseryStakeGeometry,
    () => createCourseHedgeGeometry(document),
    ...(document.objects.some((object) => object.sign !== undefined)
      ? [getCourseSignGlyphs]
      : []),
  ];
  let stopped = false;
  const schedule = (run: () => void) =>
    typeof window.requestIdleCallback === "function"
      ? window.requestIdleCallback(run, { timeout: 1_000 })
      : window.setTimeout(run, 50);
  const next = () => {
    if (stopped) return;
    steps.shift()?.();
    if (steps.length > 0) schedule(next);
  };
  schedule(next);
  return () => {
    stopped = true;
  };
}
