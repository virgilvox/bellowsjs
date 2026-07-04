/*
 * bellowsjs public API.
 *
 * Tier 1: play, instrument.
 * Tier 2: Bellows.boot and the handles it returns.
 * Tier 3: the DSP, theory, sequencing, analysis, and io modules, all
 * importable and tree-shakeable, plus defEngine/defEffect for custom ops.
 */

/* tiers 1 and 2 */
export { play, instrument, quickBellows } from './quick';
export { Bellows, Instrument, BusHandle, type BootOptions, type NoteOptions, type NoteValue, type FxInput } from './bellows';

/* contracts */
export {
  mtof,
  ftom,
  clamp,
  dbToGain,
  gainToDb,
  EventKind,
  type Rng,
  type NamedRng,
  type Voice,
  type EngineDef,
  type Effect,
  type EffectDef,
  type ParamSpec,
  type TimeValue,
  type KernelEvent,
  type StepPattern,
} from './types';

/* core */
export { rng, xmur3, mulberry32 } from './core/prng';
export { registerEngine, registerEffect, getEngine, getEffect, listEngines, listEffects } from './core/registry';
export { registerBuiltins } from './core/register';
export { VoicePool } from './core/voicepool';
export { Scheduler } from './core/scheduler';

/* theory */
export * from './theory/notes';
export { SCALES, Scale } from './theory/scales';
export * from './theory/chords';
export * from './theory/voicelead';
export * from './theory/progressions';
export { Tuning, degreeFreq } from './theory/tuning';
export { parseScl, parseKbm, tuningFromScala } from './theory/scala';

/* sequencing */
export { parseTime, beatsPerBar, DEFAULT_METER, type Meter } from './seq/time';
export { TempoMap } from './seq/tempomap';
export { Transport, type TransportTick, type TransportPosition, type TransportState } from './seq/transport';
export { euclid, rotate } from './seq/euclid';
export * from './seq/markov';
export * from './seq/lsystem';
export * from './seq/automata';
export * from './seq/arp';
export * from './seq/pattern';

/* dsp */
export * from './dsp/oscillators';
export * from './dsp/noise';
export * from './dsp/lfo';
export * from './dsp/wavetable';
export * from './dsp/filters';
export * from './dsp/envelopes';
export * from './dsp/fft';
export * from './dsp/delayline';
export * from './dsp/oversample';
export * from './dsp/waveshaper';
export * from './dsp/stft';

/* engines */
export { vaEngine } from './engines/va';
export { fmEngine } from './engines/fm';
export { additiveEngine } from './engines/additive';
export { wavetableEngine, makeWavetableEngine } from './engines/wavetable';
export { kickEngine, snareEngine, hatEngine, clapEngine, tomEngine } from './engines/drums';
export { noiseEngine } from './engines/noisesynth';
export { pluckEngine } from './engines/pluck';
export { stringEngine, tubeEngine } from './engines/waveguide';
export { modalEngine } from './engines/modal';
export { westcoastEngine } from './engines/westcoast';
export { formantEngine } from './engines/formant';
export { granularEngine, makeGranularEngine } from './engines/granular';
export { harmonicEngine } from './engines/harmonic';
export { SamplerBank, makeSamplerEngine, type SampleZone, type SampleZoneEnv } from './engines/sampler';
export * from './engines/soundfont';

/* effects */
export { delayDef, tapeDelayDef, multitapDef } from './fx/delay';
export { fdnDef } from './fx/reverb';
export { plateDef } from './fx/plate';
export { compressorDef, limiterDef, gateDef, transientDef } from './fx/dynamics';
export { chorusDef, flangerDef, phaserDef, tremoloDef, autopanDef, ringmodDef } from './fx/modfx';
export { freqshiftDef } from './fx/freqshift';
export * from './fx/spectral';
export * from './fx/eq';
export * from './fx/saturator';

/* analysis */
export * from './analysis/pitch';
export * from './analysis/onset';
export * from './analysis/chroma';
export * from './analysis/descriptors';
export * from './analysis/loudness';

/* io */
export { encodeWav, decodeWav } from './io/wav';
export * from './io/midifile';
export * from './io/webmidi';
export * from './io/encode';
export { SoundFont } from './io/sf2';
export * from './io/sfz';

/* render */
export { renderOffline, type OfflineRenderOptions, type RenderedAudio } from './render/offline';
export { bankEngineResolver } from './render/banks';

/* kernel */
export { KernelEngine, internParam } from './kernel/engine';
export { createKernelNode, KERNEL_PROCESSOR_NAME } from './kernel/node';
export type { KernelMessage, KernelReply, FxSpec, MeterFrame, SamplerZoneData } from './kernel/messages';
