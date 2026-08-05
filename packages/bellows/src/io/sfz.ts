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
  /**
   * Characters a line or a #define value may grow to once substituted,
   * default 65536. See DEFAULT_MAX_EXPANDED_LENGTH.
   */
  maxExpandedLength?: number;
  /**
   * Characters of substituted output produced across the whole parse,
   * default 16777216 (16 MiB). See DEFAULT_MAX_TOTAL_EXPANDED.
   */
  maxTotalExpanded?: number;
  /** Most #define directives accepted, default 1024. */
  maxDefines?: number;
  /** Most #include directives resolved across the whole parse, default 1024. */
  maxIncludes?: number;
  /**
   * Total characters of source parsed, counting every resolved #include,
   * default 8388608 (8 MiB).
   */
  maxTotalInput?: number;
}

/*
 * Hostile-input bounds. This parser is the only part of the library that
 * reads untrusted data, and in a browser its input is a user-chosen file or
 * a fetched URL, so both of its expansion steps need a ceiling.
 *
 * #define substitution is eager: a define's value is expanded when it is
 * stored, which is what makes nested defines resolve. It also means a chain
 * where each line references the previous one twice doubles the stored text
 * per line, so N lines produce 2^N characters. Measured before this bound
 * existed: 601 bytes of input allocated 537 MB, and 645 bytes threw a bare
 * RangeError('Invalid string length') that no caller catching this parser's
 * own 'sfz: ' errors would recognise.
 *
 * #include has the same shape one step removed. maxIncludeDepth bounds
 * nesting depth but not breadth, so a tree whose every level includes the
 * next one twice never trips it: 575 bytes across 16 files produced 65535
 * resolver calls and 32768 regions with no error. A byte budget alone does
 * not catch that, because 65535 forty-byte files is only 2.6 MB; the
 * amplified quantity is the resolver call, which is caller-supplied and may
 * well be a network fetch, so that is what gets counted.
 *
 * Worst case for the defines map is maxDefines * maxExpandedLength, 64 MiB
 * at the defaults, which takes a deliberately crafted file to approach and
 * is bounded where it was not.
 *
 * maxExpandedLength prices one line at a time and says nothing about how
 * many such lines a parse RETAINS. Every expanded line is a fresh string
 * and region.sample keeps a slice of it alive (a V8 SlicedString retains
 * its whole parent), so the live set scales with input, not with the
 * per-line cap. Measured with --expose-gc, a file of 28-byte lines each
 * expanding to 49175 characters: 10935 B retained 19.0 MB (x1734) and
 * 42295 B retained 74.5 MB (x1761). Amplification is flat, so the 8 MiB
 * maxTotalInput alone permitted roughly 14 GB retained, which OOMs a
 * browser tab. maxTotalExpanded bounds the sum instead.
 *
 * 16 MiB is twice maxTotalInput, so a file may double under substitution
 * and still parse. With the budget in place the same shape peaks at
 * 16.6 MB retained however large the input gets, and a 2.18 MB
 * 20000-region file with no defines charges nothing against it at all.
 */
const DEFAULT_MAX_EXPANDED_LENGTH = 65536;
const DEFAULT_MAX_TOTAL_EXPANDED = 16 * 1024 * 1024;
const DEFAULT_MAX_DEFINES = 1024;
const DEFAULT_MAX_INCLUDES = 1024;
const DEFAULT_MAX_TOTAL_INPUT = 8 * 1024 * 1024;
const DEFAULT_MAX_INCLUDE_DEPTH = 16;

/*
 * Every cap above is useless if a caller can hand it a value no comparison
 * is ever true against. Options routinely arrive from Number(configValue)
 * or parseInt(queryParam) over a malformed field, and '??' substitutes only
 * for null and undefined while 'x > NaN' is always false, so one NaN turned
 * a bound off completely. Measured before this check:
 * parseSfz(defineChain(30), { maxExpandedLength: NaN }) threw
 * RangeError('Invalid string length'), the exact failure the cap exists to
 * prevent, and { maxIncludes: NaN } resolved 65535 includes. Infinity does
 * the same. Zero and negative values already fail closed, so they are left
 * to the caller.
 */
