/*
 * Shared soundfont and sample store. Both the workbench SOUNDFONT panel
 * and the instrument page consume this: load .sf2 files, activate presets
 * as playable engines, and build a user kit from dropped audio files with
 * pitch-detected root keys. Activated banks re-register themselves on
 * every fresh Bellows instance (the workbench reboots on COMPOSE), so the
 * engine ids stay valid across reforges.
 */

import { reactive } from 'vue';
import {
  SoundFont,
  samplerBankFromSf2,
  decodeWav,
  yin,
  ftom,
  noteName,
  type Bellows,
  type SamplerZoneData,
} from 'bellowsjs';

export interface PresetRef {
  bank: number;
  program: number;
  name: string;
}

export interface FontEntry {
  name: string;
  sf: SoundFont;
  presets: PresetRef[];
}

export interface ActiveBank {
  /** engine id usable with b.voice(): 'sampler:<bankId>' */
  engineId: string;
  bankId: string;
  label: string;
  zones: SamplerZoneData[];
}

export interface UserSample {
  name: string;
  rootKey: number;
  detected: boolean;
  data: Float32Array;
  dataR?: Float32Array;
  sampleRate: number;
}

export const USER_KIT_BANK_ID = 'user-kit';
export const USER_KIT_ENGINE_ID = 'sampler:' + USER_KIT_BANK_ID;

interface SfState {
  fonts: FontEntry[];
  active: ActiveBank[];
  userSamples: UserSample[];
  error: string;
}

export const sfState = reactive<SfState>({
  fonts: [],
  active: [],
  userSamples: [],
  error: '',
});

/** Instances that already received every currently active bank. */
const registered = new WeakMap<Bellows, Set<string>>();

export async function addSf2(file: File): Promise<FontEntry> {
  const buf = await file.arrayBuffer();
  const sf = SoundFont.parse(buf);
  const entry: FontEntry = {
    name: file.name.replace(/\.sf2$/i, ''),
    sf,
    presets: sf.presets.map((p) => ({ bank: p.bank, program: p.program, name: p.name })),
  };
  sfState.fonts.push(entry);
  return entry;
}

/** Turn one preset of a loaded font into a playable engine. Cached. */
export function activatePreset(fontIndex: number, bank: number, program: number): ActiveBank {
  const font = sfState.fonts[fontIndex];
  if (!font) throw new Error('no font at index ' + fontIndex);
  const bankId = 'sf' + fontIndex + '-' + bank + '-' + program;
  const existing = sfState.active.find((a) => a.bankId === bankId);
  if (existing) return existing;
  const preset = font.presets.find((p) => p.bank === bank && p.program === program);
  const zones = samplerBankFromSf2(font.sf, bank, program).zones as SamplerZoneData[];
  if (!zones.length) throw new Error('preset has no zones');
  const entry: ActiveBank = {
    engineId: 'sampler:' + bankId,
    bankId,
    label: (preset?.name ?? 'preset').trim().toUpperCase(),
    zones,
  };
  sfState.active.push(entry);
  return entry;
}

export function deactivate(engineId: string): void {
  sfState.active = sfState.active.filter((a) => a.engineId !== engineId);
}

/**
 * Add an audio file to the user kit. Wav decodes directly; anything else
 * goes through decodeAudioData on a scratch AudioContext. The root key is
 * pitch-detected with yin where the material is tonal, else middle C.
 */
