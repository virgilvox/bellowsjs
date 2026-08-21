/*
 * The firmware catalogue for the simulator.
 *
 * Every entry points at a real example in packages/bellows-embedded. The
 * C++ shown on the page comes from sources.gen.ts, which is generated from
 * those files and regenerated and diffed in CI, so the source a visitor
 * reads is the source that compiles to a board and cannot drift from it.
 *
 * WHAT THE PLAYGROUND ACTUALLY RUNS, WHICH IS THE HONEST PART
 *
 * It does not emulate a Cortex-M7. It runs the TypeScript implementation of
 * the same DSP, in this browser, through the same AudioWorklet the rest of
 * the site uses.
 *
 * That would be a weak claim in most projects. Here it is a measured one.
 * packages/bellows-embedded/test/parity renders the same note from the C++
 * and from the TypeScript and diffs them, on every commit, with per engine
 * gates set at roughly ten times the observed drift. `parityRelRms` below
 * is that measurement, copied from a run of `npm run parity:check`, so the
 * page can tell you how far what you are hearing is from what the board
 * would produce instead of asking you to take it on faith.
 *
 * What that number does NOT cover, and the UI says so plainly:
 *   - timing. Whether a given board renders this in time is not simulated.
 *     One board has been measured since, twice: a Teensy 4.0 at 600 MHz
 *     runs 07_Workstation's patch, the heaviest program in the set, at
 *     33.8 to 46.5 percent CPU with a 47.3 percent running maximum and 2
 *     of 24 audio blocks used. That is one board and one program, so it
 *     is a data point rather than a general answer, and nothing here
 *     predicts any other combination.
 *   - the .ino. Codec setup, pin configuration and the audio library's
 *     scheduling are not modelled. Only the program logic is.
 */

import {
  onekick_h,
  onekick_ino,
  firststeps_ino,
  tone_h,
  fs_envelope_h,
  fs_filter_h,
  fs_motion_h,
  workstation_h,
  workstation_ino,
  instruments_ino,
  epiano_h,
  acid_h,
  junopad_h,
  westcoast_h,
  guitar_h,
  bells_h,
  marimba_h,
  glass_h,
  clarinet_h,
  choir_h,
  eightoheight_h,
  drummachine_h,
  drummachine_ino,
  polysynth_h,
  polysynth_ino,
  scalestuning_h,
  scalestuning_ino,
  audioshield_h,
  audioshield_ino,
  piezo_h,
  piezo_ino,
  wspiezo_ino,
  wsi2s_ino,
  presets_h,
  presets_ino,
} from './sources.gen';

import { INSTRUMENT_PRESETS } from 'bellowsjs';

import type { OutputId } from './output-stage';

/** A parameter the simulator exposes, and that export writes back into C++. */
export interface FirmwareParam {
  /** The C++ field name, so codegen can write `p.<key> = <value>f;` */
  key: string;
  /**
   * The object the field belongs to, when more than one object in the header
   * has a field of that name.
   *
   * eightoheight.h configures three drums in one function, so `decay` appears
   * as k.decay, s.decay and h.decay and `tone` as s.tone and h.tone. A global
   * rewrite on the bare name changed all of them: exporting with untouched
   * defaults already turned the hat's 0.055 s decay into 1.1 s, which is a
   * different instrument. Naming the owner makes the rewrite exact.
   */
  owner?: string;
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  unit?: string;
  /** One line on what it does. Shown under the control. */
  hint: string;
}

/** An input the firmware reads, rendered as a control that looks like the part. */
export interface FirmwareInput {
  kind: 'pot' | 'keys' | 'pad';
  /** The Teensy pin it is wired to, for the board graphic. Null for USB. */
  pin: number | null;
  label: string;
  hint: string;
}

/** An output the firmware drives that is not audio, like the onboard LED. */
export interface FirmwareIndicator {
  pin: number;
  label: string;
}

export interface Firmware {
  id: string;
  /** Grouping in the picker. Examples that ship several patches share one. */
  group: string;
  /** The example folder, so the page can link to the source of truth. */
  folder: string;
  title: string;
  blurb: string;
  /** The engine the parity harness measures, or null when several. */
  parityRow: string | null;
  /** Relative RMS difference between the C++ and the TypeScript, measured. */
  parityRelRms: number | null;
  /** The real C++ program logic and its board glue. */
  headerSource: string;
  inoSource: string;
  /** The header's filename, for the export. */
  headerName: string;
  params: FirmwareParam[];
  /**
   * A labelled list the firmware picks one of, when the thing being chosen
   * has a name rather than a value.
   *
   * 21_Presets walks 50 named instruments, and a slider reading "31" for
   * DOUBLE BASS is not a tour of a preset library. Only that entry uses
   * this; everything else varies by number and a slider is the honest
   * control. The chosen index reaches the voice through
   * `RunningVoice.select`, not through `setParam`, because selecting
   * rebuilds the instrument rather than moving one of its fields.
   */
  choices?: Array<{ value: number; label: string }>;
  inputs: FirmwareInput[];
  indicators: FirmwareIndicator[];
  /** Output paths this example is written for. First is the default. */
  outputs: OutputId[];
  /** Boards the matrix says this builds for. */
  boards: string[];
  /** Builds the sound in the browser. See voices.ts. */
  voice: string;
}

