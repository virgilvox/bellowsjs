import type { DocPage } from '../types';

/*
 * Tutorial page three. The modify beat here is the loudest one in the set:
 * resonance at the top of its range is an obvious, physical change, and an
 * obvious change is what a reader needs at the point they are deciding
 * whether any of this is theirs.
 */
const page: DocPage = {
  slug: 'emb-give-it-a-tune',
  title: 'Give it a tune',
  blurb: 'Eight voices, notes rather than hits, and a filter you can hear moving.',
  prev: 'emb-make-a-beat',
  next: 'emb-put-it-on-a-board',
  body: `
A drum does not care what pitch you hit it at. Most other instruments do, and once pitch is involved you need more than one voice, because notes overlap.

This program holds eight of them and hands out whichever is free.

## Hear it

There is a filter across all eight, and something moving it up and down. A filter takes the brightness out of a sound; moving one while a note is held is the sound most people mean when they say a synthesiser sounds like a synthesiser.

Before you press play: **resonance** emphasises the frequencies right at the filter's edge. Turned up, do you think that makes the sound louder, thinner, or more vocal?

\`\`\`listen polysynth params=cutoff,resonance
predict: Resonance emphasises the edge of the filter. Louder, thinner, or more vocal?
Eight voices with a swept filter. Press play, then take resonance most of the way up.
\`\`\`

Take **resonance** most of the way up and leave it there for a few bars. Then move **cutoff** by hand while it plays.

That is one physical control doing something a hundred notes could not, and it is the reason filters are on the front of almost every synthesiser ever built.

## Find it in the code

\`\`\`cpp
bellows::VoicePool<bellows::Va, kPoly> pool_;

void NoteOn(int note_id, float hz, float vel) {
  pool_.NoteOn(note_id, hz, vel, frame_);
}
\`\`\`

\`VoicePool\` is an array of eight \`Va\` voices and the rule for choosing one when a note arrives. It is not a clever object. When every voice is busy it takes the oldest one, which is what almost every polyphonic synthesiser does, and the reason your held chord sometimes loses its bottom note.

The \`note_id\` is how a note off finds the voice that a note on started. That is all it is for.

## Fifty of them, if you want

The library ships fifty instrument presets, and there is an example that walks through all of them: electric pianos, plucked strings, bells, a clarinet, a choir. They are in the [playground](/simulator) under 21_Presets, and they run on the same eight voices you just heard.

That is the point at which most people stop reading documentation and go and make something, which is the correct response.

## What you just did has a name

A **voice pool** is polyphony: several copies of one engine, plus a rule for what to do when they run out. \`Va\` is a virtual analog engine, the oscillator-filter-envelope shape that most subtractive synthesisers have.

The three pages so far are the whole library in miniature. Something makes sound, something decides when, and something shapes it on the way out.

Next: [Put it on a board](/docs/emb-put-it-on-a-board), where this stops being a browser tab.
`,
};

export default page;
