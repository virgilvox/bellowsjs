/*
 * The firmware catalogue for the simulator.
 *
 * Every entry points at a real example in packages/bellows-embedded. The
 * C++ shown on the page comes from sources.gen.ts, which is generated from
 * those files and regenerated and diffed in CI, so the source a visitor
 * reads is the source that compiles to a board and cannot drift from it.
 *
 * WHAT THE SIMULATOR ACTUALLY RUNS, WHICH IS THE HONEST PART
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
 *   - timing. Whether a given board renders this in time is not simulated
 *     and has never been measured on hardware for any board.
 *   - the .ino. Codec setup, pin configuration and the audio library's
 *     scheduling are not modelled. Only the program logic is.
 */

import {
  onekick_h,
  onekick_ino,
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
} from './sources.gen';

import type { OutputId } from './output-stage';

/** A parameter the simulator exposes, and that export writes back into C++. */
export interface FirmwareParam {
  /** The C++ field name, so codegen can write `p.<key> = <value>f;` */
  key: string;
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
      { key: 'resonance', label: 'resonance', min: 0, max: 0.95, step: 0.01, value: 0.4, hint: 'Ladder feedback. High values self oscillate.' },
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
    folder: '15_Piezo',
    title: 'PIEZO VOICING',
    blurb: 'The same chord through the piezo chain: high pass, resonance lift, hard limit.',
    parityRow: 'pluck',
    parityRelRms: 4.96e-6,
    headerSource: piezo_h,
    inoSource: piezo_ino,
    headerName: 'piezo.h',
    params: [
      { key: 'highpass_hz', label: 'high pass', min: 400, max: 3000, step: 10, value: 1200, unit: 'Hz', hint: 'Everything below this is thrown away.' },
      { key: 'resonance_hz', label: 'resonance', min: 1500, max: 7000, step: 50, value: 4000, unit: 'Hz', hint: "The disc's mechanical resonance. Measure yours." },
      { key: 'resonance_db', label: 'lift', min: 0, max: 15, step: 0.5, value: 8, unit: 'dB', hint: 'How hard to lean on the resonance.' },
    ],
    inputs: [],
    indicators: [],
    outputs: ['piezo', 'mqs', 'pwm'],
    boards: ALL_BOARDS,
    voice: 'chord',
  },
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
    /* `p.decay = 0.55f;` with any leading whitespace and any current value. */
    const re = new RegExp(`(\\b\\w+\\.${p.key}\\s*=\\s*)(-?[0-9]*\\.?[0-9]+)f?(\\s*;)`, 'g');
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