export async function addUserSample(file: File, ctx?: AudioContext): Promise<UserSample> {
  const buf = await file.arrayBuffer();
  let data: Float32Array;
  let dataR: Float32Array | undefined;
  let sampleRate: number;
  if (/\.wav$/i.test(file.name)) {
    const wav = decodeWav(buf);
    data = wav.channels[0];
    dataR = wav.channels[1];
    sampleRate = wav.sampleRate;
  } else {
    const ac = ctx ?? new AudioContext();
    const decoded = await ac.decodeAudioData(buf.slice(0));
    data = decoded.getChannelData(0).slice();
    dataR = decoded.numberOfChannels > 1 ? decoded.getChannelData(1).slice() : undefined;
    sampleRate = decoded.sampleRate;
    if (!ctx) await ac.close();
  }

  // pitch-detect the root: a window from the sustained middle of the sound
  let rootKey = 60;
  let detected = false;
  const win = 4096;
  const start = Math.min(Math.floor(data.length * 0.25), Math.max(0, data.length - win));
  if (data.length >= win) {
    const res = yin(data.subarray(start, start + win), sampleRate);
    if (res && res.freq > 25 && res.freq < 4200 && res.probability > 0.7) {
      rootKey = Math.round(ftom(res.freq));
      detected = true;
    }
  }

  const sample: UserSample = {
    name: file.name.replace(/\.[a-z0-9]+$/i, ''),
    rootKey,
    detected,
    data,
    dataR,
    sampleRate,
  };
  sfState.userSamples.push(sample);
  rebuildUserKit();
  return sample;
}

export function setUserSampleRoot(index: number, rootKey: number): void {
  const s = sfState.userSamples[index];
  if (!s) return;
  s.rootKey = rootKey;
  s.detected = false;
  rebuildUserKit();
}

export function removeUserSample(index: number): void {
  sfState.userSamples.splice(index, 1);
  rebuildUserKit();
}

export function rootKeyLabel(s: UserSample): string {
  return noteName(s.rootKey) + (s.detected ? ' (detected)' : '');
}

/**
 * The user kit maps every sample across the keyboard: sorted by root key,
 * with key range boundaries at the midpoints between neighbors, so each
 * key plays the nearest sample repitched.
 */
function rebuildUserKit(): void {
  sfState.active = sfState.active.filter((a) => a.bankId !== USER_KIT_BANK_ID);
  if (!sfState.userSamples.length) return;
  const sorted = [...sfState.userSamples].sort((a, b) => a.rootKey - b.rootKey);
  const zones: SamplerZoneData[] = sorted.map((s, i) => {
    const lo = i === 0 ? 0 : Math.ceil((sorted[i - 1].rootKey + s.rootKey) / 2);
    const hi = i === sorted.length - 1 ? 127 : Math.floor((s.rootKey + sorted[i + 1].rootKey) / 2);
    return {
      data: s.data,
      dataR: s.dataR,
      sampleRate: s.sampleRate,
      rootKey: s.rootKey,
      keyLo: lo,
      keyHi: hi,
      velLo: 0,
      velHi: 127,
      loopMode: 'none',
      env: { attack: 0.002, hold: 0, decay: 0, sustain: 1, release: 0.25 },
    };
  });
  sfState.active.push({
    engineId: USER_KIT_ENGINE_ID,
    bankId: USER_KIT_BANK_ID,
    label: 'USER KIT (' + sorted.length + ')',
    zones,
  });
}

/**
 * Make sure every active bank exists inside this Bellows instance's
 * kernel. Safe to call often; each bank posts once per instance (user-kit
 * reposts when its zone count changes, under a fresh id suffix handled by
 * the caller re-picking the engine).
 */
export function ensureRegistered(b: Bellows): void {
  let seen = registered.get(b);
  if (!seen) {
    seen = new Set();
    registered.set(b, seen);
  }
  for (const bank of sfState.active) {
    const key = bank.bankId + ':' + bank.zones.length;
    if (seen.has(key)) continue;
    seen.add(key);
    b.structural({ type: 'registerBank', bankId: bank.bankId, zones: bank.zones });
  }
}

/** Options for engine selectors: built-in engines are the caller's concern; these are the sample-backed ones. */
export function sampleEngineOptions(): Array<{ id: string; label: string }> {
  return sfState.active.map((a) => ({ id: a.engineId, label: a.label }));
}
