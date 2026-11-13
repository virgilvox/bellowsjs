/*
 * The vocal engine's timing, apart from its DSP: how far ahead sing() posts each sound and each
 * bend. The facade needs these on the main thread to plan a sung line, and importing them from
 * engines/vocal.ts pulled the whole voice (airway, geometry, planner, tables) into every page that
 * sings, beside the copy the AudioWorklet already carries. Only the glide filter comes along here.
 */

import { clamp } from '../types';
import { CRITDAMP_SETTLE_98 } from '../dsp/critdamp';
import { PitchGlide } from '../dsp/pitchglide';

/** How far ahead src/sing.ts posts each sound as `nextPhoneme`, seconds. */
export const VOCAL_PLAN_LEAD = 0.3;

/** The glide, overshoot and preparation defaults of the vocal engine's params. */
export const VOCAL_GLIDE_DEFAULTS = { glide: 0.17, overshoot: 0.095, preparation: 0.25 } as const;

/** Damping for an overshoot fraction of a step without preparation: the inverse of exp(-pi zeta / sqrt(1 - zeta^2)). */
export function vocalDamping(overshoot: number): number {
  const os = overshoot > 0 ? (overshoot < 0.6 ? overshoot : 0.6) : 0;
  if (!(os > 1e-6)) return 1;
  const l = Math.log(os);
  return -l / Math.sqrt(Math.PI * Math.PI + l * l);
}

/** The glide's natural frequency for a `glide` time, Hz. */
export function vocalGlideSpeed(glide: number): number {
  const g = clamp(glide, 0.005, 0.5);
  return CRITDAMP_SETTLE_98 / (2 * Math.PI * g);
}

/**
 * Seconds a pitch change takes to be half way, for a channel's glide,
 * overshoot and preparation (the engine's defaults where undefined): post a
 * bend this much early and the glide crosses the middle on the note.
 */
export function vocalGlideLead(glide?: number, overshoot?: number, preparation?: number): number {
  const d = VOCAL_GLIDE_DEFAULTS;
  const g = new PitchGlide(1000);
  g.setSpeed(vocalGlideSpeed(Number.isFinite(glide) ? (glide as number) : d.glide));
  g.setDamping(vocalDamping(Number.isFinite(overshoot) ? (overshoot as number) : d.overshoot));
  g.setPreparation(clamp(Number.isFinite(preparation) ? (preparation as number) : d.preparation, 0, 1));
  return g.leadTime();
}
