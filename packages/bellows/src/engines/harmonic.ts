/*
 * Harmonic plus noise engine, DDSP style: a 64 partial sine bank whose
 * amplitudes come from a parametric spectral envelope, plus filtered
 * noise, both under one loudness contour.
 *
 * The envelope is a spectral tilt (brightness), an even/odd harmonic
 * balance, and a fixed frequency lowpass rolloff whose corner moves
 * with formantShift, so shifting it against f0 reads as a formant
 * moving rather than plain brightness. Noise is white through an Svf
 * bandpass tracking f0 * noiseColor, mixed in by noiseMix. f0 glides in
 * the log domain with the portamento param when a new noteOn arrives on
 * a still sounding voice.
 *
 * The sine bank runs on one phase accumulator and the angle addition
 * recurrence sin((k+1)t) = sin(kt)cos(t) + cos(kt)sin(t), so a sample
 * costs two trig calls regardless of partial count.
 *
 * HarmonicVoice is exported for frame driven use: setControlFrame
 * bypasses the internal envelope and parametric spectrum so a neural
 * or analysis control stream can drive it directly.
 */

import type { EngineDef, NamedRng, ParamSpec, Voice } from '../types';
import { clamp } from '../types';
import { NoiseGen } from '../dsp/noise';
import { Svf } from '../dsp/filters';
import { Adsr } from '../dsp/envelopes';

const MAX_HARMONICS = 64;
const TWO_PI = Math.PI * 2;
/** Spectral envelope and noise filter refresh divider. */
const CTRL = 64;
const SILENCE = 1e-4;

function p(params: Record<string, number>, name: string, dflt: number): number {
  const v = params[name];
  return typeof v === 'number' && Number.isFinite(v) ? v : dflt;
}

export class HarmonicVoice implements Voice {
  private readonly sr: number;
  private readonly noise: NoiseGen;
  private readonly noiseBp: Svf;
  private readonly env: Adsr;
  private readonly amps = new Float32Array(MAX_HARMONICS);
  private readonly frameAmps = new Float32Array(MAX_HARMONICS);
  private frameAmpCount = 0;

  private phase = 0;
  private logF0 = Math.log2(440);
  private logTarget = Math.log2(440);
  private glideCoef = 1;
  private harmCount = 0;
  private ctrlCountdown = 0;

  private vel = 1;
  private live = false;

  // frame driven mode
  private frameMode = false;
  private frameGateOff = false;
  private loud = 0;
  private loudTarget = 0;
  private readonly loudCoef: number;

  private brightness: number;
  private evenOdd: number;
  private formantShift: number;
  private noiseMix: number;
  private noiseColor: number;
  private portamento: number;
  private attack: number;
  private release: number;
  private level: number;

  constructor(sampleRate: number, params: Record<string, number>, rng: NamedRng) {
    this.sr = sampleRate;
    this.noise = new NoiseGen(sampleRate, 'white', rng);
    this.noiseBp = new Svf(sampleRate);
    this.noiseBp.setMode('bp');
    this.env = new Adsr(sampleRate);
    this.loudCoef = 1 - Math.exp(-1 / (0.005 * sampleRate));
    this.brightness = p(params, 'brightness', 0.5);
    this.evenOdd = p(params, 'evenOdd', 0.5);
    this.formantShift = p(params, 'formantShift', 1);
    this.noiseMix = p(params, 'noiseMix', 0.1);
    this.noiseColor = p(params, 'noiseColor', 2);
    this.portamento = p(params, 'portamento', 0);
    this.attack = p(params, 'attack', 0.01);
    this.release = p(params, 'release', 0.3);
    this.level = p(params, 'level', 0.8);
  }

