/*
 * What the simulator plays, and how it maps to each firmware.
 *
 * Each builder sets up the browser library to make the sound the matching
 * C++ example makes, driven by the same parameter values the panel shows.
 * The mapping is one to one where the two implementations use the same
 * engine and the same parameter names, which is most of it: the C++
 * `Kick::Params` fields and the TypeScript kick's ParamSpec names were
 * ported from each other and the parity harness diffs the result.
 *
 * Where a firmware does something the browser library cannot do the same
 * way, the difference is named in `caveat` and shown in the UI rather than
 * papered over. Nothing here silently substitutes.
 */

import type { Bellows, Instrument } from 'bellowsjs';
import type { Firmware, FirmwareParam } from './firmware';

export interface RunningVoice {
  /** Called on every scheduled step. */
  step: (index: number, timeSec: number) => void;
  /** Live parameter change from a slider. */
  setParam: (key: string, value: number) => void;
  /** Play a pitch, for firmwares with a keyboard. */
  noteOn?: (midi: number) => void;
  noteOff?: (midi: number) => void;
  /** Steps per bar, so the transport knows how fast to tick. */
  stepsPerBeat: number;
  dispose: () => void;
}

function paramMap(params: FirmwareParam[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of params) out[p.key] = p.value;
  return out;
}

/**
 * Build the running voice for a firmware.
 *
 * `b` must already be booted. The caller owns disposal of the Bellows
 * instance; this owns only what it created on top of it.
 */
export function buildVoice(b: Bellows, fw: Firmware, params: FirmwareParam[]): RunningVoice {
  const p = paramMap(params);

  switch (fw.voice) {
    case 'kick': {
      const inst = b.voice('kick', { decay: p.decay, drive: p.drive });
      return {
        stepsPerBeat: 1,
        step: (_i, at) => inst.note(p.tune, { at, dur: '4n', vel: 0.9 }),
        setParam: (k, v) => {
          if (k === 'tune') return; /* read at trigger time */
          inst.param(k, v);
        },
        dispose: () => inst.dispose(),
      };
    }

    case 'drums': {
      const kick = b.voice('kick');
      const snare = b.voice('snare');
      const hat = b.voice('hat');
      /* The euclidean patterns the C++ example uses, same pulses and steps. */
      const kickPat = b.euclid(16, 5);
      const snarePat = b.euclid(16, 3, 4);
      const hatPat = b.euclid(16, 11);
      return {
        stepsPerBeat: 4,
        step: (i, at) => {
          const s = i % 16;
          if (kickPat[s]) kick.note(50, { at, dur: '8n', vel: 0.95 });
          if (snarePat[s]) snare.note(200, { at, dur: '8n', vel: 0.8 });
          if (hatPat[s]) hat.note(8000, { at, dur: '16n', vel: 0.5 });
        },
        setParam: () => {},
        dispose: () => {
          kick.dispose();
          snare.dispose();
          hat.dispose();
        },
      };
    }

    case 'poly': {
      const inst: Instrument = b.voice('va', {
        cutoff: p.cutoff,
        resonance: p.resonance,
        detune: p.detune,
      });
      /* Instrument.on() returns a note id that off() takes back, so a held
       * key has to remember its id rather than its pitch. */
      const held = new Map<number, number>();
      return {
        stepsPerBeat: 2,
        step: () => {},
        noteOn: (midi) => {
          if (held.has(midi)) return;
          held.set(midi, inst.on(midi, 0.85));
        },
        noteOff: (midi) => {
          const id = held.get(midi);
          if (id === undefined) return;
          inst.off(id);
          held.delete(midi);
        },
        setParam: (k, v) => inst.param(k, v),
        dispose: () => inst.dispose(),
      };
    }

    case 'chord': {
      const inst = b.voice('pluck', {
        damp: p.damp,
        decay: p.decay,
        pickPos: p.pick_pos,
      });
      /* The same minor 7th the example plays, in the same order. */
      const chord = [110, 130.81, 164.81, 196];
      return {
        stepsPerBeat: 2,
        step: (i, at) => inst.note(chord[i % chord.length], { at, dur: '2n', vel: 0.85 }),
        setParam: (k, v) => inst.param(k === 'pick_pos' ? 'pickPos' : k, v),
        dispose: () => inst.dispose(),
      };
    }

    default:
      throw new Error(`no voice builder for ${fw.voice}`);
  }
}

/**
 * Differences between what the browser plays and what the board would,
 * beyond the measured parity figure. Shown in the UI next to that figure.
 *
 * Empty for a firmware whose browser path is the same engine with the same
 * parameters. Non-empty entries are the honest small print.
 */
export const VOICE_CAVEATS: Record<string, string[]> = {
  kick: [],
  chord: [],
  drums: [
    'The C++ example reads its tempo from a pot on pin 14 every loop; here the pot is a control and the reading is instant rather than sampled once per pass.',
  ],
  poly: [
    'The C++ example takes notes from USB MIDI. The keyboard here stands in for that: the voice, the pool and the filter are the same.',
  ],
};
