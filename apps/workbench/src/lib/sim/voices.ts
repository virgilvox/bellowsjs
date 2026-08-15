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

import { Markov } from 'bellowsjs';
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

/* ------------------------------------------------------------------ *
 * The note source for 20_Instruments, mirroring examples/20_Instruments/
 * player.h.
 *
 * The patches are sounds and this is the music, so switching patch
 * compares instruments and not the parts they happen to be playing. Read
 * off player.h rather than written from memory: the progression, the line,
 * the rhythms and the octave offsets are all its numbers.
 *
 * The pitch path is the one thing that genuinely differs. The C++ goes
 * through bellows::DegreeFreq with a Tuning; here it goes through
 * Scale.degreeToMidi and then to Hz. Both land on the same note in 12-EDO,
 * because a tuning index IS a MIDI number there, and both would stop
 * agreeing under any other tuning, which is the point 04_ScalesAndTuning
 * makes.
 * ------------------------------------------------------------------ */

const PLAY_STEPS = 16;
const PLAY_BARS = 4;
/* i VI iv v in A natural minor. */
const PROGRESSION = [0, 5, 3, 4];
const REST = -99;
/* The sixteen step line, in degrees relative to the bar's chord. */
const LINE = [0, REST, 4, REST, 2, REST, REST, 7, 4, REST, 2, 0, REST, 4, REST, 2];
/* A3 as a MIDI note, which is the root index player.h uses. */
const PLAY_ROOT_OCTAVE = 3;

const midiToHz = (n: number): number => 440 * Math.pow(2, (n - 69) / 12);

interface Play {
  chord: (bar: number) => number;
  octave: number;
  hz: (degree: number) => number;
  chordDegrees: (bar: number) => number[];
  melodyDegree: (bar: number, step: number) => number;
  bassDegree: (bar: number, step: number) => number;
  kick: (step: number) => boolean;
  snare: (step: number) => boolean;
  hat: (step: number) => boolean;
}

function makePlay(b: Bellows): Play {
  const scale = b.scale(57, 'minor');
  const oct = scale.length;
  /* b.euclid takes (steps, pulses, rotation); the C++ Generate takes
   * (pulses, steps, rotation). That swap is the only translation. */
  const melodyGate = b.euclid(PLAY_STEPS, 9, 2);
  const bassGate = b.euclid(PLAY_STEPS, 3, 0);
  const kickGate = b.euclid(PLAY_STEPS, 5, 0);
  const snareGate = b.euclid(PLAY_STEPS, 4, 4);
  const hatGate = b.euclid(PLAY_STEPS, 11, 1);
  const chord = (bar: number): number => PROGRESSION[bar % PLAY_BARS];
  return {
    chord,
    octave: oct,
    hz: (degree) => midiToHz(scale.degreeToMidi(degree, PLAY_ROOT_OCTAVE)),
    chordDegrees: (bar) => {
      const c = chord(bar);
      return [c + oct, c + 2 + oct, c + 4 + oct];
    },
    melodyDegree: (bar, step) => {
      if (!melodyGate[step]) return REST;
      const d = LINE[step % PLAY_STEPS];
      if (d === REST) return REST;
      return chord(bar) + d + 2 * oct;
    },
    bassDegree: (bar, step) => (bassGate[step] ? chord(bar) - oct : REST),
    kick: (step) => kickGate[step] === 1,
    snare: (step) => snareGate[step] === 1,
    hat: (step) => hatGate[step] === 1,
  };
}

/* 96 bpm in sixteenths, which is what the .ino sets. */
const INST_STEP_SEC = 60 / 96 / 4;

/**
 * The master limiter the 20_Instruments shell has, at the same ceiling.
 *
 * Not decoration and not safety theatre: the per patch trims put every
 * instrument at the same RMS, and a plucked chord and a kick have a crest
 * factor above 30 dB, so the peak that survives that is one sample long.
 * Without this the plucked string reached exactly 1.0 here, measured,
 * where the firmware's own limiter was holding it at -1 dB, and 0.802
 * with it.
 */
function instrumentMaster(b: Bellows): void {
  b.masterFx(['limiter', { ceiling: -1, release: 0.06 }]);
}

