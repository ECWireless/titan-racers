import type * as pc from "playcanvas";

import type { Position3 } from "../contracts";

type ContactResult = {
  a: pc.Entity;
  b: pc.Entity;
  impulse: number;
  normal: Position3;
  pointA: Position3;
  pointB: Position3;
};

type ContactEventSource = {
  off: (name: string, listener: (result: ContactResult) => void) => void;
  on: (name: string, listener: (result: ContactResult) => void) => void;
};

export type KartCollisionContact = {
  approachSpeed: number;
  impulse: number;
  normal: Position3;
  otherEntityName: string;
  point: Position3;
};

export type KartCollisionFrame = {
  contacts: KartCollisionContact[];
  maximumApproachSpeed: number;
  maximumImpulse: number;
  postAngularVelocity: Position3;
  postLinearVelocity: Position3;
  preAngularVelocity: Position3;
  preLinearVelocity: Position3;
  totalImpulse: number;
};

function copyVector(vector: Position3 | undefined): Position3 {
  return vector
    ? { x: vector.x, y: vector.y, z: vector.z }
    : { x: 0, y: 0, z: 0 };
}

function normalize(vector: Position3): Position3 {
  const length = Math.hypot(vector.x, vector.y, vector.z);

  if (length <= Number.EPSILON) {
    return { x: 0, y: 0, z: 0 };
  }

  return {
    x: vector.x / length || 0,
    y: vector.y / length || 0,
    z: vector.z / length || 0,
  };
}

export function orientKartContactNormal(
  normalOnBodyB: Position3,
  kartIsBodyB: boolean,
) {
  return normalize({
    x: normalOnBodyB.x * (kartIsBodyB ? -1 : 1),
    y: normalOnBodyB.y * (kartIsBodyB ? -1 : 1),
    z: normalOnBodyB.z * (kartIsBodyB ? -1 : 1),
  });
}

export function calculateContactApproachSpeed(
  linearVelocity: Position3,
  angularVelocity: Position3,
  bodyPosition: Position3,
  contactPoint: Position3,
  normalAwayFromSurface: Position3,
) {
  const offset = {
    x: contactPoint.x - bodyPosition.x,
    y: contactPoint.y - bodyPosition.y,
    z: contactPoint.z - bodyPosition.z,
  };
  const pointVelocity = {
    x:
      linearVelocity.x +
      angularVelocity.y * offset.z -
      angularVelocity.z * offset.y,
    y:
      linearVelocity.y +
      angularVelocity.z * offset.x -
      angularVelocity.x * offset.z,
    z:
      linearVelocity.z +
      angularVelocity.x * offset.y -
      angularVelocity.y * offset.x,
  };

  return Math.max(
    -(
      pointVelocity.x * normalAwayFromSurface.x +
      pointVelocity.y * normalAwayFromSurface.y +
      pointVelocity.z * normalAwayFromSurface.z
    ),
    0,
  );
}

export class KartCollisionObserver {
  lastFrame: KartCollisionFrame | null = null;
  private contacts: KartCollisionContact[] = [];
  private preAngularVelocity: Position3 = { x: 0, y: 0, z: 0 };
  private preLinearVelocity: Position3 = { x: 0, y: 0, z: 0 };
  private prePosition: Position3 = { x: 0, y: 0, z: 0 };
  private destroyed = false;

  constructor(
    private readonly source: ContactEventSource,
    private readonly kart: pc.Entity,
  ) {
    source.on("contact", this.onContact);
  }

  beginStep() {
    if (this.destroyed) {
      return;
    }

    this.contacts = [];
    this.lastFrame = null;
    this.prePosition = copyVector(this.kart.getPosition());
    this.preLinearVelocity = copyVector(this.kart.rigidbody?.linearVelocity);
    this.preAngularVelocity = copyVector(this.kart.rigidbody?.angularVelocity);
  }

  endStep() {
    if (this.destroyed || this.contacts.length === 0) {
      return;
    }

    this.lastFrame = {
      contacts: this.contacts.map((contact) => ({
        ...contact,
        normal: copyVector(contact.normal),
        point: copyVector(contact.point),
      })),
      maximumApproachSpeed: Math.max(
        ...this.contacts.map((contact) => contact.approachSpeed),
      ),
      maximumImpulse: Math.max(
        ...this.contacts.map((contact) => contact.impulse),
      ),
      postAngularVelocity: copyVector(this.kart.rigidbody?.angularVelocity),
      postLinearVelocity: copyVector(this.kart.rigidbody?.linearVelocity),
      preAngularVelocity: copyVector(this.preAngularVelocity),
      preLinearVelocity: copyVector(this.preLinearVelocity),
      totalImpulse: this.contacts.reduce(
        (total, contact) => total + contact.impulse,
        0,
      ),
    };
  }

  destroy() {
    if (this.destroyed) {
      return;
    }

    this.destroyed = true;
    this.source.off("contact", this.onContact);
    this.contacts = [];
    this.lastFrame = null;
  }

  private readonly onContact = (result: ContactResult) => {
    const kartIsA = result.a === this.kart;
    const kartIsB = result.b === this.kart;

    if (!kartIsA && !kartIsB) {
      return;
    }

    const point = copyVector(kartIsA ? result.pointA : result.pointB);
    const normal = orientKartContactNormal(result.normal, kartIsB);

    this.contacts.push({
      approachSpeed: calculateContactApproachSpeed(
        this.preLinearVelocity,
        this.preAngularVelocity,
        this.prePosition,
        point,
        normal,
      ),
      impulse: result.impulse,
      normal,
      otherEntityName: (kartIsA ? result.b : result.a).name,
      point,
    });
  };
}
