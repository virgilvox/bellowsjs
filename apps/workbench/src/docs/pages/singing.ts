import type { DocPage } from '../types';

const page: DocPage = {
  slug: 'singing',
  title: 'Singing',
  blurb: 'Words on a melody, and speech: the bellows-voice package.',
  prev: 'engines',
  next: 'presets',
  body: `
By the end of this page you can make a singer sing a lyric on a melody, give it an accent, make it speak, fix a word it reads wrongly, and stack singers into harmony in any tuning.

## Installing the voice

The voice is its own package, \`bellows-voice\`, beside \`bellowsjs\`. It is a plugin: its engine loads into the AudioWorklet beside the kernel, so a page that never sings never carries it.

\`\`\`js
// npm install bellowsjs bellows-voice
import { Bellows } from 'bellowsjs';
import { voice, singer } from 'bellows-voice';

const b = await Bellows.boot({ plugins: [voice] });   // or, after boot: await b.use(voice)
\`\`\`

**Changed in bellowsjs 0.5.0.** The voice shipped inside bellowsjs through 0.4.0, as \`b.voice('vocal').sing()\`. It moved, with its history, to [bellows-voice](https://github.com/virgilvox/bellows-voice), and sounds exactly as it did. \`singer(b, params)\` replaces \`b.voice('vocal', params)\`, and the dictionary and accent are the singer's (\`singer.dictionary\`, \`singer.accent\`) where they were \`b.dictionary\` and \`b.accent\`. In Code mode on this site \`lib\` carries both packages, so the examples write \`lib.singer(b, params)\`.

## A first line

\`\`\`js
const alto = singer(b, { body: 1 });   // 0 male, 1 female, 2 child
const plan = alto.sing('twinkle twinkle /ˈlɪt.əl/ star', [
  { note: 'C4', dur: '4n' }, { note: 'C4', dur: '4n' },
  { note: 'G4', dur: '4n' }, { note: 'G4', dur: '4n' },
  { note: 'A4', dur: '4n' }, { note: 'A4', dur: '4n' },
  { note: 'G4', dur: '2n' },
], { at: b.now() + 0.5 });
\`\`\`

\`singer(b, params?, opts?)\` makes an instrument on the \`vocal\` engine (\`params\` are the voice's, below; \`opts\` takes \`accent\`, \`dictionary\` and \`polyphony\`) and throws if the voice is not loaded. It has \`sing\`, \`speak\`, \`note\`, \`on\`, \`off\`, \`param\`, \`fx\`, \`send\`, \`gain\`, \`pan\` and \`dispose\`, and the bellows instrument underneath as \`.instrument\`. Each note is \`{ note, dur, vel? }\`: \`note\` takes everything [\`note()\`](/docs/playing-notes) takes (a name, a midi number, \`{ hz }\`, or \`{ degree, octave }\` through \`opts.scale\`), and \`null\` is a rest. \`dur\` is beats, notation like \`'8n'\`, or \`{ seconds }\`, through the tempo map. The notes are laid end to end from \`opts.at\`, the time of the first beat.

Played with \`note()\` or a keyboard, the same singer sings whatever sound it holds, "ah" unless you set its \`phoneme\`.

## How a line is timed

Each vowel lands on its note. Consonants that open a syllable are sung just before the beat and take their time from the note before; consonants that close one finish before the next syllable's opening. A fast passage squeezes consonants in proportion rather than letting them push the vowels late. Within a phrase the pitch moves as a bend on one voice, so notes join the way a singer joins them, over \`glide\` seconds.

A line that opens on consonants starts early. \`plan.leadIn\` says by how much (a p, t or k counts its release too, because it is voiced on the beat). Offline, \`b.render()\` collects every event before it renders, so a \`sing()\` inside a clock callback replays exactly as \`note()\` does. Live, call at least \`leadIn\` ahead of the beat: an event already in the past reaches the kernel late, and an opening consonant gets shorter or is lost. Leave \`at\` out and a live line starts as soon as its opening consonants can all still sound. Inside a clock callback, aim the line a little after \`t\`, as the examples do, because the callback runs only a short way ahead of its tick.

## Writing lyrics

| You write | It sings |
|---|---|
| \`twinkle little star\` | one syllable per note, split by the syllable rules |
| \`ti-ger\` | a hyphen inside a word splits it across notes |
| \`-\` or \`~\` on its own | the vowel held onto the next note (a melisma) |
| \`,\` \`.\` \`;\` \`:\` \`!\` \`?\` or a line break | the phrase ends with a breath |
| \`{ note: null, dur: '4n' }\` | a rest, which also ends a phrase |
| \`/ˈlɪt.əl/\` | IPA between slashes: a dot splits syllables, a space splits words |

English words also get their accent's t and l: in the default General American, the flap (the t in "little" becomes ɾ) and dark l at the end of a word. Pass \`{ allophones: false }\` for classical diction, which sings every t and l as written. IPA is always sung as written, in any accent.

Words go through English letter-to-sound rules, with the common short words, the irregular common words and the contractions built in. Measured against the CMU dictionary they read about three common lyric words in four exactly, and most of the rest differ only in an unstressed vowel. Write a word they misread as IPA. A word with no vowel ("hmm", "shh") keeps its note on its most sonorous sound. A symbol the engine has no sound for is listed in \`plan.unknown\` rather than thrown, and its span keeps the sound before it.

For dictionary pronunciations, load a CMUdict file (the Carnegie Mellon Pronouncing Dictionary, BSD licensed) and hand it to bellows. None ships, and this site loads none, so the examples here use IPA where the rules fail.

\`\`\`js
const text = await (await fetch('/cmudict.dict')).text();  // your own copy
alto.dictionary = parseCmudict(text);                      // every line from now on
\`\`\`

\`opts.dictionary\` does the same for one line, in place of the singer's. Words the dictionary in use lacks go through the rules.

## Accents

\`singer.accent\` (or \`singer(b, params, { accent })\`) sets the accent every line is read in, and \`opts.accent\` sets it for one line. The default is \`'general-american'\`; the others built in are \`'southern-british'\`, \`'london'\`, \`'australian'\`, \`'new-zealand'\`, \`'irish'\`, \`'scottish'\` and \`'southern-us'\`.

\`\`\`js
alto.accent = 'southern-british';
alto.sing('the water in the bath was far too hot', melody, { at });
alto.sing('the water in the bath was far too hot', melody, { at: later, accent: 'scottish' });
\`\`\`

An accent is mostly its vowels. The reader names the vowel of every English word by its lexical set, J. C. Wells's names for "the vowel in": KIT, DRESS, TRAP, LOT, STRUT, FOOT, BATH, CLOTH, NURSE, FLEECE, FACE, PALM, THOUGHT, GOAT, GOOSE, PRICE, CHOICE, MOUTH, NEAR, SQUARE, START, NORTH, FORCE, CURE, and the weak happY, lettER and commA. An accent says how it voices each set: Southern British sings BATH with PALM's vowel and GOAT as əʊ, Australian fronts GOOSE to ʉ, Irish keeps FACE and GOAT as long single vowels. Two vowels make a diphthong, and the accent sets how long the first is held before the glide.

It also sets the consonants: whether r after a vowel is said (a non-rhotic accent still links it before a vowel, "far away"), t (flapped, released, or a glottal stop), l (dark after a vowel, clear, dark everywhere, or vocalized to a w), th (fricative, stopped to t and d, or fronted to f and v), r (approximant or tap), and whether h is dropped.

An accent is plain data, so a new one starts from a built-in:

\`\`\`js
const mine = { ...ACCENTS.irish, id: 'mine', name: 'Mine',
  sets: { ...ACCENTS.irish.sets, FACE: 'eɪ', GOAT: 'oʊ' }, th: 'fricative' };
alto.sing('they think it goes', melody, { accent: mine });
\`\`\`

## Speaking

\`speak(text, opts?)\` says text instead of singing it. Each clause is a phrase. Stressed syllables take about twice as long as unstressed ones, the last syllable of a phrase lengthens, function words take their weak forms ("the" ðə), the pitch sinks across the phrase, each stressed syllable gets a rise, and the phrase ends falling, or rising for a question. The accent sets that melody: Australian and New Zealand statements end rising, Southern British has the widest range, Southern US speaks slowest.

\`\`\`js
alto.speak('Good morning. Where are you from?', { accent: 'australian', hz: 120, rate: 1 });
\`\`\`

## Checking a pronunciation

\`toIPA(text, opts?)\` shows what will be said, and \`pronounce(text, opts?)\` gives it word by word, with each syllable and the lexical set of each vowel. Its \`syllables\` can be edited and passed to \`sing()\` in place of the text.

\`\`\`js
toIPA('far away', { accent: 'southern-british' });   // 'fɑɹ ə.ˈweɪ'
pronounce('hello').words[0].sets;                     // [undefined, 'GOAT']
\`\`\`

## The sounds

The engine knows 53 sounds plus silence, as IPA. \`VOCAL_PHONEMES\` is the list in order, and \`vocalPhonemeIndex(ipa)\` turns a symbol into the number the \`phoneme\` parameter takes.

| Kind | IPA |
|---|---|
| Vowels | ɑ æ ʌ ɔ ɛ ɝ ɪ i ʊ u e o a ə, and for other accents ɒ ɐ ɜ ʉ ɨ ɘ ɵ y ø œ ɯ ɤ |
| Stops | p b t d k g ʔ, and the tap ɾ |
| Fricatives | f v θ ð s z ʃ ʒ h |
| Affricates | tʃ dʒ |
| Nasals | m n ŋ |
| Approximants | l ɹ w j, and the dark ɫ that ends a word like "little" |

Diphthongs such as aɪ, aʊ, oʊ and eɪ are sung as their two vowels: in General American the first holds for four fifths of the vowel and the move to the second comes at the end, and an accent sets its own timing. Common spellings of the same sound are accepted: ɚ for ɝ, r for ɹ, ɡ for g, ʧ and ʤ for tʃ and dʒ. The vowels other accents need were found by fitting the mouth's shape to each vowel's measured resonances and checking the result through the voice itself; they are added after the first 42 sounds, so a saved \`phoneme\` number keeps its sound.

To hold one sound without a lyric, set it and play notes:

\`\`\`js
alto.param('phoneme', vocalPhonemeIndex('m'));  // a hum
alto.note('A3', { dur: '2n' });
\`\`\`

## The voice

| Param | Range, default | What it does |
|---|---|---|
| \`body\` | 0 to 2, 0 | 0 male, 1 female, 2 child; values in between blend |
| \`tension\` | 0 to 1, 0.55 | how pressed the folds are at velocity 0.8: soft and dark at 0, pressed and bright at 1. Louder notes press harder on their own |
| \`breath\` | 0 to 1, 0.15 | how far the folds rest apart; the hiss of the air through them follows on its own |
| \`roughness\` | 0 to 1, 0.1 | cycle to cycle unevenness (jitter and shimmer) |
| \`fry\` | 0 to 1, 0 | creak, the low rattle at the bottom of a voice |
| \`drift\` | 0 to 20 cents, 6 | slow wander in pitch |
| \`vibratoRate\`, \`vibratoDepth\`, \`vibratoDelay\` | 0 to 12 Hz, 5.5; 0 to 2 st, 0.3; 0 to 1 s, 0.25 | vibrato that blooms into a held note after the delay |
| \`glide\` | 0.005 to 0.5 s, 0.17 | the time scale of a note change; with the defaults a change is half way 46 ms in |
| \`overshoot\` | 0 to 0.5, 0.095 | how far the pitch passes a new note before settling, as a fraction of the interval |
| \`preparation\` | 0 to 1, 0.25 | how far the pitch first moves the wrong way before a note change |
| \`ring\` | 0 to 1, 0 | the singer's formant: a narrowed larynx tube that lifts the band near 3 kHz, by about 1 dB as measured: a slight edge, not a ring |
| \`tuning\` | 0 to 1, 0 | on high notes the jaw opens so the first resonance stays above the pitch, as trained sopranos do |
| \`glottis\` | 0 to 2, 2 | the vocal folds: 2 a drawn pulse (the default), 0 folds whose swing follows the air pressure across them, 1 folds that vibrate on their own and are steered to the note. A sounding voice changes at its next note. The pulse is the closest to CHIMERA's. The self-oscillating folds hold a held pitch best and react to the air as real folds do, so a consonant can bend the pitch; near 500 Hz they can lock onto the vowel's first resonance (\`tuning\` helps). The geometric folds get darker, not brighter, as a note gets louder |
| \`articulation\` | 0.25 to 4, 1 | speed of every mouth movement; 2 is twice as quick |
| \`attack\`, \`release\` | 0.001 to 1 s, 0.02; 0.01 to 2 s, 0.15 | how a phrase starts and dies away |
| \`level\` | 0 to 2, 1 | output level |

Velocity is breath: it sets the pressure in the lungs, so a louder note is also brighter and more pressed (except on the geometric folds). A phrase is sung at its first note's velocity. \`nextPhoneme\` and \`nextIn\` are how \`sing()\` tells the voice what comes next so the mouth can start moving early; you rarely set them yourself.

\`phoneme\` and \`bend\` are the instrument's own sound and pitch offset. While a line sings they belong to it: any change to either reaches the line, so keep \`param()\` calls on them clear of sung lines. When a line ends the instrument gets back the values it was created with, or the last ones an untimed \`param()\` gave it.

## Harmony, and lines that meet

One singer sings one line at a time, because \`phoneme\` and \`bend\` are channel parameters. Give each part its own \`singer()\`. Pitches go through \`b.tuning\` like every other note, so a choir in just intonation is one assignment: the VOCAL: THREE PARTS, JUST TUNED example in [Code mode](/#code) switches between 12-EDO and pure thirds on every pass. [Tuning](/docs/tuning) covers the tunings themselves.

A line that would start while the same singer is still singing starts where the earlier line ends, losing the opening consonants that overlapped it, and \`plan.trimmed\` says how much went. End a line on a rest, or on a shorter last note, to leave the next one room for its lead-in.

## What it is and is not

The voice is an articulatory synthesizer: a physical model of a singer. The lyric moves 17 articulators (jaw, tongue body and tip, lips, velum and the rest) between targets, overlapping them as speech does. Their positions become the shape of the throat and mouth, and the air from the lungs flows through that shape in a waveguide airway. Pressure building behind closed lips, the burst when they open, voicing that fades through a closure, the hiss of a narrow gap and the hum through the nose all come out of the flowing air, not out of rules. One voice costs about a microsecond a sample at 48 kHz (1.07 to 1.12 in the worst case measured on an M1). It sings and speaks English, in eight accents, and IPA. It is not a full text-to-speech system: its speech melody is a simple model, and words it does not know go through spelling rules.

bellows-voice owes a large debt to [CHIMERA](https://github.com/jamesondh/chimera-vocal-synth), Jameson Hodge's physical-model voice synthesizer (MIT). The articulators and their speeds, the gesture planner, the mouth geometry, the airway's physical elements, the glottal source and the lyric front end are ported from it or learned from its code. What bellows-voice adds: the airway is a waveguide that carries the air at the output rate, so it runs at about a quarter of CHIMERA's cost; the pitch prepares, overshoots and follows breath pressure as a singer's does; the singer's formant and high-note tuning are parameters; and the voice is calibrated against measurements of human speech as well as against CHIMERA.
`,
};

export default page;
