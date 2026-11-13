/*
 * Generates public/llm.txt, the LLM reference for bellowsjs. Accuracy by
 * construction: engine and effect tables come from the live registry of
 * the built library, and the contract and facade sections embed the real
 * .d.ts output. Run after building the library:
 *
 *   node scripts/gen-llm-ref.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const app = join(here, '..');
const pkg = join(app, '../../packages/bellows');

const lib = await import(join(pkg, 'dist/bellows.js'));
const pkgJson = JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8'));

lib.registerBuiltins();

function dts(rel) {
  return readFileSync(join(pkg, 'dist', rel), 'utf8')
    .replace(/^\/\/# sourceMappingURL=.*$/m, '')
    .trim();
}

function paramTable(params) {
  if (!params.length) return '  (no parameters)\n';
  let out = '';
  for (const p of params) {
    const unit = p.unit ? ' ' + p.unit : '';
    const curve = p.curve && p.curve !== 'lin' ? ' curve=' + p.curve : '';
    out += `  ${p.name}: ${p.min} to ${p.max}${unit}, default ${p.default}${curve}\n`;
  }
  return out;
}

let engines = '';
for (const e of lib.listEngines()) {
  engines += `### ${e.id} (${e.label})\n`;
  if (e.polyphony) engines += `default polyphony: ${e.polyphony}\n`;
  engines += paramTable(e.params) + '\n';
}

let effects = '';
for (const f of lib.listEffects()) {
  effects += `### ${f.id} (${f.label})\n` + paramTable(f.params) + '\n';
}

let presets = '';
for (const [family, list] of lib.presetsByFamily()) {
  presets += `### ${family}\n`;
  for (const p of list) {
    const fx = p.fx && p.fx.length ? ', fx: ' + p.fx.map((f) => f.effectId).join(' + ') : '';
    const oct = p.octave ? `, octave ${p.octave > 0 ? '+' : ''}${p.octave}` : '';
    presets += `- ${p.id} (${p.label}): engine ${p.engineId}${fx}${oct}\n`;
  }
  presets += '\n';
}

/* index: IPA, wrapped, so a reader can set the vocal engine's 'phoneme' param by hand */
let phonemes = '';
{
  let line = '';
  lib.VOCAL_PHONEMES.forEach((p, i) => {
    const cell = `${i} ${p}`;
    if (line.length + cell.length + 2 > 76) {
      phonemes += line.trimEnd() + '\n';
      line = '';
    }
    line += cell + ', ';
  });
  phonemes += line.replace(/, $/, '');
}

const scaleNames = Object.keys(lib.SCALES).join(', ');
const chordNames = Object.keys(lib.CHORD_TYPES).join(', ');

