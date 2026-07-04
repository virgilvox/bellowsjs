/*
 * Scala tuning file formats. parseScl reads .scl scale files, parseKbm
 * reads .kbm keyboard mappings, tuningFromScala combines them into a
 * Tuning. Reference: the format descriptions shipped with Scala
 * (huygens-fokker.org/scala/scl_format.html).
 *
 * .scl lines starting with '!' are comments. The first non-comment line
 * is the description (it may be blank). The next line is the note count,
 * then one pitch per line: a value containing a period is cents, anything
 * else is a ratio ("3/2") or an integer ("2" meaning 2/1). Text after the
 * value on a pitch line is ignored. The implicit first degree 1/1 is not
 * listed; the last listed pitch is the period.
 */

import { Tuning } from './tuning';

export interface SclFile {
  description: string;
  /** Listed pitches evaluated to cents. notes[size - 1] is the period. */
  notes: number[];
  /** Number of listed pitches (notes per period, counting the period). */
  size: number;
}

export interface KbmFile {
  /** Keys per mapping repeat. 0 means linear mapping. */
  mapSize: number;
  firstNote: number;
  lastNote: number;
  /** Key mapped to scale degree 0. */
  middleNote: number;
  /** Key that sounds refFreq. */
  refNote: number;
  refFreq: number;
  /** Scale degrees spanned by one mapping repeat (the formal octave). */
  octaveDegree: number;
  /** mapSize entries of scale degrees; null for unmapped keys. */
  mapping: (number | null)[];
}

function isComment(line: string): boolean {
  return line.trimStart().startsWith('!');
}

/** Line reader that skips comments and blank lines. */
class LineReader {
  private readonly lines: string[];
  private i = 0;

  constructor(text: string) {
    this.lines = text.split(/\r?\n/);
  }

  /** Next raw non-comment line, blank allowed. Used for the description. */
  nextRaw(what: string): string {
    while (this.i < this.lines.length) {
      const line = this.lines[this.i++];
      if (isComment(line)) continue;
      return line;
    }
    throw new Error(`unexpected end of file, expected ${what}`);
  }

  /** Next non-comment, non-blank line, trimmed. */
  next(what: string): string {
    while (this.i < this.lines.length) {
      const line = this.lines[this.i++];
      if (isComment(line) || line.trim() === '') continue;
      return line.trim();
    }
    throw new Error(`unexpected end of file, expected ${what}`);
  }

  /** Like next but returns null at end of file. */
  tryNext(): string | null {
    while (this.i < this.lines.length) {
      const line = this.lines[this.i++];
      if (isComment(line) || line.trim() === '') continue;
      return line.trim();
    }
    return null;
  }
}

function firstToken(line: string): string {
  return line.split(/\s+/)[0];
}

/** Evaluate one .scl pitch line to cents. */
function pitchCents(line: string): number {
  const token = firstToken(line);
  if (token.includes('.')) {
    if (!/^[+-]?(\d+\.\d*|\.\d+)$/.test(token)) {
      throw new Error(`scl: invalid cents value "${line}"`);
    }
    return Number(token);
  }
  const m = /^(\d+)(?:\/(\d+))?$/.exec(token);
  if (!m) throw new Error(`scl: cannot parse pitch "${line}"`);
  const num = Number(m[1]);
  const den = m[2] === undefined ? 1 : Number(m[2]);
  if (num <= 0 || den <= 0) throw new Error(`scl: invalid ratio "${line}"`);
  return 1200 * Math.log2(num / den);
}

export function parseScl(text: string): SclFile {
  const r = new LineReader(text);
  const description = r.nextRaw('description').trim();

  const countLine = r.next('note count');
  const size = Number(firstToken(countLine));
  if (!Number.isInteger(size) || size < 0) {
    throw new Error(`scl: invalid note count "${countLine}"`);
  }

  const notes = new Array<number>(size);
  for (let i = 0; i < size; i++) {
    let line: string;
    try {
      line = r.next('a pitch value');
    } catch {
      throw new Error(`scl: expected ${size} pitches, found ${i}`);
    }
    notes[i] = pitchCents(line);
  }
  return { description, notes, size };
}

function intField(line: string, what: string): number {
  const v = Number(firstToken(line));
  if (!Number.isInteger(v)) throw new Error(`kbm: invalid ${what} "${line}"`);
  return v;
}

