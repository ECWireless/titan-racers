import { expect, test } from "@playwright/test";

import { withAxisRampTest } from "../src/game/course/axis-ramp-test";
import { getEnclosureFrame } from "../src/game/enclosure/island-three";
import {
  isCoursePrimitiveObject,
  ROUGH_COURSE_DOCUMENT,
} from "../src/game/course/course-document";

test("opens the Starter Course wall where the open ramp leaves it", () => {
  const course = withAxisRampTest(ROUGH_COURSE_DOCUMENT);
  const ids = course.objects.map((object) => object.id);
  expect(ids).not.toContain("perimeter-wall-north");
  const [west, east] = ["a", "b"].map((suffix) =>
    course.objects
      .filter(isCoursePrimitiveObject)
      .find((o) => o.id === `perimeter-wall-north-${suffix}`)!,
  );
  // The gap straddles where the ramp's centreline (sunward through the
  // origin) meets the wall, wider than the 8 m ramp.
  const { sunward } = getEnclosureFrame(course.enclosure);
  const crossingX = (west.transform.position.z / sunward.z) * sunward.x;
  const westEnd = west.transform.position.x + west.visual.scale.x / 2;
  const eastEnd = east.transform.position.x - east.visual.scale.x / 2;
  expect(westEnd).toBeLessThan(crossingX - 4);
  expect(eastEnd).toBeGreaterThan(crossingX + 4);
  // Only the stop at the axis is a wall; the ramps and pad stay open.
  expect(
    course.objects
      .filter(
        (object) =>
          object.id.startsWith("axis-ramp") &&
          object.collision?.role === "solid-obstacle",
      )
      .map((object) => object.id),
  ).toEqual(["axis-ramp-end-wall"]);
});