const ALL_BOARDS = ['teensy32', 'teensy35', 'teensy36', 'teensy40', 'teensy41', 'teensymm'];
/* Boards 07_Workstation fits, from the build matrix: its 500 ms stereo delay
 * line is 187 KB, which is more than a Teensy 3.2 has in total. */
const FOUR_PLUS = ['teensy35', 'teensy36', 'teensy40', 'teensy41', 'teensymm'];
const OUTPUTS_ALL: OutputId[] = ['shield', 'i2s-dac', 'i2s-amp', 'dac12', 'mqs', 'pwm', 'piezo'];

/*
 * parityRelRms values are from `npm run parity:check` in
 * packages/bellows-embedded, run at 44100 Hz over 16384 frames with seed 1.
 * They are the relative RMS of the difference between the two
 * implementations, so 9.79e-5 is about -80 dB. Re-run that command if you
 * change either side; the harness gates it in CI either way.
 */
export const FIRMWARES: Firmware[] = [
  {
    id: 'onekick',
    group: 'learn the library',
    folder: '01_OneKick',
    title: 'ONE KICK',
    blurb: 'The smallest useful program: one drum voice retriggering twice a second.',
    parityRow: 'kick',
    parityRelRms: 9.79e-5,
    headerSource: onekick_h,
    inoSource: onekick_ino,
    headerName: 'onekick.h',
    params: [
      { key: 'decay', label: 'decay', min: 0.05, max: 2, step: 0.01, value: 0.55, unit: 's', hint: 'How long the body rings.' },
      { key: 'drive', label: 'drive', min: 0.5, max: 8, step: 0.1, value: 3, hint: 'How hard the body is pushed into the tanh.' },
      { key: 'tune', label: 'tune', min: 30, max: 120, step: 1, value: 50, unit: 'Hz', hint: 'Starting frequency of the pitch sweep.' },
    ],
    inputs: [],
    indicators: [],
    outputs: ['shield', 'i2s-dac', 'i2s-amp', 'dac12', 'mqs', 'pwm', 'piezo'],
    boards: ALL_BOARDS,
    voice: 'kick',
  },
  {
    id: 'drummachine',
    group: 'learn the library',
    folder: '02_DrumMachine',
    title: 'DRUM MACHINE',
    blurb: 'Three euclidean rhythms at once: E(5,16) kick, E(4,16) snare rotated 4, E(11,16) hat rotated 1.',
    parityRow: 'kick',
    parityRelRms: 9.79e-5,
    headerSource: drummachine_h,
    inoSource: drummachine_ino,
    headerName: 'drummachine.h',
    params: [
      { key: 'bpm', label: 'tempo', min: 60, max: 180, step: 1, value: 120, unit: 'bpm', hint: 'Also driven by the pot on pin 14.' },
      { key: 'swing', label: 'swing', min: 0, max: 0.4, step: 0.01, value: 0, hint: 'Delay applied to every other step.' },
    ],
    inputs: [
      { kind: 'pot', pin: 14, label: 'TEMPO POT', hint: 'A 10k pot on A0 (pin 14). The sketch reads it with analogRead.' },
    ],
    indicators: [],
    outputs: ['shield', 'i2s-dac', 'i2s-amp', 'dac12', 'mqs', 'pwm', 'piezo'],
    boards: ALL_BOARDS,
    voice: 'drums',
  },
  {
    id: 'polysynth',
    group: 'learn the library',
    folder: '03_PolySynth',
    title: 'POLY SYNTH',
    blurb: 'A voice pool of virtual analog voices under a swept filter.',
    parityRow: 'va',
    parityRelRms: 2.19e-3,
    headerSource: polysynth_h,
    inoSource: polysynth_ino,
    headerName: 'polysynth.h',
    params: [
      { key: 'cutoff', label: 'cutoff', min: 200, max: 8000, step: 10, value: 1800, unit: 'Hz', hint: 'Ladder filter corner.' },
      { key: 'resonance', label: 'resonance', min: 0, max: 0.95, step: 0.01, value: 0.4, hint: 'Ladder feedback. A tall peak, not an oscillator: the loop stays under unity at every setting.' },
      { key: 'detune', label: 'detune', min: 0, max: 30, step: 0.5, value: 8, unit: 'cents', hint: 'Spread between the two oscillators.' },
    ],
    inputs: [
      { kind: 'keys', pin: null, label: 'KEYBOARD', hint: 'On a board this is USB MIDI in. Here it is these keys.' },
    ],
    indicators: [],
    outputs: ['shield', 'i2s-dac', 'i2s-amp', 'dac12', 'mqs', 'pwm', 'piezo'],
    boards: ALL_BOARDS,
    voice: 'poly',
  },
  {
    id: 'scales',
    group: 'learn the library',
    folder: '04_ScalesAndTuning',
    title: 'SCALES + TUNING',
    blurb: 'One phrase as scale degrees, played in 12-EDO then 19-EDO. The tuning layer, not a formula.',
    parityRow: 'pluck',
    parityRelRms: 4.96e-6,
    headerSource: scalestuning_h,
    inoSource: scalestuning_ino,
    headerName: 'scalestuning.h',
    params: [
      { key: 'damp', label: 'damp', min: 0.05, max: 0.9, step: 0.01, value: 0.32, hint: 'Loop damping of the plucked voice.' },
      { key: 'decay', label: 'decay', min: 0.5, max: 6, step: 0.1, value: 2.2, unit: 's', hint: 'How long each note rings.' },
    ],
    inputs: [],
    indicators: [{ pin: 13, label: 'PASS LED' }],
    outputs: ['shield', 'i2s-dac', 'i2s-amp', 'dac12', 'mqs', 'pwm', 'piezo'],
    boards: ALL_BOARDS,
    voice: 'scales',
  },
  {
    id: 'chord',
    group: 'getting sound out',
    folder: '10_AudioShield',
    title: 'PLUCKED CHORD',
    blurb: 'The patch the output examples share, so switching output compares converters.',
    parityRow: 'pluck',
    parityRelRms: 4.96e-6,
    headerSource: audioshield_h,
    inoSource: audioshield_ino,
    headerName: 'audioshield.h',
    params: [
      { key: 'damp', label: 'damp', min: 0.05, max: 0.9, step: 0.01, value: 0.3, hint: 'Loop damping. Higher is duller and shorter.' },
      { key: 'decay', label: 'decay', min: 0.5, max: 8, step: 0.1, value: 3, unit: 's', hint: 'How long the strings ring.' },
      { key: 'pick_pos', label: 'pick pos', min: 0.05, max: 0.5, step: 0.01, value: 0.22, hint: 'Where along the string it is plucked.' },
    ],
    inputs: [],
    indicators: [],
    outputs: ['shield', 'i2s-dac', 'i2s-amp', 'dac12', 'mqs', 'pwm', 'piezo'],
    boards: ALL_BOARDS,
    voice: 'chord',
  },
  {
    id: 'piezo',
    group: 'getting sound out',
    folder: '15_Piezo',
    title: 'PIEZO VOICING',
    blurb: 'The same chord through the piezo chain: high pass, resonance lift, hard limit.',
    parityRow: 'pluck',
    parityRelRms: 4.96e-6,
    headerSource: piezo_h,
    inoSource: piezo_ino,
    headerName: 'piezo.h',
    params: [
      { key: 'highpass_hz', label: 'high pass', min: 400, max: 3000, step: 10, value: 1200, unit: 'Hz', hint: 'Everything below this is thrown away. Moves the output stage, not the voice.' },
      { key: 'resonance_hz', label: 'resonance', min: 1500, max: 7000, step: 50, value: 4000, unit: 'Hz', hint: "The disc's mechanical resonance. Measure yours." },
      { key: 'resonance_db', label: 'lift', min: 0, max: 15, step: 0.5, value: 8, unit: 'dB', hint: 'How hard to lean on the resonance.' },
    ],
    inputs: [],
    indicators: [],
    outputs: ['piezo', 'mqs', 'pwm'],
    boards: ALL_BOARDS,
    voice: 'chord',
  },

  /* ---------------------------------------------------------------- *
   * 16 and 17. 07_Workstation's piece through two of the output paths
   * above, and they are here rather than under "the whole thing"
   * because what distinguishes them is the converter and not the music.
   *
   * Neither folder holds a header of its own, and neither needs one:
   * both include `../07_Workstation/workstation.h`, so that IS their
   * program and it is what the header pane shows. The `.ino` differs and
   * carries the whole difference between the two, which is the split the
   * rest of the catalogue already uses. It also means the parameters
   * below write back into a file that really has those fields, rather
   * than reporting 0 of 3 against an `.ino` that has none.
   * ---------------------------------------------------------------- */
  {
    id: 'ws-piezo',
    group: 'getting sound out',
    folder: '16_WorkstationPiezo',
    title: 'WORKSTATION ON A DISC',
    blurb: 'The whole piece onto a piezo, which passes nothing under 1.2 kHz. What survives is the hat, the snare and the melody as harmonics.',
    parityRow: 'va',
    parityRelRms: 2.19e-3,
    headerSource: workstation_h,
    inoSource: wspiezo_ino,
    headerName: 'workstation.h',
    params: [
      { key: 'cutoff', label: 'bass cutoff', min: 200, max: 4000, step: 10, value: 900, unit: 'Hz', hint: 'Ladder corner on the bass voice. On a disc you will not hear this move.' },
      { key: 'damp', label: 'string damp', min: 0.05, max: 0.9, step: 0.01, value: 0.32, hint: 'How fast the top comes off the plucked melody. On a disc this is most of what you hear.' },
      { key: 'feedback', label: 'delay fb', min: 0, max: 0.85, step: 0.01, value: 0.42, hint: 'Repeats on the send. The times follow the tempo.' },
    ],
    inputs: [],
    indicators: [],
    outputs: ['piezo', 'mqs', 'pwm'],
    boards: FOUR_PLUS,
    voice: 'ws-piezo',
  },
  {
    id: 'ws-i2s',
    group: 'getting sound out',
    folder: '17_WorkstationI2S',
    title: 'WORKSTATION ON AN AMP',
    blurb: 'The same piece into a MAX98357A, summed to mono so the SD pin on the amplifier stops mattering. This is the one that has been flashed and heard.',
    parityRow: 'va',
    parityRelRms: 2.19e-3,
    headerSource: workstation_h,
    inoSource: wsi2s_ino,
    headerName: 'workstation.h',
    params: [
      { key: 'cutoff', label: 'bass cutoff', min: 200, max: 4000, step: 10, value: 900, unit: 'Hz', hint: 'Ladder corner on the bass voice.' },
      { key: 'damp', label: 'string damp', min: 0.05, max: 0.9, step: 0.01, value: 0.32, hint: 'How fast the top comes off the plucked melody.' },
      { key: 'feedback', label: 'delay fb', min: 0, max: 0.85, step: 0.01, value: 0.42, hint: 'Repeats on the send. The times follow the tempo.' },
    ],
    inputs: [],
    indicators: [],
    outputs: ['i2s-amp'],
    boards: FOUR_PLUS,
    voice: 'ws-i2s',
  },

  /* ---------------------------------------------------------------- *
   * 06_FirstSteps. The four rungs below 01_OneKick, one header each,
   * all four linked into one image. They are here because the smallest
   * program in the catalogue was already an engine, and if a board makes
   * no sound the useful question is which of these four is the first to
   * fail.
   * ---------------------------------------------------------------- */
  {
    id: 'step-tone',
    group: 'first steps',
    folder: '06_FirstSteps',
    title: '1 / TONE',
    blurb: 'One oscillator, written straight into the buffer. No engine, no envelope, no note.',
    parityRow: null,
    parityRelRms: null,
    headerSource: tone_h,
    inoSource: firststeps_ino,
    headerName: 'tone.h',
    params: [
      { key: 'freq', label: 'freq', min: 55, max: 880, step: 1, value: 220, unit: 'Hz', hint: 'The pitch. Nothing else here can be wrong.' },
      { key: 'level', label: 'level', min: 0.02, max: 0.6, step: 0.01, value: 0.25, hint: 'Straight gain on the oscillator.' },
    ],
    inputs: [],
    indicators: [],
    outputs: OUTPUTS_ALL,
    boards: ALL_BOARDS,
    voice: 'step-tone',
  },
  {
    id: 'step-envelope',
    group: 'first steps',
    folder: '06_FirstSteps',
    title: '2 / ENVELOPE',
    blurb: 'The same oscillator, gated once a beat. What turns a tone into a note.',
    parityRow: null,
    parityRelRms: null,
    headerSource: fs_envelope_h,
    inoSource: firststeps_ino,
    headerName: 'envelope.h',
    params: [
      { key: 'attack', label: 'attack', min: 0.001, max: 0.5, step: 0.001, value: 0.005, unit: 's', hint: 'How long it takes to arrive.' },
      { key: 'decay', label: 'decay', min: 0.01, max: 1.5, step: 0.01, value: 0.12, unit: 's', hint: 'How long it takes to fall to the sustain level.' },
      { key: 'sustain', label: 'sustain', min: 0, max: 1, step: 0.01, value: 0.55, hint: 'How loud it sits while held. The only one that is not a time.' },
      { key: 'release', label: 'release', min: 0.01, max: 2, step: 0.01, value: 0.25, unit: 's', hint: 'How long it takes to go, after the gate drops.' },
      { key: 'gate', label: 'gate', min: 0.05, max: 0.95, step: 0.01, value: 0.5, hint: 'Fraction of the step the note is held for.' },
    ],
    inputs: [],
    indicators: [],
    outputs: OUTPUTS_ALL,
    boards: ALL_BOARDS,
    voice: 'step-envelope',
  },
  {
    id: 'step-filter',
    group: 'first steps',
    folder: '06_FirstSteps',
    title: '3 / FILTER',
    blurb: 'A resonant ladder with an envelope of its own. This is 03_PolySynth without the voice pool.',
    parityRow: 'va',
    parityRelRms: 2.19e-3,
    headerSource: fs_filter_h,
    inoSource: firststeps_ino,
    headerName: 'filter.h',
    params: [
      { key: 'cutoff', label: 'cutoff', min: 300, max: 8000, step: 10, value: 2600, unit: 'Hz', hint: 'Where the filter opens to at the peak of the note.' },
      { key: 'cutoff_floor', label: 'floor', min: 60, max: 2000, step: 10, value: 180, unit: 'Hz', hint: 'Where it falls back to. The sweep between the two is the sound.' },
      { key: 'resonance', label: 'resonance', min: 0, max: 0.98, step: 0.01, value: 0.72, hint: 'Past about 0.9 the filter sings its own pitch.' },
      { key: 'filter_decay', label: 'filter decay', min: 0.02, max: 1.5, step: 0.01, value: 0.22, unit: 's', hint: 'Brightness gone before the note is. Sharing one envelope is what makes a patch sound like a toy.' },
    ],
    inputs: [],
    indicators: [],
    outputs: OUTPUTS_ALL,
    boards: ALL_BOARDS,
    voice: 'step-filter',
  },
  {
    id: 'step-motion',
    group: 'first steps',
    folder: '06_FirstSteps',
    title: '4 / MOTION',
    blurb: 'Two LFOs, on cutoff and on pitch. An envelope moves once a note; an LFO never stops.',
    parityRow: 'va',
    parityRelRms: 2.19e-3,
    headerSource: fs_motion_h,
    inoSource: firststeps_ino,
    headerName: 'motion.h',
    params: [
      { key: 'sweep_octaves', label: 'sweep', min: 0, max: 4, step: 0.1, value: 2.2, unit: 'oct', hint: 'How far the slow LFO opens and closes the filter.' },
      { key: 'sweep_rate', label: 'sweep rate', min: 0.02, max: 2, step: 0.01, value: 0.18, unit: 'Hz', hint: 'Slower than a note, which is what makes it a sweep.' },
      { key: 'vibrato_cents', label: 'vibrato', min: 0, max: 60, step: 1, value: 12, unit: 'cents', hint: 'In cents, not Hz: pitch is logarithmic and Hz is not.' },
      { key: 'vibrato_rate', label: 'vib rate', min: 0.5, max: 12, step: 0.1, value: 5.2, unit: 'Hz', hint: 'About 5 Hz is what a player does.' },
    ],
    inputs: [],
    indicators: [],
    outputs: OUTPUTS_ALL,
    boards: ALL_BOARDS,
    voice: 'step-motion',
  },

  /* ---------------------------------------------------------------- *
   * 07_Workstation. Five engines, a sequencer, a send and one seed.
   * ---------------------------------------------------------------- */
  {
    id: 'workstation',
    group: 'the whole thing',
    folder: '07_Workstation',
    title: 'WORKSTATION',
    blurb: 'Five engines at once: euclidean kit, Markov melody, bass, tempo-synced delay send, EQ and limiter. One seed decides all of it.',
    parityRow: 'va',
    parityRelRms: 2.19e-3,
    headerSource: workstation_h,
    inoSource: workstation_ino,
    headerName: 'workstation.h',
    params: [
      { key: 'cutoff', label: 'bass cutoff', min: 200, max: 4000, step: 10, value: 900, unit: 'Hz', hint: 'Ladder corner on the bass voice.' },
      { key: 'damp', label: 'string damp', min: 0.05, max: 0.9, step: 0.01, value: 0.32, hint: 'How fast the top comes off the plucked melody.' },
      { key: 'feedback', label: 'delay fb', min: 0, max: 0.85, step: 0.01, value: 0.42, hint: 'Repeats on the send. The times follow the tempo.' },
    ],
    inputs: [],
    indicators: [],
    outputs: OUTPUTS_ALL,
    boards: FOUR_PLUS,
    voice: 'workstation',
  },

  /* ---------------------------------------------------------------- *
   * 20_Instruments. One header per patch, all sharing player.h so that
   * switching patch compares instruments and not the parts they happen
   * to be playing. Every one of them is in the same firmware image.
   * ---------------------------------------------------------------- */
  {
    id: 'epiano',
    group: 'instruments',
    folder: '20_Instruments',
    title: 'FM ELECTRIC PIANO',
    blurb: 'A carrier at the fundamental and a modulator at 14 times it, whose envelope dies first. That is the tine.',
    parityRow: 'fm',
    parityRelRms: 5.25e-4,
    headerSource: epiano_h,
    inoSource: instruments_ino,
    headerName: 'epiano.h',
    params: [
      { key: 'brightness', label: 'brightness', min: 0, max: 1, step: 0.01, value: 0.62, hint: 'Modulator depth. The velocity knob a real one has.' },
      { key: 'm_decay', label: 'tine decay', min: 0.02, max: 1, step: 0.01, value: 0.16, unit: 's', hint: 'How long the strike rings before the body takes over.' },
      { key: 'feedback', label: 'feedback', min: 0, max: 0.8, step: 0.01, value: 0.12, hint: 'A little grit on the strike.' },
      { key: 'decay', label: 'body decay', min: 0.2, max: 4, step: 0.05, value: 1.6, unit: 's', hint: 'The sustained part, under the tine.' },
    ],
    inputs: [{ kind: 'keys', pin: null, label: 'KEYBOARD', hint: 'On a board this is USB MIDI in. Here it is these keys.' }],
    indicators: [],
    outputs: OUTPUTS_ALL,
    boards: ALL_BOARDS,
    voice: 'inst-epiano',
  },
  {
    id: 'acid',
    group: 'instruments',
    folder: '20_Instruments',
    title: 'ACID BASS',
    blurb: 'One oscillator and one filter, and the filter is the instrument. Accent moves the cutoff, not the volume.',
    parityRow: 'va',
    parityRelRms: 2.19e-3,
    headerSource: acid_h,
    inoSource: instruments_ino,
    headerName: 'acid.h',
    params: [
      { key: 'cutoff', label: 'cutoff', min: 80, max: 2000, step: 5, value: 320, unit: 'Hz', hint: 'Where the sweep lands, not where it starts.' },
      { key: 'resonance', label: 'resonance', min: 0.3, max: 0.98, step: 0.01, value: 0.88, hint: 'Close enough to self-oscillation that the peak sings.' },
      { key: 'env_amount', label: 'env amount', min: 0, max: 1, step: 0.01, value: 0.85, hint: 'How far the envelope throws the filter. This is the sound.' },
      { key: 'f_decay', label: 'sweep time', min: 0.02, max: 1, step: 0.01, value: 0.18, unit: 's', hint: 'Brightness gone well before the note is.' },
    ],
    inputs: [],
    indicators: [],
    outputs: OUTPUTS_ALL,
    boards: ALL_BOARDS,
    voice: 'inst-acid',
  },
  {
    id: 'junopad',
    group: 'instruments',
    folder: '20_Instruments',
    title: 'CHORUSED PAD',
    blurb: 'An ordinary voice made twice its size by a chorus across the whole output. Set mix to 0 and hear what it was doing.',
    parityRow: 'chorus',
    parityRelRms: 2.02e-4,
    headerSource: junopad_h,
    inoSource: instruments_ino,
    headerName: 'junopad.h',
    params: [
      { key: 'mix', label: 'chorus mix', min: 0, max: 1, step: 0.01, value: 0.5, hint: 'The whole patch. At 0 this is a thin four-voice pad.' },
      { key: 'rate', label: 'chorus rate', min: 0.05, max: 4, step: 0.01, value: 0.62, unit: 'Hz', hint: 'How fast the delay between the copies varies.' },
      { key: 'sub', label: 'sub', min: 0, max: 1, step: 0.01, value: 0.45, hint: 'The octave below, which is the body.' },
      { key: 'attack', label: 'attack', min: 0.01, max: 2, step: 0.01, value: 0.45, unit: 's', hint: 'Slow enough that chords bloom.' },
    ],
    inputs: [{ kind: 'keys', pin: null, label: 'KEYBOARD', hint: 'On a board this is USB MIDI in. Here it is these keys.' }],
    indicators: [],
    outputs: OUTPUTS_ALL,
    boards: ALL_BOARDS,
    voice: 'inst-junopad',
  },
  {
    id: 'westcoast',
    group: 'instruments',
    folder: '20_Instruments',
    title: 'WEST COAST',
    blurb: 'A sine folded back on itself to make harmonics, through a low pass gate. There is no filter in this patch.',
    parityRow: 'westcoast',
    parityRelRms: 2.75e-3,
    headerSource: westcoast_h,
    inoSource: instruments_ino,
    headerName: 'westcoast.h',
    params: [
      { key: 'fold_amount', label: 'fold', min: 0, max: 1, step: 0.01, value: 0.55, hint: 'How hard the sine is driven into the folds.' },
      { key: 'fold_stages', label: 'stages', min: 1, max: 5, step: 1, value: 3, hint: 'How many times it can turn back. Each corner is a harmonic series.' },
      { key: 'lpg_decay', label: 'lpg decay', min: 0.05, max: 2, step: 0.01, value: 0.42, unit: 's', hint: 'A vactrol closes brightness and volume together. This decides bongo or bass.' },
      { key: 'lpg_color', label: 'lpg color', min: 0, max: 1, step: 0.01, value: 0.6, hint: 'How tightly the two are coupled.' },
    ],
    inputs: [],
    indicators: [],
    outputs: OUTPUTS_ALL,
    boards: ALL_BOARDS,
    voice: 'inst-westcoast',
  },
  {
    id: 'guitar',
    group: 'instruments',
    folder: '20_Instruments',
    title: 'PLUCKED STRING',
    blurb: 'Karplus-Strong: noise into a delay line one period long, fed back through a lowpass. Pick position is a comb.',
    parityRow: 'pluck',
    parityRelRms: 4.96e-6,
    headerSource: guitar_h,
    inoSource: instruments_ino,
    headerName: 'guitar.h',
    params: [
      { key: 'damp', label: 'damp', min: 0.05, max: 0.9, step: 0.01, value: 0.28, hint: 'How fast the top comes off. Higher is duller and shorter.' },
      { key: 'pick_pos', label: 'pick pos', min: 0.02, max: 0.5, step: 0.01, value: 0.24, hint: 'Where along the string. Near the bridge is thin and bright.' },
      { key: 'decay', label: 'decay', min: 0.5, max: 8, step: 0.1, value: 3.2, unit: 's', hint: 'How long it rings.' },
    ],
    inputs: [{ kind: 'keys', pin: null, label: 'KEYBOARD', hint: 'On a board this is USB MIDI in. Here it is these keys.' }],
    indicators: [],
    outputs: OUTPUTS_ALL,
    boards: ALL_BOARDS,
    voice: 'inst-guitar',
  },
  {
    id: 'bells',
    group: 'instruments',
    folder: '20_Instruments',
    title: 'TUBULAR BELLS',
    blurb: 'Modal synthesis. Partials at 1, 2, 2.4, 3, 4.5, 5.33: that 2.4 is not in any harmonic series and it is what makes a bell.',
    parityRow: 'modal',
    parityRelRms: 1.23e-4,
    headerSource: bells_h,
    inoSource: instruments_ino,
    headerName: 'bells.h',
    params: [
      { key: 'decay', label: 'decay', min: 0.3, max: 12, step: 0.1, value: 4.5, unit: 's', hint: 'Metal is stiff and lossless and rings for seconds.' },
      { key: 'brightness', label: 'brightness', min: 0, max: 1, step: 0.01, value: 0.62, hint: 'How much of the upper modes you get.' },
      { key: 'strike_hardness', label: 'mallet', min: 0, max: 1, step: 0.01, value: 0.7, hint: 'Soft misses the upper modes entirely.' },
    ],
    inputs: [{ kind: 'keys', pin: null, label: 'KEYBOARD', hint: 'On a board this is USB MIDI in. Here it is these keys.' }],
    indicators: [],
    outputs: OUTPUTS_ALL,
    boards: ALL_BOARDS,
    voice: 'inst-bells',
  },
  {
    id: 'marimba',
    group: 'instruments',
    folder: '20_Instruments',
    title: 'MARIMBA',
    blurb: 'The same engine as the bells with the material changed. Wood dumps its energy in 200 ms where metal rings for seconds.',
    parityRow: 'modal',
    parityRelRms: 1.23e-4,
    headerSource: marimba_h,
    inoSource: instruments_ino,
    headerName: 'marimba.h',
    params: [
      { key: 'decay', label: 'decay', min: 0.3, max: 8, step: 0.1, value: 2.4, unit: 's', hint: 'Against a decay_base of 0.12 for wood, where the bell is 1.8.' },
      { key: 'brightness', label: 'brightness', min: 0, max: 1, step: 0.01, value: 0.5, hint: 'Upper modes die fastest, so it becomes a sine within one note.' },
      { key: 'strike_hardness', label: 'mallet', min: 0, max: 1, step: 0.01, value: 0.62, hint: 'A mallet with some weight behind it.' },
    ],
    inputs: [{ kind: 'keys', pin: null, label: 'KEYBOARD', hint: 'On a board this is USB MIDI in. Here it is these keys.' }],
    indicators: [],
    outputs: OUTPUTS_ALL,
    boards: ALL_BOARDS,
    voice: 'inst-marimba',
  },
  {
    id: 'glass',
    group: 'instruments',
    folder: '20_Instruments',
    title: 'GLASS',
    blurb: 'The third material. Sparse partials that keep their brightness most of the way through the note.',
    parityRow: 'modal',
    parityRelRms: 1.23e-4,
    headerSource: glass_h,
    inoSource: instruments_ino,
    headerName: 'glass.h',
    params: [
      { key: 'decay', label: 'decay', min: 0.5, max: 16, step: 0.1, value: 6, unit: 's', hint: 'Long, because its upper modes hold 0.75 of the base where wood holds 0.35.' },
      { key: 'brightness', label: 'brightness', min: 0, max: 1, step: 0.01, value: 0.8, hint: 'Glass keeps its top. That is the whole difference from a marimba.' },
      { key: 'strike_hardness', label: 'mallet', min: 0, max: 1, step: 0.01, value: 0.5, hint: 'Struck, not stroked.' },
    ],
    inputs: [{ kind: 'keys', pin: null, label: 'KEYBOARD', hint: 'On a board this is USB MIDI in. Here it is these keys.' }],
    indicators: [],
    outputs: OUTPUTS_ALL,
    boards: ALL_BOARDS,
    voice: 'inst-glass',
  },
  {
    id: 'clarinet',
    group: 'instruments',
    folder: '20_Instruments',
    title: 'CLARINET',
    blurb: 'A waveguide driven continuously by a reed, rather than struck once. That is why it holds a note instead of decaying.',
    parityRow: 'tube',
    parityRelRms: 1.7e-3,
    headerSource: clarinet_h,
    inoSource: instruments_ino,
    headerName: 'clarinet.h',
    params: [
      { key: 'breath', label: 'breath', min: 0.3, max: 1, step: 0.01, value: 0.82, hint: 'Not a volume. Too little and the reed never starts; too much and it slams.' },
      { key: 'noise', label: 'air', min: 0, max: 0.5, step: 0.01, value: 0.09, hint: 'The air you hear around the tone.' },
      { key: 'glide', label: 'glide', min: 0, max: 0.3, step: 0.005, value: 0.02, unit: 's', hint: 'How long a slur between two notes takes.' },
    ],
    inputs: [{ kind: 'keys', pin: null, label: 'KEYBOARD', hint: 'Monophonic, as the instrument is.' }],
    indicators: [],
    outputs: OUTPUTS_ALL,
    boards: ALL_BOARDS,
    voice: 'inst-clarinet',
  },
  {
    id: 'choir',
    group: 'instruments',
    folder: '20_Instruments',
    title: 'VOWEL CHOIR',
    blurb: 'Formants: which frequency bands are loud, staying put as the pitch moves. That is what makes an "ah" an "ah".',
    parityRow: 'formant',
    parityRelRms: 1.39e-5,
    headerSource: choir_h,
    inoSource: instruments_ino,
    headerName: 'choir.h',
    params: [
      { key: 'vowel', label: 'vowel', min: 0, max: 4, step: 0.01, value: 0.6, hint: 'Morphs a to e to i to o to u. Frequency interpolates in the log domain.' },
      { key: 'breath', label: 'breath', min: 0, max: 0.6, step: 0.01, value: 0.14, hint: 'Noise in the source, before the formants.' },
      { key: 'vibrato_depth', label: 'vibrato', min: 0, max: 1, step: 0.01, value: 0.3, hint: 'What stops it sounding like a machine.' },
    ],
    inputs: [{ kind: 'keys', pin: null, label: 'KEYBOARD', hint: 'On a board this is USB MIDI in. Here it is these keys.' }],
    indicators: [],
    outputs: OUTPUTS_ALL,
    boards: ALL_BOARDS,
    voice: 'inst-choir',
  },
  {
    id: 'eightoheight',
    group: 'instruments',
    folder: '20_Instruments',
    title: 'LONG KICK KIT',
    blurb: 'The analogue kit, and one number: a kick that rings for over a second and spends most of it below 60 Hz.',
    parityRow: 'kick',
    parityRelRms: 9.79e-5,
    headerSource: eightoheight_h,
    inoSource: instruments_ino,
    headerName: 'eightoheight.h',
    params: [
      { key: 'decay', owner: 'k', label: 'kick decay', min: 0.1, max: 2, step: 0.01, value: 1.1, unit: 's', hint: 'The whole argument of this patch. 0.4 is an ordinary kick.' },
      { key: 'pitch_decay', owner: 'k', label: 'pitch drop', min: 0.005, max: 0.3, step: 0.005, value: 0.045, unit: 's', hint: 'How fast the head detunes. Short values give the click.' },
      { key: 'drive', owner: 'k', label: 'drive', min: 0.5, max: 8, step: 0.1, value: 2.6, hint: 'How hard the body is pushed into the tanh.' },
      { key: 'tone', owner: 's', label: 'snare tone', min: 0, max: 1, step: 0.01, value: 0.36, hint: 'Balance between the shells and the noise.' },
    ],
    inputs: [],
    indicators: [],
    outputs: OUTPUTS_ALL,
    boards: ALL_BOARDS,
    voice: 'inst-808',
  },

  /* ---------------------------------------------------------------- *
   * 21_Presets. The other half of 20_Instruments: eleven patches
   * written out by hand there, and here the whole 50 row preset table
   * played through one shell.
   *
   * The choice list below is built FROM the library rather than typed
   * out, so it cannot drift from what the browser will actually load,
   * and the same table is what the C++ side compiles: every value in
   * bellows/presets/instruments.h is diffed against this array by
   * `npm run presets:check`, 1054 of them. So the labels here and the
   * sounds on the board come from one source.
   * ---------------------------------------------------------------- */
  {
    id: 'presets',
    group: 'instruments',
    folder: '21_Presets',
    title: 'THE PRESET TABLE',
    blurb: 'All 50 instruments from the preset library, each playing the same four bars, so what changes between them is the instrument and nothing else.',
    /* Eleven engines, so no single parity row describes it. Each preset
     * inherits the row of the engine it names, which the panel shows
     * for the individual instruments above. */
    parityRow: null,
    parityRelRms: null,
    headerSource: presets_h,
    inoSource: presets_ino,
    headerName: 'presets.h',
    params: [],
    choices: INSTRUMENT_PRESETS.map((pre, i) => ({ value: i, label: pre.label })),
    inputs: [],
    indicators: [],
    outputs: OUTPUTS_ALL,
    /* Measured, not assumed: ./build-matrix.sh 21_Presets refuses the
     * link on LC, 3.2, 3.5 and 3.6 with `region RAM overflowed`. Eleven
     * voice pools plus a plate tank is 251 KB, and a 3.6 has 256 KB
     * total. */
    boards: ['teensy40', 'teensy41', 'teensymm'],
    voice: 'presets',
  },
];


