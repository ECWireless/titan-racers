import { expect, test } from "@playwright/test";

import {
  getAudioSurface,
  getAudioWheel,
  getImpactMaterial,
  getMotorAudioState,
  getRaceCue,
  ImpactAudioGate,
  LandingAudioDetector,
  resolveImpactMaterial,
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

  test("hears each surface by how it looks and grips, with water winning", () => {
    expect(getAudioSurface("surface.standard-course", "asphalt", false)).toBe(
      "asphalt",
    );
    expect(getAudioSurface("surface.standard-course", "kerb", false)).toBe(
      "concrete",
    );
    expect(getAudioSurface("surface.standard-course", "timber", false)).toBe(
      "concrete",
    );
    expect(getAudioSurface("surface.lawn-grass", "lawn", false)).toBe("grass");
    expect(getAudioSurface("surface.standard-course", "mulch", false)).toBe(
      "gravel",
    );
    expect(getAudioSurface("surface.standard-course", "asphalt", true)).toBe(
      "water",
    );
    expect(getAudioSurface(null, undefined, false)).toBe("asphalt");
  });

  test("names what a contact hit: solid objects, arc boxes, trees, bicycles, and the fence", () => {
    const solid = new Map([
      ["drum-1", getImpactMaterial("obstacleBarrel")],
      ["fence-arc", getImpactMaterial("timber")],
      ["kerb-2", getImpactMaterial("kerb")],
      ["hedge-1", getImpactMaterial("hedge")],
    ]);
    const hit = (name: string) => resolveImpactMaterial(name, solid);
    expect(hit("drum-1")).toBe("metal");
    expect(hit("fence-arc-collision-3")).toBe("wood");
    expect(hit("kerb-2")).toBe("concrete");
    expect(hit("hedge-1")).toBe("soft");
    expect(hit("course-tree-collider-12")).toBe("wood");
    expect(hit("course-bicycle-collider-2")).toBe("metal");
    expect(hit("course-clearing-fence-4")).toBe("metal");
    // Drivable ground, including a deck the chassis bottoms out on.
    expect(hit("deck-1")).toBeNull();
    expect(hit("ground")).toBeNull();
  });

  test("scrubs from the tire-mark onset and scales load to a quarter at rest", () => {
    const wheel = {
      appliedLateralTireForce: 10,
      lateralSpeed: 3,
      locked: false,
      longitudinalSpeed: 4,
      supported: true,
      suspensionLoad: 5,
    };
    expect(getAudioWheel(wheel, "asphalt", 5, 30, 130)).toMatchObject({
      load: 0.25,
      scrub: 0,
      speed: 5,
      surface: "asphalt",
    });
    expect(
      getAudioWheel({ ...wheel, lateralSpeed: 8 }, "asphalt", 5, 30, 130).scrub,
    ).toBeCloseTo(0.5, 6);
    expect(getAudioWheel(wheel, null, 5, 30, 130)).toMatchObject({
      speed: 0,
      supported: false,
    });
  });

  test("plays one hit per wall contact and scales it to approach speed", () => {
    const gate = new ImpactAudioGate();
    expect(gate.admit(0.3, true)).toBeNull();
    expect(gate.admit(4.2, true)).toBeCloseTo(0.3, 6);
    // Scraping on along the same wall stays silent, however long it lasts;
    // a much harder hit does not.
    gate.advance(1);
    expect(gate.admit(4.2, false)).toBeNull();
    expect(gate.admit(14, false)).toBe(1);
    // A fresh contact inside the repeat window must be clearly harder too.
    gate.advance(1 / 60);
    expect(gate.admit(4.2, true)).toBeNull();
    gate.advance(0.2);
    expect(gate.admit(1.4, true)).toBeCloseTo(0.1, 6);
  });

  test("lands with the downward speed from just before touchdown", () => {
    const detector = new LandingAudioDetector();
    expect(detector.step(0, 2.25, 0.05)).toBeNull();
    expect(detector.step(4, 0, 1 / 60)).toBeNull(); // a bump, not a flight

    for (let step = 0; step < 30; step += 1) detector.step(0, 2.25, 1 / 60);
    expect(detector.step(2, 0, 1 / 60)).toBeCloseTo(0.5, 6);
    expect(detector.step(4, 0, 1 / 60)).toBeNull();

    // A reset mid-flight (a recovery teleport) forgets the flight.
    for (let step = 0; step < 30; step += 1) detector.step(0, 3, 1 / 60);
    detector.reset();
    expect(detector.step(4, 0, 1 / 60)).toBeNull();
  });

  test("calls each countdown tick, Go, the final lap, and the finish once", () => {
    const at = (
      state: string,
      countdownValue: number | null,
      currentLap = 1,
      cue: string | null = countdownValue === null
        ? null
        : String(countdownValue),
    ) => ({ countdownValue, cue, currentLap, lapCount: 2, state });
    const sequence = [
      at("ready", null),
      at("countdown", 3),
      at("countdown", 3),
      at("countdown", 2),
      at("countdown", 1),
      at("racing", null, 1, "Go!"),
      at("racing", null, 1, "Go!"),
      at("racing", null),
      at("racing", null, 2, "Lap 2"),
      at("paused", null, 2),
      at("resuming", 3, 2),
      at("resuming", 2, 2),
      at("resuming", 1, 2),
      // A pause during a recovery resumes into it; Go shows once racing.
      at("recovering", null, 2),
      at("racing", null, 2, "Go!"),
      at("finished", null, 2),
    ];
    const cues = sequence
      .slice(1)
      .map((next, index) => getRaceCue(sequence[index], next))
      .filter(Boolean);
    expect(cues).toEqual([
      "count-3",
      "count-2",
      "count-1",
      "go",
      "final-lap",
      "count-3",
      "count-2",
      "count-1",
      "go",
      "finish",
    ]);
  });
});
