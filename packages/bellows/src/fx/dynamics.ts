/*
 * Dynamics processors: compressor, limiter, gate, transient shaper.
 * All four are stereo in-place Effects driven by one mono sidechain,
 * max(|l|, |r|), so the stereo image does not wander when one channel
 * dips. Level detection runs in the dB domain: rectified sample to dB
 * with a -96 dB floor, then asymmetric one-pole smoothing.
 *
 * The limiter is the only unit with a fixed latency (its 5 ms lookahead);
 * the compressor reports whatever its lookahead param is set to. Both
 * expose a `latency` getter in samples on the concrete class.
 */

import type { Effect, EffectDef, ParamSpec } from '../types';
import { clamp, dbToGain } from '../types';
import { DelayLine } from '../dsp/delayline';
import { EnvelopeFollower } from '../dsp/envelopes';
import { Oversampler } from '../dsp/oversample';

/** Apply spec defaults, then caller overrides, through setParam. */
function applyParams(fx: Effect, specs: ParamSpec[], params: Record<string, number>): void {
  for (const s of specs) fx.setParam(s.name, params[s.name] ?? s.default);
}

const DB_FLOOR = -96;
const FLOOR_LIN = Math.pow(10, DB_FLOOR / 20);
/** gain = exp(db * DB_TO_LN), cheaper than Math.pow on the audio path. */
const DB_TO_LN = Math.LN10 / 20;

/** Rectified sample to dB with a -96 dB floor. */
function levelDb(x: number): number {
  return x > FLOOR_LIN ? 20 * Math.log10(x) : DB_FLOOR;
}

/** One-pole coefficient reaching 63 percent of a step in timeSec. */
function onePoleCoef(timeSec: number, sampleRate: number): number {
  return timeSec <= 0 ? 1 : 1 - Math.exp(-1 / (timeSec * sampleRate));
}

/* ------------------------------------------------------------------ */
/* Compressor                                                          */
/* ------------------------------------------------------------------ */

const COMP_LOOKAHEAD_MAX = 0.01;
/** Averaging time of the crest factor trackers, per Giannoulis et al. */
const CREST_TC = 0.2;

const COMPRESSOR_PARAMS: ParamSpec[] = [
  { name: 'threshold', min: -60, max: 0, default: -18, curve: 'db', unit: 'dB' },
  { name: 'ratio', min: 1, max: 20, default: 4 },
  { name: 'knee', min: 0, max: 24, default: 6, unit: 'dB' },
  { name: 'attack', min: 0.0001, max: 0.5, default: 0.01, curve: 'exp', unit: 's' },
  { name: 'release', min: 0.01, max: 2, default: 0.2, curve: 'exp', unit: 's' },
  /** -1 selects auto makeup: half the static reduction of a 0 dBFS signal. */
  { name: 'makeup', min: -1, max: 24, default: 0, unit: 'dB' },
  { name: 'lookahead', min: 0, max: COMP_LOOKAHEAD_MAX, default: 0, unit: 's' },
  { name: 'mix', min: 0, max: 1, default: 1 },
];

/**
 * Feedforward stereo-linked compressor. The sidechain level is smoothed
 * in dB with attack/release ballistics, then a quadratic soft knee static
 * curve computes the gain.
 *
 * Program-dependent release: two release constants, the configured time
 * and a quarter of it, blended by the sidechain crest factor. Peak and
 * RMS power are tracked with the same 200 ms one-pole (Giannoulis et al.,
 * "Digital Dynamic Range Compressor Design", JAES 2012). A steady sine
 * has crest^2 = 2 and gets the full release time; percussive material
 * with crest^2 >= 8 gets the quarter time; values between blend linearly.
 *
 * Lookahead delays the audio path with DelayLines while the detector
 * reads the undelayed input, so the gain is already down when a step
 * transient reaches the output.
 */
class Compressor implements Effect {
  private readonly sampleRate: number;
  private readonly dlL: DelayLine;
  private readonly dlR: DelayLine;
  private readonly crestA: number;

  private threshold = -18;
  private ratio = 4;
  private knee = 6;
  private aCoef = 1;
  private rCoefSlow = 1;
  private rCoefFast = 1;
  private makeupParam = 0;
  private makeupDb = 0;
  private lookSamples = 0;
  private mix = 1;

