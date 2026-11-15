/*
 * Registers every built-in engine and effect.
 *
 * Lives beside the facade rather than under core/ because of what it
 * imports. CLAUDE.md: "types and core at the bottom, then dsp, then
 * engines/fx/analysis, then kernel/io, then the facade. Never import
 * upward." This file names 22 modules from engines/ and fx/, so from
 * core/ every one of those was an upward import. It is a manifest of the
 * layers above it, so above them is where it goes; nothing about what it
 * does changed.
 *
 * Called once by the facade at boot, by the worklet entry at load, and by
 * the offline renderer, so all three realms resolve the same ids to the
 * same DSP. Explicit rather than
 * side-effectful imports, which keeps sideEffects: false honest.
 */

import { registerEngine, registerEffect } from './core/registry';

import { vaEngine } from './engines/va';
import { fmEngine } from './engines/fm';
import { additiveEngine } from './engines/additive';
import { wavetableEngine } from './engines/wavetable';
import { kickEngine, snareEngine, hatEngine, clapEngine, tomEngine } from './engines/drums';
import { noiseEngine } from './engines/noisesynth';
import { pluckEngine } from './engines/pluck';
import { stringEngine, tubeEngine } from './engines/waveguide';
import { modalEngine } from './engines/modal';
import { westcoastEngine } from './engines/westcoast';
import { formantEngine } from './engines/formant';
import { granularEngine } from './engines/granular';
import { harmonicEngine } from './engines/harmonic';

import { delayDef, tapeDelayDef, multitapDef } from './fx/delay';
import { fdnDef } from './fx/reverb';
import { plateDef } from './fx/plate';
import { compressorDef, limiterDef, gateDef, transientDef } from './fx/dynamics';
import { chorusDef, flangerDef, phaserDef, tremoloDef, autopanDef, ringmodDef } from './fx/modfx';
import { freqshiftDef } from './fx/freqshift';
import { eqDef } from './fx/eq';
import { saturatorDef } from './fx/saturator';
import { spectralEffects } from './fx/spectral';

let done = false;

export function registerBuiltins(): void {
  if (done) return;
  done = true;

  for (const e of [
    vaEngine,
    fmEngine,
    additiveEngine,
    wavetableEngine,
    kickEngine,
    snareEngine,
    hatEngine,
    clapEngine,
    tomEngine,
    noiseEngine,
    pluckEngine,
    stringEngine,
    tubeEngine,
    modalEngine,
    westcoastEngine,
    formantEngine,
    granularEngine,
    harmonicEngine,
  ]) {
    registerEngine(e);
  }

  for (const f of [
    delayDef,
    tapeDelayDef,
    multitapDef,
    fdnDef,
    plateDef,
    compressorDef,
    limiterDef,
    gateDef,
    transientDef,
    chorusDef,
    flangerDef,
    phaserDef,
    tremoloDef,
    autopanDef,
    ringmodDef,
    freqshiftDef,
    eqDef,
    saturatorDef,
    ...spectralEffects,
  ]) {
    registerEffect(f);
  }
}
