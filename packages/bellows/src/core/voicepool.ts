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

  /**
   * Set a parameter on the pool and on every live voice.
   *
   * Non-finite values are dropped here rather than passed down. Engines
   * each clamp their own parameters, but clamping is not a filter: most
   * ranges are open at one end, and a NaN that survives one multiply is in
   * the recursive state of a filter or an envelope for the life of the
   * voice. Measured before this guard existed, one NaN parameter produced
   * non-finite audio in 129 parameters across 17 engines. A NaN arriving
   * here is a caller error every time (an empty text field read as a
   * number, a division by a zero rate), so the useful behaviour is to
   * ignore it and leave the last good value in place, which is what a
   * physical control does when you let go of it.
   */
  setParam(name: string, value: number): void {
    if (!Number.isFinite(value)) return;
    this.params[name] = value;
    for (const s of this.slots) s.voice.setParam(name, value);
  }

  /**
   * Current value of a pool parameter, or undefined if the pool was never
   * given one. The kernel reads this to find where a parameter ramp should
   * start; the pool itself has no opinion about automation.
   */
  getParam(name: string): number | undefined {
    return this.params[name];
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
