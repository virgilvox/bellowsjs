/*
 * The boards, and enough of their pinout to draw one and label it.
 *
 * Only what the simulator needs: the pins the examples touch, the pins each
 * output path uses, and the flash and RAM figures so the page can say why a
 * Teensy LC is not a board to plan a synth around. Full pinouts belong to
 * PJRC and are not reproduced here.
 *
 * The `builds` figures come from examples/build-matrix.sh, which compiles
 * every example for every board. They are RAM used by the plucked chord
 * example, which is the one all the output examples share.
 */

export type BoardId = 'teensy32' | 'teensy35' | 'teensy36' | 'teensy40' | 'teensy41' | 'teensymm';

export interface BoardPin {
  /** Teensy pin number as printed on the board. */
  n: number;
  /** Which side, for the drawing. */
  side: 'left' | 'right';
  /** Row from the top, zero based. */
  row: number;
  label?: string;
}

export interface Board {
  id: BoardId;
  label: string;
  mcu: string;
  /** Cortex core, and whether it has a floating point unit. */
  core: string;
  fpu: boolean;
  clockMhz: number;
  flashKb: number;
  ramKb: number;
  /** Rows of pins down each side. Teensy 4.1 is longer than the rest. */
  rows: number;
  blurb: string;
  /** Pins the audio paths use on this board. */
  i2s: { data: number; bclk: number; lrclk: number } | null;
  dac: number[] | null;
  mqs: number[] | null;
  pwm: number[];
  led: number;
}

const T4_I2S = { data: 7, bclk: 21, lrclk: 20 };
const T3_I2S = { data: 22, bclk: 9, lrclk: 23 };

export const BOARDS: Board[] = [
  {
    id: 'teensy41',
    label: 'TEENSY 4.1',
    mcu: 'i.MX RT1062',
    core: 'Cortex-M7',
    fpu: true,
    clockMhz: 600,
    flashKb: 7936,
    ramKb: 1024,
    rows: 24,
    blurb: 'Runs everything here with room to spare. Takes PSRAM on the underside pads.',
    i2s: T4_I2S,
    dac: null,
    mqs: [10, 12],
    pwm: [6, 9],
    led: 13,
  },
  {
    id: 'teensy40',
    label: 'TEENSY 4.0',
    mcu: 'i.MX RT1062',
    core: 'Cortex-M7',
    fpu: true,
    clockMhz: 600,
    flashKb: 1984,
    ramKb: 1024,
    rows: 14,
    blurb: 'The same part as the 4.1 in a shorter board. No DAC, like every 4.x.',
    i2s: T4_I2S,
    dac: null,
    mqs: [10, 12],
    pwm: [6, 9],
    led: 13,
  },
  {
    id: 'teensymm',
    label: 'TEENSY MICROMOD',
    mcu: 'i.MX RT1062',
    core: 'Cortex-M7',
    fpu: true,
    clockMhz: 600,
    flashKb: 15872,
    ramKb: 1024,
    rows: 14,
    blurb: 'The 4.x part on a MicroMod carrier. Same audio paths as a 4.0.',
    i2s: T4_I2S,
    dac: null,
    mqs: [10, 12],
    pwm: [6, 9],
    led: 13,
  },
  {
    id: 'teensy36',
    label: 'TEENSY 3.6',
    mcu: 'MK66FX1M0',
    core: 'Cortex-M4F',
    fpu: true,
    clockMhz: 180,
    flashKb: 1024,
    ramKb: 256,
    rows: 24,
    blurb: 'Has a floating point unit and two DAC pins. Every example builds.',
    i2s: T3_I2S,
    dac: [66, 67],
    mqs: null,
    pwm: [6, 9],
    led: 13,
  },
  {
    id: 'teensy35',
    label: 'TEENSY 3.5',
    mcu: 'MK64FX512',
    core: 'Cortex-M4F',
    fpu: true,
    clockMhz: 120,
    flashKb: 512,
    ramKb: 256,
    rows: 24,
    blurb: 'Like the 3.6 at two thirds the clock. Every example builds.',
    i2s: T3_I2S,
    dac: [66, 67],
    mqs: null,
    pwm: [6, 9],
    led: 13,
  },
  {
    id: 'teensy32',
    label: 'TEENSY 3.2',
    mcu: 'MK20DX256',
    core: 'Cortex-M4',
    fpu: false,
    clockMhz: 72,
    flashKb: 256,
    ramKb: 64,
    rows: 14,
    blurb:
      'No floating point unit, so every float operation is emulated in software. Everything builds; whether it keeps up is unmeasured.',
    i2s: T3_I2S,
    dac: [14],
    mqs: null,
    pwm: [6, 9],
    led: 13,
  },
];

export const BOARD_BY_ID = new Map(BOARDS.map((b) => [b.id, b]));

/** Pins in use for a given output path on a given board, for highlighting. */
export function outputPins(board: Board, output: string): number[] {
  switch (output) {
    case 'shield':
    case 'i2s-dac':
    case 'i2s-amp':
      return board.i2s ? [board.i2s.data, board.i2s.bclk, board.i2s.lrclk] : [];
    case 'dac12':
      return board.dac ?? [];
    case 'mqs':
      return board.mqs ?? [];
    case 'pwm':
    case 'piezo':
      return board.mqs ?? board.pwm;
    default:
      return [];
  }
}
