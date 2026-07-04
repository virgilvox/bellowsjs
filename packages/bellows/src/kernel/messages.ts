/*
 * Kernel message protocol. The same messages configure the realtime worklet
 * and the offline renderer, which is what keeps the two paths identical.
 * Event times are engine-time seconds (frames / sampleRate).
 */

import type { KernelEvent } from '../types';

export interface FxSpec {
  effectId: string;
  params?: Record<string, number>;
}

export interface SamplerZoneData {
  data: Float32Array;
  dataR?: Float32Array;
  sampleRate: number;
  rootKey: number;
  fineTune?: number;
  keyLo: number;
  keyHi: number;
  velLo: number;
  velHi: number;
  loopStart?: number;
  loopEnd?: number;
  loopMode: 'none' | 'loop' | 'loopRelease';
  gainDb?: number;
  pan?: number;
  env?: { attack: number; hold: number; decay: number; sustain: number; release: number };
  roundRobinGroup?: number;
  seqPosition?: number;
}

export type KernelMessage =
  | { type: 'createChannel'; id: number; engineId: string; params: Record<string, number>; seed: string; polyphony?: number }
  | { type: 'removeChannel'; id: number }
  | { type: 'channelFx'; id: number; chain: FxSpec[] }
  | { type: 'fxParam'; channelId: number; fxIndex: number; name: string; value: number }
  | { type: 'channelParam'; id: number; name: string; value: number }
  | { type: 'channelGain'; id: number; gain: number }
  | { type: 'channelPan'; id: number; pan: number }
  | { type: 'createBus'; id: number; chain: FxSpec[]; returnLevel: number }
  | { type: 'busFxParam'; busId: number; fxIndex: number; name: string; value: number }
  | { type: 'send'; channelId: number; busId: number; level: number }
  | { type: 'masterFx'; chain: FxSpec[] }
  | { type: 'masterFxParam'; fxIndex: number; name: string; value: number }
  | { type: 'masterGain'; gain: number }
  | { type: 'events'; events: KernelEvent[] }
  | { type: 'internParam'; name: string; index: number }
  | { type: 'registerBank'; bankId: string; zones: SamplerZoneData[] }
  | { type: 'registerGrain'; bankId: string; data: Float32Array; sampleRate: number }
  | { type: 'defOp'; kind: 'engine' | 'effect'; code: string }
  | { type: 'panic' };

export interface MeterFrame {
  type: 'meter';
  peakL: number;
  peakR: number;
  rmsL: number;
  rmsR: number;
  voices: number;
  frame: number;
}

export type KernelReply = MeterFrame | { type: 'error'; message: string };
