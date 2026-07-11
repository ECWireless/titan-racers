import { expect, test } from "@playwright/test";
import type * as pc from "playcanvas";

import {
  calculateContactApproachSpeed,
  KartCollisionObserver,
  orientKartContactNormal,
} from "../src/game/collision/kart-collision-observer";
import type { Position3 } from "../src/game/contracts";

type ContactResult = {
  a: pc.Entity;
  b: pc.Entity;
  impulse: number;
  normal: Position3;
  pointA: Position3;
  pointB: Position3;
};

class ContactSource {
  private listener: ((result: ContactResult) => void) | null = null;

  on(_name: string, listener: (result: ContactResult) => void) {
    this.listener = listener;
  }

  off(_name: string, listener: (result: ContactResult) => void) {
    if (this.listener === listener) {
      this.listener = null;
    }
  }

  emit(result: ContactResult) {
    this.listener?.(result);
  }
}

function vector(x = 0, y = 0, z = 0) {
  return { x, y, z };
}

function createBody(name: string, position = vector()) {
  const linearVelocity = vector();
  const angularVelocity = vector();

  return {
    entity: {
      getPosition: () => position,
      name,
      rigidbody: { angularVelocity, linearVelocity },
    } as unknown as pc.Entity,
    angularVelocity,
    linearVelocity,
  };
}

test("orients normals and calculates contact-point approach speed", () => {
  expect(orientKartContactNormal(vector(-2, 0, 0), true)).toEqual(
    vector(1, 0, 0),
  );
  expect(
    calculateContactApproachSpeed(
      vector(-3, 0, 0),
      vector(0, 0, 2),
      vector(),
      vector(0, 1, 0),
      vector(1, 0, 0),
    ),
  ).toBeCloseTo(5);
});

test("copies and aggregates pooled contact data", () => {
  const source = new ContactSource();
  const kart = createBody("kart");
  const wall = createBody("wall");
  const observer = new KartCollisionObserver(source, kart.entity);
  const normal = vector(1, 0, 0);
  const point = vector(-0.8, 0, 0);

  kart.linearVelocity.x = -4;
  observer.beginStep();
  source.emit({
    a: kart.entity,
    b: wall.entity,
    impulse: 12,
    normal,
    pointA: point,
    pointB: { ...point },
  });
  normal.x = 0;
  normal.y = 1;
  point.x = 99;
  kart.linearVelocity.x = 0.5;
  observer.endStep();

  expect(observer.lastFrame?.contacts).toHaveLength(1);
  expect(observer.lastFrame?.contacts[0].normal).toEqual(vector(1, 0, 0));
  expect(observer.lastFrame?.contacts[0].point).toEqual(vector(-0.8, 0, 0));
  expect(observer.lastFrame?.maximumApproachSpeed).toBeCloseTo(4);
  expect(observer.lastFrame?.totalImpulse).toBe(12);
  expect(observer.lastFrame?.postLinearVelocity.x).toBeCloseTo(0.5);

  observer.destroy();
  expect(observer.lastFrame).toBeNull();
});
