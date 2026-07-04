/*
 * SFZ instrument definition parser. Covers the opcode subset that real
 * free libraries use (Salamander piano, VSCO style mappings): the
 * header hierarchy control/global/master/group/region with inheritance,
 * #include via a caller-provided resolver, #define variable
 * substitution, note names, and per-spec defaults (key sets lokey,
 * hikey, and pitch_keycenter).
 *
 * Parsing and data modeling only: the sampler engine that plays regions
 * lives elsewhere. Sample paths are prefixed with default_path and
 * normalized to forward slashes but never loaded here. Unknown opcodes
 * are kept verbatim in region.other so nothing is lost.
 */

export type SfzLoopMode = 'no_loop' | 'one_shot' | 'loop_continuous' | 'loop_sustain';

/** Amplitude envelope opcodes, all times in seconds, sustain in percent. */
export interface SfzEnvelope {
  delay: number;
  attack: number;
  hold: number;
  decay: number;
  /** Percent of peak, 0..100. */
  sustain: number;
  release: number;
}

/**
 * One region with all header inheritance applied
 * (control > global > master > group > region, region-most wins).
 */
export interface SfzRegion {
  /** Sample path with default_path applied, forward slashes. */
  sample: string;
  lokey: number;
  hikey: number;
  pitchKeycenter: number;
  lovel: number;
  hivel: number;
  /** null when unspecified: the sampler decides from the sample's own loop data. */
  loopMode: SfzLoopMode | null;
  loopStart: number | null;
  loopEnd: number | null;
  /** Playback start offset in frames. */
  offset: number;
  /** Cents. */
  tune: number;
  /** Semitones. */
  transpose: number;
  /** dB. */
  volume: number;
  /** -100 full left to 100 full right. */
  pan: number;
  /** Percent of amplitude tracked from velocity, default 100. */
  ampVeltrack: number;
  ampeg: SfzEnvelope;
  /** Round robin sequence length and this region's 1-based slot. */
  seqLength: number;
  seqPosition: number;
  /** Random layer bounds in [0, 1]. */
  lorand: number;
  hirand: number;
  /** Voice muting group this region belongs to, 0 for none. */
  group: number;
  /** Group whose new voices cut this region's voices, 0 for none. */
  offBy: number;
  /* Keyswitch opcodes are parsed but not interpreted by the sampler yet. */
  swLokey: number | null;
  swHikey: number | null;
  swLast: number | null;
  swDown: number | null;
  swUp: number | null;
  swDefault: number | null;
  /** Opcodes this parser does not interpret, verbatim. */
  other: Record<string, string>;
}

export interface SfzFile {
  regions: SfzRegion[];
}

export type IncludeResolver = (path: string) => string | Promise<string>;

export interface SfzParseOptions {
  /** Called for each #include directive with the quoted path. */
  resolveInclude?: IncludeResolver;
  /** Include nesting limit, default 16. */
  maxIncludeDepth?: number;
}

export async function parseSfz(text: string, opts: SfzParseOptions = {}): Promise<SfzFile> {
  const parser = new SfzParser(opts);
  await parser.feed(text, 0);
  parser.endOfInput();
  return { regions: parser.regions };
}

const LOOP_MODES: ReadonlySet<string> = new Set([
  'no_loop',
  'one_shot',
  'loop_continuous',
  'loop_sustain',
]);

const NOTE_SEMITONES: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

/**
 * An SFZ note value: a MIDI number or a note name like c4, f#3, eb2,
 * with middle C c4 = 60. Returns null when unparseable.
 */