export function parseKbm(text: string): KbmFile {
  const r = new LineReader(text);
  const need = (what: string): string => {
    try {
      return r.next(what);
    } catch {
      throw new Error(`kbm: unexpected end of file, expected ${what}`);
    }
  };

  const mapSize = intField(need('map size'), 'map size');
  if (mapSize < 0) throw new Error(`kbm: map size must not be negative, got ${mapSize}`);
  const firstNote = intField(need('first midi note'), 'first midi note');
  const lastNote = intField(need('last midi note'), 'last midi note');
  const middleNote = intField(need('middle note'), 'middle note');
  const refNote = intField(need('reference note'), 'reference note');

  const refLine = need('reference frequency');
  const refFreq = Number(firstToken(refLine));
  if (!Number.isFinite(refFreq) || refFreq <= 0) {
    throw new Error(`kbm: invalid reference frequency "${refLine}"`);
  }

  const octaveDegree = intField(need('octave degree'), 'octave degree');

  // Missing trailing entries mean unmapped keys, per the format spec.
  const mapping = new Array<number | null>(mapSize);
  for (let i = 0; i < mapSize; i++) {
    const line = r.tryNext();
    if (line === null) {
      mapping.fill(null, i);
      break;
    }
    const token = firstToken(line);
    if (token === 'x' || token === 'X') {
      mapping[i] = null;
    } else {
      const deg = Number(token);
      if (!Number.isInteger(deg)) throw new Error(`kbm: invalid mapping entry "${line}"`);
      mapping[i] = deg;
    }
  }

  return { mapSize, firstNote, lastNote, middleNote, refNote, refFreq, octaveDegree, mapping };
}

/**
 * Cents of scale degree d in the periodic extension of an scl scale.
 * Degree 0 is 1/1, degree scl.size is one period up, negatives go down.
 */
function sclDegreeCents(scl: SclFile, d: number): number {
  const s = scl.size;
  const period = scl.notes[s - 1];
  const oct = Math.floor(d / s);
  const rem = d - oct * s;
  return oct * period + (rem === 0 ? 0 : scl.notes[rem - 1]);
}

/**
 * Build a Tuning from an scl scale and an optional kbm mapping. Without a
 * kbm (or with map size 0) the mapping is linear: successive keys step
 * through successive scale degrees, degree 0 on the middle note. Defaults
 * match Scala: middle note 60, reference note 69 at 440 Hz. Unmapped keys
 * produce NaN from freqOf. The kbm key range (firstNote, lastNote) is not
 * enforced.
 */
export function tuningFromScala(scl: SclFile, kbm?: KbmFile): Tuning {
  if (scl.size < 1) throw new Error('scala: scale has no notes');
  if (!(scl.notes[scl.size - 1] > 0)) throw new Error('scala: period must be positive');

  const linear = kbm === undefined || kbm.mapSize === 0;
  const middleNote = kbm ? kbm.middleNote : 60;
  const refNote = kbm ? kbm.refNote : 69;
  const refFreq = kbm ? kbm.refFreq : 440;
  const size = linear ? scl.size : kbm!.mapSize;
  const octaveDegree = linear
    ? kbm && kbm.octaveDegree > 0
      ? kbm.octaveDegree
      : scl.size
    : kbm!.octaveDegree;

  const periodCents = sclDegreeCents(scl, octaveDegree);
  if (!(periodCents > 0)) {
    throw new Error(`scala: formal octave of ${octaveDegree} degrees spans no cents`);
  }

  const degreeCents = new Array<number>(size);
  for (let i = 0; i < size; i++) {
    const deg = linear ? i : kbm!.mapping[i];
    degreeCents[i] = deg === null ? NaN : sclDegreeCents(scl, deg);
  }

  // Anchor so the reference note sounds refFreq. degreeCents is aligned to
  // the middle note, so find the reference note's cents relative to it.
  const q = refNote - middleNote;
  const oct = Math.floor(q / size);
  const refRel = oct * periodCents + degreeCents[q - oct * size];
  if (!Number.isFinite(refRel)) {
    throw new Error(`scala: reference note ${refNote} is not mapped`);
  }
  const anchorFreq = refFreq * Math.pow(2, -refRel / 1200);

  return Tuning.fromCents(degreeCents, periodCents, anchorFreq, middleNote);
}