/**
 * The shell every 20_Instruments patch shares, so a patch builder only has
 * to say how to make one note. Mirrors the Book class in the .ino.
 */
function instrumentVoice(
  b: Bellows,
  inst: Instrument,
  kind: 'chord' | 'melody' | 'bass',
  setParam: (k: string, v: number) => void,
): RunningVoice {
  instrumentMaster(b);
  const play = makePlay(b);
  let held: number[] = [];
  return {
    stepsPerBeat: 4,
    stepSec: INST_STEP_SEC,
    step: (i, at) => {
      const s = i % PLAY_STEPS;
      const bar = Math.floor(i / PLAY_STEPS) % PLAY_BARS;
      if (kind === 'chord') {
        if (s !== 0) return;
        for (const id of held) inst.off(id);
        held = play.chordDegrees(bar).map((d) => inst.on({ hz: play.hz(d) }, 0.62, at));
        return;
      }
      if (kind === 'melody') {
        const d = play.melodyDegree(bar, s);
        if (d !== REST) inst.note({ hz: play.hz(d) }, { at, dur: 1.2, vel: 0.7 });
        return;
      }
      const d = play.bassDegree(bar, s);
      /* Accent every fourth step, which is what moves the filter. */
      if (d !== REST) inst.note({ hz: play.hz(d) }, { at, dur: 0.22, vel: s % 4 === 0 ? 0.95 : 0.55 });
    },
    noteOn: (midi) => {
      held.push(inst.on({ hz: midiToHz(midi) }, 0.8));
    },
    noteOff: () => {
      const id = held.pop();
      if (id !== undefined) inst.off(id);
    },
    setParam,
    dispose: () => inst.dispose(),
  };
}

