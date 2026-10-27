import { expect, test } from "@playwright/test";

import {
  COURSE_ARC_COLLISION_TOLERANCE,
  COURSE_ARC_MAXIMUM_WIDTH_RATIO,
  COURSE_ARC_VISUAL_TOLERANCE,
  type CourseArc,
  createCourseArcGeometry,
  getCourseArcCollisionBoxes,
  getCourseArcSegmentCount,
} from "../src/game/course/course-arc";

// Falls View Park's tunnel bend barriers, a tight hairpin wall, and a wide
// low wall whose open ends need the shortest end segments.
const ARCS: CourseArc[] = [
  { height: 0.5, innerRadius: 4.45, sweep: 90, width: 0.3 },
  { height: 0.5, innerRadius: 9.25, sweep: 90, width: 0.3 },
  { height: 0.5, innerRadius: 2.25, sweep: 180, width: 0.3 },
  { height: 0.3, innerRadius: 4, sweep: 90, width: 2 },
];

test("splits arcs finely enough to stay within millimetres of the circle", () => {
  // The largest arc the schema allows keeps the tolerance too.
  const largest = getCourseArcSegmentCount(
    200,
    360,
    COURSE_ARC_VISUAL_TOLERANCE,
  );
  expect(200 * (1 - Math.cos(Math.PI / largest))).toBeLessThanOrEqual(
    COURSE_ARC_VISUAL_TOLERANCE,
  );
  // Small radii still step at most 6°.
  expect(
    90 / getCourseArcSegmentCount(0.1, 90, COURSE_ARC_VISUAL_TOLERANCE),
  ).toBeLessThanOrEqual(6);
  for (const arc of ARCS) {
    const outer = arc.innerRadius + arc.width;
    const { segments } = createCourseArcGeometry(arc);
    const step = (arc.sweep * Math.PI) / 180 / segments;
    expect(outer * (1 - Math.cos(step / 2))).toBeLessThanOrEqual(
      COURSE_ARC_VISUAL_TOLERANCE,
    );
  }
});

test("draws an arc as one smooth surface with sharp top and end edges", () => {
  for (const arc of ARCS) {
    const { indices, normals, positions, segments, uvs } =
      createCourseArcGeometry(arc);
    const vertexCount = positions.length / 3;
    // Inner and outer faces, the top, and two end caps; no hidden base.
    expect(vertexCount).toBe(6 * (segments + 1) + 8);
    expect(indices.length / 3).toBe(6 * segments + 4);
    expect(normals).toHaveLength(positions.length);
    expect(uvs).toHaveLength(vertexCount * 2);

    const outer = arc.innerRadius + arc.width;
    for (let index = 0; index < vertexCount; index++) {
      const [x, y, z] = positions.slice(index * 3, index * 3 + 3);
      const [nx, ny, nz] = normals.slice(index * 3, index * 3 + 3);
      expect(Math.hypot(nx!, ny!, nz!)).toBeCloseTo(1, 9);
      expect(y!).toBeGreaterThanOrEqual(0);
      expect(y!).toBeLessThanOrEqual(arc.height);
      const radius = Math.hypot(x!, z!);
      expect(radius).toBeGreaterThanOrEqual(arc.innerRadius - 1e-9);
      expect(radius).toBeLessThanOrEqual(outer + 1e-9);
      // Every face points away from the wall: the outer face out from the
      // centre, the inner face toward it, the top up, and each end cap back
      // along the sweep at its start and onward at its end.
      const radial = (nx! * x! + nz! * z!) / radius;
      if (ny === 1) {
        expect(y!).toBeCloseTo(arc.height, 9);
      } else if (radial > 0.5) {
        expect(radial).toBeCloseTo(1, 9);
        expect(radius).toBeCloseTo(outer, 9);
      } else if (radial < -0.5) {
        expect(radial).toBeCloseTo(-1, 9);
        expect(radius).toBeCloseTo(arc.innerRadius, 9);
      } else {
        const angle = Math.atan2(-z!, x!);
        const onward = -nx! * Math.sin(angle) - nz! * Math.cos(angle);
        const atStart = Math.abs(angle) < 1e-9;
        const atEnd = Math.abs(angle - (arc.sweep * Math.PI) / 180) < 1e-9;
        expect(atStart || atEnd, `cap vertex ${index}`).toBe(true);
        expect(onward).toBeCloseTo(atStart ? -1 : 1, 9);
      }
    }

    // Every triangle faces the way its vertices' normals point.
    for (let index = 0; index < indices.length; index += 3) {
      const [a, b, c] = indices
        .slice(index, index + 3)
        .map((vertex) => positions.slice(vertex * 3, vertex * 3 + 3));
      const e1 = [b![0]! - a![0]!, b![1]! - a![1]!, b![2]! - a![2]!];
      const e2 = [c![0]! - a![0]!, c![1]! - a![1]!, c![2]! - a![2]!];
      const face = [
        e1[1]! * e2[2]! - e1[2]! * e2[1]!,
        e1[2]! * e2[0]! - e1[0]! * e2[2]!,
        e1[0]! * e2[1]! - e1[1]! * e2[0]!,
      ];
      const normal = normals.slice(
        indices[index]! * 3,
        indices[index]! * 3 + 3,
      );
      expect(
        face[0]! * normal[0]! + face[1]! * normal[1]! + face[2]! * normal[2]!,
      ).toBeGreaterThan(0);
    }
  }
});