  private env = DB_FLOOR;
  private peakSq = 0;
  private rmsSq = 0;

  constructor(sampleRate: number, params: Record<string, number>) {
    this.sampleRate = sampleRate;
    const cap = Math.ceil(COMP_LOOKAHEAD_MAX * sampleRate) + 4;
    this.dlL = new DelayLine(cap);
    this.dlR = new DelayLine(cap);
    this.crestA = Math.exp(-1 / (CREST_TC * sampleRate));
    applyParams(this, COMPRESSOR_PARAMS, params);
  }

  /** Current lookahead delay in samples. */
  get latency(): number {
    return this.lookSamples;
  }

  setParam(name: string, value: number): void {
    switch (name) {
      case 'threshold':
        this.threshold = clamp(value, -60, 0);
        this.updateMakeup();
        break;
      case 'ratio':
        this.ratio = clamp(value, 1, 20);
        this.updateMakeup();
        break;
      case 'knee':
        this.knee = clamp(value, 0, 24);
        this.updateMakeup();
        break;
      case 'attack':
        this.aCoef = onePoleCoef(clamp(value, 0.0001, 0.5), this.sampleRate);
        break;
      case 'release': {
        const rel = clamp(value, 0.01, 2);
        this.rCoefSlow = onePoleCoef(rel, this.sampleRate);
        this.rCoefFast = onePoleCoef(rel * 0.25, this.sampleRate);
        break;
      }
      case 'makeup':
        this.makeupParam = clamp(value, -1, 24);
        this.updateMakeup();
        break;
      case 'lookahead':
        this.lookSamples = Math.round(clamp(value, 0, COMP_LOOKAHEAD_MAX) * this.sampleRate);
        break;
      case 'mix':
        this.mix = clamp(value, 0, 1);
        break;
    }
  }

  /**
   * Gain in dB the static curve applies at sidechain level lvl.
   * Quadratic soft knee interpolates over [threshold - knee/2,
   * threshold + knee/2]; outside the knee the curve is the usual
   * two-segment threshold/ratio line.
   */
  private staticGainDb(lvl: number): number {
    const over = lvl - this.threshold;
    const knee = this.knee;
    if (knee > 0 && 2 * Math.abs(over) <= knee) {
      const t = over + knee * 0.5;
      return ((1 / this.ratio - 1) * t * t) / (2 * knee);
    }
    return over > 0 ? (1 / this.ratio - 1) * over : 0;
  }

  /** Auto makeup compensates half the reduction a 0 dBFS signal would get. */
  private updateMakeup(): void {
    this.makeupDb =
      this.makeupParam <= -0.999 ? -0.5 * this.staticGainDb(0) : this.makeupParam;
  }

  process(l: Float32Array, r: Float32Array, from: number, to: number): void {
    const mix = this.mix;
    const dryAmt = 1 - mix;
    const look = this.lookSamples;
    for (let i = from; i < to; i++) {
      const xl = l[i];
      const xr = r[i];
      const al = Math.abs(xl);
      const ar = Math.abs(xr);
      const s = al > ar ? al : ar;

      // Crest factor tracking for program-dependent release.
      const s2 = s * s;
      this.rmsSq = this.crestA * this.rmsSq + (1 - this.crestA) * s2;
      const pk = this.crestA * this.peakSq + (1 - this.crestA) * s2;
      this.peakSq = s2 > pk ? s2 : pk;
      const crestSq = this.peakSq / (this.rmsSq > 1e-12 ? this.rmsSq : 1e-12);
      const w = clamp((crestSq - 2) / 6, 0, 1);

      const sDb = levelDb(s);
      if (sDb > this.env) {
        this.env += this.aCoef * (sDb - this.env);
      } else {
        const rCoef = this.rCoefSlow + w * (this.rCoefFast - this.rCoefSlow);
        this.env += rCoef * (sDb - this.env);
      }

      const gDb = this.staticGainDb(this.env) + this.makeupDb;
      const gain = Math.exp(gDb * DB_TO_LN);

      this.dlL.write(xl);
      this.dlR.write(xr);
      const dl = this.dlL.readInt(look);
      const dr = this.dlR.readInt(look);
      // Parallel compression: dry is the delayed input so both paths align.
      const g = dryAmt + mix * gain;
      l[i] = dl * g;
      r[i] = dr * g;
    }
  }