  noteOn(freq: number, vel: number): void {
    const f = clamp(freq, 16, this.sr * 0.45);
    this.vel = clamp(vel, 0, 1);
    this.logTarget = Math.log2(f);
    const port = clamp(this.portamento, 0, 4);
    if (this.live && port > 0) {
      // Legato glide from the current pitch; a fresh voice snaps.
      this.glideCoef = 1 - Math.exp(-1 / (port * this.sr));
    } else {
      this.logF0 = this.logTarget;
      this.glideCoef = 1;
      this.phase = 0;
      this.noiseBp.reset();
    }
    this.frameMode = false;
    this.frameGateOff = false;
    this.frameAmpCount = 0;
    this.env.set(clamp(this.attack, 0.001, 4), 0.1, 0.85, clamp(this.release, 0.01, 8));
    this.env.trigger();
    this.ctrlCountdown = 0;
    this.live = true;
  }

  noteOff(): void {
    if (this.frameMode) {
      this.frameGateOff = true;
      this.loudTarget = 0;
    } else {
      this.env.release();
    }
  }

  /**
   * Frame driven control, the render target for external (for example
   * neural) controllers. Call once per control frame, any rate:
   *
   *   f0        fundamental in Hz
   *   loudness  linear amplitude 0..1, smoothed internally over 5 ms
   *   harmonics optional linear amplitudes for partials 1..n (n <= 64),
   *             copied, not retained by reference; once given they
   *             replace the parametric spectral envelope and stay in
   *             force until the next frame that supplies harmonics or
   *             the next noteOn
   *
   * The first call switches the voice into frame mode: the Adsr and
   * velocity are bypassed and loudness is the whole contour. noteOff
   * then ends the voice once loudness has faded out. A later noteOn
   * returns the voice to normal envelope operation.
   */
  setControlFrame(f0: number, loudness: number, harmonics?: Float32Array): void {
    if (!this.frameMode) {
      this.frameMode = true;
      this.frameGateOff = false;
      this.live = true;
    }
    this.logTarget = Math.log2(clamp(f0, 16, this.sr * 0.45));
    const port = clamp(this.portamento, 0, 4);
    this.glideCoef = port > 0 ? 1 - Math.exp(-1 / (port * this.sr)) : 1;
    this.loudTarget = clamp(loudness, 0, 1);
    if (harmonics !== undefined) {
      const n = Math.min(harmonics.length, MAX_HARMONICS);
      for (let k = 0; k < n; k++) this.frameAmps[k] = harmonics[k];
      this.frameAmpCount = n;
    }
    this.ctrlCountdown = 0;
  }

  /** Rebuild partial amplitudes and the noise filter for the current f0. */
  private control(f0: number): void {
    const nyq = this.sr * 0.45;
    this.harmCount = Math.min(MAX_HARMONICS, Math.max(1, Math.floor(nyq / f0)));

    if (this.frameMode && this.frameAmpCount > 0) {
      let sum = 0;
      for (let k = 0; k < MAX_HARMONICS; k++) {
        const a = k < this.frameAmpCount && k < this.harmCount ? this.frameAmps[k] : 0;
        this.amps[k] = a;
        sum += Math.abs(a);
      }
      if (sum > 1) {
        const norm = 1 / sum;
        for (let k = 0; k < this.harmCount; k++) this.amps[k] *= norm;
      }
    } else {
      const tilt = 2.5 * (1 - clamp(this.brightness, 0, 1));
      const eo = clamp(this.evenOdd, 0, 1);
      const evenGain = eo <= 0.5 ? eo * 2 : 1;
      const oddGain = eo >= 0.5 ? (1 - eo) * 2 : 1;
      const corner = 3500 * clamp(this.formantShift, 0.25, 4);
      let sum = 0;
      for (let k = 0; k < MAX_HARMONICS; k++) {
        const h = k + 1;
        const f = h * f0;
        if (k >= this.harmCount) {
          this.amps[k] = 0;
          continue;
        }
        let a = Math.pow(h, -tilt);
        a *= h % 2 === 0 ? evenGain : oddGain;
        const rel = f / corner;
        a /= 1 + rel * rel * rel * rel;
        this.amps[k] = a;
        sum += a;
      }
      const norm = 1 / Math.max(sum, 1);
      for (let k = 0; k < this.harmCount; k++) this.amps[k] *= norm;
    }

    const bpHz = clamp(f0 * clamp(this.noiseColor, 0.25, 16), 40, nyq);
    this.noiseBp.set(bpHz, 1.5);
  }

