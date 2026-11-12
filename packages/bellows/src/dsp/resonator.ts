/*
 * Klatt's digital resonator and antiresonator, the two building blocks of a
 * cascade formant synthesizer.
 *
 * Source: Klatt, D. H. (1980), Software for a cascade/parallel formant
 * synthesizer, JASA 67(3), 971-995, Eqs. (1), (2), (4) and (5).
 *
 * Resonator: y[n] = A x[n] + B y[n-1] + C y[n-2], with
 *
 *   C = -exp(-2 pi bw T),  B = 2 exp(-pi bw T) cos(2 pi f T),  A = 1 - B - C.
 *
 * B and C place a pole pair at radius exp(-pi bw T) and angle 2 pi f T, the
 * impulse-invariant image of an analog resonance at f with bandwidth bw
 * (Gold and Rabiner 1968, as Klatt cites). A = 1 - B - C makes the gain at
 * DC exactly 1. That normalisation is what lets resonators be chained: in a
 * cascade each formant passes the ones below it at unity, so no formant
 * needs its own amplitude control (Klatt, "Cascade versus parallel").
 *
 * The peaks come out at the relative levels an all-pole vocal tract gives
 * them only at Klatt's 10 kHz, though. A digital resonator's response
 * repeats about the sample rate, so at 10 kHz each of R1 to R5 also acts as
 * a pole at 10 kHz minus its frequency: for the uniform tube (500, 1500 ...
 * 4500 Hz) at 9.5, 8.5, 7.5, 6.5 and 5.5 kHz, which are F10 down to F6 of
 * the same tube. Those images stand in for the poles above F5, which is
 * why Klatt's five-formant cascade needs no correction for them. At audio
 * rates the images are far out of band and the same five resonators leave
 * F3, F4 and F5 of the uniform tube 11, 22 and 41 dB under their 10 kHz
 * levels at 48 kHz (MEASURED). higherPoleCorrection() below puts them back.
 *
 * AntiResonator: y[n] = A' x[n] + B' x[n-1] + C' x[n-2], with
 *
 *   A' = 1/A,  B' = -B/A,  C' = -C/A,
 *
 * computed from the same f and bw. That is the exact inverse of the
 * resonator: a zero pair where the resonator has its poles, also at unity
 * DC gain. The paper prints C' = -CA in Eq. (5), which is a misprint; only
 * -C/A inverts A / (1 - B z^-1 - C z^-2). Klatt uses one for the nasal zero
 * (RNZ) beside a nasal pole resonator (RNP), and removes the pair outside
 * nasal sounds by setting both to the same frequency, so the cancellation is
 * load-bearing and test/dsp-filt/resonator.test.ts measures it.
 *
 * Where the peak lands. An all-pole pair peaks at sqrt(f^2 - (bw/2)^2), not
 * at f, so a wide resonance sits low: under 1 percent low while bw < 0.28 f,
 * which every formant bandwidth in a vocal tract table satisfies. The -3 dB
 * bandwidth equals bw to within about 2 percent on the same condition.
 *
 * A frequency of 0 is allowed on purpose: it is Klatt's low-pass resonator,
 * which he uses to smooth the glottal pulse and the voice bar. It is a
 * double real pole at bw/2, so it falls 12 dB per octave and is 6 dB down
 * at bw/2. Klatt's text puts the 3 dB point at bw/2; the formulas put it at
 * sqrt(sqrt(2) - 1) * bw/2 = 0.644 * bw/2, measured at 44100 and 96000.
 *
 * Peak gain grows as f/bw because DC is pinned at 1: a 1 Hz bandwidth at
 * 0.45 fs is stable but 99 dB tall at 44100 (106 dB at 96000). Callers keep
 * bandwidths physical (Klatt's Table I floor is 40 Hz); the clamp only
 * guarantees stability.
 *
 * Setters ignore a call carrying a non-finite argument and keep the last
 * good setting, the policy of dsp/filters.ts and dsp/envelopes.ts and for
 * the same reason: these are recursive units, one NaN coefficient latches
 * into y[n-1] and silences the voice for good, and no later good value can
 * pull it back out. Finite values go through clamp() from ../types. next()
 * treats a non-finite input sample as 0.
 *
 * Every state and coefficient is a number field set in the constructor, so
 * next() and process() allocate nothing.
 */

