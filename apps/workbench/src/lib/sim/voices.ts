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

/*
 * Every pitch here goes through { hz: n }, never a bare number.
 *
 * NoteValue is `number | string | { hz } | { degree }`, and a bare number
 * is a MIDI NOTE, not a frequency. The first version of this file passed
 * frequencies directly, so the hat asked for MIDI 330, the chord's 110 to
 * 196 Hz became MIDI 110 to 196, and everything with a short envelope came
 * out as a click at the wrong pitch. The firmware side takes Hz, because
 * the C++ drum engines tune from the noteOn frequency, so the two sides
 * genuinely differ here and the conversion has to be explicit.
 */
import type { Firmware, FirmwareParam } from './firmware';

export interface RunningVoice {
  /** Called on every scheduled step. */
  step: (index: number, timeSec: number) => void;
  /** Live parameter change from a slider. */
  setParam: (key: string, value: number) => void;
  /** Play a pitch, for firmwares with a keyboard. */
  noteOn?: (midi: number) => void;
  noteOff?: (midi: number) => void;
  /** Steps per beat, so the transport knows how fast to tick. */
  stepsPerBeat: number;
  /**
   * Seconds between steps, when the firmware's own timing is not a musical
   * subdivision. 03_PolySynth's loop() is a plain delay(180), so tying it
   * to a tempo would be inventing a relationship the firmware does not have.
   */
  stepSec?: number;
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
        step: (_i, at) => inst.note({ hz: p.tune }, { at, dur: '4n', vel: 0.9 }),
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
      /*
       * The patterns, pitches and velocities the C++ example uses, read off
       * drummachine.h rather than guessed. Its Euclid::Generate takes
       * (pulses, steps, rotation) and b.euclid takes (steps, pulses,
       * rotation), which is the only translation here.
       *
       * An earlier version of this file had the snare at 3 pulses instead
       * of 4, dropped the hat's rotation, and put the hat at 8000 Hz where
       * the firmware says 330. The drum engines tune from the noteOn
       * frequency, so that last one was not a detail: it was a different
       * instrument.
       */
      const kickPat = b.euclid(16, 5); /* Generate(5, 16) */
      const snarePat = b.euclid(16, 4, 4); /* Generate(4, 16, 4) */
      const hatPat = b.euclid(16, 11, 1); /* Generate(11, 16, 1) */
      return {
        stepsPerBeat: 4,
        step: (i, at) => {
          const s = i % 16;
          if (kickPat[s]) kick.note({ hz: 50 }, { at, dur: '8n', vel: 0.95 });
          if (snarePat[s]) snare.note({ hz: 190 }, { at, dur: '8n', vel: 0.8 });
          if (hatPat[s]) hat.note({ hz: 330 }, { at, dur: '16n', vel: 0.5 });
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
      /*
       * The example does not hold a static cutoff: a 0.12 Hz triangle LFO
       * sweeps it exponentially from 200 Hz to 200 * 2^5.5, about 9 kHz,
       * one LFO sample per block. Without this the browser played a filter
       * that never moved while the firmware's whole character is that it
       * does. Stepped here on a timer rather than per block, which is the
       * same shape at a coarser grain.
       */
      let phase = 0;
      const sweep = window.setInterval(() => {
        phase = (phase + 0.05 * 0.12 * 4) % 1;
        const tri = phase < 0.5 ? phase * 4 - 1 : 3 - phase * 4;
        const norm = 0.5 * (tri + 1);
        const cutoff = Math.min(16000, Math.max(40, 200 * Math.pow(2, norm * 5.5)));
        inst.param('cutoff', cutoff);
      }, 50);
      /* Instrument.on() returns a note id that off() takes back, so a held
       * key has to remember its id rather than its pitch. */
      const held = new Map<number, number>();
      /*
       * What loop() actually does: NoteOn each of eight chord tones 180 ms
       * apart, hold them, rest 2.5 seconds, then release all eight and
       * start again. An earlier version of this file had `step: () => {}`
       * here, so pressing RUN produced silence and the page looked broken.
       *
       * The rest is expressed as steps of the same 180 ms so one timer
       * drives both, which is also how the sketch does it.
       */
      const CHORD = [45, 52, 57, 60, 64, 67, 71, 76];
      const REST_STEPS = Math.round(2500 / 180);
      const CYCLE = CHORD.length + REST_STEPS;
      const midiToHz = (n: number): number => 440 * Math.pow(2, (n - 69) / 12);

      return {
        stepsPerBeat: 1,
        stepSec: 0.18,
        step: (i) => {
          const at = i % CYCLE;
          if (at < CHORD.length) {
            const n = CHORD[at];
            if (!held.has(n)) held.set(n, inst.on({ hz: midiToHz(n) }, 0.7));
          } else if (at === CHORD.length) {
            /* the sketch releases the whole chord after the rest */
            for (const [, id] of held) inst.off(id);
            held.clear();
          }
        },
        noteOn: (midi) => {
          if (held.has(midi)) return;
          held.set(midi, inst.on({ hz: 440 * Math.pow(2, (midi - 69) / 12) }, 0.85));
        },
        noteOff: (midi) => {
          const id = held.get(midi);
          if (id === undefined) return;
          inst.off(id);
          held.delete(midi);
        },
        setParam: (k, v) => inst.param(k, v),
        dispose: () => {
          clearInterval(sweep);
          inst.dispose();
        },
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
        step: (i, at) => inst.note({ hz: chord[i % chord.length] }, { at, dur: '2n', vel: 0.85 }),
        setParam: (k, v) => inst.param(k === 'pick_pos' ? 'pickPos' : k, v),
        dispose: () => inst.dispose(),
      };
    }

    case 'scales': {
      /*
       * The phrase, the mode and the two tunings are the ones in
       * scalestuning.h: sixteen scale DEGREES rather than note numbers, D
       * dorian, played once in 12-EDO and once in 19-EDO. Degrees past the
       * scale length wrap and transpose by a period, which is what makes
       * one phrase meaningful in both divisions of the octave.
       *
       * 19-EDO dorian is not [0,2,3,5,7,9,10]: a whole tone there is three
       * steps and a diatonic semitone is two, so the firmware carries an
       * explicit table and so does this.
       */
      const PHRASE = [0, 2, 4, 6, 7, 6, 4, 2, 0, 4, 7, 11, 7, 4, 2, 0];
      const DORIAN_12 = [0, 2, 3, 5, 7, 9, 10];
      const DORIAN_19 = [0, 3, 5, 8, 11, 14, 16];
      const inst = b.voice('pluck', { damp: 0.32, decay: 2.2 });

      /** Degree to Hz, wrapping past the end of the table by one period. */
      const freq = (degree: number, table: number[], edo: number): number => {
        const len = table.length;
        const octave = Math.floor(degree / len);
        const step = table[((degree % len) + len) % len] + octave * edo;
        /* D is 62; the tuning references A440 at note 69 in both divisions. */
        const fromA = step + 62 - 69;
        return 440 * Math.pow(2, fromA / edo);
      };

      return {
        stepsPerBeat: 2,
        step: (i, at) => {
          const pass = Math.floor(i / PHRASE.length) % 2;
          const degree = PHRASE[i % PHRASE.length];
          const hz =
            pass === 0 ? freq(degree, DORIAN_12, 12) : freq(degree, DORIAN_19, 19);
          inst.note({ hz }, { at, dur: '4n', vel: 0.8 });
        },
        setParam: (k, v) => inst.param(k, v),
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
    'The firmware moves its filter one LFO sample per audio block. Here it is stepped on a 50 ms timer, so the sweep is the same shape at a coarser grain.',
  ],
  scales: [
    'The phrase alternates: sixteen notes in 12-EDO, then the same sixteen degrees in 19-EDO. The difference is the point, and it is easiest to hear on the third and the sixth.',
    'The pitches are computed here rather than taken from the library tuning layer, so what the parity harness gates for them is the theory row, measured at 9.42e-8 relative, not the pluck row shown above.',
  ],
};
