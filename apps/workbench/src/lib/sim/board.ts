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

/* ------------------------------------------------------------------ *
 * Wiring
 *
 * The exact connections for one output path on one board, derived from
 * the same fields `outputPins` reads, so the drawing and the text cannot
 * disagree. If a pin moves in the table above, both move together.
 *
 * Everything here is from the Teensy Audio Library's own pin assignments
 * and the examples in packages/bellows-embedded, not from guesswork. The
 * pins are not a choice: the audio library owns them.
 * ------------------------------------------------------------------ */

export interface WiringRow {
  /** The Teensy side. */
  from: string;
  /** What it connects to. */
  to: string;
}

export interface Wiring {
  /** What you need besides the board. */
  parts: string;
  rows: WiringRow[];
  /** The one mistake that costs an evening, or null. */
  gotcha: string | null;
}

const DAC_LABEL: Record<string, string> = {
  teensy32: 'A14',
  teensy35: 'A21 (left), A22 (right)',
  teensy36: 'A21 (left), A22 (right)',
};

/** Exact wiring for an output path on a board, or null if unavailable. */
export function wiringFor(board: Board, output: string): Wiring | null {
  const i2s = board.i2s;
  switch (output) {
    case 'shield':
      if (!i2s) return null;
      return {
        parts: 'Teensy Audio Shield (Rev D), headers soldered',
        rows: [
          { from: 'stack the shield on the board', to: 'no loose wires at all' },
          { from: `pins ${i2s.data}, ${i2s.bclk}, ${i2s.lrclk}`, to: 'I2S to the SGTL5000, used by the shield' },
          { from: 'pins 18, 19', to: 'I2C control, used by the shield' },
          { from: 'headphones', to: 'the shield jack' },
        ],
        gotcha:
          'The shield also claims pins 6, 7, 9, 10, 11, 12, 13, 15, 18, 19, 20, 21, 22 and 23 for SD and memory. Check before you use one for anything else.',
      };

    case 'i2s-dac':
      if (!i2s) return null;
      return {
        parts: 'PCM5102A or UDA1334A breakout, and something to plug into',
        rows: [
          { from: `pin ${i2s.data}`, to: 'DIN / DATA' },
          { from: `pin ${i2s.bclk}`, to: 'BCK / BCLK / SCK' },
          { from: `pin ${i2s.lrclk}`, to: 'LRCK / LRC / WS' },
          { from: '3.3V', to: 'VIN' },
          { from: 'GND', to: 'GND' },
          { from: 'line out on the breakout', to: 'amplifier or powered speakers' },
        ],
        gotcha:
          'A line-level DAC draws almost nothing, so 3.3V is fine here. An amplifier breakout is a different question: see I2S AMP.',
      };

    case 'i2s-amp':
      if (!i2s) return null;
      return {
        parts: 'MAX98357A breakout and a speaker (4 or 8 ohm)',
        rows: [
          { from: `pin ${i2s.data}`, to: 'DIN' },
          { from: `pin ${i2s.bclk}`, to: 'BCLK' },
          { from: `pin ${i2s.lrclk}`, to: 'LRC' },
          { from: '5V (the VIN pin)', to: 'VIN' },
          { from: 'GND', to: 'GND' },
          { from: 'nothing', to: 'SD and GAIN, both left floating' },
          { from: 'speaker', to: 'across + and -' },
        ],
        gotcha:
          'Power it from 5V, not the 3.3V regulator. A 3W amp browning that out looks like the audio glitching on loud notes rather than like a power problem. The speaker goes across + and -, never one side to ground.',
      };

    case 'dac12': {
      const pins = board.dac;
      if (!pins || pins.length === 0) return null;
      const label = DAC_LABEL[board.id] ?? pins.map((p) => `pin ${p}`).join(', ');
      return {
        parts: 'one 10uF capacitor per channel',
        rows: [
          { from: label, to: '+ side of a 10uF capacitor' },
          { from: '- side of the capacitor', to: 'amplifier or powered speaker input' },
          { from: 'GND', to: 'amplifier ground' },
        ],
        gotcha:
          'The capacitor is not optional. The DAC idles at half its reference, so a direct connection puts about 1.6 V of DC into whatever you plugged in.',
      };
    }

    case 'mqs':
    case 'pwm': {
      const pins = board.mqs ?? board.pwm;
      const [l, r] = pins;
      const isMqs = board.mqs !== null;
      return {
        parts: '2 resistors (470R) and 2 capacitors (100nF) per channel',
        rows: [
          { from: `pin ${l} (left), pin ${r} (right)`, to: isMqs ? 'MQS out' : 'PWM out' },
          { from: 'each pin', to: '470R, then 100nF to GND' },
          { from: 'after the first section', to: 'another 470R, then 100nF to GND' },
          { from: 'the far end', to: 'headphones or an amplifier input' },
          { from: 'GND', to: 'amplifier ground' },
        ],
        gotcha:
          'Two RC sections, not one. A single 470R/100nF corner sits at 3.4 kHz, inside the audio band and audibly dull, and leaves carrier behind.',
      };
    }

    case 'piezo': {
      const pins = board.mqs ?? board.pwm;
      const [l, r] = pins;
      return {
        parts: 'one piezo disc, and nothing else',
        rows: [
          { from: `pin ${l}`, to: 'one side of the disc' },
          { from: `pin ${r}`, to: 'the other side of the disc' },
          { from: 'no resistor, no capacitor', to: 'a piezo is already a capacitor' },
        ],
        gotcha:
          `Across the two pins, not one pin to ground. The firmware sends the signal on pin ${l} and its exact inverse on pin ${r}, so the disc sees 6.6 V peak to peak instead of 3.3. Wiring it to ground works and is 6 dB quieter.`,
      };
    }

    default:
      return null;
  }
}