test("sweeps from local +X toward local -Z", () => {
  const { positions } = createCourseArcGeometry(ARCS[0]!);
  const points = Array.from({ length: positions.length / 3 }, (_, index) => ({
    x: positions[index * 3]!,
    z: positions[index * 3 + 2]!,
  }));
  expect(Math.min(...points.map(({ x }) => x))).toBeCloseTo(0, 9);
  expect(Math.max(...points.map(({ z }) => z))).toBeCloseTo(0, 9);
  expect(Math.min(...points.map(({ z }) => z))).toBeCloseTo(-4.75, 9);
});

test("collides with boxes that meet on the outer face without gaps or spikes", () => {
  for (const arc of ARCS) {
    const outer = arc.innerRadius + arc.width;
    const boxes = getCourseArcCollisionBoxes(arc);
    // A box's corner in the arc's frame, turned like the builder turns it.
    const corner = (
      box: (typeof boxes)[number],
      along: number,
      out: number,
    ) => {
      const yaw = (box.yaw * Math.PI) / 180;
      const x = along * box.halfExtents.x;
      const z = out * box.halfExtents.z;
      return {
        x: box.center.x + x * Math.cos(yaw) + z * Math.sin(yaw),
        z: box.center.z - x * Math.sin(yaw) + z * Math.cos(yaw),
      };
    };
    boxes.forEach((box, index) => {
      expect(box.halfExtents.z * 2).toBeGreaterThanOrEqual(arc.width * 0.99);
      expect(box.center.y).toBeCloseTo(arc.height / 2, 9);
      // The outer face's corners lie on the outer circle.
      for (const along of [-1, 1]) {
        const point = corner(box, along, 1);
        expect(Math.hypot(point.x, point.z)).toBeCloseTo(outer, 9);
      }
      // The outer face stays within tolerance inside the drawn surface.
      const middle = Math.hypot(box.center.x, box.center.z) + box.halfExtents.z;
      expect(outer - middle).toBeLessThanOrEqual(
        COURSE_ARC_COLLISION_TOLERANCE,
      );
      // The inner face stands at most the tolerance proud of it.
      const inner = Math.hypot(box.center.x, box.center.z) - box.halfExtents.z;
      expect(arc.innerRadius - inner).toBeLessThanOrEqual(
        COURSE_ARC_COLLISION_TOLERANCE,
      );
      // Neighbours share their outer corners exactly.
      const next = boxes[index + 1];
      if (next) {
        const a = corner(box, 1, 1);
        const b = corner(next, -1, 1);
        expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeLessThan(1e-9);
      }
    });
    // No box reaches past the arc's open ends by more than the tolerance:
    // its start lies on local z = 0, its end on the plane at the sweep.
    const sweep = (arc.sweep * Math.PI) / 180;
    const pastEnd = { x: -Math.sin(sweep), z: -Math.cos(sweep) };
    for (const box of boxes) {
      for (const along of [-1, 1]) {
        for (const out of [-1, 1]) {
          const point = corner(box, along, out);
          expect(point.z).toBeLessThanOrEqual(
            COURSE_ARC_COLLISION_TOLERANCE + 1e-9,
          );
          expect(point.x * pastEnd.x + point.z * pastEnd.z).toBeLessThanOrEqual(
            COURSE_ARC_COLLISION_TOLERANCE + 1e-9,
          );
        }
      }
    }
  }
});

test("keeps the widest allowed arcs to a few hundred collision boxes", () => {
  // Open ends shorten the boxes most where the wall is widest for its inner
  // radius, so the schema bounds that ratio.
  for (const innerRadius of [0.05, 0.5, 6.25]) {
    for (const sweep of [1, 90, 359.999999]) {
      const arc = {
        height: 0.5,
        innerRadius,
        sweep,
        width: COURSE_ARC_MAXIMUM_WIDTH_RATIO * innerRadius,
      };
      expect(getCourseArcCollisionBoxes(arc).length).toBeLessThanOrEqual(500);
    }
  }
});
