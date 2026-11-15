/*
 * The singing and speaking voice: the bellows-voice package, which the site loads as a plugin
 * (src/lib/audio.ts). The runner hands examples both packages as `lib`, so a singer is
 * lib.singer(b, params). Param names come from the vocal engine in bellows-voice.
 */

import type { Example } from './types';

export const voiceExamples: Example[] = [
  {
    id: 'voice-lab',
    title: 'VOICE LAB',
    category: 'VOCALS',
    lab: 'voice',
    description:
      'Everything the voice does, from controls: type a line, pick one of twenty accents, sing it on a melody or speak it, and move every parameter of the vocal engine. The IPA shows what the accent will say before it says it, and the mouth follows the line through the voice\'s own geometry as it plays. Hold any sound to hear it alone and see its shape. SHOW CODE writes your settings out as a Code mode example.',
    seed: 'voice-lab',
    code: `var singer = lib.singer(b, {}, { accent: 'general-american' });
var plan = singer.sing('The water in the bath was far too hot.', [
  { note: 'C3', dur: { seconds: 0.35 } }, { note: 'D3', dur: { seconds: 0.35 } },
  { note: 'E3', dur: { seconds: 0.35 } }, { note: 'F3', dur: { seconds: 0.35 } },
  { note: 'G3', dur: { seconds: 0.35 } }, { note: 'F3', dur: { seconds: 0.35 } },
  { note: 'E3', dur: { seconds: 0.35 } }, { note: 'D3', dur: { seconds: 0.35 } },
  { note: 'C3', dur: { seconds: 0.7 } }, { note: 'C3', dur: { seconds: 0.7 } },
  { note: null, dur: { seconds: 0.4 } },
]);
log(lib.toIPA('The water in the bath was far too hot.'));`,
  },
  {
    id: 'vocal-dialogue',
    title: 'VOCAL: A SPOKEN DIALOGUE',
    category: 'VOCALS',
    description:
      'Two speakers trade lines with speak(): a man in Southern British English and a woman from Australia. speak() reads each clause as a phrase, times it stress by stress, and gives it the accent\'s melody: his statements fall, hers rise at the end, as Australian statements often do, and a question rises in both. Each line waits for the one before through plan.phrases, so they never talk over each other.',
    seed: 'vocal-dialogue',
    code: `var him = lib.singer(b, { body: 0 }, { accent: 'southern-british' });
var her = lib.singer(b, { body: 1 }, { accent: 'australian' });

var script = [
  [him, 'Good morning. Where are you from?', 105],
  [her, 'I am from Sydney. I came over last year.', 190],
  [him, 'And do you like the weather here?', 105],
  [her, 'Not really. It rains far too much.', 190],
];

var at = b.now() + 0.4;
script.forEach(function (line) {
  var plan = line[0].speak(line[1], { at: at, hz: line[2] });
  log(line[0].accent + ': ' + lib.toIPA(line[1], { accent: line[0].accent }));
  var last = plan.phrases[plan.phrases.length - 1];
  at = last.end + 0.5;
});`,
  },
  {
    id: 'vocal-custom-accent',
    title: 'VOCAL: BUILD AN ACCENT',
    category: 'VOCALS',
    description:
      'An accent is plain data, so a new one starts from a built-in. This one takes Irish and changes four things: FACE and GOAT glide again as diphthongs, th is a fricative instead of a stop, and statements rise. The same line plays in Irish, then in the new accent, and the log shows both in IPA. Every field is listed in ACCENTS.irish: sets (one vowel per lexical set), rhotic, t, l, th, r, hDrop, raised and prosody.',
    seed: 'vocal-custom-accent',
    code: `var base = lib.ACCENTS.irish;
var mine = Object.assign({}, base, {
  id: 'mine',
  name: 'Irish, with diphthongs',
  sets: Object.assign({}, base.sets, { FACE: 'eɪ', GOAT: 'oʊ' }),
  th: 'fricative',
  prosody: Object.assign({}, base.prosody, { tune: 'rise' }),
});

var line = 'They think the boat goes over the water today.';
log('irish: ' + lib.toIPA(line, { accent: base }));
log('mine:  ' + lib.toIPA(line, { accent: mine }));

var voice = lib.singer(b, { body: 0 });
var first = voice.speak(line, { accent: base, at: b.now() + 0.3 });
var end = first.phrases[first.phrases.length - 1].end;
voice.speak(line, { accent: mine, at: end + 0.8 });`,
  },
  {
    id: 'vocal-pronounce',
    title: 'VOCAL: WHAT WILL IT SAY',
    category: 'VOCALS',
    description:
      'The text layer without the audio. pronounce() reads a line the way sing() will and returns each word with its IPA, its syllables and the lexical set of each vowel (the name an accent uses to re-voice it). Here one sentence goes through three accents, word by word, so you can see which sets each one changes. Write a word between slashes as IPA and every accent leaves it alone.',
    seed: 'vocal-pronounce',
    code: `var line = 'Father bought a new car and a bath for the house.';
['general-american', 'southern-british', 'scottish'].forEach(function (accent) {
  var p = lib.pronounce(line, { accent: accent });
  log(accent.toUpperCase());
  p.words.forEach(function (w) {
    log('  ' + w.text.padEnd(8) + w.ipa.padEnd(12) + w.sets.filter(Boolean).join(' '));
  });
});

// one short sung check of the last accent
var s = lib.singer(b, { body: 1 }, { accent: 'scottish' });
s.sing('a bath for the house', [
  { note: 'E4', dur: '8n' }, { note: 'G4', dur: '8n' }, { note: 'A4', dur: '8n' },
  { note: 'G4', dur: '8n' }, { note: 'E4', dur: '4n' },
], { at: b.now() + 0.3 });`,
  },
  {
    id: 'vocal-vowel-sequencer',
    title: 'VOCAL: VOWEL SEQUENCER',
    category: 'VOCALS',
    description:
      'No lyrics: one held note, with the phoneme param stepped on the clock. Each step names a sound by its IPA through vocalPhonemeIndex, and the voice glides its tongue, jaw and lips there at the speed a real mouth moves, so fast steps blur into diphthongs. The sequence runs through the corners of the vowel space and a few of the vowels other accents use (ɒ ʉ ø y).',
    seed: 'vocal-vowel-seq',
    code: `var drone = lib.singer(b, { body: 1, vibratoDepth: 0.2, breath: 0.12 });
var room = b.bus(['plate'], { level: 0.3 });
drone.send(room, 0.35);
b.bpm(100);

var seq = ['i', 'e', 'ɛ', 'a', 'ɑ', 'ɒ', 'ɔ', 'o', 'u', 'ʉ', 'y', 'ø', 'ə', 'm'];
var id = drone.on('A3', 0.75);
onCleanup(function () { drone.off(id); });

var off = b.clock.at('8n', function (t, step) {
  var p = seq[step % seq.length];
  drone.param('phoneme', lib.vocalPhonemeIndex(p), t);
  if (step % seq.length === 0) log('round ' + (step / seq.length + 1));
});
onCleanup(off);
b.start();`,
  },
  {
    id: 'vocal-folds-and-bodies',
    title: 'VOCAL: FOLDS AND BODIES',
    category: 'VOCALS',
    description:
      'The same phrase six times: the three vocal fold models on the male body, then the default folds on the female and child bodies, then a breathy, rough, low-tension voice. glottis 2 is a drawn pulse (the default), 0 folds whose swing follows the air pressure, 1 self-oscillating folds steered to the note. body sets the size of the tract and the folds, so the same targets give different formants.',
    seed: 'vocal-folds',
    code: `var phrase = [
  { note: 'G3', dur: { seconds: 0.4 } }, { note: 'A3', dur: { seconds: 0.4 } },
  { note: 'B3', dur: { seconds: 0.4 } }, { note: 'D4', dur: { seconds: 0.9 } },
  { note: null, dur: { seconds: 0.5 } },
];
var takes = [
  ['pulse folds, male', { body: 0, glottis: 2 }, 0],
  ['geometric folds, male', { body: 0, glottis: 0 }, 0],
  ['self-oscillating folds, male', { body: 0, glottis: 1 }, 0],
  ['female', { body: 1 }, 12],
  ['child', { body: 2 }, 19],
  ['breathy, rough, slack', { body: 1, breath: 0.6, roughness: 0.5, tension: 0.2 }, 12],
];

var at = b.now() + 0.4;
takes.forEach(function (take) {
  var s = lib.singer(b, take[1]);
  var notes = phrase.map(function (n) {
    // transposed by the take's semitones, as a pitch in Hz
    return n.note === null ? n : { note: { hz: lib.mtof(lib.parseNote(n.note) + take[2]) }, dur: n.dur };
  });
  s.sing('/la la la laː/', notes, { at: at });
  log(take[0]);
  at += 2.6;
});`,
  },
  {
    id: 'vocal-sing',
    title: 'VOCAL: SING A LYRIC',
    category: 'VOCALS',
    description:
      'The singing voice (the bellows-voice package, loaded here as a plugin) sings words on notes. lib.singer(b, params) makes a singer; singer.sing(lyrics, notes) times every consonant around its note so each vowel lands on the beat, and carries the pitch inside a phrase as bend. The site loads no pronouncing dictionary, so English goes through letter-to-sound rules; the second line is IPA between slashes, which sets the sounds directly. The line ends on a rest, so the next repeat has room for its "tw" before the beat.',
    seed: 'vocal-sing',
    code: `var singer = lib.singer(b, {
  body: 1,            // 0 male, 1 female, 2 child
  breath: 0.2,
  vibratoDepth: 0.25, // semitones, blooming in over vibratoDelay
});
singer.gain(0.9);
var room = b.bus(['plate'], { level: 0.35 });
singer.send(room, 0.4);
b.bpm(96);

// plain English: a word the rules misread could be written as IPA between slashes
var lyric = 'twinkle twinkle little star, how I wonder what you are';
var tune = ['C4', 'C4', 'G4', 'G4', 'A4', 'A4', 'G4', 'F4', 'F4', 'E4', 'E4', 'D4', 'D4', 'C4'];
var melody = tune.map(function (n, i) {
  return { note: n, dur: i === 6 ? '2n' : '4n' };
});
// one instrument sings one line at a time: the last beat is a rest, so the
// next repeat's "tw", which starts before its beat, does not cut into this one
melody.push({ note: null, dur: '4n' });

var off = b.clock.at('4m', function (t) {
  // "tw" starts before the first beat, so the line is aimed a little late
  var plan = singer.sing(lyric, melody, { at: t + 0.25 });
  log(plan.phrases.length + ' phrases, consonants lead the beat by ' +
    Math.round(plan.leadIn * 1000) + ' ms' + (plan.trimmed > 0 ? ', ' +
    Math.round(plan.trimmed * 1000) + ' ms cut by the line before' : ''));
});
onCleanup(off);
b.start();`,
  },
  {
    id: 'vocal-accents',
    title: 'VOCAL: ACCENTS',
    category: 'VOCALS',
    description:
      'One voice goes round all twenty built-in accents, from General American to Singaporean, speaking a line with speak() and then singing it. An accent re-voices each word by its lexical set (BATH, GOAT, NURSE...) and sets its r, t, l and th, so "water" and "bath" change most. speak() times the line stress by stress and gives it the accent\'s melody: Australian and New Zealand statements end rising. lib.toIPA shows what each accent says.',
    seed: 'vocal-accents',
    code: `var singer = lib.singer(b, { body: 0, vibratoDepth: 0.15 });
var room = b.bus(['plate'], { level: 0.25 });
singer.send(room, 0.3);
b.bpm(100);

var line = 'I thought the water in the bath was far too hot';
var tune = ['C3', 'D3', 'E3', 'F3', 'G3', 'F3', 'E3', 'D3', 'E3', 'D3', 'C3', 'C3'];
var melody = tune.map(function (n, i) {
  return { note: n, dur: i === tune.length - 1 ? '2n' : '8n' };
});
melody.push({ note: null, dur: '4n' });

var ids = Object.keys(lib.ACCENTS);
var turn = 0;
// six bars a turn: the spoken line, then the sung one two bars in
var off = b.clock.at('6m', function (t) {
  var accent = ids[turn++ % ids.length];
  log(lib.ACCENTS[accent].name + ': ' + lib.toIPA(line, { accent: accent }));
  // spoken first, then sung two bars later
  singer.speak(line + '.', { at: t + 0.25, accent: accent, hz: 115 });
  singer.sing(line, melody, { at: t + 0.25 + 2 * 2.4, accent: accent });
});
onCleanup(off);
b.start();`,
  },
  {
    id: 'vocal-harmony',
    title: 'VOCAL: THREE PARTS, JUST TUNED',
    category: 'VOCALS',
    description:
      'Three vocal instruments, one per part, since an instrument sings one line at a time, sing a I V IV I cadence. Every second time round b.tuning switches to five-limit just intonation, where each major third is a pure 5/4, 14 cents under its 12-EDO size. sing() resolves pitch through the tuning as note() does, so the engine never knows which temperament it is in.',
    seed: 'vocal-harmony',
    code: `var room = b.bus(['plate'], { level: 0.35 });
var parts = [
  { body: 2, pan: -0.35, notes: ['E4', 'D4', 'F4', 'E4'] }, // child
  { body: 1, pan: 0.35, notes: ['G3', 'B3', 'A3', 'G3'] },  // female
  { body: 0, pan: 0, notes: ['C3', 'G2', 'F2', 'C3'] },     // male
];
parts.forEach(function (p) {
  // little drift and vibrato, so the tuning is what you hear change
  p.singer = lib.singer(b, { body: p.body, drift: 2, vibratoDepth: 0.12 });
  p.singer.gain(0.55);
  p.singer.pan(p.pan);
  p.singer.send(room, 0.45);
});
b.bpm(72);

// C major in pure ratios from C4: E is 5/4, G 3/2, B 15/8, F 4/3, A 5/3
var just = lib.Tuning.ji(
  [1, 16 / 15, 9 / 8, 6 / 5, 5 / 4, 4 / 3, 45 / 32, 3 / 2, 8 / 5, 5 / 3, 9 / 5, 15 / 8],
  261.63, 60);
var equal = lib.Tuning.edo(12);
onCleanup(function () { b.tuning = lib.Tuning.edo(12); });

var lyric = 'we sing, /ɑ ˈmɛn/';
var beats = [2, 2, 2, 6];
var pass = 0;
var off = b.clock.at('4m', function (t) {
  var pure = pass++ % 2 === 1;
  b.tuning = pure ? just : equal;
  parts.forEach(function (p) {
    var line = p.notes.map(function (n, i) { return { note: n, dur: beats[i] }; });
    line.push({ note: null, dur: 4 }); // a rest leaves the next pass room for its "w"
    p.singer.sing(lyric, line, { at: t + 0.25 });
  });
  log(pure ? 'just intonation: pure thirds and fifths' : '12-EDO: thirds 14 cents wide');
});
onCleanup(off);
b.start();`,
  },
  {
    id: 'vocal-soprano',
    title: 'VOCAL: A TRAINED SOPRANO',
    category: 'VOCALS',
    description:
      'One female voice sings the same high line twice: first plain, then with the singer\'s formant (ring) and first-resonance tuning on. Ring narrows the tube above the folds, which lifts the band near 3 kHz that lets a trained voice carry, here by about 1 dB, so listen for a slight edge. Tuning opens the jaw on high notes so the vowel\'s first resonance stays above the pitch, as sopranos do, which keeps the top notes from going thin. The pitch prepares and overshoots at each note change.',
    seed: 'vocal-soprano',
    code: `var singer = lib.singer(b, { body: 1, vibratoDepth: 0.35, overshoot: 0.12 });
var room = b.bus(['plate'], { level: 0.3 });
singer.send(room, 0.4);
b.bpm(66);

var line = [
  { note: 'C5', dur: 2 }, { note: 'E5', dur: 2 }, { note: 'G5', dur: 2 },
  { note: 'A5', dur: 4 }, { note: null, dur: 2 },
];
var pass = 0;
var off = b.clock.at('3m', function (t) {
  var trained = pass++ % 2 === 1;
  singer.param('ring', trained ? 1 : 0);
  singer.param('tuning', trained ? 1 : 0);
  singer.sing('/ɑ i u ɑ/', line, { at: t + 0.25 });
  log(trained ? 'ring 1 and tuning 1: the singer formant and an open jaw up high' : 'plain: ring 0, tuning 0');
});
onCleanup(off);
b.start();`,
  },
];