export function sfzNoteValue(value: string): number | null {
  if (/^-?\d+$/.test(value)) return parseInt(value, 10);
  const m = /^([a-g])(#|b)?(-?\d+)$/.exec(value.toLowerCase());
  if (!m) return null;
  const acc = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  return (parseInt(m[3], 10) + 1) * 12 + NOTE_SEMITONES[m[1]] + acc;
}

function noteOf(name: string, value: string): number {
  const v = sfzNoteValue(value);
  if (v === null) throw new Error(`sfz: invalid note value "${value}" for ${name}`);
  return v;
}

function numOf(name: string, value: string): number {
  const v = Number(value);
  if (value === '' || !Number.isFinite(v)) {
    throw new Error(`sfz: invalid numeric value "${value}" for ${name}`);
  }
  return v;
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/');
}

function stripComment(line: string): string {
  const i = line.indexOf('//');
  return i < 0 ? line : line.slice(0, i);
}

function buildRegion(merged: Map<string, string>, defaultPath: string): SfzRegion | null {
  const sampleRaw = merged.get('sample');
  /* A region with no sample cannot play; drop it like samplers do. */
  if (sampleRaw === undefined || sampleRaw === '') return null;

  const r: SfzRegion = {
    sample: normalizePath(defaultPath + sampleRaw),
    lokey: 0,
    hikey: 127,
    pitchKeycenter: 60,
    lovel: 0,
    hivel: 127,
    loopMode: null,
    loopStart: null,
    loopEnd: null,
    offset: 0,
    tune: 0,
    transpose: 0,
    volume: 0,
    pan: 0,
    ampVeltrack: 100,
    ampeg: { delay: 0, attack: 0, hold: 0, decay: 0, sustain: 100, release: 0 },
    seqLength: 1,
    seqPosition: 1,
    lorand: 0,
    hirand: 1,
    group: 0,
    offBy: 0,
    swLokey: null,
    swHikey: null,
    swLast: null,
    swDown: null,
    swUp: null,
    swDefault: null,
    other: {},
  };

  /* key applies first so explicit lokey/hikey/pitch_keycenter can override it. */
  const key = merged.get('key');
  if (key !== undefined) {
    const k = noteOf('key', key);
    r.lokey = k;
    r.hikey = k;
    r.pitchKeycenter = k;
  }

  for (const [name, value] of merged) {
    switch (name) {
      case 'sample':
      case 'key':
        break;
      case 'lokey':
        r.lokey = noteOf(name, value);
        break;
      case 'hikey':
        r.hikey = noteOf(name, value);
        break;
      case 'pitch_keycenter':
        r.pitchKeycenter = noteOf(name, value);
        break;
      case 'lovel':
        r.lovel = numOf(name, value);
        break;
      case 'hivel':
        r.hivel = numOf(name, value);
        break;
      case 'loop_mode':
      case 'loopmode':
        if (!LOOP_MODES.has(value)) throw new Error(`sfz: unknown loop_mode "${value}"`);
        r.loopMode = value as SfzLoopMode;
        break;
      case 'loop_start':
      case 'loopstart':
        r.loopStart = numOf(name, value);
        break;
      case 'loop_end':
      case 'loopend':
        r.loopEnd = numOf(name, value);
        break;
      case 'offset':
        r.offset = numOf(name, value);
        break;
      case 'tune':
        r.tune = numOf(name, value);
        break;
      case 'transpose':
        r.transpose = numOf(name, value);
        break;
      case 'volume':
        r.volume = numOf(name, value);
        break;
      case 'pan':
        r.pan = numOf(name, value);
        break;
      case 'amp_veltrack':
        r.ampVeltrack = numOf(name, value);
        break;
      case 'ampeg_delay':
        r.ampeg.delay = numOf(name, value);
        break;
      case 'ampeg_attack':
        r.ampeg.attack = numOf(name, value);
        break;
      case 'ampeg_hold':
        r.ampeg.hold = numOf(name, value);
        break;
      case 'ampeg_decay':
        r.ampeg.decay = numOf(name, value);
        break;
      case 'ampeg_sustain':
        r.ampeg.sustain = numOf(name, value);
        break;
      case 'ampeg_release':
        r.ampeg.release = numOf(name, value);
        break;
      case 'seq_length':
        r.seqLength = numOf(name, value);
        break;
      case 'seq_position':
        r.seqPosition = numOf(name, value);
        break;
      case 'lorand':
        r.lorand = numOf(name, value);
        break;
      case 'hirand':
        r.hirand = numOf(name, value);
        break;
      case 'group':
        r.group = numOf(name, value);
        break;
      case 'off_by':
        r.offBy = numOf(name, value);
        break;
      case 'sw_lokey':
        r.swLokey = noteOf(name, value);
        break;
      case 'sw_hikey':
        r.swHikey = noteOf(name, value);
        break;
      case 'sw_last':
        r.swLast = noteOf(name, value);
        break;
      case 'sw_down':
        r.swDown = noteOf(name, value);
        break;
      case 'sw_up':
        r.swUp = noteOf(name, value);
        break;
      case 'sw_default':
        r.swDefault = noteOf(name, value);
        break;
      default:
        r.other[name] = value;
        break;
    }
  }
  return r;
}

class SfzParser {
  readonly regions: SfzRegion[] = [];

  private readonly resolveInclude?: IncludeResolver;
  private readonly maxDepth: number;
  private readonly defines = new Map<string, string>();
  private defaultPath = '';
  private controlScope = new Map<string, string>();
  private globalScope = new Map<string, string>();
  private masterScope = new Map<string, string>();
  private groupScope = new Map<string, string>();
  private pending: Map<string, string> | null = null;
  private pendingDefaultPath = '';
  /** Where opcode assignments currently land. */
  private scope: Map<string, string>;

  constructor(opts: SfzParseOptions) {
    this.resolveInclude = opts.resolveInclude;
    this.maxDepth = opts.maxIncludeDepth ?? 16;
    this.scope = this.globalScope;
  }

  async feed(text: string, depth: number): Promise<void> {
    if (depth > this.maxDepth) throw new Error('sfz: #include nesting too deep');
    for (const rawLine of text.split(/\r?\n/)) {
      const line = stripComment(rawLine);
      if (line.trim() === '') continue;
      const inc = /^\s*#include\s+"([^"]*)"\s*$/.exec(line);
      if (inc) {
        if (!this.resolveInclude) {
          throw new Error(`sfz: #include "${inc[1]}" but no resolver was provided`);
        }
        await this.feed(await this.resolveInclude(inc[1]), depth + 1);
        continue;
      }
      const def = /^\s*#define\s+(\$\w+)\s+(\S+)\s*$/.exec(line);
      if (def) {
        this.defines.set(def[1], this.substitute(def[2]));
        continue;
      }
      this.line(this.substitute(line));
    }
  }

  endOfInput(): void {
    this.finalizeRegion();
  }

  private substitute(text: string): string {
    if (this.defines.size === 0 || !text.includes('$')) return text;
    /* Longest names first so $NOTE2 wins over $NOTE. */
    const names = [...this.defines.keys()].sort((a, b) => b.length - a.length);
    let out = text;
    for (const n of names) out = out.split(n).join(this.defines.get(n)!);
    return out;
  }

  /*
   * A line holds headers and opcode=value pairs in any mix. A value runs
   * from its '=' to the start of the next header or opcode, so sample
   * paths with spaces survive.
   */
  private line(text: string): void {
    const tokens = [...text.matchAll(/<([^>]*)>|([\w$]+)=/g)];
    for (let i = 0; i < tokens.length; i++) {
      const m = tokens[i];
      if (m[1] !== undefined) {
        this.header(m[1].trim().toLowerCase());
        continue;
      }
      const from = m.index! + m[0].length;
      const to = i + 1 < tokens.length ? tokens[i + 1].index! : text.length;
      this.opcode(m[2].toLowerCase(), text.slice(from, to).trim());
    }
  }

  private header(name: string): void {
    this.finalizeRegion();
    switch (name) {
      case 'control':
        this.scope = this.controlScope;
        break;
      case 'global':
        this.globalScope = new Map();
        this.masterScope = new Map();
        this.groupScope = new Map();
        this.scope = this.globalScope;
        break;
      case 'master':
        this.masterScope = new Map();
        this.groupScope = new Map();
        this.scope = this.masterScope;
        break;
      case 'group':
        this.groupScope = new Map();
        this.scope = this.groupScope;
        break;
      case 'region':
        this.pending = new Map();
        this.pendingDefaultPath = this.defaultPath;
        this.scope = this.pending;
        break;
      default:
        /* curve, effect, and unknown headers: parsed, contents discarded. */
        this.scope = new Map();
        break;
    }
  }

  private opcode(name: string, value: string): void {
    if (name === 'default_path') {
      this.defaultPath = normalizePath(value);
      return;
    }
    this.scope.set(name, value);
  }

  private finalizeRegion(): void {
    if (!this.pending) return;
    const merged = new Map([
      ...this.globalScope,
      ...this.masterScope,
      ...this.groupScope,
      ...this.pending,
    ]);
    this.pending = null;
    const region = buildRegion(merged, this.pendingDefaultPath);
    if (region) this.regions.push(region);
  }
}
