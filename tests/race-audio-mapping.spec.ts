import { expect, test } from "@playwright/test";

import {
  getMotorAudioState,
  type MotorAudioInput,
} from "../src/game/audio/race-audio-mapping";
import { getRequestedDriveForce } from "../src/game/kart/kart-drive-model";
import { DEFAULT_KART_PHYSICAL_PROFILE } from "../src/game/kart/kart-physical-profile";

const DRIVETRAIN = DEFAULT_KART_PHYSICAL_PROFILE.drivetrain;

function wheels(rear: {
  locked?: boolean;
  speed: number;
  supported?: boolean;
}): MotorAudioInput["wheels"] {
  const front = {
    driven: false,
    locked: false,
    longitudinalSpeed: rear.speed,
    supported: true,
  };
  const driven = {
    driven: true,
    locked: rear.locked ?? false,
    longitudinalSpeed: rear.speed,
    supported: rear.supported ?? true,
  };
  return [front, front, driven, driven];
}

function motor(overrides: Partial<MotorAudioInput>) {
  return getMotorAudioState({
    brake: 0,
    deltaSeconds: 1 / 60,
    forwardSpeed: 0,
    handbrake: 0,
    held: false,
    noLoadSpeed: DRIVETRAIN.noLoadSpeed,
    previousMotorSpeed: 0,
    throttle: 0,
    wheels: wheels({ speed: 0 }),
    ...overrides,
  });
}

test.describe("race audio mapping", () => {
  test("turns the motor with its rolling driven wheels and loads it like the drive model", () => {
    for (const speed of [0, 4, 8.5, 15]) {
      const state = motor({
        forwardSpeed: speed,
        throttle: 1,
        wheels: wheels({ speed }),
      });
      expect(state.motorSpeed).toBeCloseTo(speed / DRIVETRAIN.noLoadSpeed, 6);
      expect(state.load).toBeCloseTo(
        getRequestedDriveForce(1, speed, DRIVETRAIN) /
          DRIVETRAIN.maximumDriveForce,
        6,
      );
    }
  });

  test("stops the motor with a locked driven wheel and disengages it with the handbrake", () => {
    expect(
      motor({
        brake: 1,
        forwardSpeed: 6,
        wheels: wheels({ locked: true, speed: 6 }),
      }),
    ).toMatchObject({ brake: 1, motorSpeed: 0 });
    expect(
      motor({
        forwardSpeed: 6,
        handbrake: 1,
        throttle: 1,
        wheels: wheels({ speed: 6 }),
      }),
    ).toMatchObject({ load: 0, throttle: 0 });
    expect(
      motor({ forwardSpeed: -2, throttle: -1, wheels: wheels({ speed: 2 }) }),
    ).toMatchObject({
      reversing: true,
      throttle: 1,
    });
  });

  test("revs a motor whose driven wheels are in the air, then coasts it down", () => {
    let previousMotorSpeed = 0;
    const airborne = wheels({ speed: 0, supported: false });
    for (let frame = 0; frame < 30; frame += 1) {
      previousMotorSpeed = motor({
        previousMotorSpeed,
        throttle: 0.8,
        wheels: airborne,
      }).motorSpeed;
    }
    expect(previousMotorSpeed).toBeGreaterThan(0.75);
    expect(previousMotorSpeed).toBeLessThanOrEqual(0.8);

    const released = motor({
      deltaSeconds: 0.5,
      previousMotorSpeed,
      wheels: airborne,
    });
    expect(released.motorSpeed).toBeCloseTo(
      previousMotorSpeed * Math.exp(-1),
      6,
    );
    expect(released.load).toBe(0);
  });

  test("spins a kart held on the grid, then lets grip pull it to rolling speed at Go", () => {
    const held = motor({ deltaSeconds: 1, held: true, throttle: 1 });
    expect(held.motorSpeed).toBeGreaterThan(0.99);
    expect(held.load).toBeCloseTo(0.6, 6);

    const go = motor({
      deltaSeconds: 0.2,
      previousMotorSpeed: held.motorSpeed,
      throttle: 1,
    });
    expect(go.motorSpeed).toBeCloseTo(held.motorSpeed * Math.exp(-1), 6);

    // A locked wheel stops the motor at once.
    expect(
      motor({
        previousMotorSpeed: 0.8,
        wheels: wheels({ locked: true, speed: 0 }),
      }).motorSpeed,
    ).toBe(0);
  });
});