function finiteOption(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
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

/*
 * Non-overlapping left to right, which is what String.split does, so the
 * count matches the split/join that follows it.
 */
function countOccurrences(haystack: string, needle: string): number {
  let n = 0;
  for (let i = haystack.indexOf(needle); i !== -1; i = haystack.indexOf(needle, i + needle.length)) {
    n++;
  }
  return n;
}

/** One '<header>' or one 'opcode=' on a line, in source order. */
type SfzToken =
  /** Text between the angle brackets, verbatim. */
  | { start: number; header: string; name: null; valueFrom: number }
  /** Opcode name, with valueFrom the index just past its '='. */
  | { start: number; header: null; name: string; valueFrom: number };

/** [A-Za-z0-9_$], the character class the opcode and define names use. */
function isNameChar(c: number): boolean {
  return (
    (c >= 97 && c <= 122) || // a-z
    (c >= 65 && c <= 90) || // A-Z
    (c >= 48 && c <= 57) || // 0-9
    c === 95 || // _
    c === 36 // $
  );
}

/*
 * Hand written rather than /<([^>]*)>|([\w$]+)=/g, which this replaces
 * token for token, because that regex backtracks quadratically. Both of
 * its branches are a greedy run followed by a required literal, and when
 * that literal is absent the engine retries the run at every length:
 * measured with parseSfz('x'.repeat(n)), 8 / 27 / 105 / 424 / 1686 ms for
 * n = 2000 / 4000 / 8000 / 16000 / 32000, exactly 4x per doubling, and
 * 1517 ms for '<'.repeat(32000). Real files never hit it because '=', '/'
 * and '.' break their word runs, but a #define manufactures the shape for
 * free: a 336-byte file whose single line expands to 32784 characters,
 * 32768 of them one unbroken run, cost 1784 ms, and maxTotalInput admits
 * hundreds of thousands of such lines.
 *
 * This scanner reads every character a bounded number of times. A name run
 * is skipped whole when no '=' follows it, which is what the regex did in
 * effect: a shorter prefix of the run always ends on a name character, so
 * it can never end on the '=' the pattern demands.
 *
 * Verified equivalent against the old regex over the parser's own test
 * inputs plus 200000 random strings drawn from '<>=abZ_$09 /\\.\t-':
 * 200059 inputs, 0 differing token streams.
 */
function tokenizeLine(text: string): SfzToken[] {
  const tokens: SfzToken[] = [];
  const n = text.length;
  /*
   * First '>' at or after the last place we looked, -1 once the line has
   * none left. Carried across iterations so repeated '<' with no closing
   * bracket cannot rescan the tail once per bracket, which would restore
   * the quadratic cost the regex had.
   */
  let gt = text.indexOf('>');
  let i = 0;
  while (i < n) {
    const c = text.charCodeAt(i);
    if (c === 60 /* < */) {
      while (gt !== -1 && gt <= i) gt = text.indexOf('>', gt + 1);
      if (gt !== -1) {
        tokens.push({ start: i, header: text.slice(i + 1, gt), name: null, valueFrom: 0 });
        i = gt + 1;
        continue;
      }
      /* Unclosed '<' is not a token and not a name character either, so
       * the regex skipped past it one position at a time. */
      i++;
      continue;
    }
    if (isNameChar(c)) {
      let j = i + 1;
      while (j < n && isNameChar(text.charCodeAt(j))) j++;
      if (j < n && text.charCodeAt(j) === 61 /* = */) {
        tokens.push({ start: i, header: null, name: text.slice(i, j), valueFrom: j + 1 });
        i = j + 1;
      } else {
        /* Stop at j, not past it: text[j] may be a '<' that opens a header. */
        i = j;
      }
      continue;
    }
    i++;
  }
  return tokens;
}

class SfzParser {
  readonly regions: SfzRegion[] = [];

  private readonly resolveInclude?: IncludeResolver;
  private readonly maxDepth: number;
  private readonly maxExpandedLength: number;
  private readonly maxTotalExpanded: number;
  private readonly maxDefines: number;
  private readonly maxIncludes: number;
  private readonly maxTotalInput: number;
  private totalInput = 0;
  private totalExpanded = 0;
  private includeCount = 0;
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
    this.maxDepth = finiteOption(opts.maxIncludeDepth, DEFAULT_MAX_INCLUDE_DEPTH);
    this.maxExpandedLength = finiteOption(opts.maxExpandedLength, DEFAULT_MAX_EXPANDED_LENGTH);
    this.maxTotalExpanded = finiteOption(opts.maxTotalExpanded, DEFAULT_MAX_TOTAL_EXPANDED);
    this.maxDefines = finiteOption(opts.maxDefines, DEFAULT_MAX_DEFINES);
    this.maxIncludes = finiteOption(opts.maxIncludes, DEFAULT_MAX_INCLUDES);
    this.maxTotalInput = finiteOption(opts.maxTotalInput, DEFAULT_MAX_TOTAL_INPUT);
    this.scope = this.globalScope;
  }

  async feed(text: string, depth: number): Promise<void> {
    if (depth > this.maxDepth) throw new Error('sfz: #include nesting too deep');
    /* Bytes, counted across resolved includes as well as the top-level text,
     * so a small include tree cannot pull in an unbounded amount of source. */
    this.totalInput += text.length;
    if (this.totalInput > this.maxTotalInput) {
      throw new Error(`sfz: total input exceeds ${this.maxTotalInput} characters`);
    }
    /* CR, LF and CRLF all end a line. SFZ libraries authored on classic Mac
     * tooling are CR delimited, and a splitter that only knew \r?\n turned
     * such a file into one line of the whole input, which is both wrong and
     * the worst case for the line scanner. */
    for (const rawLine of text.split(/\r\n?|\n/)) {
      const line = stripComment(rawLine);
      if (line.trim() === '') continue;
      const inc = /^\s*#include\s+"([^"]*)"\s*$/.exec(line);
      if (inc) {
        if (!this.resolveInclude) {
          throw new Error(`sfz: #include "${inc[1]}" but no resolver was provided`);
        }
        /* Counted before the resolver runs, so a hostile tree cannot spend
         * one more fetch than the budget allows. */
        if (++this.includeCount > this.maxIncludes) {
          throw new Error(`sfz: more than ${this.maxIncludes} #include directives`);
        }
        await this.feed(await this.resolveInclude(inc[1]), depth + 1);
        continue;
      }
      const def = /^\s*#define\s+(\$\w+)\s+(\S+)\s*$/.exec(line);
      if (def) {
        if (!this.defines.has(def[1]) && this.defines.size >= this.maxDefines) {
          throw new Error(`sfz: more than ${this.maxDefines} #define directives`);
        }
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
    let expanded = false;
    for (const n of names) {
      const value = this.defines.get(n)!;
      /*
       * Price each expansion before building it. Checking the result
       * afterwards would mean allocating the very string the cap exists to
       * prevent, which past V8's limit throws a RangeError this parser does
       * not own.
       */
      const hits = countOccurrences(out, n);
      if (hits === 0) continue;
      const grown = out.length + hits * (value.length - n.length);
      if (grown > this.maxExpandedLength) {
        throw new Error(
          `sfz: #define expansion of ${n} exceeds ${this.maxExpandedLength} characters`,
        );
      }
      out = out.split(n).join(value);
      expanded = true;
    }
    /*
     * Charged after the loop, not per name, so a line touched by several
     * defines is counted once. Safe to charge on the finished string
     * because the per-line cap above already refused to build anything
     * longer than maxExpandedLength. Lines that contain a '$' but match no
     * define name are not charged: they allocate nothing new.
     */
    if (expanded) {
      this.totalExpanded += out.length;
      if (this.totalExpanded > this.maxTotalExpanded) {
        throw new Error(
          `sfz: #define expansion totals more than ${this.maxTotalExpanded} characters`,
        );
      }
    }
    return out;
  }

  /*
   * A line holds headers and opcode=value pairs in any mix. A value runs
   * from its '=' to the start of the next token, so sample paths with
   * spaces survive.
   */
  private line(text: string): void {
    const tokens = tokenizeLine(text);
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (t.header !== null) {
        this.header(t.header.trim().toLowerCase());
        continue;
      }
      const to = i + 1 < tokens.length ? tokens[i + 1].start : text.length;
      this.opcode(t.name.toLowerCase(), text.slice(t.valueFrom, to).trim());
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