import { clamp } from '../types';

/** Highest centre frequency, as a fraction of the sample rate. */
export const RESONATOR_MAX_FREQ = 0.45;
/** Narrowest bandwidth in Hz. Any positive bandwidth is stable; this keeps the peak finite. */
export const RESONATOR_MIN_BW = 1;

/** The coefficients both units share, computed once per set(). */
interface Coefs {
  a: number;
  b: number;
  c: number;
}

function klattCoefs(out: Coefs, sampleRate: number, freqHz: number, bwHz: number): void {
  const f = clamp(freqHz, 0, RESONATOR_MAX_FREQ * sampleRate);
  // Up to the sample rate itself, past which the pole radius exp(-pi) is
  // already 0.04 and a wider setting changes nothing anyone could hear.
  const bw = clamp(bwHz, RESONATOR_MIN_BW, sampleRate);
  const r = Math.exp((-Math.PI * bw) / sampleRate);
  out.c = -r * r;
  out.b = 2 * r * Math.cos((2 * Math.PI * f) / sampleRate);
  out.a = 1 - out.b - out.c;
}

/**
 * Fixed resonators to add after R5 of a five-formant cascade so that its
 * spectrum matches the same cascade at Klatt's 10 kHz: `stages` identical
 * resonators at `hz`, `bw` wide. Both are for a tract whose F5 is 4500 Hz;
 * scale both by F5 / 4500 for a shorter one, which keeps the correction in
 * the same place relative to the formants it lifts.
 */
export interface HigherPoleCorrection {
  readonly stages: number;
  readonly hz: number;
  readonly bw: number;
}

/*
 * Fitted, not derived (MEASURED, scratch fit script): over every vowel of
 * engines/vocal-phonemes.ts for all three bodies, the response from 250 to
 * 4500 Hz (times the body's F5 / 4500) of R1 to R5 plus `stages` resonators
 * at each rate, against R1 to R5 at 10 kHz (times the same ratio), for 1 to
 * 6 stages, centres 4600 to 7000 Hz and widths 500 to 2500 Hz. Worst error,
 * mean error, and worst error at F3 and at F4, in dB:
 *
 *   rate      correction       worst  mean   F3    F4    none: worst  F3    F4
 *   192000    5 at 5300/1500    2.7   0.9   2.1   2.2          44.7  17.4  34.7
 *   96000     5 at 5300/1500    3.6   0.7   1.8   1.8          44.5  17.3  34.3
 *   88200     5 at 5300/1500    3.8   0.7   1.8   1.7          44.4
 *   48000     5 at 5400/1500    5.4   0.5   1.6   1.6          43.5  16.8  32.9
 *   44100     5 at 5400/1500    6.2   0.5   1.4   1.8          43.3  16.7  32.5
 *   32000     4 at 5500/1000    4.7   1.2   3.2   4.5          41.9  16.1  30.4
 *   22050     2 at 4700/750     6.9   1.7   4.7   6.0          38.5  14.6  27.6
 *   16000     1 at 4600/500    10.5   2.4   5.9   9.3          32.1  11.9  22.7
 *
 * Each row is the best fit at that rate, or within a few tenths of it, and
 * the rate bands below take the row nearest them. 5 at 5400/1500 at 96000
 * fits about as well (3.4 worst) but sat 1.3 dB lower than 48000 in /h/,
 * whose noise the correction's region carries; 5300 holds /h/ within 1 dB
 * of 48000 (MEASURED, test/engines-physical/vocal.test.ts). The worst error is at the top of the band, where the
 * 10 kHz reference is itself rising into its own Nyquist. Below the 16 kHz
 * row the cascade's own images, now near the band again, supply most of
 * what is missing, and a stage would sit over 0.45 of the rate, so there
 * is none.
 */
