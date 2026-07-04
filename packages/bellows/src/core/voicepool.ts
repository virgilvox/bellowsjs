/*
 * Voice pool. Preallocates voices for an engine and reuses them, so
 * steady-state playback allocates nothing. Stealing order: free voice,
 * then oldest released voice, then oldest held voice.
 */

import type { EngineDef, NamedRng, Voice } from '../types';

interface Slot {
  voice: Voice;
  noteId: number;
  startFrame: number;
  held: boolean;
}

export class VoicePool {
  private slots: Slot[] = [];
  private params: Record<string, number>;

  constructor(
    def: EngineDef,
    sampleRate: number,
    params: Record<string, number>,
    rng: NamedRng,
    polyphony?: number,
  ) {
    const n = polyphony ?? def.polyphony ?? 16;
    this.params = { ...params };
    for (let i = 0; i < n; i++) {
      this.slots.push({
        voice: def.createVoice(sampleRate, this.params, rng.fork('v' + i)),
        noteId: -1,
        startFrame: 0,
        held: false,
      });
    }
  }

  noteOn(noteId: number, freq: number, vel: number, frame: number): void {
    let pick: Slot | null = null;
    // free voice first
    for (const s of this.slots) {
      if (!s.voice.active) { pick = s; break; }
    }
    // then oldest released
    if (!pick) {
      for (const s of this.slots) {
        if (!s.held && (!pick || s.startFrame < pick.startFrame)) pick = s;
      }
    }
    // then oldest held
    if (!pick) {
      for (const s of this.slots) {
        if (!pick || s.startFrame < pick.startFrame) pick = s;
      }
    }
    if (!pick) return;
    pick.noteId = noteId;
    pick.startFrame = frame;
    pick.held = true;
    pick.voice.noteOn(freq, vel);
  }

  noteOff(noteId: number): void {
    for (const s of this.slots) {
      if (s.held && s.noteId === noteId) {
        s.held = false;
        s.voice.noteOff();
      }
    }
  }

  allNotesOff(): void {
    for (const s of this.slots) {
      if (s.held) { s.held = false; s.voice.noteOff(); }
    }
  }

  setParam(name: string, value: number): void {
    this.params[name] = value;
    for (const s of this.slots) s.voice.setParam(name, value);
  }

  process(outL: Float32Array, outR: Float32Array, from: number, to: number): void {
    for (const s of this.slots) {
      if (s.voice.active) s.voice.process(outL, outR, from, to);
    }
  }

  get activeCount(): number {
    let n = 0;
    for (const s of this.slots) if (s.voice.active) n++;
    return n;
  }

  get size(): number {
    return this.slots.length;
  }
}
