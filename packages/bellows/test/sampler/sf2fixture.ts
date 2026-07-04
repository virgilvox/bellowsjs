/*
 * Byte-level SF2 fixture builders. Assembles small valid SoundFont
 * files from raw RIFF pieces so the bridge tests control every field.
 * Copied from test/soundfont/sf2fixture.ts (tests do not import across
 * suite directories), with a stereo-pair builder added at the end.
 */

export function ascii(s: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) out.push(s.charCodeAt(i) & 0xff);
  return out;
}

export function u16(v: number): number[] {
  return [v & 0xff, (v >>> 8) & 0xff];
}

export function u32(v: number): number[] {
  return [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
}

export function fixedStr(s: string, len: number): number[] {
  const out = new Array<number>(len).fill(0);
  for (let i = 0; i < Math.min(s.length, len); i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

/** RIFF sub-chunk: id, size, body, pad byte if the body length is odd. */
export function chunk(id: string, body: number[]): number[] {
  const out = [...ascii(id), ...u32(body.length), ...body];
  if (body.length % 2) out.push(0);
  return out;
}

export function list(type: string, body: number[]): number[] {
  return chunk('LIST', [...ascii(type), ...body]);
}

export function riff(form: string, body: number[]): ArrayBuffer {
  const inner = [...ascii(form), ...body];
  const all = [...ascii('RIFF'), ...u32(inner.length), ...inner];
  return new Uint8Array(all).buffer;
}

export const gen = (op: number, amount: number): number[] => [...u16(op), ...u16(amount & 0xffff)];

/** Pack a keyRange/velRange amount: low byte lo, high byte hi. */
export const rangeAmt = (lo: number, hi: number): number => (lo & 0xff) | ((hi & 0xff) << 8);

export const bag = (genNdx: number, modNdx: number): number[] => [...u16(genNdx), ...u16(modNdx)];

export const modTerminal = (): number[] => new Array<number>(10).fill(0);

export const phdrRec = (name: string, program: number, bank: number, bagNdx: number): number[] => [
  ...fixedStr(name, 20),
  ...u16(program),
  ...u16(bank),
  ...u16(bagNdx),
  ...u32(0),
  ...u32(0),
  ...u32(0),
];

export const instRec = (name: string, bagNdx: number): number[] => [
  ...fixedStr(name, 20),
  ...u16(bagNdx),
];

export const shdrRec = (
  name: string,
  start: number,
  end: number,
  loopStart: number,
  loopEnd: number,
  rate: number,
  pitch: number,
  corr: number,
  link: number,
  type: number,
): number[] => [
  ...fixedStr(name, 20),
  ...u32(start),
  ...u32(end),
  ...u32(loopStart),
  ...u32(loopEnd),
  ...u32(rate),
  pitch & 0xff,
  corr & 0xff,
  ...u16(link),
  ...u16(type),
];

export function samples16(vals: number[]): number[] {
  const out: number[] = [];
  for (const v of vals) out.push(...u16(v & 0xffff));
  return out;
}

/** One cycle of a sine as 16-bit sample values. */
export function sineSamples(n: number, amp = 30000): number[] {
  return Array.from({ length: n }, (_, i) => Math.round(Math.sin((2 * Math.PI * i) / n) * amp));
}

export function infoList(name: string, major = 2, minor = 4): number[] {
  return list('INFO', [
    ...chunk('ifil', [...u16(major), ...u16(minor)]),
    ...chunk('INAM', [...ascii(name), 0]),
  ]);
}

/*
 * The main fixture: one preset with a global zone and one local zone,
 * one instrument with a global zone and two key-split local zones, one
 * 64-frame sine sample.
 *
 * Preset "TestPreset" bank 0 program 0:
 *   global zone: initialAttenuation 100 cB
 *   local zone: fineTune 25, instrument 0
 * Instrument "TestInst":
 *   global zone: pan 250, releaseVolEnv -3600 tc
 *   zone A: keyRange 0..60, attackVolEnv -1200 tc, overridingRootKey 60,
 *           sampleModes 1, startloopAddrsOffset +2, endloopAddrsOffset -2,
 *           sampleID 0
 *   zone B: keyRange 61..127, velRange 0..100, coarseTune 2, sampleID 0
 * Sample "Sine": frames 0..64, loop 8..56, 44100 Hz, original pitch 69
 */
export function buildTestSf2(): ArrayBuffer {
  const smplBody = samples16(sineSamples(64));

  const phdr = [
    ...phdrRec('TestPreset', 0, 0, 0),
    ...phdrRec('EOP', 0, 0, 2),
  ];
  const pbag = [...bag(0, 0), ...bag(1, 0), ...bag(3, 0)];
  const pmod = modTerminal();
  const pgen = [
    ...gen(48, 100), // preset global: initialAttenuation
    ...gen(52, 25), // preset local: fineTune
    ...gen(41, 0), // preset local: instrument 0 (zone terminator)
    ...gen(0, 0), // terminal record
  ];
  const inst = [...instRec('TestInst', 0), ...instRec('EOI', 3)];
  const ibag = [...bag(0, 0), ...bag(2, 0), ...bag(9, 0), ...bag(13, 0)];
  const imod = modTerminal();
  const igen = [
    // instrument global zone
    ...gen(17, 250), // pan
    ...gen(38, -3600), // releaseVolEnv
    // zone A
    ...gen(43, rangeAmt(0, 60)), // keyRange
    ...gen(34, -1200), // attackVolEnv
    ...gen(58, 60), // overridingRootKey
    ...gen(54, 1), // sampleModes
    ...gen(2, 2), // startloopAddrsOffset
    ...gen(3, -2), // endloopAddrsOffset
    ...gen(53, 0), // sampleID (zone terminator)
    // zone B
    ...gen(43, rangeAmt(61, 127)), // keyRange
    ...gen(44, rangeAmt(0, 100)), // velRange
    ...gen(51, 2), // coarseTune
    ...gen(53, 0), // sampleID
    ...gen(0, 0), // terminal record
  ];
  const shdr = [
    ...shdrRec('Sine', 0, 64, 8, 56, 44100, 69, 0, 0, 1),
    ...shdrRec('EOS', 0, 0, 0, 0, 0, 0, 0, 0, 0),
  ];

  return riff('sfbk', [
    ...infoList('Bellows Test'),
    ...list('sdta', chunk('smpl', smplBody)),
    ...list('pdta', [
      ...chunk('phdr', phdr),
      ...chunk('pbag', pbag),
      ...chunk('pmod', pmod),
      ...chunk('pgen', pgen),
      ...chunk('inst', inst),
      ...chunk('ibag', ibag),
      ...chunk('imod', imod),
      ...chunk('igen', igen),
      ...chunk('shdr', shdr),
    ]),
  ]);
}

/**
 * Minimal file: one preset, one instrument, one full-range zone playing
 * sample 0. Sample headers and sample bytes come from the caller.
 */
export function buildSimpleSf2(opts: {
  shdrs: number[][];
  smpl: number[];
  sm24?: number[];
}): ArrayBuffer {
  const phdr = [...phdrRec('P', 0, 0, 0), ...phdrRec('EOP', 0, 0, 1)];
  const pbag = [...bag(0, 0), ...bag(1, 0)];
  const pgen = [...gen(41, 0), ...gen(0, 0)];
  const inst = [...instRec('I', 0), ...instRec('EOI', 1)];
  const ibag = [...bag(0, 0), ...bag(1, 0)];
  const igen = [...gen(53, 0), ...gen(0, 0)];
  const shdr = [
    ...opts.shdrs.flat(),
    ...shdrRec('EOS', 0, 0, 0, 0, 0, 0, 0, 0, 0),
  ];

  const sdtaChunks = [...chunk('smpl', opts.smpl)];
  if (opts.sm24) sdtaChunks.push(...chunk('sm24', opts.sm24));

  return riff('sfbk', [
    ...infoList('Simple'),
    ...list('sdta', sdtaChunks),
    ...list('pdta', [
      ...chunk('phdr', phdr),
      ...chunk('pbag', pbag),
      ...chunk('pmod', modTerminal()),
      ...chunk('pgen', pgen),
      ...chunk('inst', inst),
      ...chunk('ibag', ibag),
      ...chunk('imod', modTerminal()),
      ...chunk('igen', igen),
      ...chunk('shdr', shdr),
    ]),
  ]);
}

/*
 * Stereo pair: preset 0/0, one instrument with two full-range zones,
 * zone 1 playing sample 0 (left, links to 1) and zone 2 playing sample
 * 1 (right, links to 0). Sample 0 is a full-scale sine cycle, sample 1
 * the same cycle at half amplitude, both 64 frames at 44100, original
 * pitch 69.
 */
export function buildStereoSf2(): ArrayBuffer {
  const left = sineSamples(64, 30000);
  const right = sineSamples(64, 15000);
  const smplBody = samples16([...left, ...right]);

  const phdr = [...phdrRec('P', 0, 0, 0), ...phdrRec('EOP', 0, 0, 1)];
  const pbag = [...bag(0, 0), ...bag(1, 0)];
  const pgen = [...gen(41, 0), ...gen(0, 0)];
  const inst = [...instRec('I', 0), ...instRec('EOI', 2)];
  const ibag = [...bag(0, 0), ...bag(1, 0), ...bag(2, 0)];
  const igen = [
    ...gen(53, 0), // zone 1: sampleID 0 (left)
    ...gen(53, 1), // zone 2: sampleID 1 (right)
    ...gen(0, 0), // terminal record
  ];
  const shdr = [
    ...shdrRec('L', 0, 64, 8, 56, 44100, 69, 0, 1, 4),
    ...shdrRec('R', 64, 128, 72, 120, 44100, 69, 0, 0, 2),
    ...shdrRec('EOS', 0, 0, 0, 0, 0, 0, 0, 0, 0),
  ];

  return riff('sfbk', [
    ...infoList('Stereo'),
    ...list('sdta', chunk('smpl', smplBody)),
    ...list('pdta', [
      ...chunk('phdr', phdr),
      ...chunk('pbag', pbag),
      ...chunk('pmod', modTerminal()),
      ...chunk('pgen', pgen),
      ...chunk('inst', inst),
      ...chunk('ibag', ibag),
      ...chunk('imod', modTerminal()),
      ...chunk('igen', igen),
      ...chunk('shdr', shdr),
    ]),
  ]);
}