  process(outL: Float32Array, outR: Float32Array, from: number, to: number): void {
    if (!this.live) return;
    const level = this.level;
    const nMix = clamp(this.noiseMix, 0, 1);
    for (let i = from; i < to; i++) {
      this.logF0 += this.glideCoef * (this.logTarget - this.logF0);
      const f0 = Math.pow(2, this.logF0);
      if (this.ctrlCountdown <= 0) {
        this.control(f0);
        this.ctrlCountdown = CTRL;
      }
      this.ctrlCountdown--;

      this.phase += f0 / this.sr;
      if (this.phase >= 1) this.phase -= 1;
      const t = TWO_PI * this.phase;
      const c1 = Math.cos(t);
      const s1 = Math.sin(t);
      let sk = s1;
      let ck = c1;
      let harm = this.amps[0] * s1;
      const count = this.harmCount;
      for (let k = 1; k < count; k++) {
        const s2 = sk * c1 + ck * s1;
        ck = ck * c1 - sk * s1;
        sk = s2;
        harm += this.amps[k] * sk;
      }

      const nz = this.noiseBp.next(this.noise.next());
      const dry = harm * (1 - nMix) + nz * nMix;

      let gain: number;
      if (this.frameMode) {
        this.loud += this.loudCoef * (this.loudTarget - this.loud);
        gain = this.loud;
      } else {
        gain = this.env.next() * this.vel;
      }
      const o = dry * gain * level;
      outL[i] += o;
      outR[i] += o;
    }
    if (this.frameMode) {
      if (this.frameGateOff && this.loud < SILENCE) this.live = false;
    } else if (!this.env.active) {
      this.live = false;
    }
  }

  setParam(name: string, value: number): void {
    switch (name) {
      case 'brightness':
        this.brightness = value;
        break;
      case 'evenOdd':
        this.evenOdd = value;
        break;
      case 'formantShift':
        this.formantShift = value;
        break;
      case 'noiseMix':
        this.noiseMix = value;
        break;
      case 'noiseColor':
        this.noiseColor = value;
        break;
      case 'portamento':
        this.portamento = value;
        break;
      case 'attack':
        this.attack = value;
        break;
      case 'release':
        this.release = value;
        break;
      case 'level':
        this.level = value;
        break;
    }
  }

  get active(): boolean {
    return this.live;
  }
}

const params: ParamSpec[] = [
  { name: 'brightness', min: 0, max: 1, default: 0.5 },
  { name: 'evenOdd', min: 0, max: 1, default: 0.5 },
  { name: 'formantShift', min: 0.25, max: 4, default: 1, curve: 'exp' },
  { name: 'noiseMix', min: 0, max: 1, default: 0.1 },
  { name: 'noiseColor', min: 0.25, max: 16, default: 2, curve: 'exp' },
  { name: 'portamento', min: 0, max: 4, default: 0, unit: 's' },
  { name: 'attack', min: 0.001, max: 4, default: 0.01, curve: 'exp', unit: 's' },
  { name: 'release', min: 0.01, max: 8, default: 0.3, curve: 'exp', unit: 's' },
  { name: 'level', min: 0, max: 1, default: 0.8 },
];

export const harmonicEngine: EngineDef = {
  id: 'harmonic',
  label: 'Harmonic plus Noise',
  params,
  polyphony: 8,
  createVoice: (sampleRate, initParams, rng) => new HarmonicVoice(sampleRate, initParams, rng),
};
