/*
 * Named instrument presets. Each preset pins an engine plus a curated
 * param set, optional insert fx, a gain trim, and a suggested keyboard
 * octave shift, so a caller can ask for VIOLIN or NYLON GUITAR instead
 * of hand-tuning 'string' or 'pluck'.
 *
 * Every param name here matches the owning engine's ParamSpec list
 * exactly; params not named fall back to the engine defaults. Presets
 * are plain data: resolving one still means creating a channel for
 * preset.engineId with preset.params, applying preset.fx as the insert
 * chain, and trimming by preset.gain.
 */

export type InstrumentFamily =
  | 'guitars'
  | 'strings'
  | 'winds'
  | 'brass'
  | 'keys'
  | 'mallets'
  | 'voices'
  | 'synth';

export interface InstrumentPreset {
  /** Kebab-case id, e.g. 'nylon-guitar'. */
  id: string;
  /** Display label, e.g. 'NYLON GUITAR'. */
  label: string;
  family: InstrumentFamily;
  /** Underlying engine id as registered by registerBuiltins. */
  engineId: string;
  params: Record<string, number>;
  /** Insert fx chain, applied in order. */
  fx?: Array<{ effectId: string; params?: Record<string, number> }>;
  /** Channel gain trim, default 0.8. */
  gain?: number;
  /** Suggested keyboard octave shift, default 0. */
  octave?: number;
}

const FAMILY_ORDER: InstrumentFamily[] = [
  'guitars',
  'strings',
  'winds',
  'brass',
  'keys',
  'mallets',
  'voices',
  'synth',
];

/**
 * Explicit level map for the additive engine's 32 partials. Unnamed
 * additive partials default to a sawtooth (1/n), so a preset that wants
 * a sparse spectrum has to zero the rest; this fills partialN and
 * targetN for all 32 from the given list, zero beyond its end.
 */
