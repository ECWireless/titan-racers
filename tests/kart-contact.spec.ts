import { expect, test } from "@playwright/test";

import { createBalancedKartDocument } from "../src/game/kart/balanced-kart-document";
import { deriveKartSnapshot } from "../src/game/kart/kart-derivation";
import { createSpeedKartDocument } from "../src/game/kart/speed-kart-document";
import type { RaceQuaternion, RaceVector3 } from "../src/game/race/race-gate";
import {
  advanceKartPose,
  KART_CONTACT,
  kartContactShape,
  resolveKartContact,
  sweepKartContact,
  withKartImpulse,
  type ContactKart,
  type KartContactResponse,
  type KartContactShape,
} from "../src/game/room/kart-contact";

const BALANCED = kartContactShape(deriveKartSnapshot(createBalancedKartDocument()));
const SPEED = kartContactShape(deriveKartSnapshot(createSpeedKartDocument()));
const STEP = 1 / 120;
/** Nose to tail, two Balanced karts just touch this far apart. */
const LENGTH = 2 * BALANCED.halfExtents.z;
const WIDTH = 2 * BALANCED.halfExtents.x;
/** The most any contact here may sink in: the overlap left alone. */
const SINK_METRES = KART_CONTACT.slopMetres;

function kart(
  position: Partial<RaceVector3>,
  velocity: Partial<RaceVector3> = {},
  shape: KartContactShape = BALANCED,
): ContactKart {
  return {
    shape,
    body: {
      position: { x: 0, y: 0, z: 0, ...position },
      rotation: { w: 1, x: 0, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0, ...velocity },
      spin: { x: 0, y: 0, z: 0 },
    },
  };
}

/** A kart turned `degrees` about its up axis, driving forward at `speed`. */
function headed(position: Partial<RaceVector3>, degrees: number, speed: number) {
  const turn = (degrees * Math.PI) / 180;
  const driving = kart(position, {
    x: speed * Math.sin(turn),
    z: speed * Math.cos(turn),
  });
  driving.body.rotation = { w: Math.cos(turn / 2), x: 0, y: Math.sin(turn / 2), z: 0 };
  return driving;
}

function swept(a: ContactKart, b: ContactKart, seconds = STEP) {
  return sweepKartContact(
    { shape: a.shape, from: a.body, to: advanceKartPose(a.body, seconds) },
    { shape: b.shape, from: b.body, to: advanceKartPose(b.body, seconds) },
  );
}

function apply(a: ContactKart, b: ContactKart, response: KartContactResponse) {
  a.body = withKartImpulse(a, scale(response.impulse, -1), response.turnA);
  b.body = withKartImpulse(b, response.impulse, response.turnB);
}

/** Answers one pair's contact for the coming step; returns the response. */
function answer(a: ContactKart, b: ContactKart) {
  const contact = swept(a, b);
  const response = contact && resolveKartContact(a, b, contact, STEP);
  if (response) apply(a, b, response);
  return response;
}

/** The deepest any point of two karts overlaps now. */
function overlapNow(a: ContactKart, b: ContactKart) {
  const touching = swept(a, b, 0);
  return touching ? Math.max(...touching.points.map(({ depth }) => depth)) : 0;
}

/** Steps the karts at 120 Hz, answering every pair before each step. */
function run(karts: ContactKart[], steps: number, passes = 1) {
  let deepest = 0;
  let answered = 0;
  for (let step = 0; step < steps; step += 1) {
    for (let pass = 0; pass < passes; pass += 1) {
      for (let i = 0; i < karts.length; i += 1) {
        for (let j = i + 1; j < karts.length; j += 1) {
          if (answer(karts[i], karts[j])) answered += 1;
        }
      }
    }
    for (const { body } of karts) Object.assign(body, advanceKartPose(body, STEP));
    for (let i = 0; i < karts.length; i += 1) {
      for (let j = i + 1; j < karts.length; j += 1) {
        deepest = Math.max(deepest, overlapNow(karts[i], karts[j]));
      }
    }
  }
  return { deepest, answered };
}

/** How fast the karts part along the normal where the response pushed. */
function partingSpeed(
  a: ContactKart,
  b: ContactKart,
  { normal, point }: KartContactResponse,
) {
  const at = ({ body }: ContactKart) =>
    add(body.velocity, cross(body.spin, add(point, scale(body.position, -1))));
  const relative = add(at(b), scale(at(a), -1));
  return dot(relative, normal);
}