const HPC_HIGH: HigherPoleCorrection = Object.freeze({ stages: 5, hz: 5300, bw: 1500 });
const HPC_FULL: HigherPoleCorrection = Object.freeze({ stages: 5, hz: 5400, bw: 1500 });
const HPC_32K: HigherPoleCorrection = Object.freeze({ stages: 4, hz: 5500, bw: 1000 });
const HPC_22K: HigherPoleCorrection = Object.freeze({ stages: 2, hz: 4700, bw: 750 });
const HPC_16K: HigherPoleCorrection = Object.freeze({ stages: 1, hz: 4600, bw: 500 });
const HPC_NONE: HigherPoleCorrection = Object.freeze({ stages: 0, hz: 4500, bw: 1000 });

/** The higher-pole correction a five-formant Klatt cascade needs at this rate; see HigherPoleCorrection. */
export function higherPoleCorrection(sampleRate: number): HigherPoleCorrection {
  if (sampleRate >= 64000) return HPC_HIGH;
  if (sampleRate >= 40000) return HPC_FULL;
  if (sampleRate >= 28000) return HPC_32K;
  if (sampleRate >= 19000) return HPC_22K;
  if (sampleRate >= 14000) return HPC_16K;
  return HPC_NONE;
}

export class Resonator {
  private readonly sampleRate: number;
  private readonly k: Coefs = { a: 1, b: 0, c: 0 };
  private y1 = 0;
  private y2 = 0;

  /** Starts as Klatt's neutral F1: 500 Hz, 50 Hz wide. */
  constructor(sampleRate: number) {
    this.sampleRate = sampleRate;
    this.set(500, 50);
  }

  /** Centre frequency in [0, 0.45 fs] and bandwidth in [1 Hz, fs]. Non-finite calls are ignored. */
  set(freqHz: number, bwHz: number): void {
    if (!Number.isFinite(freqHz) || !Number.isFinite(bwHz)) return;
    klattCoefs(this.k, this.sampleRate, freqHz, bwHz);
  }

  next(x: number): number {
    if (!Number.isFinite(x)) x = 0;
    const k = this.k;
    const y = k.a * x + k.b * this.y1 + k.c * this.y2;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }

  /** Filter buf[from, to) in place. */
  process(buf: Float32Array, from: number, to: number): void {
    for (let i = from; i < to; i++) buf[i] = this.next(buf[i]);
  }

  /** Zero a state that has decayed under 1e-30, before it reaches the subnormal range. */
  flush(): void {
    if (this.y1 < 1e-30 && this.y1 > -1e-30 && this.y2 < 1e-30 && this.y2 > -1e-30) {
      this.y1 = 0;
      this.y2 = 0;
    }
  }

  reset(): void {
    this.y1 = 0;
    this.y2 = 0;
  }
}

export class AntiResonator {
  private readonly sampleRate: number;
  private readonly k: Coefs = { a: 1, b: 0, c: 0 };
  /* The inverse coefficients A', B', C'. */
  private a0 = 1;
  private a1 = 0;
  private a2 = 0;
  private x1 = 0;
  private x2 = 0;

  /** Starts at Klatt's resting nasal zero, 250 Hz and 100 Hz wide (Table I, FNZ and BNZ). */
  constructor(sampleRate: number) {
    this.sampleRate = sampleRate;
    this.set(250, 100);
  }

  /** Same ranges as Resonator.set. Non-finite calls are ignored. */
  set(freqHz: number, bwHz: number): void {
    if (!Number.isFinite(freqHz) || !Number.isFinite(bwHz)) return;
    const k = this.k;
    klattCoefs(k, this.sampleRate, freqHz, bwHz);
    // A = (1 - r)^2 + 2r(1 - cos) > 0 for every r < 1, so the division is safe.
    this.a0 = 1 / k.a;
    this.a1 = -k.b / k.a;
    this.a2 = -k.c / k.a;
  }

  next(x: number): number {
    if (!Number.isFinite(x)) x = 0;
    const y = this.a0 * x + this.a1 * this.x1 + this.a2 * this.x2;
    this.x2 = this.x1;
    this.x1 = x;
    return y;
  }

  /** Filter buf[from, to) in place. */
  process(buf: Float32Array, from: number, to: number): void {
    for (let i = from; i < to; i++) buf[i] = this.next(buf[i]);
  }

  reset(): void {
    this.x1 = 0;
    this.x2 = 0;
  }
}
