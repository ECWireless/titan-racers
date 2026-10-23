import { expect, test } from "@playwright/test";

import { withAxisRampTest } from "../src/game/course/axis-ramp-test";
import { ROUGH_COURSE_DOCUMENT } from "../src/game/course/course-document";

test("opens the Starter Course wall where the open ramp leaves it", () => {
  const course = withAxisRampTest(ROUGH_COURSE_DOCUMENT);
  const ids = course.objects.map((object) => object.id);
  expect(ids).not.toContain("perimeter-wall-north");
  const [west, east] = ["a", "b"].map((suffix) =>
    course.objects.find((o) => o.id === `perimeter-wall-north-${suffix}`)!,
  );
  // The centreline crosses the wall 27 m out, 16.7 m west of the origin.
  const westEnd = west.transform.position.x + west.visual.scale.x / 2;
  const eastEnd = east.transform.position.x - east.visual.scale.x / 2;
  expect(westEnd).toBeLessThan(-16.68 - 5.08);
  expect(eastEnd).toBeGreaterThan(-16.68 + 5.08);
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