function momentum(karts: ContactKart[]) {
  return karts.reduce(
    (sum, { shape, body }) => add(sum, scale(body.velocity, shape.mass)),
    { x: 0, y: 0, z: 0 },
  );
}

/** About the origin: each kart's motion plus its spin. */
function angularMomentum(karts: ContactKart[]) {
  return karts.reduce((sum, { shape, body }) => {
    const { xx, yy, zz, xy, xz, yz } = shape.inertia;
    const { x, y, z } = rotate(conjugate(body.rotation), body.spin);
    const spinning = rotate(body.rotation, {
      x: xx * x + xy * y + xz * z,
      y: xy * x + yy * y + yz * z,
      z: xz * x + yz * y + zz * z,
    });
    return add(
      add(sum, scale(cross(body.position, body.velocity), shape.mass)),
      spinning,
    );
  }, { x: 0, y: 0, z: 0 });
}

function expectVectorClose(actual: RaceVector3, expected: RaceVector3, digits = 9) {
  expect(actual.x).toBeCloseTo(expected.x, digits);
  expect(actual.y).toBeCloseTo(expected.y, digits);
  expect(actual.z).toBeCloseTo(expected.z, digits);
}

test.describe("kart-to-kart contact", () => {
  test("the contact box wraps the kart's hull, from its centre of mass", () => {
    // The wheel guard sets the width and the top, the bumpers the length,
    // and the chassis plate's and bumpers' undersides the bottom.
    expect(BALANCED.halfExtents.x).toBeCloseTo(0.19, 4);
    expect(BALANCED.halfExtents.z).toBeCloseTo(0.2325, 4);
    expect(BALANCED.halfExtents.y).toBeCloseTo(0.036, 4);
    expect(BALANCED.center.y).toBeCloseTo(0.0159, 4);
    expect(BALANCED.mass).toBeCloseTo(1.8493, 4);
    expect(BALANCED.inertia.yy).toBeCloseTo(0.045312, 6);
  });

  test("the contact box turns parts as PlayCanvas does", async () => {
    const { Quat, Vec3 } = await import(
      "playcanvas/build/playcanvas/src/index.js"
    );
    const snapshot = deriveKartSnapshot(createBalancedKartDocument());
    const turned = { x: 20, y: 35, z: 50 };
    const size = { x: 0.8, y: 0.02, z: 0.04 };
    const shape = kartContactShape({
      ...snapshot,
      geometry: {
        ...snapshot.geometry,
        collisionCompound: [
          {
            shape: "box",
            size,
            transform: { position: { x: 0, y: 0.08, z: 0 }, rotationDegrees: turned },
          },
        ],
      },
    });
    const rotation = new Quat().setFromEulerAngles(turned.x, turned.y, turned.z);
    let reachX = 0;
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const corner = rotation.transformVector(
            new Vec3((sx * size.x) / 2, (sy * size.y) / 2, (sz * size.z) / 2),
          );
          reachX = Math.max(reachX, corner.x);
        }
      }
    }
    // Wider than the wheel guard only by the turned bar.
    expect(reachX).toBeGreaterThan(0.19);
    expect(shape.halfExtents.x).toBeCloseTo(reachX, 4);
  });

  test("a rear-end leaves both karts at one speed, without sinking in", () => {
    const behind = kart({ z: 0 }, { z: 5 });
    const ahead = kart({ z: LENGTH + 0.02 }, { z: 2 });
    const before = momentum([behind, ahead]);

    const { deepest } = run([behind, ahead], 30);

    expectVectorClose(momentum([behind, ahead]), before);
    expect(behind.body.velocity.z).toBeCloseTo(3.5, 1);
    expect(ahead.body.velocity.z).toBeCloseTo(3.5, 1);
    expect(deepest).toBeLessThan(SINK_METRES);
  });

  test("a head-on at twice top speed can't pass through", () => {
    // Between two of the room's states 1/30 s apart, the karts swap places:
    // neither end of the motion overlaps.
    const a = kart({ z: 0 }, { z: 17 });
    const b = kart({ z: LENGTH + 0.1 }, { z: -17 });
    const between = sweepKartContact(
      { shape: a.shape, from: a.body, to: advanceKartPose(a.body, 1 / 30) },
      { shape: b.shape, from: b.body, to: advanceKartPose(b.body, 1 / 30) },
    );
    expect(between).not.toBeNull();
    expect(between!.normal.z).toBeGreaterThan(0.99);
    expect(between!.at).toBeLessThan(0.2);

    // Answered each physics step, they meet and stop rather than overlap.
    // With no ground here, the hit's height above each centre of mass sets
    // them tumbling, so their centres can come closer than nose to tail.
    const { deepest } = run([a, b], 20);
    expect(deepest).toBeLessThan(SINK_METRES);
    expect(b.body.position.z - a.body.position.z).toBeGreaterThan(LENGTH / 2);
    expect(b.body.velocity.z - a.body.velocity.z).toBeGreaterThan(-1);
  });

  test("the room's sweep between states records a head-on over that time", () => {
    const interval = 1 / 30;
    const a = kart({ z: 0 }, { z: 17 });
    const b = kart({ z: LENGTH + 0.1 }, { z: -17 });
    const contact = sweepKartContact(
      { shape: a.shape, from: a.body, to: advanceKartPose(a.body, interval) },
      { shape: b.shape, from: b.body, to: advanceKartPose(b.body, interval) },
    )!;

    const response = resolveKartContact(a, b, contact, interval)!;
    apply(a, b, response);
    for (const { body } of [a, b]) {
      Object.assign(body, advanceKartPose(body, interval));
    }

    expect(response.closingSpeed).toBeCloseTo(34, 6);
    // Over a whole interval in free flight, the hit's pitch turns their
    // noses into each other a little; each page answers every step.
    expect(overlapNow(a, b)).toBeLessThan(0.015);
    expect(b.body.position.z).toBeGreaterThan(a.body.position.z);
  });

  test("passing close by a corner without touching isn't contact", () => {
    // The side gap would close only after the karts are already past.
    const passing = kart({}, { x: 5, z: 15 });
    const still = kart({ x: 0.385, z: -0.46 });

    const { answered } = run([passing, still], 4);

    expect(answered).toBe(0);
    expect(still.body.velocity).toEqual({ x: 0, y: 0, z: 0 });
  });

  test("a corner grazing a corner between sub-steps is still answered", () => {
    // At its deepest, about 10 ms in, this pass would overlap by 3 mm.
    const passing = headed({ x: 0.367, z: -0.489 }, 74.5, 0);
    passing.body.velocity = { x: 9.8, y: 0, z: 13.9 };
    const still = kart({});

    const { deepest, answered } = run([passing, still], 6);

    expect(answered).toBeGreaterThan(0);
    expect(deepest).toBeLessThan(SINK_METRES);
  });

  test("rubbing side by side keeps the karts' glancing motion", () => {
    const left = kart({ x: 0 }, { x: 0.5, z: 10 });
    const right = kart({ x: WIDTH }, { z: 8 });
    const response = resolveKartContact(left, right, swept(left, right)!, STEP);

    expect(response).not.toBeNull();
    const { impulse, normal } = response!;
    expect(normal.x).toBeGreaterThan(0.99);
    // Friction is bounded by the normal impulse.
    expect(Math.abs(impulse.z)).toBeLessThanOrEqual(
      KART_CONTACT.friction * impulse.x + 1e-12,
    );
    apply(left, right, response!);
    expect(right.body.velocity.x).toBeGreaterThan(0.2);
    expect(right.body.velocity.z).toBeGreaterThan(7.95);
  });

  test("an off-centre hit spins the kart it hits, keeping momentum", () => {
    // A nose clips the left rear corner of the kart ahead, already touching.
    const hitter = kart({ x: 0 }, { z: 6 });
    const hit = kart({ x: WIDTH - 0.05, z: LENGTH - 0.002 }, {}, SPEED);
    const karts = [hitter, hit];
    const linear = momentum(karts);
    const angular = angularMomentum(karts);

    const response = resolveKartContact(hitter, hit, swept(hitter, hit, 0)!, STEP)!;
    apply(hitter, hit, response);

    expect(response.closingSpeed).toBeCloseTo(6, 6);
    expect(hit.body.velocity.z).toBeGreaterThan(1);
    // Pushed forward at its left rear corner, it yaws about its up axis.
    expect(Math.abs(hit.body.spin.y)).toBeGreaterThan(1);
    expect(Math.sign(hit.body.spin.y)).toBe(
      -Math.sign(response.point.x - hit.body.position.x),
    );
    expectVectorClose(momentum(karts), linear);
    expectVectorClose(angularMomentum(karts), angular);
  });

  test("a contact still to come keeps both momenta", () => {
    // They meet partway through the coming step.
    const a = kart({}, { x: 10, z: 10 });
    const b = kart({ x: 0.2, z: 0.495 });
    const karts = [a, b];
    const contact = swept(a, b)!;
    expect(contact.at).toBeGreaterThan(0);
    const linear = momentum(karts);
    const angular = angularMomentum(karts);

    apply(a, b, resolveKartContact(a, b, contact, STEP)!);

    expectVectorClose(momentum(karts), linear);
    expectVectorClose(angularMomentum(karts), angular);
  });

  test("which kart comes first doesn't change the answer", () => {
    // A kart turned 45 degrees drops onto another's back, off centre.
    const below = kart({});
    const above = headed({ y: 0.07, z: 0.2 }, 45, 0);
    above.body.velocity = { x: 0, y: -3, z: 0 };

    const forward = resolveKartContact(below, above, swept(below, above)!, STEP)!;
    const reverse = resolveKartContact(above, below, swept(above, below)!, STEP)!;

    expectVectorClose(reverse.impulse, scale(forward.impulse, -1));
    expectVectorClose(reverse.turnA, forward.turnB);
    expectVectorClose(reverse.turnB, forward.turnA);
    expectVectorClose(reverse.point, forward.point);
  });

  test("which kart comes first doesn't change a corner-to-edge answer", () => {
    // Side by side, one turned and a little higher, their faces don't yet
    // overlap: they meet where a corner comes closest to the other's face.
    const turned = headed({ x: 0.43, y: 0.079, z: -0.01 }, 90, 0);
    turned.body.velocity = { x: -2, y: -3, z: 0 };
    const still = kart({});

    const forward = resolveKartContact(turned, still, swept(turned, still)!, STEP);
    const reverse = resolveKartContact(still, turned, swept(still, turned)!, STEP);

    expect(forward).not.toBeNull();
    expectVectorClose(reverse!.impulse, scale(forward!.impulse, -1));
    expectVectorClose(reverse!.turnA, forward!.turnB);
    expectVectorClose(reverse!.turnB, forward!.turnA);
  });

  test("which kart comes first doesn't change an answer on a tie", () => {
    // Turned a third of a full turn about a diagonal, this kart overlaps the
    // other equally along two of the world's axes.
    const tied = kart({ x: 0.4237, y: 0.2409, z: -0.0181 }, { x: -2, y: -3 });
    tied.body.rotation = { w: 0.5, x: 0.5, y: 0.5, z: 0.5 };
    const still = kart({});

    const forward = resolveKartContact(tied, still, swept(tied, still, 0)!, STEP);
    const reverse = resolveKartContact(still, tied, swept(still, tied, 0)!, STEP);

    expect(forward).not.toBeNull();
    expect(reverse!.closingSpeed).toBeCloseTo(forward!.closingSpeed, 9);
    expectVectorClose(reverse!.impulse, scale(forward!.impulse, -1));
  });

  test("karts touching part at the restitution's share of their closing", () => {
    // Boxes centred on their centres of mass, so the hit turns neither.
    const even: KartContactShape = {
      ...BALANCED,
      center: { x: 0, y: 0, z: 0 },
      inertia: { ...BALANCED.inertia, xy: 0, xz: 0, yz: 0 },
    };
    const a = kart({}, { z: 10 }, even);
    const b = kart({ z: 2 * even.halfExtents.z }, {}, even);

    const response = resolveKartContact(a, b, swept(a, b, 0)!, STEP)!;
    apply(a, b, response);

    expect(partingSpeed(a, b, response) / (10 * KART_CONTACT.restitution)).toBeCloseTo(
      1,
      6,
    );
    for (const { body } of [a, b]) {
      expect(Math.hypot(body.spin.x, body.spin.y, body.spin.z)).toBeLessThan(1e-9);
    }
  });

  test("a nose pitched into a tail settles every point it touches", () => {
    // Two of its points already overlap; two are still apart.
    const tilt = (-20 * Math.PI) / 360;
    const pitched = kart({ x: 0.04, y: -0.02, z: -0.455 }, { z: 10 });
    pitched.body.rotation = { w: Math.cos(tilt), x: Math.sin(tilt), y: 0, z: 0 };
    const still = kart({});
    const contact = swept(pitched, still)!;
    expect(contact.points.some(({ depth }) => depth > 0)).toBe(true);
    expect(contact.points.some(({ depth }) => depth < 0)).toBe(true);

    apply(pitched, still, resolveKartContact(pitched, still, contact, STEP)!);

    for (const { point, depth } of contact.points) {
      if (depth < 0) continue;
      const parting = partingSpeed(pitched, still, {
        normal: contact.normal,
        point,
      } as KartContactResponse);
      expect(parting).toBeGreaterThan(-0.01);
    }
  });

  for (const { name, hitter, sink } of [
    // Each hit yaws the hitter hard enough to swing more of it in, which
    // these free-flying karts have no tyres to resist.
    {
      name: "the side, behind its centre",
      hitter: () => headed({ x: -0.506, z: -0.051 }, 60, 15),
      sink: 0.01,
    },
    {
      // Here it sweeps the hitter's side in too.
      name: "the rear quarter",
      hitter: () => headed({ x: -0.64, z: -0.29 }, 58, 15),
      sink: 0.025,
    },
  ]) {
    test(`a T-bone at racing speed into ${name} barely sinks in`, () => {
      const karts = [hitter(), kart({})];
      const before = momentum(karts);

      const { deepest, answered } = run(karts, 20);

      expect(answered).toBeGreaterThan(0);
      expect(deepest).toBeLessThan(sink);
      expect(Math.abs(karts[1].body.spin.y)).toBeGreaterThan(0.5);
      expectVectorClose(momentum(karts), before);
    });
  }

  test("a kart landing on another is pushed up, not sideways", () => {
    const below = kart({ y: 0 }, { z: 6 });
    const above = kart({ y: 2 * BALANCED.halfExtents.y + 0.01 }, { y: -3, z: 6 });
    const contact = swept(below, above)!;
    expect(contact.normal.y).toBeGreaterThan(0.99);

    const { deepest } = run([below, above], 10);
    expect(deepest).toBeLessThan(SINK_METRES);
    expect(above.body.position.y - below.body.position.y).toBeGreaterThan(
      2 * BALANCED.halfExtents.y - 0.01,
    );
    expect(Math.abs(above.body.velocity.x)).toBeLessThan(0.05);
  });

  test("karts parting, or too far to meet this step, take no impulse", () => {
    const parting = kart({ z: LENGTH - 0.01 }, { z: 1 });
    const still = kart({ z: 0 });
    const contact = swept(still, parting)!;
    expect(resolveKartContact(still, parting, contact, STEP)).toBeNull();

    // 5 m/s covers 4 cm in a step, short of a 10 cm gap.
    const closing = kart({ z: LENGTH + 0.1 }, { z: -5 });
    expect(swept(still, closing)).toBeNull();
  });

  test("an overlap is pushed apart no faster than the cap", () => {
    const parted = (overlap: number) => {
      const a = kart({ z: 0 });
      const b = kart({ z: LENGTH - overlap });
      const response = resolveKartContact(a, b, swept(a, b)!, STEP)!;
      apply(a, b, response);
      return partingSpeed(a, b, response);
    };
    // Nose into tail, shallower than the karts are tall; answered point by
    // point, to within a couple of percent.
    const within = (actual: number, expected: number) =>
      expect(Math.abs(actual / expected - 1)).toBeLessThan(0.02);
    within(parted(0.05), KART_CONTACT.maxSeparationSpeed);
    within(
      parted(0.01),
      (0.01 - KART_CONTACT.slopMetres) * KART_CONTACT.separationPerSecond,
    );
  });

  test("a pileup settles pair by pair, keeping momentum", () => {
    const karts = [
      kart({ z: 0 }, { z: 6 }),
      kart({ z: LENGTH + 0.001 }),
      kart({ z: 2 * (LENGTH + 0.001) }),
    ];
    const before = momentum(karts);

    const { deepest } = run(karts, 30, 3);

    expectVectorClose(momentum(karts), before);
    for (const { body } of karts) {
      expect(Math.abs(body.velocity.z - 2)).toBeLessThan(0.1);
    }
    expect(deepest).toBeLessThan(SINK_METRES);
  });
});

function add(a: RaceVector3, b: RaceVector3) {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function scale(v: RaceVector3, by: number) {
  return { x: v.x * by, y: v.y * by, z: v.z * by };
}

function dot(a: RaceVector3, b: RaceVector3) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross(a: RaceVector3, b: RaceVector3) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function conjugate({ w, x, y, z }: RaceQuaternion): RaceQuaternion {
  return { w, x: -x, y: -y, z: -z };
}

function rotate(q: RaceQuaternion, v: RaceVector3): RaceVector3 {
  const t = scale(cross(q, v), 2);
  return add(add(v, scale(t, q.w)), cross(q, t));
}
