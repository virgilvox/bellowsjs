import type { DocPage } from '../types';

const page: DocPage = {
  slug: 'singing',
  title: 'Singing and speech',
  blurb: 'A physical model of a singer: lyrics, speech, twenty accents, IPA and the mouth, in the bellows-voice package.',
  prev: 'engines',
  next: 'presets',
  body: `
By the end of this page you can make a singer sing a lyric on a melody, make it speak, choose one of thirteen starter voices or make your own, give it any of thirty-one accents or one of your own, check what it will say before it says it, draw its mouth, fix a word it reads wrongly, and stack singers into harmony in any tuning.

**Try it first.** The [Voice Lab](/#code/voice-lab) in Code mode has all of this behind controls: type a line, choose a voice and an accent (both searchable), speak or sing it, and watch the mouth follow along. Every parameter, holding a single sound, and the code for your settings are folded underneath. Its SHOW CODE button writes your settings out as code. The other VOCALS examples there each take one idea further.

## Installing the voice

The voice is its own package, \`bellows-voice\`, beside \`bellowsjs\`. It is a plugin: its engine loads into the AudioWorklet beside the kernel, so a page that never sings never carries it.

\`\`\`js
// npm install bellowsjs bellows-voice
import { Bellows } from 'bellowsjs';
import { voice, singer } from 'bellows-voice';

const b = await Bellows.boot({ plugins: [voice] });   // or, after boot: await b.use(voice)
\`\`\`

In a single HTML file with no bundler, load both from a CDN and map the name \`bellowsjs\` with an import map. bellows-voice imports bellows by that name, and the map is also what gives the page and the voice one copy of bellows; with two copies, \`singer()\` cannot see the plugin and throws.

\`\`\`html
<script type="importmap">
  { "imports": { "bellowsjs": "https://cdn.jsdelivr.net/npm/bellowsjs@0.5/dist/bellows.js" } }
</script>
<script type="module">
  import { Bellows } from 'bellowsjs';
  import { voice, singer } from 'https://cdn.jsdelivr.net/npm/bellows-voice@0.4/dist/index.js';
  document.querySelector('#go').onclick = async () => {
    const b = await Bellows.boot({ plugins: [voice] });
    singer(b, { body: 1 }).speak('Hello from a single file.');
  };
</script>
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

## Starter voices

\`singer()\` takes a starter voice by id in place of params:

\`\`\`js
const soprano = singer(b, 'soprano');
const host = singer(b, 'narrator-female', { accent: 'irish' });
host.speak('Good evening, and welcome.');   // at her own speaking pitch, 199 Hz
\`\`\`

| Id | Group | Sings | Speaks at | What it is |
|---|---|---|---|---|
| \`narrator-male\` | male | G2 to E4 | 115 Hz | a steady, clear speaking voice at the male conversational mean |
| \`narrator-female\` | female | G3 to E5 | 199 Hz | the same at the female mean, a little breathier, as women's voices are on average |
| \`child\` | child | A3 to A5 | 240 Hz | a child of about ten: the smallest tract |
| \`bass\` | male | E2 to E4 | 98 Hz | the lowest classical voice, dark and slow to move |
| \`baritone\` | male | A2 to A4 | 110 Hz | the middle male voice |
| \`tenor\` | male | C3 to C5 | 130 Hz | the high male voice: a slightly shorter tract, brighter and pressed |
| \`contralto\` | female | F3 to F5 | 180 Hz | the lowest female voice |
| \`mezzo\` | female | A3 to A5 | 195 Hz | the middle female voice |
| \`soprano\` | female | C4 to C6 | 215 Hz | the highest, with the jaw opening on high notes as trained sopranos do |
| \`pop-female\`, \`pop-male\` | female, male | G3 to E5, C3 to A4 | 205, 120 Hz | light and breathy, little vibrato and that only on long notes |
| \`rock\` | male | A2 to A4 | 115 Hz | pressed and rough, with creak at the bottom |
| \`elder\` | male | G2 to D4 | 125 Hz | an older man: more shimmer, a wandering pitch, a slow wide wobble |

\`VOICE_PRESETS\` is the list as data (id, name, group, description, params, speechHz, range), for a menu. A preset is a starting point: \`singer(b, 'tenor')\` then \`.param('breath', 0.3)\`, or spread its \`params\` into your own. Without a preset, \`speak()\` defaults to the norm for the body, 115 Hz male, 199 Hz female, 240 Hz child, interpolated between; \`singer.speechHz\` or \`opts.hz\` sets it.

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

## Speaking

\`speak(text, opts?)\` says text instead of singing it.

\`\`\`js
alto.speak('Good morning. Where are you from?', { accent: 'australian', hz: 120, rate: 1 });
\`\`\`

| Option | Default | What it does |
|---|---|---|
| \`at\` | as soon as the opening consonants can sound | context time the first vowel lands |
| \`accent\` | the singer's | how the words are said, and the melody they are said with |
| \`hz\` | 110 | the speaker's baseline pitch |
| \`rate\` | 1 | speed over the accent's own |
| \`dictionary\`, \`allophones\` | the singer's, true | as for \`sing()\` |

Speech is a line the voice plans itself. Each clause (up to a comma, full stop, question mark, colon or line break) is a phrase with a short breath after it. Function words take their weak forms ("the" ðə, "and" ənd). A stressed syllable takes about twice as long as an unstressed one, the last syllable of a phrase lengthens by half, and each consonant takes its spoken length. The pitch follows a simple reading of English intonation: a baseline that sinks across the phrase, a rise on each stressed syllable (the first one highest), and on the phrase's last stressed syllable the tune that ends it, a fall below the baseline or a rise above it, moving inside that syllable when it is the last. A clause that ends in "?" rises whatever the accent.

The accent's \`prosody\` sets all of that: \`tune\` ('fall' or 'rise'), \`range\` (how high a stressed syllable goes, in semitones), \`declination\` (how far the baseline sinks), \`rate\`, and \`stressRatio\` (how much longer a stressed vowel is than an unstressed one). That last one is what separates stress-timed English, where unstressed syllables are squeezed (2, General American and British), from the syllable-timed Englishes of India, Nigeria, Singapore and the Caribbean, where every syllable takes nearly the same time (1 to 1.3). Australian, New Zealand, Geordie, Belfast and Welsh statements end rising; Southern British and Welsh have the widest ranges; Southern US speaks slowest.

It is a model of read speech, not of a person: one melody per clause, no emphasis you did not write. For a line that must land exactly, sing it on notes you choose: \`{ hz }\` notes and \`{ seconds }\` durations make \`sing()\` a speech editor.

## Accents

\`singer.accent\` (or \`singer(b, params, { accent })\`) sets the accent every line is read in, and \`opts.accent\` sets it for one line. Thirty-one are built in, each with a \`region\` (\`ACCENT_REGIONS\` lists them in order) and each a broad transcription of the accent's mainstream form from the published lexical-set tables (Wells, and the Handbook of Varieties of English), not a recording of any one speaker. The last column is what each says for "The water in the bath was far too hot." straight from \`toIPA()\`.

| Accent | Region | What you hear | "The water in the bath was far too hot." |
|---|---|---|---|
| \`general-american\` | North America | rhotic; flapped t (water); dark l after a vowel; diphthongs held long | ðə ˈwɔ.ɾɚ ɪn ðə bæθ wɑz fɑɹ tu hɑt |
| \`canadian\` | North America | cot and caught merge; Canadian raising: price, house start high before p t k f s | ðə ˈwɒ.ɾɚ ɪn ðə baθ wɒz fɑɹ tu hɒt |
| \`californian\` | North America | fronted GOOSE and GOAT; TRAP lowered; cot and caught merge | ðə ˈwɑ.ɾɚ ɪn ðə baθ wɑz fɑɹ tʉ hɑt |
| \`new-york\` | North America | non-rhotic; raised THOUGHT (oə); tensed BATH (eə) | ðə ˈwoə.ɾəɹ ɪn ðə beəθ wɑz fɑ tu hɑt |
| \`boston\` | North America | non-rhotic; START fronted (pahk the cah); cot and caught merge; PRICE raised | ðə ˈwɒ.ɾəɹ ɪn ðə baθ wɒz fa tu hɒt |
| \`inland-north\` | North America | the Northern Cities Shift: TRAP raised to eə, LOT fronted to a, STRUT backed | ðə ˈwɑ.ɾɚ ɘn ðə beəθ waz fɑɹ tu hat |
| \`southern-us\` | North America | PRICE a single long vowel (pɹas); GOAT and GOOSE fronted; dark l | ðə ˈwɒɔ.ɾɚ ɪn ðə bæθ wɑz fɑɹ tʉ hɑt |
| \`received-pronunciation\` | England | the traditional standard: TRAP æ, STRUT ʌ, SQUARE ɛə, CURE ʊə; wide tune | ðə ˈwɔ.təɹ ɪn ðə bɑθ wɒz fɑ tu hɒt |
| \`southern-british\` | England | non-rhotic with linking r; BATH with PALM vowel; GOAT əʊ; t glottalled before consonants | ðə ˈwo.təɹ ɪn ðə bɑθ wɒz fɑ tʉ hɒt |
| \`london\` | England | TH-fronting (fink, bruvver); h dropped; glottal t; vocalized l (mɪwk) | də ˈwo.ʔəɹ ɪn də bɑf wɒz fɑ tʉ ɒʔ |
| \`west-country\` | England | rhotic, rare in England; PRICE ɐɪ; FACE and GOAT single vowels | ðə ˈwɒ.tɚ ɪn ðə baθ wɒz faɹ tʉ hɒt |
| \`brummie\` | England | PRICE ɔɪ, FACE ʌɪ, GOAT ʌʊ; a level, narrow tune; h dropped | ðə ˈwɔ.təɹ ɪn ðə baθ wɒz fɑ təʉ ɒt |
| \`scouse\` | England | NURSE and SQUARE merge (fur and fair); FOOT and STRUT merge; tapped r; statements rise | ðə ˈwɔ.təɾ ɪn ðə baθ wɒz fɑ tʉ hɒt |
| \`northern-english\` | England | FOOT and STRUT merge; short BATH; FACE and GOAT single vowels; h dropped | ðə ˈwo.təɹ ɪn ðə baθ wɒz fa tu ɒt |
| \`geordie\` | England | FOOT and STRUT merge; FACE eə, GOAT ɵ, NURSE ø, MOUTH u; statements rise | ðə ˈwɒ.tɐɹ ɪn ðə baθ wɒz fɑ tʉ hɒt |
| \`scottish\` | Scotland, Wales and Ireland | rhotic with tapped r; FOOT and GOOSE merge as ʉ; NURSE ʌɾ; dark l | ðə ˈwɔ.təɾ ɘn ðə baθ wɔz faɾ tʉ hɔt |
| \`welsh\` | Scotland, Wales and Ireland | tapped r, non-rhotic; clear l; PRICE əɪ; a rising, lilting tune | ðə ˈwo.təɾ ɪn ðə baθ wɒz fa tʉ hɒt |
| \`irish\` | Scotland, Wales and Ireland | TH-stopping (tink, dis); FACE and GOAT long single vowels; clear l; rhotic | də ˈwɒ.tɚ ɪn də bat wɑz faɹ tu hɑt |
| \`northern-irish\` | Scotland, Wales and Ireland | statements rise; FACE eə; MOUTH ɘʉ; fronted GOOSE and FOOT | ðə ˈwɔ.ɾɚ ɘn ðə bɑθ wɔz fɑɹ tʉ hɔt |
| \`australian\` | Southern hemisphere | non-rhotic; GOAT ɐʉ, PRICE ɒe, FACE æɪ; fronted GOOSE; statements rise | ðə ˈwo.ɾəɹ ɪn ðə bɐθ wɔz fɐ tʉ hɔt |
| \`new-zealand\` | Southern hemisphere | KIT centralized to ɘ; DRESS raised; NURSE ø; statements rise | ðə ˈwo.ɾɘɹ ɘn ðə bɐθ wɒz fɐ tʉ hɒt |
| \`south-african\` | Southern hemisphere | non-rhotic; NURSE ø; GOAT œʊ; BATH ɑ; clear l | ðə ˈwo.təɹ ɪn ðə bɑθ wɒz fɑ tʉ hɒt |
| \`nigerian\` | Africa | no central vowels (STRUT ɔ, NURSE ɛ); TH-stopping; tapped r; syllable-timed | də ˈwɔ.taɾ in də bat wɔz fa tu hɔt |
| \`ghanaian\` | Africa | five full vowels, schwa as a; TH-stopping; syllable-timed | də ˈwɔ.taɹ in də bat wɔz fa tu hɔt |
| \`kenyan\` | Africa | five vowels as in Swahili; tapped r; th kept; syllable-timed | ðə ˈwɔ.taɾ in ðə baθ wɔz fa tu hɔt |
| \`jamaican\` | Caribbean | FACE ie, GOAT uo; TRAP and LOT merge; TH-stopping; h dropped; syllable-timed | də ˈwa.taɹ ɪn də bat waz fa tu at |
| \`trinidadian\` | Caribbean | STRUT ɔ; TH-stopping; a wide, rising, lively tune | də ˈwɒ.taɹ ɪn də bat wɒz fa tu hɒt |
| \`indian\` | Asia | FACE and GOAT single vowels; TH-stopping; tapped r; syllable-timed | də ˈwɔ.təɾ ɪn də bɑt wɒz fɑɾ tu hɒt |
| \`singaporean\` | Asia | long and short pairs merge (KIT with FLEECE); glottal final t; syllable-timed | də ˈwɔ.təɹ in də bɑt wɔz fɑ tu hɔt |
| \`filipino\` | Asia | five vowels; rhotic with a tap; TH-stopping; syllable-timed | də ˈwɔ.tɛɾ in də bat wɔz faɾ tu hɔt |
| \`russian\` | Europe | th as s and z (zis, sink); w as v; final voiced consonants devoiced (dok); KIT with FLEECE; tapped r | zə ˈvɔ.tɛɾ in zə bas vɔs faɾ tu hɔt |

\`\`\`js
alto.accent = 'scottish';
alto.sing('the water in the bath was far too hot', melody, { at });
alto.speak('Where are you from?', { accent: 'jamaican' });   // one line in another accent
\`\`\`

### What an accent is made of

An accent is mostly its vowels. The reader names the vowel of every English word by its lexical set, J. C. Wells's names for "the vowel in" a keyword, which let you talk about a vowel without saying how any one accent says it:

| Set | Words | Set | Words | Set | Words |
|---|---|---|---|---|---|
| KIT | ship, bit | FLEECE | see, keep | NEAR | here, beer |
| DRESS | step, bed | FACE | day, wait | SQUARE | care, fair |
| TRAP | cat, map | PALM | father, calm | START | car, heart |
| LOT | hot, stop | THOUGHT | caught, law | NORTH | for, war |
| STRUT | cup, love | GOAT | go, home | FORCE | four, more |
| FOOT | put, good | GOOSE | too, food | CURE | pure, tour |
| BATH | bath, dance | PRICE | ride, time | happY | the y of happy |
| CLOTH | cloth, dog | CHOICE | boy, coin | lettER | the er of letter |
| NURSE | bird, word | MOUTH | how, down | commA | the a of comma |

General American merges some of these (LOT with PALM in "bother" and "father", TRAP with BATH), so the reader separates them by spelling: "calm" is PALM, "cot" is LOT, "bath", "staff" and "dance" are BATH. Each field of an accent:

| Field | What it sets |
|---|---|
| \`sets\` | each lexical set's vowel, as IPA: one vowel (\`'e'\`), a diphthong (\`'əʊ'\`), or a vowel and an r (\`'ʌɾ'\`). A set left out keeps General American's |
| \`rhotic\` | whether r after a vowel is said ("car"). A non-rhotic accent still says it before a vowel ("far away") |
| \`t\` | 'flap' (water with a tap), 'released', 'glottal-coda' (a glottal stop before a consonant), 'glottal' (also between vowels and before a pause) |
| \`l\` | 'dark-coda' (dark after a vowel), 'clear', 'dark' (everywhere), 'vocalized' (milk as mɪwk) |
| \`th\` | 'fricative', 'stop' (think as tɪŋk), 'front' (think as fɪŋk, brother as bɹɐvə), 'sibilant' (think as sɪŋk, this as zɪs) |
| \`r\` | 'approximant' or 'tap' |
| \`hDrop\` | drops h at the start of a word |
| \`replace\` | consonants said as others everywhere: \`{ w: 'v' }\` for west as vest |
| \`devoiceFinal\` | devoices a voiced stop or fricative that ends a word: bed as bet, dog as dok |
| \`raised\` | vowels used before a voiceless consonant in the same word: Canadian "price" and "house" against "prize" and "how" |
| \`hold\`, \`holds\` | how long a diphthong holds its first vowel before gliding, overall and per set |
| \`prosody\` | the speech melody: tune, range, declination, rate, stressRatio (Speaking, above) |

So a new accent starts from a built-in, and anything can change:

\`\`\`js
import { ACCENTS } from 'bellows-voice';
const mine = {
  ...ACCENTS.irish, id: 'mine', name: 'Irish, with diphthongs',
  sets: { ...ACCENTS.irish.sets, FACE: 'eɪ', GOAT: 'oʊ' },
  th: 'fricative',
  prosody: { ...ACCENTS.irish.prosody, tune: 'rise' },
};
alto.sing('they think it goes', melody, { accent: mine });
\`\`\`

Every vowel an accent names must be one the voice has (The sounds, below). Writing a word as IPA between slashes takes it out of the accent's hands: it is sung exactly as written.

## Checking a pronunciation

\`toIPA(text, opts?)\` shows what will be said, and \`pronounce(text, opts?)\` gives it word by word: each word's spelling, its IPA with stress marks and syllable dots, its syllables, and the lexical set of each vowel. Both take \`accent\`, \`dictionary\` and \`allophones\`, read exactly as \`sing()\` reads, and need no audio: they are also in \`bellows-voice/text\`, which a page, a server or a test can use without bellows. \`pronounce(text).syllables\` can be edited (a vowel changed, a syllable's stress moved) and passed to \`sing()\` in place of the text.

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

## Seeing the mouth

\`bellows-voice/view\` runs the voice's own geometry, the one the engine runs, on the same per-phoneme articulator targets, so a page can draw what the mouth is doing. A consonant's targets overlay the vowel's posture as they do in the engine (what /m/ does not set stays where the vowel put it), the velum lowers for a nasal, and each articulator moves toward its target at the engine's own speed.

\`\`\`js
import { TractModel } from 'bellows-voice/view';

const tract = new TractModel(1);                 // body: 0 male, 1 female, 2 child
const plan = alto.sing(lyric, melody, { at });
const spans = plan.phrases.flatMap((p) => p.spans);

function frame() {
  const now = b.now();
  const span = spans.find((s) => now >= s.start && now < s.end);
  tract.target(span ? span.ipa : '_');
  tract.step(1 / 60);
  const { upper, lower, area, velumPort, lipArea } = tract.shape();
  // upper and lower are x, y pairs in centimetres from the glottis to the lips: draw them
  requestAnimationFrame(frame);
}
\`\`\`

\`shape()\` gives the upper wall (the back of the throat, the palate, the upper lip) and the lower wall (the tongue, the floor of the mouth, the lower lip) as point pairs, the cross-sectional area at each, the opening into the nose and between the lips, the tongue tip, and where the throat turns into the mouth. The Voice Lab's mouth is drawn from exactly this. It follows the plan, not the audio, so it shows the targets the voice is moving toward on the timing the line was planned with.

## Harmony, and lines that meet

One singer sings one line at a time, because \`phoneme\` and \`bend\` are channel parameters. Give each part its own \`singer()\`. Pitches go through \`b.tuning\` like every other note, so a choir in just intonation is one assignment: the VOCAL: THREE PARTS, JUST TUNED example in [Code mode](/#code) switches between 12-EDO and pure thirds on every pass. [Tuning](/docs/tuning) covers the tunings themselves.

A line that would start while the same singer is still singing starts where the earlier line ends, losing the opening consonants that overlapped it, and \`plan.trimmed\` says how much went. End a line on a rest, or on a shorter last note, to leave the next one room for its lead-in.

## Rendering, Node, and the text alone

\`b.render()\` renders through the worklet with the plugin loaded, exactly as it plays, so a sung line inside a clock callback exports sample for sample as you heard it. To render with \`renderOffline()\` or in Node without a worklet, register the engine on that thread first:

\`\`\`js
import { registerBuiltins, renderOffline } from 'bellowsjs';
import { registerVoice } from 'bellows-voice/engine';
registerBuiltins();
registerVoice();
\`\`\`

| Import | What it has | Gzipped |
|---|---|---|
| \`bellows-voice\` | \`voice\` (the plugin), \`singer\`, \`ACCENTS\`, the text layer, \`VOCAL_PHONEMES\` | about 50 KB, nearly all of it the engine's worklet script |
| \`bellows-voice/text\` | lyrics, accents, \`toIPA\`, \`pronounce\`, \`speechPlan\`: no audio, no bellows | small |
| \`bellows-voice/engine\` | \`vocalEngine\`, \`registerVoice()\`, the glottal source: the DSP on this thread | about 26 KB |
| \`bellows-voice/view\` | \`TractModel\`: the mouth, for drawing | shares the engine's geometry |
| \`bellows-voice/worklet.js\` | the plugin script as a file, for a host whose CSP blocks blob: URLs (\`{ ...voice, workletUrl }\`) | |

## Measured against people

The voice is checked against published human data, and tuned where it missed (the [bellows-voice repository](https://github.com/virgilvox/bellows-voice) has the full write-up in docs/VOICE-NORMS.md, and a test gates each result):

- **The source is a healthy one.** Jitter and shimmer (cycle-to-cycle wobble in pitch and loudness) measure 0.7 to 0.8 percent and 2.2 to 3.0 percent at each body's speaking pitch, under the clinical screening limits (1.04 and 3.81 percent) and near the healthy means. The old default roughness, 0.1, measured past both limits, which is what made the default voice sound old; it is now 0.02.
- **The tract is the right size.** Every body's ten General American vowels sit within about 4.5 percent of Hillenbrand et al.'s 1995 measurements of men, women and children in F1, and 2 to 3.5 percent in F2. Vowels that were up to 12 percent out were re-solved per body against those measurements with the voice's own vowel solver, keeping a new shape only where it measured closer and no rougher; the open /ɑ/ stays as it was, because every shape that fit it better made the voice rougher.
- **Each voice speaks where people do**: the starter voices' speaking pitches sit inside Baken's published ranges for men, women and children, and their singing ranges are the classical voice types'.

## What it is and is not

The voice is an articulatory synthesizer: a physical model of a singer. The lyric moves 17 articulators between targets, overlapping them as speech does:

| Articulators | What they move |
|---|---|
| \`jaw\` | how far the mouth opens |
| \`tbX\`, \`tbY\`, \`dorsum\`, \`root\` | the tongue body forward and up, its back, and its root in the throat |
| \`ttX\`, \`ttY\`, \`ttCurl\`, \`lateral\` | the tongue tip, its curl, and the side opening of an l |
| \`lipAp\`, \`lipProt\`, \`lipWidth\`, \`labiodental\` | the lips: open, pushed forward, spread, and the lower lip to the teeth for f and v |
| \`velum\` | the soft palate, down for m, n and ŋ |
| \`larynx\`, \`epilarynx\`, \`ventricular\` | the voice box's height and the tubes above the folds |
 Their positions become the shape of the throat and mouth, and the air from the lungs flows through that shape in a waveguide airway. Pressure building behind closed lips, the burst when they open, voicing that fades through a closure, the hiss of a narrow gap and the hum through the nose all come out of the flowing air, not out of rules. One voice costs about a microsecond a sample at 48 kHz (1.07 to 1.12 in the worst case measured on an M1). It sings and speaks English, in twenty accents, and IPA. It is not a full text-to-speech system: its speech melody is a simple model, and words it does not know go through spelling rules.

bellows-voice owes a large debt to [CHIMERA](https://github.com/jamesondh/chimera-vocal-synth), Jameson Hodge's physical-model voice synthesizer (MIT). The articulators and their speeds, the gesture planner, the mouth geometry, the airway's physical elements, the glottal source and the lyric front end are ported from it or learned from its code. What bellows-voice adds: the airway is a waveguide that carries the air at the output rate, so it runs at about a quarter of CHIMERA's cost; the pitch prepares, overshoots and follows breath pressure as a singer's does; the singer's formant and high-note tuning are parameters; and the voice is calibrated against measurements of human speech as well as against CHIMERA.
`,
};

export default page;
