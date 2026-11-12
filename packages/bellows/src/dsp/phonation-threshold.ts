/*
 * When the folds vibrate: the phonation threshold and its hysteresis, for
 * a fold model that does not find its own threshold (the geometric glottis,
 * dsp/geometric-glottis.ts).
 *
 * THRESHOLD. Titze (1988, "The physics of small-amplitude oscillation of
 * the vocal folds", JASA 83) derives the least transglottal pressure that
 * sustains oscillation as proportional to the prephonatory half-width
 * xi_0: P_th = (k_t B c / T) xi_0, with k_t the transglottal pressure
 * coefficient, B the tissue's damping per unit area, c the mucosal wave's
 * speed and T the folds' thickness. That goes to zero for folds that
 * touch, which they do not do in life, so a floor P_0 is added: Titze
 * (1992, "Phonation threshold pressure: a missing link in glottal
 * aerodynamics", JASA 91) measures about 0.2 kPa at a speaker's mean f0.
 *
 *   P_on = P_0 + K xi_0
 *
 * ONSET AND OFFSET. Oscillation starts at P_on and, once going, keeps
 * going down to a lower pressure: the offset to onset ratio is 0.5 to 1 in
 * Lucero (1999, "A theoretical study of the hysteresis phenomenon at vocal
 * fold oscillation onset-offset", JASA 105). So the state switches on when
 * the pressure rises past P_on and off when it falls past OFFSET_RATIO
 * P_on, and between the two it stays as it was.
 *
 * LEVEL. The oscillation grows into and dies out of its amplitude over a
 * few cycles, not at once: the state drives a one-pole level with an onset
 * and an offset time. `drive` (0..1) scales the target: a glottal stop
 * holds the folds together whatever the pressure.
 *
 * Runs once a block. Inputs and outputs are fields; nothing allocates.
 */

import { CM_H2O } from './air';

/** Threshold floor, dyn/cm^2: 0.2 kPa (Titze 1992, at the mean f0). */
export const THRESHOLD_FLOOR = 2000;
/**
 * Threshold slope per cm of half-width, dyn/cm^2 per cm. k_t B c / T with
 * k_t 1.1, B 100 dyn s/cm^3, c 100 cm/s and T 0.3 cm is 3.7e4 (3.7 cmH2O
 * per mm; INFERRED values in Titze's range). CHOICE: 4 cmH2O per mm, with
 * which a voiced fricative (rest half-width about 0.3 mm) keeps voicing at
 * the pressure the airway leaves it and a voiceless one (about 1 mm) loses
 * it (test/engines-physical/vocal.test.ts).
 */
export const THRESHOLD_SLOPE = 4 * CM_H2O * 10;
/** Offset pressure over onset pressure (Lucero 1999: 0.5 to 1). */
export const OFFSET_RATIO = 0.7;
/** The level's onset and offset time constants, s. CHOICE: under a cycle at speech f0, as the pulse's gate. */
const ONSET_TAU = 0.006;
const OFFSET_TAU = 0.006;

export class PhonationThreshold {
  /* ---- Inputs. ---- */
  /** Transglottal pressure, dyn/cm^2 (smoothed over about a cycle). */
  pressure = 0;
  /** Prephonatory half-width xi_0, cm. */
  halfWidth = 0;
  /** 0..1: how far the folds are free to vibrate (1 - a glottal stop's closure). */
  drive = 1;

  /* ---- Outputs. ---- */
  /** Onset and offset pressures for the current half-width, dyn/cm^2. */
  onset = THRESHOLD_FLOOR;
  offset = OFFSET_RATIO * THRESHOLD_FLOOR;
  /** Whether the folds oscillate (hysteretic), 0 or 1. */
  on = 0;
  /** The oscillation's level, 0..1. */
  level = 0;

  private readonly cOn: number = 0;
  private readonly cOff: number = 0;

  /** dt: the interval between step() calls, s. */
  constructor(dt: number) {
    this.cOn = 1 - Math.exp(-dt / ONSET_TAU);
    this.cOff = 1 - Math.exp(-dt / OFFSET_TAU);
  }

  reset(): void {
    this.on = 0;
    this.level = 0;
    this.onset = THRESHOLD_FLOOR;
    this.offset = OFFSET_RATIO * THRESHOLD_FLOOR;
  }

  step(): void {
    const xi = this.halfWidth > 0 ? this.halfWidth : 0;
    const onset = THRESHOLD_FLOOR + THRESHOLD_SLOPE * xi;
    this.onset = onset;
    this.offset = OFFSET_RATIO * onset;
    const p = this.pressure;
    if (this.on === 0) {
      if (p > onset) this.on = 1;
    } else if (p < this.offset) this.on = 0;
    let d = this.drive;
    d = d < 0 ? 0 : d > 1 ? 1 : d;
    const target = this.on * d;
    const c = target > this.level ? this.cOn : this.cOff;
    this.level += c * (target - this.level);
  }
}
