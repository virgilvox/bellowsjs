/*
 * Granular engine over a source buffer.
 *
 * makeGranularEngine wraps any mono Float32Array in an EngineDef; the
 * default granularEngine reads an internally synthesized one second
 * test tone. A voice keeps 64 preallocated grain slots and schedules
 * new grains sample accurately from a countdown driven by the density
 * param, drawing start position (position + spray jitter), pitch
 * jitter, reverse chance, and stereo pan from its own rng stream.
 * Grains window through a shared hann table and read the buffer with
 * linear interpolation. noteOn frequency scales playback rate relative
 * to baseNote, times the pitch param and the source sample rate ratio.
 *
 * Spawning draws four rng values per grain no matter which params are
 * active, so renders stay comparable across param tweaks with the same
 * seed. No allocation happens on the audio path.
 */

import type { EngineDef, NamedRng, ParamSpec, Voice } from '../types';
import { clamp, mtof } from '../types';

const MAX_GRAINS = 64;
const HANN_N = 1024;
const TWO_PI = Math.PI * 2;

let hannTable: Float32Array | null = null;

function getHann(): Float32Array {
  if (hannTable === null) {
    hannTable = new Float32Array(HANN_N);
    for (let i = 0; i < HANN_N; i++) {
      hannTable[i] = 0.5 * (1 - Math.cos((TWO_PI * i) / (HANN_N - 1)));
    }
  }
  return hannTable;
}

interface Grain {
  live: boolean;
  pos: number;
  step: number;
  age: number;
  dur: number;
  amp: number;
  gl: number;
  gr: number;
}

function makeGrain(): Grain {
  return { live: false, pos: 0, step: 0, age: 0, dur: 0, amp: 0, gl: 0, gr: 0 };
}

function p(params: Record<string, number>, name: string, dflt: number): number {
  const v = params[name];
  return typeof v === 'number' && Number.isFinite(v) ? v : dflt;
}

class GranularVoice implements Voice {
  private readonly sr: number;
  private readonly rng: NamedRng;
  private readonly buffer: Float32Array;
  private readonly bufferRate: number;
  private readonly window: Float32Array;
  private readonly grains: Grain[];
  private liveGrains = 0;

  private gate = false;
  private vel = 1;
  private rateBase = 1;
  private countdown = 0;

  private grainSize: number;
  private density: number;
  private position: number;
  private spray: number;
  private pitch: number;
  private pitchJitter: number;
  private spread: number;
  private reverse: number;
  private baseNote: number;
  private level: number;

  constructor(
    sampleRate: number,
    params: Record<string, number>,
    rng: NamedRng,
    buffer: Float32Array,
    bufferSampleRate: number
  ) {
    this.sr = sampleRate;
    this.rng = rng;
    this.buffer = buffer;
    this.bufferRate = bufferSampleRate;
    this.window = getHann();
    this.grains = [];
    for (let i = 0; i < MAX_GRAINS; i++) this.grains.push(makeGrain());
    this.grainSize = p(params, 'grainSize', 80);
    this.density = p(params, 'density', 20);
    this.position = p(params, 'position', 0.25);
    this.spray = p(params, 'spray', 0.05);
    this.pitch = p(params, 'pitch', 1);
    this.pitchJitter = p(params, 'pitchJitter', 0);
    this.spread = p(params, 'spread', 0.5);
    this.reverse = p(params, 'reverse', 0);
    this.baseNote = p(params, 'baseNote', 69);
    this.level = p(params, 'level', 0.9);
  }

  noteOn(freq: number, vel: number): void {
    this.vel = clamp(vel, 0, 1);
    this.gate = true;
    this.rateBase = (freq / mtof(this.baseNote)) * (this.bufferRate / this.sr);
    this.countdown = 0;
    for (const g of this.grains) g.live = false;
    this.liveGrains = 0;
  }

  noteOff(): void {
    this.gate = false;
  }

  private spawn(): void {
    // Fixed draw order and count keeps the stream aligned across params.
    const posJit = 2 * this.rng() - 1;
    const pitchJit = 2 * this.rng() - 1;
    const revDraw = this.rng();
    const panDraw = 2 * this.rng() - 1;

    let slot: Grain | null = null;
    for (let i = 0; i < MAX_GRAINS; i++) {
      if (!this.grains[i].live) {
        slot = this.grains[i];
        break;
      }
    }
    if (slot === null) return; // cloud saturated, drop the grain

    const durSec = clamp(this.grainSize, 10, 500) / 1000;
    const dur = Math.max(2, Math.round(durSec * this.sr));
    const startNorm = clamp(this.position + clamp(this.spray, 0, 1) * posJit, 0, 1);
    let step = this.rateBase * clamp(this.pitch, 0.25, 4);
    step *= Math.pow(2, (clamp(this.pitchJitter, 0, 12) * pitchJit) / 12);
    if (revDraw < clamp(this.reverse, 0, 1)) step = -step;

    const pan = 0.5 + 0.5 * clamp(this.spread, 0, 1) * panDraw;
    const theta = (pan * Math.PI) / 2;

    slot.live = true;
    slot.pos = startNorm * (this.buffer.length - 2);
    slot.step = step;
    slot.age = 0;
    slot.dur = dur;
    slot.amp = this.vel / Math.sqrt(Math.max(1, this.density * durSec));
    slot.gl = Math.cos(theta);
    slot.gr = Math.sin(theta);
    this.liveGrains++;
  }