  reset(): void {
    this.dlL.clear();
    this.dlR.clear();
    this.env = DB_FLOOR;
    this.peakSq = 0;
    this.rmsSq = 0;
  }
}

export const compressorDef: EffectDef = {
  id: 'compressor',
  label: 'Compressor',
  params: COMPRESSOR_PARAMS,
  create: (sampleRate, params) => new Compressor(sampleRate, params),
};

/* ------------------------------------------------------------------ */
/* Limiter                                                             */
/* ------------------------------------------------------------------ */

const LIMITER_LOOKAHEAD_SEC = 0.005;
const LIM_OS_BLOCK = 128;

const LIMITER_PARAMS: ParamSpec[] = [
  { name: 'ceiling', min: -24, max: 0, default: -0.3, unit: 'dB' },
  { name: 'release', min: 0.001, max: 1, default: 0.05, curve: 'exp', unit: 's' },
  /** 1 enables 4x oversampled peak detection (detection only). */
  { name: 'truePeak', min: 0, max: 1, default: 0 },
];

/**
 * Lookahead brickwall limiter. Per sample the required gain reduction in
 * dB (with exponential release applied) feeds a sliding maximum over the
 * lookahead window, and that maximum is box-averaged over the same window
 * length. Every term of the average covers the sample leaving the delay
 * line, so the averaged reduction is always at least the reduction that
 * sample needs: the output never exceeds the ceiling, and the attack is
 * a smooth ramp instead of a step. True-peak mode raises the detector
 * level with a 4x oversampled peak estimate; the raw sample peak is
 * always included so the sample-domain guarantee holds either way.
 */
class Limiter implements Effect {
  /** Fixed lookahead delay in samples. */
  readonly latency: number;
  private readonly sampleRate: number;
  private readonly win: number;
  private readonly dlL: DelayLine;
  private readonly dlR: DelayLine;
  private readonly dqVal: Float64Array;
  private readonly dqIdx: Float64Array;
  private readonly dqCap: number;
  private dqHead = 0;
  private dqTail = 0;
  private readonly avgRing: Float64Array;
  private avgSum = 0;
  private avgPos = 0;
  private readonly osL: Oversampler;
  private readonly osR: Oversampler;
  private n = 0;
  private renv = 0;

  private ceilingDb = -0.3;
  private ceilLin = dbToGain(-0.3);
  private relMul = 0;
  private truePeak = false;

  constructor(sampleRate: number, params: Record<string, number>) {
    this.sampleRate = sampleRate;
    this.latency = Math.ceil(LIMITER_LOOKAHEAD_SEC * sampleRate);
    this.win = this.latency + 1;
    this.dlL = new DelayLine(this.latency + 4);
    this.dlR = new DelayLine(this.latency + 4);
    this.dqCap = this.win + 1;
    this.dqVal = new Float64Array(this.dqCap);
    this.dqIdx = new Float64Array(this.dqCap);
    this.avgRing = new Float64Array(this.win);
    this.osL = new Oversampler(4, LIM_OS_BLOCK);
    this.osR = new Oversampler(4, LIM_OS_BLOCK);
    applyParams(this, LIMITER_PARAMS, params);
  }

  setParam(name: string, value: number): void {
    switch (name) {
      case 'ceiling':
        this.ceilingDb = clamp(value, -24, 0);
        this.ceilLin = dbToGain(this.ceilingDb);
        break;
      case 'release':
        this.relMul = Math.exp(-1 / (clamp(value, 0.001, 1) * this.sampleRate));
        break;
      case 'truePeak':
        this.truePeak = value >= 0.5;
        break;
    }
  }

  process(l: Float32Array, r: Float32Array, from: number, to: number): void {
    for (let start = from; start < to; start += LIM_OS_BLOCK) {
      this.chunk(l, r, start, Math.min(start + LIM_OS_BLOCK, to));
    }
  }