const doc = `# bellowsjs ${pkgJson.version} LLM reference

bellowsjs is a browser-native audio engine for synthesis, samples, sequencing,
analysis, and I/O. One AudioWorklet kernel hosts every voice and effect; musical
logic runs on the main thread and compiles to sample-accurate events. The DSP
core has zero browser dependencies, so offline rendering and analysis also run
in Node. Every stochastic decision flows from named, seeded PRNG streams.
License MIT. Site: https://bellows.live  Repo: https://github.com/virgilvox/bellowsjs

This file is generated from the library source and its type declarations.
Everything in it is exact for version ${pkgJson.version}.

## Install and import

npm:            npm install bellowsjs
webpage (CDN):  import { play } from 'https://unpkg.com/bellowsjs/dist/bellows.js'
Node (offline): import { registerBuiltins, renderOffline, encodeWav } from 'bellowsjs'

In the browser, the AudioContext needs a user gesture: call Bellows.boot() or
play() from a click handler. In Node there is no audio device: use
renderOffline(), which registers the built-in engines itself (see Offline
rendering).

## Tier 1: immediate sound

import { play, instrument } from 'bellowsjs';
play('pluck', 'C4');                                   // engine id, note
play('kick', 'C2', { vel: 1 });
const piano = await instrument('sf2:./gm.sf2#0:0');    // url#bank:program
piano.note('E3', { dur: '8n', vel: 0.7 });

## Tier 2: the Bellows facade

const b = await Bellows.boot({ seed: 'forge-01' });

Notes on the model:
- b.voice(engineId, params?) creates an instrument channel in the kernel and
  returns an Instrument handle. Engine ids are listed under Engines below.
- Instrument.note(note, { at, dur, vel }) plays one note. NoteValue accepts a
  midi number, a name like 'C#4', { hz: 440 }, or { degree, octave } resolved
  through the active scale and tuning. 'at' is absolute context time in
  seconds (pass the clock callback's t). 'dur' is musical time ('8n', '3/8',
  2 meaning two beats) or { seconds }.
- Instrument.on(note, vel?, at?) returns a note id for indefinite holds;
  Instrument.off(id, at?) releases it.
- Instrument.sing(lyrics, notes, { at, dictionary, scale, allophones }) sings on an
  instrument made with b.voice('vocal') and throws on any other engine. See
  Singing and lyrics below.
- b.clock.at('16n', (t, step) => ...) fires ahead of every subdivision tick;
  schedule with the provided t and placement is sample accurate even under
  main-thread load or background-tab timer throttling.
- b.bus([fx...], { level }) makes a send bus; instrument.send(bus, amount)
  routes to it. instrument.fx('tapeDelay', ['eq', { }]) replaces the insert
  chain. b.masterFx(...) sets the master chain.
- Musical time strings: '1n' whole, '2n', '4n' (one beat), '8n', '16n', '32n',
  dotted '4n.' or '4nd', triplet '8t', measures '2m', fractions of a whole
  note '3/8', bar:beat:sixteenth positions '2:1:2', or plain numbers (beats).
- b.transport is the Transport (see Sequencing); b.bpm(v), b.rampBpm(v, '8m'),
  b.swing(amount, '8n'), b.start(), b.stop(), b.pause(), b.resume().
- b.rng(label) returns a named seeded stream (NamedRng below); same boot seed
  and label always yields the same sequence.
- b.render({ bars | beats | seconds, sampleRate? }) re-runs the recorded
  setup and clock callbacks offline and returns { left, right, sampleRate,
  wav(bitDepth?) }. Renders equal a fresh page load of the same seed as long
  as randomness flows through b.rng(). In a browser it renders through the
  kernel worklet in an OfflineAudioContext (off the main thread); elsewhere
  the same worklet code runs on the calling thread. Same samples either way.
- listEngines() / listEffects() describe every built-in (id, label, params)
  without loading its DSP, plus anything registered on this thread.
  getEngine(id) returns a full definition only once registered there:
  registerBuiltins() registers the built-ins (Bellows.boot() does not; the
  engines play in the worklet).
- b.tuning is settable: Tuning.edo(19), Tuning.ji([...ratios]), or
  tuningFromScala(parseScl(text)). All note resolution flows through it.
- b.defEngine(def) / b.defEffect(def) register custom DSP (tier 3): the def
  must be self-contained (no imports, no closures) because it is serialized
  into the worklet realm.

Facade declaration (exact, from dist/bellows.d.ts):

${dts('bellows.d.ts')}

## Engines

Create with b.voice(id, params?). All params are numbers, settable at creation
and live via instrument.param(name, value, at?). Ranges below are exact.

${engines}
Sample-backed engines: register zone data with the kernel, then use the id
'sampler:<bankId>'. From an SF2: SoundFont.parse(arrayBuffer), then
samplerBankFromSf2(sf, bank, program).zones, then b.samplerInstrument(zones)
or b.sf2Instrument(buffer, bank, program) or await b.instrument('sf2:url#0:0').
Sampler engines expose SAMPLER_PARAMS:
${paramTable(lib.SAMPLER_PARAMS)}
Granular over your own buffer: b.granular(float32Data, sampleRate, params?).

## Singing and lyrics

const singer = b.voice('vocal', { body: 1 });          // 0 male, 1 female, 2 child
const plan = singer.sing('twinkle twinkle /ˈlɪt.əl/ star', [
  { note: 'C4', dur: '4n' }, { note: 'C4', dur: '4n' }, { note: 'G4', dur: '4n' },
  { note: 'G4', dur: '4n' }, { note: 'A4', dur: '4n' }, { note: 'A4', dur: '4n' },
  { note: 'G4', dur: '2n' },
], { at: b.now() + 0.5 });

- notes are laid end to end from 'at' (the first note's beat; default as
  note()), each dur through the tempo map and each pitch through b.tuning.
  { note: null, dur } is a rest. vel is per note; a phrase plays at its
  first note's velocity.
- lyrics: English words (letter-to-sound rules, or b.dictionary /
  opts.dictionary, a ReadonlyMap from lowercase word to CMUdict ARPAbet such
  as parseCmudict(text) returns; bellows ships no dictionary), and IPA
  between slashes, which sets the sounds directly. A hyphen inside a word splits
  syllables, a free-standing '-' or '~' holds the vowel onto the next note,
  and . , ; : ! ? or a line break ends a phrase with a breath. A Syllable[]
  is accepted in place of text.
- Without a dictionary, common function words, irregular words (one, two,
  what, people, eye, again, ...) and contractions (I'm, don't, you're, ...)
  are built in, and the rules cover the rest: about three common lyric words
  in four read exactly as CMUdict has them, most of the rest differing only
  in an unstressed vowel. Fire, hour and desire stay one syllable (one note).
  Write a misread word as IPA between slashes. A word with no vowel ("hmm",
  "shh", "TV") keeps its note on its most sonorous sound; digits are skipped. English words get the American flap and
  dark l unless opts.allophones is false (classical diction); IPA is sung
  as written.
- Each vowel lands on its note time; onset consonants are sung before it.
  The returned plan has phrases (spans of IPA with start/end seconds, and
  pitches) and leadIn, the most any phrase starts before its first note:
  live, call at least that far ahead. plan.unknown lists IPA the engine has
  no phoneme for; those spans keep the sound before them. plan.trimmed is
  the seconds cut because the instrument was still singing an earlier line
  there: leave the next line's leadIn free (a rest, a shorter last note).
  Any phoneme or bend param() change, untimed included, also reaches a line
  that is singing at that moment. Live with no at, the line starts as soon
  as its opening consonants can all still sound.
- Inside a clock callback, b.render() replays sing() exactly as note().
- The voice's own params: glottis picks the vocal folds (2 a drawn pulse,
  the default; 0 geometric folds whose swing follows the pressure; 1
  self-oscillating folds steered to the note, which bend with consonants
  and can lock onto F1 near 500 Hz). ring adds a singer's formant near
  3 kHz (about 1 dB); tuning opens the jaw on high notes so F1 stays above
  the pitch. body 0 male, 1 female, 2 child, blending in between.
- Each phrase is one note with Param events inside: 'phoneme' (an index
  into VOCAL_PHONEMES; vocalPhonemeIndex(ipa)) and 'bend' in semitones. One
  instrument sings one line at a time; give a harmony its own voice(). A
  line sings at its own pitches whatever the channel's bend, and when it
  ends the channel gets back the phoneme and bend it was created with or
  last given by an untimed param().
- Without the facade: planSung(notes in seconds and Hz, syllables) gives the
  plan, sungEvents(plan, { channel, phonemeParam: internParam('phoneme'),
  bendParam: internParam('bend') }) gives kernel events for renderOffline.
  lyricsToSyllables(text, { dictionary, allophones }), readLyrics(text, frontEnds) with
  englishFrontEnd(opts) and ipaFrontEnd, tokenizeIpa(ipa),
  arpabetToSegments(phones) and parseCmudict(text) are the lyric layer.

VOCAL_PHONEMES ('_' is silence; append only, so a saved index keeps its sound):
${phonemes}

## Instrument presets

Named playable instruments: each pins an engine plus curated params, optional
insert fx, a gain trim, and a suggested keyboard octave. getPreset(id) returns
the full InstrumentPreset (INSTRUMENT_PRESETS is the whole bank,
presetsByFamily() groups it); create the sound with b.voice(preset.engineId,
preset.params) plus instrument.fx(...preset.fx) and instrument.gain(preset.gain).
The bellows.live instrument page selects these with engine ids of the form
preset:<id>.

${presets}
## Effects

Use in instrument.fx(...), b.bus([...]), or b.masterFx(...). A chain entry is
an effect id string, [id, { param: value }], or { effectId, params }.

${effects}
## Theory

Scale: new Scale(root, name) where root is 'D', 'F#', a pitch class number, or
a note like 'D3'; name is one of: ${scaleNames}.
Methods: degreeToMidi(degree, octave?) (wraps octaves, negatives fine),
quantize(midi), contains(midi), degrees(octaves, baseOctave?), intervals.

Chords: CHORD_TYPES keys: ${chordNames}.
parseChord('F#m7b5'), detectChord(pitchClasses), diatonicTriads(scale),
diatonicSevenths(scale), romanToChord('viio7', scale), chordToRoman(chord, scale).

Voice leading: voiceLead(prevVoicing, candidateChordMidis, options?) picks the
minimal-motion voicing. negativeHarmony(midi, keyRoot) reflects around the
root-fifth axis. invert(chordMidis, inversion).

Progressions: buildProgression(rng, bars, { cadence? }) returns scale degrees
0..6 with functional-harmony weighting and cadence bias.

Notes: parseNote('C#4') -> midi (C4 = 60), noteName(midi, preferFlats?),
pitchClass, octaveOf, mtof(midi), ftom(freq).

Tuning: Tuning.edo(n, refFreq?, refIndex?), Tuning.ji(ratios, baseFreq?,
baseIndex?), Tuning.fromCents(cents, period?, refFreq?, refIndex?),
tuning.freqOf(index), Tuning.default12. Scala: parseScl(text), parseKbm(text),
tuningFromScala(scl, kbm?).

## Sequencing

Transport: new Transport({ bpm, meter }) with exact closed-form tempo
integration. beatAt(seconds), secondsAt(beat), setBpm(bpm, atSeconds?),
rampBpm(bpm, overBeats, atSeconds?), setSwing(amount, subdivision),
setMeter(bar, { num, den }), position(seconds) -> { bar, beat, phase },
scheduleHorizon(fromSec, toSec, subdivision) yields { beat, seconds, step }.
TempoMap (transport.tempo): setBpm(beat, bpm), rampTo(beat, bpm), bpmAt(beat),
beatToSeconds(beat), secondsToBeat(sec).

Generators (all deterministic given a NamedRng):
- euclid(pulses, steps, rotation?) -> 0/1 array (true Bjorklund; E(3,8) = [1,0,0,1,0,0,1,0])
- Markov<T>(order): train(seq), addTransition(from[], to, weight), seed(ctx),
  next(rng), steps(rng, n). Helpers buildStepwiseMatrix, weightedWalk (chord
  gravity).
- lsystem(axiom, rules, generations, rng?) with stochastic rule support;
  mapToDegrees(str, mapping).
- ElementaryCA(rule, width, init?): step(), row (Uint8Array), generation.
- Arpeggiator({ mode: 'up'|'down'|'updown'|'downup'|'random'|'order', octaves }):
  setNotes(midis), next(rng?), reset().
- Pattern combinators (step-indexed): seq(...), stack(...), fromArray, gates,
  every(n, fn, p), sometimes(prob, fn, p, rng), fast(n, p), slow(n, p),
  rev(p), rotatePattern(p, n). Patterns implement at(step) and length.
  (The bare rotate(arr, n) at the package root rotates a plain array, which is
  what euclid rows want; the two are different functions.)

PRNG: rng(label) -> NamedRng: call for [0,1); .fork(label), .int(n),
.pick(arr), .range(lo, hi), .chance(p), .shuffle(arr), .gauss(), .weighted(w).

## Analysis

yin(buffer, sampleRate, threshold?) -> { freq, probability } | null.
mpm(buffer, sampleRate) -> { freq, clarity } | null.
detectOnsets(buffer, sampleRate) -> seconds[]. estimateTempo(onsetsOrBuffer)
-> { bpm, confidence } (may fold to half or double tempo).
chroma + keyEstimate(chroma) -> { key 0..11, mode, confidence }.
spectralCentroid, spectralFlatness, spectralRolloff, spectralSpread, rms, zcr,
mfcc(buffer, sampleRate, opts?).
LoudnessMeter(sampleRate, channels): push audio, then momentary(), shortTerm(),
integrated(), range(), truePeak(); BS.1770-4 K-weighting derived per rate.
Streaming classes YinDetector and OnsetDetector take push(mono, from, to).

## I/O and rendering

encodeWav(channels, sampleRate, { bitDepth: 16|24|32 }) -> ArrayBuffer.
decodeWav(buf) -> { channels, sampleRate } (PCM 8/16/24/32 and float).
parseMidi(buf) / writeMidi(tracks, tpq) / toScore(parsed) for standard MIDI
files. MidiInput / MidiOutput wrap Web MIDI (Chromium and Firefox only;
feature-detect); parseMidiMessage(bytes) is pure. SoundFont.parse(buf) reads
SF2 (presets, generator resolution, 24-bit, stereo links); parseSfz(text,
resolver) reads the SFZ subset. encodeAudio for WebCodecs Opus where present.

Offline rendering without a browser:

import { registerBuiltins, renderOffline, encodeWav, EventKind } from 'bellowsjs';
registerBuiltins();
const setup = [
  { type: 'createChannel', id: 0, engineId: 'pluck', params: {}, seed: 's' },
  { type: 'masterGain', gain: 0.9 },
  { type: 'events', events: [
    { time: 0.02, kind: EventKind.NoteOn, target: 0, a: 1, b: 220, c: 0.9 },
    { time: 0.5, kind: EventKind.NoteOff, target: 0, a: 1, b: 0, c: 0 },
  ] },
];
const out = renderOffline(setup, { seconds: 2, sampleRate: 44100 });
// out.left, out.right are Float32Array; identical output on every run

Event fields: time (engine seconds), kind (EventKind.NoteOn/NoteOff/Param/
AllNotesOff), target (channel id), a (note id or interned param index),
b (frequency Hz or param value), c (velocity 0..1).

## Tier 3 contracts (exact, from dist/types.d.ts)

${dts('types.d.ts')}

## Rules an integration must follow

- Boot from a user gesture or the context stays suspended and silent.
- In Node, call registerBuiltins() before renderOffline or engine lookups.
- Voices ADD into output buffers over (from, to); effects process IN PLACE.
  Custom defs must not allocate inside process() at steady state.
- defEngine/defEffect defs are serialized with toString() into the worklet:
  self-contained functions only, numeric params only. Hosts with a CSP that
  blocks blob: or eval need { workletUrl } pointing at bellowsjs/worklet.js.
- For reproducible renders, route every random choice through b.rng(label)
  and create generators fresh inside setup, not across renders.
- Web MIDI does not exist in Safari. WebCodecs Opus export is feature-detected;
  WAV export always works.
`;

writeFileSync(join(app, 'public/llm.txt'), doc);
console.log('public/llm.txt written:', (doc.length / 1024).toFixed(1), 'KB,', doc.split('\n').length, 'lines');