  process(outL: Float32Array, outR: Float32Array, from: number, to: number): void {
    if (!this.gate && this.liveGrains === 0) return;
    const buf = this.buffer;
    const last = buf.length - 2;
    const win = this.window;
    const winScale = HANN_N - 1;
    const level = this.level;
    for (let i = from; i < to; i++) {
      if (this.gate) {
        this.countdown -= 1;
        while (this.countdown <= 0) {
          this.spawn();
          this.countdown += this.sr / clamp(this.density, 0.5, 400);
        }
      }
      let l = 0;
      let r = 0;
      for (let gi = 0; gi < MAX_GRAINS; gi++) {
        const g = this.grains[gi];
        if (!g.live) continue;
        const wi = (g.age / g.dur) * winScale;
        const wIdx = wi | 0;
        const wf = wi - wIdx;
        const w = win[wIdx] + wf * (win[wIdx + 1] - win[wIdx]);
        const pi = g.pos | 0;
        const pf = g.pos - pi;
        const s = (buf[pi] + pf * (buf[pi + 1] - buf[pi])) * w * g.amp;
        l += s * g.gl;
        r += s * g.gr;
        g.pos += g.step;
        g.age++;
        if (g.age >= g.dur - 1 || g.pos < 0 || g.pos >= last) {
          g.live = false;
          this.liveGrains--;
        }
      }
      outL[i] += l * level;
      outR[i] += r * level;
    }
  }

  setParam(name: string, value: number): void {
    switch (name) {
      case 'grainSize':
        this.grainSize = value;
        break;
      case 'density':
        this.density = value;
        break;
      case 'position':
        this.position = value;
        break;
      case 'spray':
        this.spray = value;
        break;
      case 'pitch':
        this.pitch = value;
        break;
      case 'pitchJitter':
        this.pitchJitter = value;
        break;
      case 'spread':
        this.spread = value;
        break;
      case 'reverse':
        this.reverse = value;
        break;
      case 'baseNote':
        this.baseNote = value;
        break;
      case 'level':
        this.level = value;
        break;
    }
  }

  get active(): boolean {
    return this.gate || this.liveGrains > 0;
  }
}

const params: ParamSpec[] = [
  { name: 'grainSize', min: 10, max: 500, default: 80, curve: 'exp', unit: 'ms' },
  { name: 'density', min: 0.5, max: 400, default: 20, curve: 'exp', unit: 'Hz' },
  { name: 'position', min: 0, max: 1, default: 0.25 },
  { name: 'spray', min: 0, max: 1, default: 0.05 },
  { name: 'pitch', min: 0.25, max: 4, default: 1, curve: 'exp' },
  { name: 'pitchJitter', min: 0, max: 12, default: 0, unit: 'st' },
  { name: 'spread', min: 0, max: 1, default: 0.5 },
  { name: 'reverse', min: 0, max: 1, default: 0 },
  { name: 'baseNote', min: 24, max: 96, default: 69 },
  { name: 'level', min: 0, max: 1, default: 0.9 },
];

/** Build a granular EngineDef over the given mono buffer. */
export function makeGranularEngine(
  buffer: Float32Array,
  bufferSampleRate: number,
  id = 'granular'
): EngineDef {
  return {
    id,
    label: 'Granular',
    params,
    polyphony: 8,
    createVoice: (sampleRate, initParams, rng) =>
      new GranularVoice(sampleRate, initParams, rng, buffer, bufferSampleRate),
  };
}

const TEST_TONE_RATE = 44100;
let testTone: Float32Array | null = null;

/** One second 220 Hz tone with a second harmonic and 10 ms edge fades. */
function getTestTone(): Float32Array {
  if (testTone === null) {
    const n = TEST_TONE_RATE;
    testTone = new Float32Array(n);
    const fade = Math.round(0.01 * n);
    for (let i = 0; i < n; i++) {
      const t = i / TEST_TONE_RATE;
      let a = 1;
      if (i < fade) a = i / fade;
      else if (i > n - fade) a = (n - i) / fade;
      testTone[i] = a * (0.7 * Math.sin(TWO_PI * 220 * t) + 0.2 * Math.sin(TWO_PI * 440 * t));
    }
  }
  return testTone;
}

/** Default granular engine over the internal test tone. */
export const granularEngine: EngineDef = makeGranularEngine(getTestTone(), TEST_TONE_RATE);