function partials(levels: number[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (let n = 1; n <= 32; n++) {
    const lvl = levels[n - 1] ?? 0;
    out['partial' + n] = lvl;
    out['target' + n] = lvl;
  }
  return out;
}

export const INSTRUMENT_PRESETS: InstrumentPreset[] = [
  /* ---------------------------------------------------------------- */
  /* guitars: Karplus-Strong pluck, voiced by damping, pick position,  */
  /* excitation blend, and decay                                       */
  /* ---------------------------------------------------------------- */
  {
    id: 'nylon-guitar',
    label: 'NYLON GUITAR',
    family: 'guitars',
    engineId: 'pluck',
    // warm damping, rounder finger-style excitation, mid pick position
    params: { damp: 0.5, pickPos: 0.32, exciteType: 0.6, decay: 2.2, level: 0.9 },
    gain: 0.85,
  },
  {
    id: 'steel-guitar',
    label: 'STEEL GUITAR',
    family: 'guitars',
    engineId: 'pluck',
    // bright wire, plectrum near the soundhole edge, long ring
    params: { damp: 0.24, pickPos: 0.18, exciteType: 0.2, decay: 3.5, level: 0.85 },
  },
  {
    id: 'twelve-string',
    label: 'TWELVE STRING',
    family: 'guitars',
    engineId: 'pluck',
    // steel voicing; the octave-course shimmer comes from a slow chorus
    params: { damp: 0.26, pickPos: 0.16, exciteType: 0.2, decay: 3.2, level: 0.8 },
    fx: [{ effectId: 'chorus', params: { rate: 0.8, depth: 0.35, mix: 0.55, feedback: 0 } }],
  },
  {
    id: 'muted-electric',
    label: 'MUTED ELECTRIC',
    family: 'guitars',
    engineId: 'pluck',
    // palm mute: heavy damping and a very short decay
    params: { damp: 0.78, pickPos: 0.12, exciteType: 0.35, decay: 0.35, level: 0.95 },
    gain: 0.9,
  },
  {
    id: 'clean-electric',
    label: 'CLEAN ELECTRIC',
    family: 'guitars',
    engineId: 'pluck',
    // bright pick near the bridge, single slap-back echo off tape
    params: { damp: 0.3, pickPos: 0.14, exciteType: 0.15, decay: 3, level: 0.85 },
    fx: [
      {
        effectId: 'tapeDelay',
        params: {
          time: 0.115,
          feedback: 0.12,
          mix: 0.22,
          wow: 0.06,
          flutter: 0.08,
          saturation: 0.3,
          tone: 5500,
          hiss: 0,
        },
      },
    ],
  },
  {
    id: 'bass-guitar',
    label: 'BASS GUITAR',
    family: 'guitars',
    engineId: 'pluck',
    // dark fingered pluck, played two octaves down
    params: { damp: 0.55, pickPos: 0.25, exciteType: 0.45, decay: 2.2, level: 0.95 },
    gain: 0.9,
    octave: -2,
  },
  {
    id: 'banjo',
    label: 'BANJO',
    family: 'guitars',
    engineId: 'pluck',
    // near-bridge pick, almost no damping, short head decay
    params: { damp: 0.12, pickPos: 0.08, exciteType: 0.55, decay: 1.1, level: 0.8 },
  },
  {
    id: 'sitar-drone',
    label: 'SITAR DRONE',
    family: 'guitars',
    engineId: 'pluck',
    // pick right at the bridge for the buzzy comb, very long sympathetic ring
    params: { damp: 0.18, pickPos: 0.04, exciteType: 0.3, decay: 6, level: 0.75 },
  },
  {
    id: 'koto',
    label: 'KOTO',
    family: 'guitars',
    engineId: 'pluck',
    // hard plectrum well up the string, silk-string damping
    params: { damp: 0.42, pickPos: 0.42, exciteType: 0.75, decay: 1.8, level: 0.85 },
  },
  {
    id: 'harp',
    label: 'HARP',
    family: 'guitars',
    engineId: 'pluck',
    // mid-string finger pluck, long open ring
    params: { damp: 0.4, pickPos: 0.5, exciteType: 0.5, decay: 4.5, level: 0.85 },
  },
  {
    id: 'clavinet',
    label: 'CLAVINET',
    family: 'guitars',
    engineId: 'pluck',
    // pure impulse strike right at the bridge, short and snappy
    params: { damp: 0.3, pickPos: 0.07, exciteType: 1, decay: 0.9, level: 0.9 },
  },

  /* ---------------------------------------------------------------- */
  /* strings: bowed waveguide for the violin family, plucked for       */
  /* upright and pizzicato                                             */
  /* ---------------------------------------------------------------- */
  {
    id: 'violin',
    label: 'VIOLIN',
    family: 'strings',
    engineId: 'string',
    params: { damp: 0.22, sustain: 0.85, dispersion: 0, bow: 0.8, bowPressure: 0.55, bowSpeed: 0.6, level: 0.8 },
    gain: 0.75,
  },
  {
    id: 'viola',
    label: 'VIOLA',
    family: 'strings',
    engineId: 'string',
    params: { damp: 0.32, sustain: 0.85, dispersion: 0, bow: 0.8, bowPressure: 0.6, bowSpeed: 0.55, level: 0.8 },
    gain: 0.75,
  },
  {
    id: 'cello',
    label: 'CELLO',
    family: 'strings',
    engineId: 'string',
    params: { damp: 0.42, sustain: 0.9, dispersion: 0, bow: 0.85, bowPressure: 0.65, bowSpeed: 0.45, level: 0.8 },
    gain: 0.75,
    octave: -1,
  },
  {
    id: 'double-bass',
    label: 'DOUBLE BASS',
    family: 'strings',
    engineId: 'string',
    // no bow: a plucked upright, dark and fairly short
    params: { damp: 0.6, sustain: 0.55, dispersion: 0, bow: 0, level: 0.9 },
    octave: -2,
  },
  {
    id: 'pizzicato-strings',
    label: 'PIZZICATO STRINGS',
    family: 'strings',
    engineId: 'string',
    params: { damp: 0.45, sustain: 0.3, dispersion: 0, bow: 0, level: 0.9 },
  },

  /* ---------------------------------------------------------------- */
  /* winds: harmonic-plus-noise for breathy pipes, the reed tube for   */
  /* clarinet and recorder                                             */
  /* ---------------------------------------------------------------- */
  {
    id: 'concert-flute',
    label: 'CONCERT FLUTE',
    family: 'winds',
    engineId: 'harmonic',
    params: { brightness: 0.32, evenOdd: 0.5, noiseMix: 0.18, noiseColor: 4, attack: 0.06, release: 0.2, level: 0.85 },
    octave: 1,
  },
  {
    id: 'pan-flute',
    label: 'PAN FLUTE',
    family: 'winds',
    engineId: 'harmonic',
    // more breath than tone, chiffy attack
    params: { brightness: 0.25, evenOdd: 0.5, noiseMix: 0.35, noiseColor: 3, attack: 0.05, release: 0.15, level: 0.85 },
    octave: 1,
  },
  {
    id: 'clarinet',
    label: 'CLARINET',
    family: 'winds',
    engineId: 'tube',
    params: { breath: 0.85, noise: 0.05, level: 0.8 },
  },
  {
    id: 'recorder',
    label: 'RECORDER',
    family: 'winds',
    engineId: 'tube',
    params: { breath: 0.7, noise: 0.12, level: 0.75 },
    octave: 1,
  },
  {
    id: 'ocarina',
    label: 'OCARINA',
    family: 'winds',
    engineId: 'harmonic',
    // nearly pure tone with a little breath around the fundamental
    params: { brightness: 0.08, evenOdd: 0.5, noiseMix: 0.1, noiseColor: 1, attack: 0.04, release: 0.12, level: 0.9 },
    octave: 1,
  },
  {
    id: 'shakuhachi',
    label: 'SHAKUHACHI',
    family: 'winds',
    engineId: 'harmonic',
    // heavy breath noise, slow speaking attack
    params: { brightness: 0.35, evenOdd: 0.5, noiseMix: 0.4, noiseColor: 2.5, attack: 0.09, release: 0.3, level: 0.85 },
  },

  /* ---------------------------------------------------------------- */
  /* brass: bright harmonic spectra with slow-ish attacks, one classic */
  /* two-operator FM horn                                              */
  /* ---------------------------------------------------------------- */
  {
    id: 'trumpet',
    label: 'TRUMPET',
    family: 'brass',
    engineId: 'harmonic',
    params: { brightness: 0.72, evenOdd: 0.5, formantShift: 1.8, noiseMix: 0.04, attack: 0.04, release: 0.15, level: 0.8 },
  },
  {
    id: 'trombone',
    label: 'TROMBONE',
    family: 'brass',
    engineId: 'harmonic',
    params: { brightness: 0.55, evenOdd: 0.5, formantShift: 0.9, noiseMix: 0.05, attack: 0.07, release: 0.2, level: 0.85 },
    octave: -1,
  },
  {
    id: 'brass-section',
    label: 'BRASS SECTION',
    family: 'brass',
    engineId: 'harmonic',
    // ensemble spread from a slow chorus over a broad bright spectrum
    params: { brightness: 0.62, evenOdd: 0.5, formantShift: 1.4, noiseMix: 0.06, attack: 0.09, release: 0.25, level: 0.85 },
    fx: [{ effectId: 'chorus', params: { rate: 0.5, depth: 0.3, mix: 0.4, feedback: 0 } }],
  },
  {
    id: 'fm-horn',
    label: 'FM HORN',
    family: 'brass',
    engineId: 'fm',
    // serial 2-op at 1:1, moderate feedback: the classic FM brass patch
    params: {
      ops: 2,
      algorithm: 1,
      ratio1: 1,
      level1: 1,
      ratio2: 1,
      level2: 0.55,
      feedback: 0.25,
      brightness: 0.8,
      attack: 0.06,
      decay: 0.25,
      sustain: 0.85,
      release: 0.25,
      mAttack: 0.09,
      mDecay: 0.5,
      mSustain: 0.65,
      mRelease: 0.2,
    },
  },

  /* ---------------------------------------------------------------- */
  /* keys: FM e-piano, additive organs and struck idiophone keyboards, */
  /* plucked harpsichord                                               */
  /* ---------------------------------------------------------------- */
  {
    id: 'dx-epiano',
    label: 'DX E-PIANO',
    family: 'keys',
    engineId: 'fm',
    // two carrier pairs (algorithm 5): body at 1:1 plus a 14x tine ping
    params: {
      ops: 4,
      algorithm: 5,
      ratio1: 1,
      level1: 1,
      ratio2: 1,
      level2: 0.4,
      ratio3: 1,
      level3: 0.55,
      ratio4: 14,
      level4: 0.1,
      feedback: 0.1,
      brightness: 0.9,
      attack: 0.002,
      decay: 1.4,
      sustain: 0.2,
      release: 0.35,
      mAttack: 0.001,
      mDecay: 0.3,
      mSustain: 0,
      mRelease: 0.2,
    },
    fx: [{ effectId: 'chorus', params: { rate: 0.7, depth: 0.3, mix: 0.3, feedback: 0 } }],
  },
  {
    id: 'drawbar-organ',
    label: 'DRAWBAR ORGAN',
    family: 'keys',
    engineId: 'additive',
    // drawbar-style footages, fully sustained while held
    params: {
      ...partials([1, 0.85, 0.65, 0.5, 0.18, 0.4, 0.08, 0.3]),
      inharm: 0,
      decay: 20,
      rolloff: 1,
      attack: 0.004,
      release: 0.08,
      gain: 1,
    },
  },
  {
    id: 'church-organ',
    label: 'CHURCH ORGAN',
    family: 'keys',
    engineId: 'additive',
    // principal chorus with octave and mutation ranks, slow speech
    params: {
      ...partials([1, 0.75, 0.4, 0.6, 0.15, 0.35, 0.08, 0.3, 0, 0.12, 0, 0.18]),
      inharm: 0,
      decay: 20,
      rolloff: 1,
      attack: 0.04,
      release: 0.3,
      gain: 1,
    },
  },
  {
    id: 'harpsichord',
    label: 'HARPSICHORD',
    family: 'keys',
    engineId: 'pluck',
    // quill impulse right at the bridge, bright and quick
    params: { damp: 0.2, pickPos: 0.06, exciteType: 1, decay: 1.6, level: 0.85 },
  },
  {
    id: 'celesta',
    label: 'CELESTA',
    family: 'keys',
    engineId: 'additive',
    params: {
      ...partials([1, 0.2, 0.05, 0.12]),
      inharm: 0.001,
      decay: 1.8,
      rolloff: 0.55,
      attack: 0.001,
      release: 0.4,
      gain: 1,
    },
    octave: 1,
  },
  {
    id: 'music-box',
    label: 'MUSIC BOX',
    family: 'keys',
    engineId: 'additive',
    // sparse stretched partials, tiny tine ping
    params: {
      ...partials([1, 0, 0.5, 0, 0.22, 0, 0.1]),
      inharm: 0.004,
      decay: 1.3,
      rolloff: 0.45,
      attack: 0.001,
      release: 0.3,
      gain: 1,
    },
    octave: 2,
  },

  /* ---------------------------------------------------------------- */
  /* mallets: the modal bank, voiced by material, decay, and strike    */
  /* ---------------------------------------------------------------- */
  {
    id: 'marimba',
    label: 'MARIMBA',
    family: 'mallets',
    engineId: 'modal',
    params: { material: 0, decay: 0.4, brightness: 0.45, strikeHardness: 0.5, level: 0.75 },
  },
  {
    id: 'vibraphone',
    label: 'VIBRAPHONE',
    family: 'mallets',
    engineId: 'modal',
    // long metal-bar ring under the motor tremolo
    params: { material: 0, decay: 3.5, brightness: 0.4, strikeHardness: 0.35, level: 0.65 },
    fx: [{ effectId: 'tremolo', params: { rate: 4.5, depth: 0.4, shape: 0, phase: 0 } }],
  },
  {
    id: 'glockenspiel',
    label: 'GLOCKENSPIEL',
    family: 'mallets',
    engineId: 'modal',
    params: { material: 0, decay: 1.6, brightness: 0.8, strikeHardness: 0.85, level: 0.5 },
    octave: 2,
  },
  {
    id: 'tubular-bells',
    label: 'TUBULAR BELLS',
    family: 'mallets',
    engineId: 'modal',
    params: { material: 2, decay: 5, brightness: 0.5, strikeHardness: 0.7, level: 0.55 },
  },
  {
    id: 'kalimba',
    label: 'KALIMBA',
    family: 'mallets',
    engineId: 'modal',
    // dark thumb-plucked tine, quick decay
    params: { material: 0, decay: 0.9, brightness: 0.22, strikeHardness: 0.4, level: 0.8 },
  },
  {
    id: 'steel-drum',
    label: 'STEEL DRUM',
    family: 'mallets',
    engineId: 'modal',
    params: { material: 2, decay: 1.1, brightness: 0.62, strikeHardness: 0.45, level: 0.7 },
  },
  {
    id: 'woodblock',
    label: 'WOODBLOCK',
    family: 'mallets',
    engineId: 'modal',
    // wood material already damps hard; decay 2 nets about a 0.24 s ring
    params: { material: 4, decay: 2, brightness: 0.6, strikeHardness: 0.9, level: 0.85 },
  },
  {
    id: 'timpani',
    label: 'TIMPANI',
    family: 'mallets',
    engineId: 'modal',
    // membrane modes, soft felt strike, played low
    params: { material: 1, decay: 3, brightness: 0.15, strikeHardness: 0.3, level: 0.8 },
    octave: -2,
  },

  /* ---------------------------------------------------------------- */
  /* voices                                                            */
  /* ---------------------------------------------------------------- */
  {
    id: 'choir-aah',
    label: 'CHOIR AAH',
    family: 'voices',
    engineId: 'formant',
    params: { vowel: 0, breath: 0.15, vibratoRate: 4.5, vibratoDepth: 0.2, shape: 0, level: 1 },
    fx: [{ effectId: 'chorus', params: { rate: 0.4, depth: 0.45, mix: 0.5, feedback: 0 } }],
  },
  {
    id: 'voice-ooh',
    label: 'VOICE OOH',
    family: 'voices',
    engineId: 'formant',
    // between o and u on the vowel morph
    params: { vowel: 3.2, breath: 0.12, vibratoRate: 5, vibratoDepth: 0.25, shape: 0, level: 1.1 },
  },
  {
    id: 'whistle',
    label: 'WHISTLE',
    family: 'voices',
    engineId: 'additive',
    // a single sustained sine two octaves up
    params: { ...partials([1]), inharm: 0, decay: 20, rolloff: 1, attack: 0.04, release: 0.12, gain: 0.9 },
    octave: 2,
  },

  /* ---------------------------------------------------------------- */
  /* synth                                                             */
  /* ---------------------------------------------------------------- */
  {
    id: 'analog-lead',
    label: 'ANALOG LEAD',
    family: 'synth',
    engineId: 'va',
    params: {
      shape: 0,
      detune: 9,
      sub: 0.2,
      cutoff: 3200,
      resonance: 0.35,
      filterType: 0,
      envAmount: 1.5,
      attack: 0.004,
      decay: 0.15,
      sustain: 0.85,
      release: 0.18,
      fAttack: 0.002,
      fDecay: 0.25,
      fSustain: 0.45,
      fRelease: 0.2,
      drift: 0.25,
    },
  },
  {
    id: 'fat-saw-pad',
    label: 'FAT SAW PAD',
    family: 'synth',
    engineId: 'va',
    params: {
      shape: 0,
      detune: 18,
      sub: 0.35,
      cutoff: 1600,
      resonance: 0.12,
      filterType: 0,
      envAmount: 1,
      attack: 0.6,
      decay: 0.4,
      sustain: 0.85,
      release: 1.1,
      fAttack: 0.9,
      fDecay: 0.5,
      fSustain: 0.6,
      fRelease: 0.8,
      drift: 0.4,
    },
    gain: 0.75,
  },
  {
    id: 'acid-bass',
    label: 'ACID BASS',
    family: 'synth',
    engineId: 'va',
    // ladder squelch: low cutoff, high resonance, snappy filter envelope
    params: {
      shape: 0,
      detune: 0,
      sub: 0,
      cutoff: 320,
      resonance: 0.85,
      filterType: 0,
      envAmount: 3,
      attack: 0.002,
      decay: 0.25,
      sustain: 0.55,
      release: 0.12,
      fAttack: 0.001,
      fDecay: 0.18,
      fSustain: 0.05,
      fRelease: 0.1,
      drift: 0.1,
    },
    octave: -1,
  },
  {
    id: 'sub-bass',
    label: 'SUB BASS',
    family: 'synth',
    engineId: 'va',
    // plain sine two octaves down, filter just a safety net
    params: {
      shape: 3,
      detune: 0,
      sub: 0,
      cutoff: 900,
      resonance: 0,
      envAmount: 0,
      attack: 0.004,
      decay: 0.1,
      sustain: 1,
      release: 0.12,
      drift: 0,
    },
    gain: 0.95,
    octave: -2,
  },
  {
    id: 'west-coast-pluck',
    label: 'WEST COAST PLUCK',
    family: 'synth',
    engineId: 'westcoast',
    // folded blip through a colored low pass gate
    params: { foldAmount: 0.55, foldStages: 2, foldEnv: 0.8, lpgColor: 0.85, lpgDecay: 0.3, level: 0.85 },
  },
  {
    id: 'motion-pad',
    label: 'MOTION PAD',
    family: 'synth',
    engineId: 'wavetable',
    // slow LFO scan across the morph table under a soft filter
    params: {
      position: 0.25,
      scanRate: 0.2,
      scanDepth: 0.35,
      envToPosition: 0.25,
      attack: 0.7,
      decay: 0.4,
      sustain: 0.85,
      release: 1.2,
      filter: 1,
      cutoff: 3800,
      resonance: 0.15,
    },
    gain: 0.75,
  },
  {
    id: 'fm-bell-lead',
    label: 'FM BELL LEAD',
    family: 'synth',
    engineId: 'fm',
    // near-3.5x modulator ratio for the classic FM bell clang
    params: {
      ops: 2,
      algorithm: 1,
      ratio1: 1,
      level1: 1,
      ratio2: 3.53,
      level2: 0.45,
      feedback: 0.15,
      brightness: 1,
      attack: 0.002,
      decay: 2,
      sustain: 0,
      release: 0.6,
      mAttack: 0.001,
      mDecay: 1.1,
      mSustain: 0,
      mRelease: 0.5,
    },
  },
];

const byId = new Map<string, InstrumentPreset>();
for (const preset of INSTRUMENT_PRESETS) byId.set(preset.id, preset);

/** Look up a preset by id. Throws on an unknown id. */
export function getPreset(id: string): InstrumentPreset {
  const preset = byId.get(id);
  if (!preset) throw new Error('unknown instrument preset: ' + id);
  return preset;
}

/** Presets grouped by family, in display order (guitars first, synth last). */
export function presetsByFamily(): Map<InstrumentFamily, InstrumentPreset[]> {
  const out = new Map<InstrumentFamily, InstrumentPreset[]>();
  for (const family of FAMILY_ORDER) out.set(family, []);
  for (const preset of INSTRUMENT_PRESETS) out.get(preset.family)!.push(preset);
  for (const family of FAMILY_ORDER) {
    if (out.get(family)!.length === 0) out.delete(family);
  }
  return out;
}