/** One rung of 06_FirstSteps. They are raw DSP in C++; see the caveats. */
function stepVoice(
  b: Bellows,
  params: Record<string, number>,
  freq: number,
  stepSec: number,
  hold: boolean,
  extra?: (inst: Instrument) => { tick?: () => void; dispose?: () => void },
  engineId = 'va',
): RunningVoice {
  const inst = b.voice(engineId, params);
  const side = extra?.(inst) ?? {};
  let sounding = -1;
  return {
    stepsPerBeat: 1,
    stepSec,
    step: (_i, at) => {
      side.tick?.();
      if (hold) {
        /* A tone has no note: it starts once and never stops. */
        if (sounding < 0) sounding = inst.on({ hz: freq }, 0.7, at);
        return;
      }
      inst.note({ hz: freq }, { at, dur: stepSec * 0.5, vel: 0.8 });
    },
    setParam: (k, v) => {
      if (k === 'freq') {
        freq = v;
        return;
      }
      if (k === 'filter_decay') {
        /* The C++ names it filter_decay and the engine names it fDecay.
         * This used to fall into the swallow list below and reach nothing. */
        inst.param('fDecay', v);
        return;
      }
      if (k === 'gate' || k === 'sweep_octaves' || k === 'sweep_rate' ||
          k === 'vibrato_cents' || k === 'vibrato_rate' || k === 'cutoff_floor' ||
          k === 'level') {
        return; /* handled by the closures below, or not an engine param */
      }
      inst.param(k, v);
    },
    dispose: () => {
      side.dispose?.();
      inst.dispose();
    },
  };
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
      /*
       * `tune` is not an engine parameter. The drum tunes from the noteOn
       * frequency, which is `Trigger(hz, vel)` in onekick.h and 50.0f in
       * the .ino, so it has to be read when the note is triggered.
       *
       * It is held here rather than read out of `p`, which is the snapshot
       * paramMap took when this voice was built and never changes again.
       * Reading `p.tune` in the step meant the slider moved its readout and
       * the pitch stayed at 50 Hz: measured at 49.8 Hz before and after
       * dragging it to 100. It is also the one parameter applyParams
       * cannot write back into the header, because it is a call argument
       * and not a `p.<field>` line, which is what the panel's value count
       * is reporting when it says 2 of 3.
       */
      let tune = p.tune;
      return {
        stepsPerBeat: 1,
        step: (_i, at) => inst.note({ hz: tune }, { at, dur: '4n', vel: 0.9 }),
        setParam: (k, v) => {
          if (k === 'tune') {
            tune = v;
            return;
          }
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
       * codec.volume(0.6f), which every .ino sets and the simulator does
       * not otherwise model. It matters here and nowhere else: this is the
       * only firmware that holds eight VA voices at once, and measured at
       * unity the sum peaked at 1.095, over full scale. 0.6 puts it at
       * 0.657. Nothing was wrong until the chord started lasting its full
       * 2.5 seconds; before that it was released after 180 ms and never
       * had eight voices sounding together.
       */
      inst.gain(0.6);
      /*
       * The example does not hold a static cutoff: a 0.12 Hz triangle LFO
       * sweeps it exponentially from 200 Hz to 200 * 2^5.5, about 9 kHz,
       * one LFO sample per block. Without this the browser played a filter
       * that never moved while the firmware's whole character is that it
       * does. Stepped here on a timer rather than per block, which is the
       * same shape at a coarser grain.
       */
      let phase = 0;
      /*
       * The sweep writes cutoff every 50 ms, so a slider that also writes it is
       * overwritten before you hear it. The slider sets the BASE the sweep runs
       * from instead, which is the only reading of that control that can be
       * audible while the LFO owns the parameter.
       */
      let sweepBase = p.cutoff;
      const sweep = window.setInterval(() => {
        phase = (phase + 0.05 * 0.12 * 4) % 1;
        const tri = phase < 0.5 ? phase * 4 - 1 : 3 - phase * 4;
        const norm = 0.5 * (tri + 1);
        const cutoff = Math.min(16000, Math.max(40, (sweepBase / 9) * Math.pow(2, norm * 5.5)));
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
      /*
       * loop() in full, in its own units: eight NoteOn 180 ms apart, then
       * delay(2500) HOLDING them, then eight NoteOff, then delay(1500).
       * That is 5.44 s and the chord rings for 2.5 s of it.
       *
       * This used to release on the step straight after the last note on,
       * so the chord lasted 180 ms and the page sounded like it was cutting
       * itself off, which it was. The release belongs at the END of the
       * hold, and the closing silence has to be part of the cycle or the
       * pattern restarts 1.5 s early.
       */
      const HOLD_STEPS = Math.round(2500 / 180);
      const SILENCE_STEPS = Math.round(1500 / 180);
      const RELEASE_AT = CHORD.length + HOLD_STEPS;
      const CYCLE = RELEASE_AT + SILENCE_STEPS;
      const midiToHz = (n: number): number => 440 * Math.pow(2, (n - 69) / 12);

      return {
        stepsPerBeat: 1,
        stepSec: 0.18,
        step: (i) => {
          const at = i % CYCLE;
          if (at < CHORD.length) {
            const n = CHORD[at];
            if (!held.has(n)) held.set(n, inst.on({ hz: midiToHz(n) }, 0.7));
          } else if (at === RELEASE_AT) {
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
        setParam: (k, v) => {
          if (k === 'cutoff') {
            sweepBase = v;
            return;
          }
          inst.param(k, v);
        },
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

    /* ---------------- 06_FirstSteps ---------------- *
     * The C++ writes raw BlepOsc, Adsr, LadderFilter and Lfo straight into
     * the buffer. The browser library's public surface is engines and
     * effects, not those primitives, so each rung is built from `va` with
     * its second oscillator and sub silenced, which leaves the same
     * topology. What differs is named in VOICE_CAVEATS rather than hidden.
     */
    case 'step-tone': {
      /* One saw, filter wide open, held forever. */
      return stepVoice(b, {
        detune: 0, sub: 0, cutoff: 18000, resonance: 0,
        attack: 0.002, decay: 0.05, sustain: 1, release: 0.02, envAmount: 0,
      }, p.freq, 1.0, true);
    }

    case 'step-envelope': {
      return stepVoice(b, {
        detune: 0, sub: 0, cutoff: 18000, resonance: 0, envAmount: 0,
        attack: p.attack, decay: p.decay, sustain: p.sustain, release: p.release,
      }, 220, 0.5, false);
    }

    case 'step-filter': {
      return stepVoice(b, {
        detune: 0, sub: 0,
        cutoff: p.cutoff, resonance: p.resonance, envAmount: 1,
        attack: 0.004, decay: 0.45, sustain: 0, release: 0.05,
        fAttack: 0.002, fDecay: p.filter_decay, fSustain: 0, fRelease: 0.05,
      }, 110, 0.25, false);
    }

    case 'step-motion': {
      /*
       * Two LFOs. The firmware steps them once per audio block; here they
       * are stepped once per sequencer step and once on a 50 ms timer, which
       * is the same shape at a coarser grain.
       */
      let phase = 0;
      let vphase = 0;
      let sweepOct = p.sweep_octaves;
      let sweepRate = p.sweep_rate;
      let vibCents = p.vibrato_cents;
      let vibRate = p.vibrato_rate;
      const base = 165;
      /*
       * A one-oscillator engine with a real hz parameter, rather than the VA.
       *
       * The first version modulated the VA's `detune`, which is a SYMMETRIC
       * SPREAD: it pushes osc1 down and osc2 up by half each. Modulating it
       * moves the two oscillators apart and leaves the pitch centre exactly
       * where it was, so what you heard was beating rather than vibrato, and
       * the caveat claimed otherwise. One oscillator whose frequency actually
       * moves is the honest equivalent of the C++, which calls SetFreq.
       */
      /*
       * defEngine bodies are serialised into the worklet realm by toString,
       * so this has to be self-contained: its own arguments and Math, nothing
       * closed over. `active` stays true because this rung, like the C++, runs
       * from power on rather than per note.
       */
      b.defEngine({
        id: 'motion-rung',
        label: 'motion rung',
        params: [
          { name: 'hz', min: 20, max: 4000, default: 165, unit: 'Hz' },
          { name: 'cutoff', min: 40, max: 16000, default: 1500, unit: 'Hz' },
        ],
        polyphony: 1,
        createVoice: function (sampleRate, params) {
          var hz = params.hz === undefined ? 165 : params.hz;
          var cutoff = params.cutoff === undefined ? 1500 : params.cutoff;
          var ph = 0;
          var lp = 0;
          return {
            noteOn: function () {},
            noteOff: function () {},
            setParam: function (name, value) {
              if (name === 'hz') hz = value;
              else if (name === 'cutoff') cutoff = value;
            },
            process: function (outL, outR, from, to) {
              var inc = hz / sampleRate;
              var a = 1 - Math.exp((-2 * Math.PI * cutoff) / sampleRate);
              for (var i = from; i < to; i++) {
                ph += inc;
                if (ph >= 1) ph -= 1;
                lp += a * (2 * ph - 1 - lp);
                outL[i] += lp * 0.3;
                outR[i] += lp * 0.3;
              }
            },
            get active() {
              return true;
            },
          };
        },
      });
      const v = stepVoice(b, {}, base, 0.5, false, (inst) => {
        const timer = window.setInterval(() => {
          phase = (phase + 0.05 * sweepRate) % 1;
          vphase = (vphase + 0.05 * vibRate) % 1;
          const tri = phase < 0.5 ? phase * 4 - 1 : 3 - phase * 4;
          const norm = 0.5 * (tri + 1);
          inst.param('cutoff', Math.min(16000, 1500 * Math.pow(2, norm * sweepOct)));
          /* Cents, not Hz: the same wobble at every pitch. */
          const cents = Math.sin(2 * Math.PI * vphase) * vibCents;
          inst.param('hz', base * Math.pow(2, cents / 1200));
        }, 50);
        return { dispose: () => clearInterval(timer) };
      }, 'motion-rung');
      const inner = v.setParam;
      v.setParam = (k, val) => {
        if (k === 'sweep_octaves') sweepOct = val;
        else if (k === 'sweep_rate') sweepRate = val;
        else if (k === 'vibrato_cents') vibCents = val;
        else if (k === 'vibrato_rate') vibRate = val;
        else inner(k, val);
      };
      return v;
    }

    /* ---------------- 07_Workstation ---------------- */
    case 'workstation': {
      /*
       * The whole piece: kit on euclidean rhythms, a bass line, a plucked
       * melody whose notes come from the Markov chain, and a tempo-synced
       * delay send. Read off workstation.h: the patterns, the motif, the
       * progression and the send levels are its numbers.
       */
      const play = makePlay(b);
      const delay = b.bus([['delay', {
        timeL: (60 / 96) * 0.75, timeR: (60 / 96) * 0.5,
        feedback: p.feedback, crossFeedback: 0.18, damping: 4200, mix: 1,
      }]], { level: 1 });

      const kick = b.voice('kick');
      const snare = b.voice('snare');
      const hat = b.voice('hat');
      const bass = b.voice('va', {
        shape: 0.15, detune: 4, sub: 0.6, cutoff: p.cutoff, resonance: 0.25,
        envAmount: 0.4, attack: 0.004, decay: 0.18, sustain: 0.45, release: 0.12,
      });
      const melody = b.voice('pluck', { damp: p.damp, pickPos: 0.22, decay: 2.4 }, { polyphony: 4 });

      kick.gain(0.55);
      snare.gain(0.33);
      hat.gain(0.2);
      bass.gain(0.4);
      melody.gain(0.36);
      /* workstation.h ends with an Eq3 and a Limiter on the master. */
      instrumentMaster(b);
      snare.send(delay, 0.14 / 0.33);
      melody.send(delay, 0.26 / 0.36);

      const kickPat = b.euclid(16, 5);
      const snarePat = b.euclid(16, 4, 4);
      const hatPat = b.euclid(16, 11, 1);
      const bassPat = b.euclid(16, 3);
      const melPat = b.euclid(16, 9, 2);

      /* The Markov chain, trained on the same sixteen note motif. */
      const MOTIF = [0, 2, 4, 2, 7, 4, 2, 0, 4, 5, 4, 2, 0, 2, 4, 7];
      const chain = new Markov<number>(2);
      chain.train(MOTIF);
      chain.seed(MOTIF.slice(0, 2));
      const seq = b.rng('workstation::seq');

      let gate = 0;
      return {
        stepsPerBeat: 4,
        stepSec: INST_STEP_SEC,
        step: (i, at) => {
          const s = i % 16;
          const bar = Math.floor(i / 16) % 4;
          const chord = play.chord(bar);
          if (kickPat[s]) kick.note({ hz: 50 }, { at, dur: '8n', vel: 0.95 });
          if (snarePat[s]) snare.note({ hz: 190 }, { at, dur: '8n', vel: 0.7 + 0.2 * seq() });
          if (hatPat[s]) hat.note({ hz: 330 }, { at, dur: '16n', vel: 0.3 + 0.25 * seq() });
          if (gate > 0) gate--;
          if (bassPat[s]) {
            const d = chord - play.octave + (seq() < 0.16 ? 4 : 0);
            bass.note({ hz: play.hz(d) }, { at, dur: 0.35, vel: 0.85 });
            gate = 3;
          }
          if (melPat[s]) {
            const sym = chain.next(seq);
            const d = chord + sym + play.octave;
            melody.note({ hz: play.hz(d) }, { at, dur: 1.4, vel: 0.5 + 0.35 * seq() });
          }
        },
        setParam: (k, v) => {
          if (k === 'cutoff') bass.param('cutoff', v);
          else if (k === 'damp') melody.param('damp', v);
          else if (k === 'feedback') delay.fxParam(0, 'feedback', v);
        },
        dispose: () => {
          kick.dispose();
          snare.dispose();
          hat.dispose();
          bass.dispose();
          melody.dispose();
        },
      };
    }

    /* ---------------- 20_Instruments ---------------- */
    case 'inst-epiano': {
      const inst = b.voice('fm', {
        ops: 4, algorithm: 5, feedback: p.feedback, brightness: p.brightness,
        attack: 0.002, decay: p.decay, sustain: 0.28, release: 0.5,
        mAttack: 0.001, mDecay: p.m_decay, mSustain: 0, mRelease: 0.12,
        /* The tine. epiano.h sets ratio[1] = 14, and without it the
         * modulator runs at the carrier frequency and the strike that makes
         * this an electric piano does not exist. The names are 1-based here
         * and 0-based there. */
        ratio1: 1, ratio2: 14, ratio3: 1, ratio4: 1,
        level1: 1, level2: 0.42, level3: 0.5, level4: 0.22,
      }, { polyphony: 4 });
      inst.gain(0.47);
      return instrumentVoice(b, inst, 'chord', (k, v) => {
        if (k === 'm_decay') inst.param('mDecay', v);
        else inst.param(k, v);
      });
    }

    case 'inst-acid': {
      const inst = b.voice('va', {
        shape: 0, detune: 0, sub: 0,
        cutoff: p.cutoff, resonance: p.resonance, envAmount: p.env_amount,
        attack: 0.002, decay: 0.4, sustain: 0, release: 0.06,
        fAttack: 0.001, fDecay: p.f_decay, fSustain: 0, fRelease: 0.05,
        velLevel: 0.2, velFilter: 0.8,
      }, { polyphony: 1 });
      inst.gain(1.54);
      return instrumentVoice(b, inst, 'bass', (k, v) => {
        if (k === 'f_decay') inst.param('fDecay', v);
        else if (k === 'env_amount') inst.param('envAmount', v);
        else inst.param(k, v);
      });
    }

    case 'inst-junopad': {
      const inst = b.voice('va', {
        shape: 0.08, detune: 11, sub: p.sub, cutoff: 2400, resonance: 0.12,
        envAmount: 0.25, attack: p.attack, decay: 0.6, sustain: 0.8, release: 1.4,
        fAttack: 0.6, fDecay: 1.0, fSustain: 0.6, fRelease: 1.2,
      }, { polyphony: 4 });
      /* The chorus is an INSERT, not a send: it is the patch, not an effect
       * applied to it. Set mix to 0 and hear what it was doing. */
      inst.fx(['chorus', { rate: p.rate, depth: 0.55, mix: p.mix, feedback: 0.1 }]);
      inst.gain(0.49);
      return instrumentVoice(b, inst, 'chord', (k, v) => {
        if (k === 'mix') inst.fxParam(0, 'mix', v);
        else if (k === 'rate') inst.fxParam(0, 'rate', v);
        else inst.param(k, v);
      });
    }

    case 'inst-westcoast': {
      const inst = b.voice('westcoast', {
        foldAmount: p.fold_amount, foldStages: p.fold_stages, foldEnv: 0.65,
        lpgColor: p.lpg_color, lpgDecay: p.lpg_decay,
      }, { polyphony: 2 });
      inst.gain(1.81);
      return instrumentVoice(b, inst, 'melody', (k, v) => {
        const map: Record<string, string> = {
          fold_amount: 'foldAmount', fold_stages: 'foldStages',
          lpg_color: 'lpgColor', lpg_decay: 'lpgDecay',
        };
        inst.param(map[k] ?? k, v);
      });
    }

    case 'inst-guitar': {
      const inst = b.voice('pluck', {
        damp: p.damp, pickPos: p.pick_pos, decay: p.decay,
      }, { polyphony: 4 });
      inst.gain(3.4);
      return instrumentVoice(b, inst, 'chord', (k, v) =>
        inst.param(k === 'pick_pos' ? 'pickPos' : k, v));
    }

    case 'inst-bells':
    case 'inst-marimba':
    case 'inst-glass': {
      /* One engine, three instruments. The material is the difference. */
      const material = fw.voice === 'inst-bells' ? 2 : fw.voice === 'inst-marimba' ? 4 : 3;
      const gain = fw.voice === 'inst-bells' ? 0.8 : fw.voice === 'inst-marimba' ? 3.4 : 1.22;
      const inst = b.voice('modal', {
        material,
        decay: p.decay,
        brightness: p.brightness,
        strikeHardness: p.strike_hardness,
      }, { polyphony: 3 });
      inst.gain(gain);
      return instrumentVoice(b, inst, 'melody', (k, v) =>
        inst.param(k === 'strike_hardness' ? 'strikeHardness' : k, v));
    }

    case 'inst-clarinet': {
      const inst = b.voice('tube', {
        breath: p.breath, noise: p.noise, glide: p.glide,
      }, { polyphony: 1 });
      inst.gain(0.41);
      return instrumentVoice(b, inst, 'melody', (k, v) => inst.param(k, v));
    }

    case 'inst-choir': {
      const inst = b.voice('formant', {
        vowel: p.vowel, breath: p.breath,
        vibratoRate: 4.6, vibratoDepth: p.vibrato_depth, shape: 0.35,
      }, { polyphony: 3 });
      inst.gain(1.3);
      return instrumentVoice(b, inst, 'chord', (k, v) =>
        inst.param(k === 'vibrato_depth' ? 'vibratoDepth' : k, v));
    }

    case 'inst-808': {
      const play = makePlay(b);
      const kick = b.voice('kick', { decay: p.decay, pitchDecay: p.pitch_decay, drive: p.drive });
      const snare = b.voice('snare', { tone: p.tone, decay: 0.24, snap: 0.22 });
      const hat = b.voice('hat', { decay: 0.055 });
      instrumentMaster(b);
      kick.gain(0.29);
      snare.gain(0.29);
      hat.gain(0.29);
      return {
        stepsPerBeat: 4,
        stepSec: INST_STEP_SEC,
        step: (i, at) => {
          const s = i % PLAY_STEPS;
          /* Tuned per pad, and the drum engines tune from the noteOn
           * frequency, so these are the pitches eightoheight.h passes. */
          if (play.kick(s)) kick.note({ hz: 48 }, { at, dur: '4n', vel: 0.95 });
          if (play.snare(s)) snare.note({ hz: 185 }, { at, dur: '8n', vel: 0.75 });
          if (play.hat(s)) hat.note({ hz: 330 }, { at, dur: '16n', vel: 0.45 });
        },
        setParam: (k, v) => {
          if (k === 'decay' || k === 'drive') kick.param(k, v);
          else if (k === 'pitch_decay') kick.param('pitchDecay', v);
          else if (k === 'tone') snare.param('tone', v);
        },
        dispose: () => {
          kick.dispose();
          snare.dispose();
          hat.dispose();
        },
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
  chord: [
    'The PIEZO entry shares this voice. Its three sliders move the output stage rather than the voice, because a high pass and a resonance lift are properties of the disc and not of the string.',
  ],
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

  /* 06_FirstSteps. These four are the only entries in the catalogue whose
   * C++ is raw DSP rather than an engine, so they are the only ones where
   * the browser side is a stand-in rather than the same code path. */
  'step-tone': [
    'The firmware is one BlepOsc written straight into the buffer. The browser library exposes engines, not oscillators, so this is the VA engine with its second oscillator, its sub and its filter envelope silenced. Same waveform, one more filter in the path.',
    'It never stops, because there is no envelope and no note. That is the whole point of the rung.',
  ],
  'step-envelope': [
    'Same stand-in as the tone: a VA voice with everything but the amplitude envelope taken out.',
    'The gate control is in the firmware and has no browser equivalent here, so the note length is fixed at half a step.',
  ],
  'step-filter': [
    'From this rung on, the stand-in is close: the firmware is an oscillator, a ladder and two envelopes, which is what the VA engine is.',
    'The cutoff floor is a firmware control. Here the envelope amount does the same job from the other end.',
  ],
  'step-motion': [
    'The firmware steps both LFOs once per audio block. Here they run on a 50 ms timer, which is the same shape at a coarser grain.',
    'The browser side is a one-oscillator engine registered by the example, not the VA. Modulating the VA detune would have moved the two oscillators apart and left the pitch centre where it was, which is beating rather than vibrato.',
  ],

  /* 07_Workstation. */
  workstation: [
    'Five engines, a Markov melody and a delay send, from one seed. Both sides train the same sixteen note motif on a variable-order chain; the C++ is a fixed-capacity rewrite of it, compared exactly on 74 rows in the value-parity harness.',
    'The two will not play the same notes. The chain and the rhythms match, but the draw does not: the C++ Rng rounds to float where the browser keeps double, so a weighted pick near a boundary can fall either way. That is a property of the generator and it is why the parity harness compares the draw with the uniform supplied rather than drawn.',
    'The parity figure above is the VA row, which is the loudest engine in the piece. The kit, the string, the delay and the EQ have their own rows and all of them are tighter.',
  ],

  /* 20_Instruments. These are one to one: the same engine, the same
   * parameter names, and the parity row printed above is that engine's. */
  'inst-epiano': [],
  'inst-acid': [],
  'inst-junopad': [
    'The chorus is a channel insert here and an in-patch effect there, which is the same position in the chain: after the voice mix, not per voice.',
  ],
  'inst-westcoast': [],
  'inst-guitar': [],
  'inst-bells': [],
  'inst-marimba': [],
  'inst-glass': [],
  'inst-clarinet': [],
  'inst-choir': [],
  'inst-808': [],
};
