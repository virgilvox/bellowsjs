import type { DocPage } from '../types';

const page: DocPage = {
  slug: 'singing',
  title: 'Singing',
  blurb: 'Words on a melody: the vocal engine and sing().',
  prev: 'engines',
  next: 'presets',
  body: `
By the end of this page you can make an instrument sing a lyric on a melody, fix a word it reads wrongly, and stack singers into harmony in any tuning.

## A first line

\`\`\`js
const singer = b.voice('vocal', { body: 1 });   // 0 male, 1 female, 2 child
const plan = singer.sing('twinkle twinkle /ˈlɪt.əl/ star', [
  { note: 'C4', dur: '4n' }, { note: 'C4', dur: '4n' },
  { note: 'G4', dur: '4n' }, { note: 'G4', dur: '4n' },
  { note: 'A4', dur: '4n' }, { note: 'A4', dur: '4n' },
  { note: 'G4', dur: '2n' },
], { at: b.now() + 0.5 });
\`\`\`

\`sing(lyrics, notes, opts?)\` needs an instrument on the \`vocal\` engine and throws on any other. Each note is \`{ note, dur, vel? }\`: \`note\` takes everything [\`note()\`](/docs/playing-notes) takes (a name, a midi number, \`{ hz }\`, or \`{ degree, octave }\` through \`opts.scale\`), and \`null\` is a rest. \`dur\` is beats, notation like \`'8n'\`, or \`{ seconds }\`, through the tempo map. The notes are laid end to end from \`opts.at\`, the time of the first beat.

Played with \`note()\` or a keyboard, the same instrument sings whatever sound it holds, "ah" unless you set its \`phoneme\`.

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

English words also get the American flap (the t in "little" becomes ɾ) and dark l at the end of a word; pass \`{ allophones: false }\` for classical diction, which sings every t and l as written. IPA is always sung as written.

Words go through English letter-to-sound rules, with the common short words, the irregular common words and the contractions built in. Measured against the CMU dictionary they read about three common lyric words in four exactly, and most of the rest differ only in an unstressed vowel. Write a word they misread as IPA. A word with no vowel ("hmm", "shh") keeps its note on its most sonorous sound. A symbol the engine has no sound for is listed in \`plan.unknown\` rather than thrown, and its span keeps the sound before it.

For dictionary pronunciations, load a CMUdict file (the Carnegie Mellon Pronouncing Dictionary, BSD licensed) and hand it to bellows. bellows ships none, and this site loads none, so the examples here use IPA where the rules fail.

\`\`\`js
const text = await (await fetch('/cmudict.dict')).text();  // your own copy
b.dictionary = parseCmudict(text);                         // every line from now on
\`\`\`

\`opts.dictionary\` does the same for one line, in place of \`b.dictionary\`. Words the dictionary in use lacks go through the rules.

## The sounds

The engine knows 41 sounds plus silence, as IPA. \`VOCAL_PHONEMES\` is the list in order, and \`vocalPhonemeIndex(ipa)\` turns a symbol into the number the \`phoneme\` parameter takes.

| Kind | IPA |
|---|---|
| Vowels | ɑ æ ʌ ɔ ɛ ɝ ɪ i ʊ u e o a ə |
| Stops | p b t d k g ʔ, and the tap ɾ |
| Fricatives | f v θ ð s z ʃ ʒ h |
| Affricates | tʃ dʒ |
| Nasals | m n ŋ |
| Approximants | l ɹ w j, and the dark ɫ that ends a word like "little" |

Diphthongs such as aɪ, aʊ, oʊ and eɪ are sung as their two vowels: the first holds for four fifths of the vowel and the move to the second comes at the end. Common spellings of the same sound are accepted: ɚ and ɜ for ɝ, r for ɹ, ɡ for g, ʧ and ʤ for tʃ and dʒ, ɒ for ɑ, ɐ for ʌ, ɨ for ɪ, ʉ for u and y for i.

To hold one sound without a lyric, set it and play notes:

\`\`\`js
singer.param('phoneme', vocalPhonemeIndex('m'));  // a hum
singer.note('A3', { dur: '2n' });
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

One instrument sings one line at a time, because \`phoneme\` and \`bend\` are channel parameters. Give each part its own \`voice('vocal')\`. Pitches go through \`b.tuning\` like every other note, so a choir in just intonation is one assignment: the VOCAL: THREE PARTS, JUST TUNED example in [Code mode](/#code/vocal-harmony) switches between 12-EDO and pure thirds on every pass. [Tuning](/docs/tuning) covers the tunings themselves.

A line that would start while the same instrument is still singing starts where the earlier line ends, losing the opening consonants that overlapped it, and \`plan.trimmed\` says how much went. End a line on a rest, or on a shorter last note, to leave the next one room for its lead-in.

## What it is and is not

The voice is an articulatory synthesizer: a physical model of a singer. The lyric moves 17 articulators (jaw, tongue body and tip, lips, velum and the rest) between targets, overlapping them as speech does. Their positions become the shape of the throat and mouth, and the air from the lungs flows through that shape in a waveguide airway. Pressure building behind closed lips, the burst when they open, voicing that fades through a closure, the hiss of a narrow gap and the hum through the nose all come out of the flowing air, not out of rules. One voice costs about a microsecond a sample at 48 kHz (1.07 to 1.12 in the worst case measured on an M1). It sings English and IPA. It is not a text-to-speech system.

The singing voice in bellows owes a large debt to [CHIMERA](https://github.com/jamesondh/chimera-vocal-synth), Jameson Hodge's physical-model voice synthesizer (MIT). The articulators and their speeds, the gesture planner, the mouth geometry, the airway's physical elements, the glottal source and the lyric front end are ported from it or learned from its code. What bellows adds: the airway is a waveguide that carries the air at the output rate, so it runs at about a quarter of CHIMERA's cost; the pitch prepares, overshoots and follows breath pressure as a singer's does; the singer's formant and high-note tuning are parameters; and the voice is calibrated against measurements of human speech as well as against CHIMERA.
`,
};

export default page;
