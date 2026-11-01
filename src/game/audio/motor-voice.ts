import {
  cachedCurve,
  cachedWave,
  chain,
  clamp,
  continuousVoice,
  createParameterSmoother,
  filterNode,
  gainNode,
  loopSource,
  noiseBuffer,
  smoothstep,
} from "./audio-synthesis";
import type { MotorAudioState } from "./race-audio-mapping";

/**
 * A sensorless brushless "540" motor and its gears, as on a real 1:10 RC car.
 *
 * - Two poles at about 30,000 rpm no-load: a 500 Hz rotor rate at motor speed
 *   1, with six-step commutation ripple at 6×.
 * - An 18T pinion on a 72T spur (4:1), then a 21T second stage on the spur
 *   shaft: meshes at 18× rotor rate and 21× spur-shaft rate.
 *
 * Layers: the electrical whine, a buzz the current drives into saturation, the
 * two gear meshes, the ESC's PWM squeal and a bearing hiss, through a high
 * shelf that brightens with current. 16 nodes.
 */
export function createMotorVoice(context: BaseAudioContext, output: AudioNode) {
  const noise = noiseBuffer(context);
  const electrical = context.createOscillator();
  electrical.setPeriodicWave(
    cachedWave(context, "motorElectrical", {
      1: 1,
      2: 0.45,
      3: 0.16,
      4: 0.14,
      6: 0.62,
      7: 0.1,
      12: 0.3,
      18: 0.12,
    }),
  );
  electrical.frequency.value = 5;
  // Runs at spur-shaft rate (rotor / 4): harmonics 20–22 are the second-stage
  // mesh with runout sidebands, 68–76 the pinion mesh.
  const gear = context.createOscillator();
  gear.setPeriodicWave(
    cachedWave(context, "motorGear", {
      20: 0.18,
      21: 0.75,
      22: 0.18,
      42: 0.2,
      68: 0.12,
      71: 0.1,
      72: 0.6,
      73: 0.1,
      76: 0.12,
    }),
  );
  gear.frequency.value = 1.25;
  const electricalGain = gainNode(context);
  const gearGain = gainNode(context);
  const drive = gainNode(context, 0.3);
  const shaper = context.createWaveShaper();
  shaper.curve = cachedCurve(context, "motorSaturation", () => {
    const curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i += 1) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      curve[i] = Math.tanh(4.5 * x + 0.6 * x * x) / Math.tanh(5.1);
    }
    return curve;
  });
  shaper.oversample = "2x";
  const harshFilter = filterNode(context, "highpass", 1500, 0.8);
  const harshGain = gainNode(context);
  const pwm = context.createOscillator();
  pwm.type = "triangle";
  pwm.frequency.value = 8000;
  const pwmGain = gainNode(context);
  const bearing = loopSource(context, noise, 1, 0.3);
  const bearingFilter = filterNode(context, "bandpass", 2000, 0.8);
  const bearingGain = gainNode(context);
  // Noise played very slowly: a random pitch wobble about 90 Hz wide.
  const jitter = loopSource(context, noise, 0.002, 0.7);
  const jitterGain = gainNode(context, 3);
  const shelf = filterNode(context, "highshelf", 1800);
  shelf.gain.value = -3;

  chain(electrical, electricalGain, shelf);
  chain(electrical, drive, shaper, harshFilter, harshGain, shelf);
  chain(gear, gearGain, shelf);
  chain(pwm, pwmGain, shelf);
  chain(bearing, bearingFilter, bearingGain, shelf);
  shelf.connect(output);
  jitter.connect(jitterGain);
  jitterGain.connect(electrical.detune);
  jitterGain.connect(gear.detune);
  electrical.start();
  gear.start();
  pwm.start();

  const set = createParameterSmoother();
  const nodes = [
    electrical,
    gear,
    electricalGain,
    gearGain,
    drive,
    shaper,
    harshFilter,
    harshGain,
    pwm,
    pwmGain,
    bearing,
    bearingFilter,
    bearingGain,
    jitter,
    jitterGain,
    shelf,
  ];

  return continuousVoice<MotorAudioState>(
    nodes,
    [electrical, gear, pwm, bearing, jitter],
    (state, time) => {
      const speed = clamp(state.motorSpeed, 0, 1.1);
      const throttle = clamp(state.throttle);
      const brake = clamp(state.brake);
      const load = clamp(state.load);
      const spin = smoothstep(0, 0.03, speed);
      // Braking through the ESC pushes current through the windings too.
      const regen = brake * spin * Math.min(1, speed * 3);
      const current = Math.max(throttle > 0.01 ? load : 0, regen * 0.6);
      const powered = Math.max(throttle, regen);
      const rpm = speed ** 0.7;
      const rotorHz = 500 * Math.max(speed, 0.01);

      // Below about 2% speed a sensorless ESC steps the field open-loop: a
      // coarse stutter rather than a pitched whine.
      set(
        electrical.frequency,
        Math.max(rotorHz, 14 * powered * current),
        time,
        0.025,
      );
      set(gear.frequency, rotorHz / 4, time, 0.025);
      set(
        electricalGain.gain,
        powered * (0.1 + 0.45 * current) * rpm + 0.03 * spin * rpm,
        time,
        0.04,
      );
      // Strongest when lugging at low speed.
      set(drive.gain, 0.2 + 0.8 * current, time, 0.04);
      set(
        harshGain.gain,
        powered * current * (0.4 + 0.6 * (1 - Math.min(speed, 1) * 0.8)) * 0.6,
        time,
        0.04,
      );
      // Gear whine follows shaft speed; transmitted torque loads the teeth.
      set(
        gearGain.gain,
        spin *
          rpm *
          (0.28 + 0.3 * Math.max(current, throttle * 0.4)) *
          (state.reversing ? 1.15 : 1),
        time,
        0.04,
      );
      // PWM ripple is largest at partial duty: the stall and crawl squeal.
      const duty = clamp(0.12 + speed * 0.9 + current * 0.15);
      set(
        pwmGain.gain,
        powered > 0.01 ? powered * 4 * duty * (1 - duty) * 0.035 : 0,
        time,
        0.03,
      );
      set(bearingGain.gain, spin * speed ** 1.3 * 0.25, time, 0.05);
      set(bearingFilter.frequency, 1200 + 3800 * speed, time, 0.05);
      set(shelf.gain, -3 + 9 * current, time, 0.05);
      set(
        jitterGain.gain,
        3 + 32 * current * (1 - Math.min(speed, 1)),
        time,
        0.05,
      );
    },
  );
}