/**
 * The picker's groups, in reading order.
 *
 * Twenty-five flat entries is a list you scroll rather than read, and the
 * groups are a real distinction: four rungs of primitives, four programs
 * that teach one idea each, one that puts them together, eleven patches
 * sharing a note source plus the whole preset table, and four about
 * getting sound off the board.
 *
 * The order is written down rather than taken from the array, because the
 * order to READ them in is not the order the examples are numbered in: 06
 * is the rung below 01, and 20 is a library rather than a lesson. Order
 * within a group stays as FIRMWARES has it.
 *
 * It lives here rather than in the view because it is catalogue data and
 * because a `group` that is not in this list is dropped from the picker
 * with no error of any kind. `npm run check:catalogue` is what makes that
 * loud; it could not import this while it was a const inside a .vue file.
 */
export const GROUP_ORDER = [
  'first steps',
  'learn the library',
  'the whole thing',
  'instruments',
  'getting sound out',
];

export const FIRMWARE_BY_ID = new Map(FIRMWARES.map((f) => [f.id, f]));

/**
 * Rewrite the example's parameter block with the current values, producing
 * C++ that compiles.
 *
 * The examples all set their parameters the same way, `p.<field> = <n>f;`,
 * so a line-wise substitution is enough and is far more honest than
 * generating a new file: what comes out is the example, with the numbers
 * changed, and every comment the author wrote still in place.
 *
 * Returns the source unchanged for any field it cannot find, which is why
 * the export panel shows a diff count: zero replacements means the shape of
 * the example moved and this needs looking at.
 */
export function applyParams(source: string, params: FirmwareParam[]): { text: string; applied: number } {
  let applied = 0;
  let text = source;
  for (const p of params) {
    /* `p.decay = 0.55f;` with any leading whitespace and any current value.
     * When the param names its owner, bind to that object only. */
    const obj = p.owner ? p.owner.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : '\\w+';
    const re = new RegExp(`(\\b${obj}\\.${p.key}\\s*=\\s*)(-?[0-9]*\\.?[0-9]+)f?(\\s*;)`, 'g');
    const next = text.replace(re, (_m, head: string, _old: string, tail: string) => {
      applied++;
      return `${head}${formatFloat(p.value)}f${tail}`;
    });
    text = next;
  }
  return { text, applied };
}

/** C++ float literal: always a decimal point, never exponent notation. */
function formatFloat(v: number): string {
  if (Number.isInteger(v)) return `${v}.0`;
  return String(Number(v.toFixed(4)));
}
