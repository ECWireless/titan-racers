import { growCourseHedgeGeometry } from "./course-hedge-geometry";
import { growCourseParkGeometry } from "./course-park";
import { getHabitatLight } from "../enclosure/habitat-light";
import type { CourseDocument } from "./course-document";
import { courseLampLux } from "./course-lamps";
import { getCourseSignGlyphs } from "./course-sign";
import { prewarmCourseSurfacePixels } from "./course-surface-materials";
import {
  createNurseryStakeGeometry,
  createNurseryTreeGeometry,
  NURSERY_TREE_VARIANTS,
} from "./course-tree-geometry";

/**
 * Builds the CPU-side parts of a race on this course while the page is
 * otherwise idle, such as the home screen while a kart is chosen: the
 * finishes' pixels, the habitat's light and its environment atlas, the
 * planting's geometry, and its signs' letters. Each is cached per page, so
 * a race on the same course finds it ready, or part built. Steps run one at
 * a time while the page is idle, or, where the browser cannot say (Safari),
 * once the player has not touched or typed for half a second; the returned
 * function stops any not yet run.
 */
// Where the browser cannot report idle time, how long after the player's
// last touch or key a step may run.
const QUIET_MS = 500;
// How long the park grows in one step, short enough not to delay a tap.
const PARK_SLICE_MS = 8;

export function prewarmCourseScene(document: CourseDocument) {
  // A step that returns false has more to do, and runs again.
  const steps: Array<() => unknown> = [
    ...prewarmCourseSurfacePixels,
    () => getHabitatLight(document.enclosure, courseLampLux(document)).atlasPixels(),
    ...Array.from(
      { length: NURSERY_TREE_VARIANTS },
      (_, variant) => () => createNurseryTreeGeometry(variant),
    ),
    createNurseryStakeGeometry,
    // The park and the hedges are the longest of these, so each grows a
    // slice a step.
    () => growCourseParkGeometry(document, PARK_SLICE_MS) !== null,
    () => growCourseHedgeGeometry(document, PARK_SLICE_MS) !== null,
    ...(document.objects.some((object) => object.sign !== undefined)
      ? [getCourseSignGlyphs]
      : []),
  ];
  let stopped = false;
  const idle = typeof window.requestIdleCallback === "function";
  let lastInput = -Infinity;
  const onInput = () => {
    lastInput = performance.now();
  };
  const inputs = ["keydown", "pointerdown"] as const;
  const stop = () => {
    stopped = true;
    if (!idle) inputs.forEach((type) => window.removeEventListener(type, onInput, true));
  };
  if (!idle) inputs.forEach((type) => window.addEventListener(type, onInput, true));
  const schedule = (run: () => void) =>
    idle
      ? window.requestIdleCallback(run, { timeout: 1_000 })
      : window.setTimeout(run, 100);
  const next = () => {
    if (stopped) return;
    if (!idle && performance.now() - lastInput < QUIET_MS) {
      schedule(next);
      return;
    }
    if (steps[0]?.() !== false) steps.shift();
    if (steps.length > 0) schedule(next);
    else stop();
  };
  schedule(next);
  return stop;
}