  private chunk(l: Float32Array, r: Float32Array, from: number, to: number): void {
    const tp = this.truePeak;
    let upL: Float32Array | null = null;
    let upR: Float32Array | null = null;
    if (tp) {
      upL = this.osL.up(l, from, to);
      upR = this.osR.up(r, from, to);
    }
    const win = this.win;
    const cap = this.dqCap;
    for (let i = from; i < to; i++) {
      const xl = l[i];
      const xr = r[i];
      const al = Math.abs(xl);
      const ar = Math.abs(xr);
      let det = al > ar ? al : ar;
      if (tp) {
        const b = (i - from) * 4;
        for (let k = 0; k < 4; k++) {
          const ul = Math.abs(upL![b + k]);
          if (ul > det) det = ul;
          const ur = Math.abs(upR![b + k]);
          if (ur > det) det = ur;
        }
      }
      this.dlL.write(xl);
      this.dlR.write(xr);

      // Required reduction in dB with exponential release toward zero.
      const need = det > this.ceilLin ? levelDb(det) - this.ceilingDb : 0;
      let renv = this.renv * this.relMul;
      if (need > renv) renv = need;
      this.renv = renv;

      // Sliding maximum over the last `win` reduction values.
      while (this.dqTail > this.dqHead && this.dqVal[(this.dqTail - 1) % cap] <= renv) {
        this.dqTail--;
      }
      this.dqVal[this.dqTail % cap] = renv;
      this.dqIdx[this.dqTail % cap] = this.n;
      this.dqTail++;
      if (this.dqIdx[this.dqHead % cap] <= this.n - win) this.dqHead++;
      const m = this.dqVal[this.dqHead % cap];

      // Box average of the maximum, same window length.
      this.avgSum += m - this.avgRing[this.avgPos];
      this.avgRing[this.avgPos] = m;
      this.avgPos = this.avgPos + 1 === win ? 0 : this.avgPos + 1;
      let red = this.avgSum / win;
      if (red < 0) red = 0;

      const g = Math.exp(-red * DB_TO_LN);
      l[i] = this.dlL.readInt(this.latency) * g;
      r[i] = this.dlR.readInt(this.latency) * g;
      this.n++;
    }
  }

  reset(): void {
    this.dlL.clear();
    this.dlR.clear();
    this.dqHead = 0;
    this.dqTail = 0;
    this.avgRing.fill(0);
    this.avgSum = 0;
    this.avgPos = 0;
    this.osL.reset();
    this.osR.reset();
    this.n = 0;
    this.renv = 0;
  }
}

export const limiterDef: EffectDef = {
  id: 'limiter',
  label: 'Limiter',
  params: LIMITER_PARAMS,
  create: (sampleRate, params) => new Limiter(sampleRate, params),
};

/* ------------------------------------------------------------------ */
/* Gate                                                                */
/* ------------------------------------------------------------------ */

/** Open threshold sits at the threshold param, close 3 dB below it. */
const GATE_HYSTERESIS_DB = 3;

const GATE_PARAMS: ParamSpec[] = [
  { name: 'threshold', min: -80, max: 0, default: -40, curve: 'db', unit: 'dB' },
  { name: 'attack', min: 0.0001, max: 0.1, default: 0.001, curve: 'exp', unit: 's' },
  { name: 'hold', min: 0, max: 1, default: 0.05, unit: 's' },
  { name: 'release', min: 0.001, max: 2, default: 0.1, curve: 'exp', unit: 's' },
  /** Attenuation floor when closed. */
  { name: 'range', min: -80, max: 0, default: -60, unit: 'dB' },
];

/**
 * Noise gate with hysteresis. The detector is a fast fixed envelope
 * follower; the gate opens when its level crosses the threshold and only
 * closes once it has stayed below threshold - 3 dB for the hold time.
 * Levels inside the band keep the current state and top the hold timer
 * up. Gain moves between the range floor and unity with separate attack
 * and release one-poles.
 */
class Gate implements Effect {
  private readonly sampleRate: number;
  private readonly det: EnvelopeFollower;

  private openDb = -40;
  private closeDb = -43;
  private aCoef = 1;
  private rCoef = 1;
  private holdSamples = 0;
  private floorLin = dbToGain(-60);

  private open = false;
  private holdLeft = 0;
  private g = 0;

  constructor(sampleRate: number, params: Record<string, number>) {
    this.sampleRate = sampleRate;
    this.det = new EnvelopeFollower(sampleRate, 0.0002, 0.002);
    applyParams(this, GATE_PARAMS, params);
    this.g = this.floorLin;
  }

  setParam(name: string, value: number): void {
    switch (name) {
      case 'threshold':
        this.openDb = clamp(value, -80, 0);
        this.closeDb = this.openDb - GATE_HYSTERESIS_DB;
        break;
      case 'attack':
        this.aCoef = onePoleCoef(clamp(value, 0.0001, 0.1), this.sampleRate);
        break;
      case 'hold':
        this.holdSamples = Math.round(clamp(value, 0, 1) * this.sampleRate);
        break;
      case 'release':
        this.rCoef = onePoleCoef(clamp(value, 0.001, 2), this.sampleRate);
        break;
      case 'range':
        this.floorLin = dbToGain(clamp(value, -80, 0));
        break;
    }
  }

  process(l: Float32Array, r: Float32Array, from: number, to: number): void {
    for (let i = from; i < to; i++) {
      const al = Math.abs(l[i]);
      const ar = Math.abs(r[i]);
      const detDb = levelDb(this.det.next(al > ar ? al : ar));
      if (detDb >= this.openDb) {
        this.open = true;
        this.holdLeft = this.holdSamples;
      } else if (this.open) {
        if (detDb >= this.closeDb) {
          // Hysteresis band: stay open, keep the hold timer topped up.
          this.holdLeft = this.holdSamples;
        } else if (this.holdLeft > 0) {
          this.holdLeft--;
        } else {
          this.open = false;
        }
      }
      const target = this.open ? 1 : this.floorLin;
      this.g += (this.open ? this.aCoef : this.rCoef) * (target - this.g);
      l[i] *= this.g;
      r[i] *= this.g;
    }
  }

  reset(): void {
    this.det.reset();
    this.open = false;
    this.holdLeft = 0;
    this.g = this.floorLin;
  }
}

export const gateDef: EffectDef = {
  id: 'gate',
  label: 'Gate',
  params: GATE_PARAMS,
  create: (sampleRate, params) => new Gate(sampleRate, params),
};

/* ------------------------------------------------------------------ */
/* Transient shaper                                                    */
/* ------------------------------------------------------------------ */

const TRANSIENT_PARAMS: ParamSpec[] = [
  { name: 'attack', min: -1, max: 1, default: 0 },
  { name: 'sustain', min: -1, max: 1, default: 0 },
];

/** The shaper never boosts or cuts by more than this. */
const TRANSIENT_MAX_DB = 24;

/**
 * Transient shaper: a fast and a slow envelope follower track the same
 * sidechain. Their dB difference is positive during onsets (the fast one
 * gets there first) and negative through tails (the fast one falls away
 * first). The positive part scaled by the attack param and the negative
 * part scaled by the sustain param drive the gain, so at 0/0 the unit
 * passes audio through untouched.
 */
class TransientShaper implements Effect {
  private readonly fast: EnvelopeFollower;
  private readonly slow: EnvelopeFollower;
  private attackAmt = 0;
  private sustainAmt = 0;

  constructor(sampleRate: number, params: Record<string, number>) {
    this.fast = new EnvelopeFollower(sampleRate, 0.0005, 0.02);
    this.slow = new EnvelopeFollower(sampleRate, 0.02, 0.1);
    applyParams(this, TRANSIENT_PARAMS, params);
  }

  setParam(name: string, value: number): void {
    if (name === 'attack') this.attackAmt = clamp(value, -1, 1);
    else if (name === 'sustain') this.sustainAmt = clamp(value, -1, 1);
  }

  process(l: Float32Array, r: Float32Array, from: number, to: number): void {
    const atk = this.attackAmt;
    const sus = this.sustainAmt;
    for (let i = from; i < to; i++) {
      const al = Math.abs(l[i]);
      const ar = Math.abs(r[i]);
      const s = al > ar ? al : ar;
      const d = levelDb(this.fast.next(s)) - levelDb(this.slow.next(s));
      const gDb = clamp(d > 0 ? atk * d : -sus * d, -TRANSIENT_MAX_DB, TRANSIENT_MAX_DB);
      const g = Math.exp(gDb * DB_TO_LN);
      l[i] *= g;
      r[i] *= g;
    }
  }

  reset(): void {
    this.fast.reset();
    this.slow.reset();
  }
}

export const transientDef: EffectDef = {
  id: 'transient',
  label: 'Transient Shaper',
  params: TRANSIENT_PARAMS,
  create: (sampleRate, params) => new TransientShaper(sampleRate, params),
};
