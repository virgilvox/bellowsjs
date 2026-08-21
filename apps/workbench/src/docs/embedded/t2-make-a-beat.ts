import type { DocPage } from '../types';

/*
 * Tutorial page two. Same shape as page one, and deliberately the same kick:
 * a reader who meets a familiar object three times starts to chunk it, and
 * chunking is what makes reading code stop costing working memory per token.
 */
const page: DocPage = {
  slug: 'emb-make-a-beat',
  title: 'Make a beat',
  blurb: 'Three drums, a pattern that decides when each one fires, and a tempo you can push around.',
  prev: 'emb-make-a-sound',
  next: 'emb-give-it-a-tune',
  body: `
One drum is an instrument. Three drums and something deciding when they fire is a beat.

The kick from the last page is still here. It has been joined by a snare and a hat, and by a thing that answers the only question a drum machine really has: on which of the sixteen steps does each drum play?

## Hear it

The answer this program gives is a **euclidean pattern**: spread a number of hits as evenly as possible across a number of steps. Five kicks across sixteen steps. Four snares across sixteen, starting on the fifth. Eleven hats across sixteen.

That is the whole rhythm. Three pairs of numbers.

Before you press play: five kicks spread evenly across sixteen steps does not divide neatly. Do you think that sounds like a march, or like something that leans?

\`\`\`listen drummachine params=bpm,swing
predict: Five hits spread across sixteen steps. A march, or something that leans?
A kick, a snare and a hat on euclidean patterns. Press play, then push the tempo around.
\`\`\`

Now drag **tempo**. Then bring **swing** up from zero, slowly. Swing delays every second step, which is the difference between a drum machine and a drummer.

## Find it in the code

\`\`\`cpp
/* Three patterns that lock together over 16 steps. The kick lands on
 * a 5-in-16 euclidean spread, the snare answers on the backbeat, and
 * the hat fills. */
pattern_[kKick].Generate(5, 16);
pattern_[kSnare].Generate(4, 16, 4);
pattern_[kHat].Generate(11, 16, 1);
\`\`\`

Three lines. Find the one that made the kick pattern, and notice the third number on the other two: that is a rotation, how far around the sixteen steps the pattern starts.

If you want to know what a different beat sounds like, those six numbers are where you would change it. \`Generate(3, 8)\` is a different feel entirely. There are no wrong values here; some of them are just more interesting than others.

## What you just did has a name

The patterns are a **sequencer**, and the euclidean generator is one of several this library ships. It stores a sixteen step pattern as a bitmask and a cursor, which is two bytes, because on a microcontroller the difference between two bytes and sixteen matters.

The important part is the split: the drums do not know about the pattern, and the pattern does not know about the drums. One decides *when*, the other decides *what it sounds like*. Every piece of music you make with this library is built out of that separation.

Next: [Give it a tune](/docs/emb-give-it-a-tune), where the thing being triggered has a pitch.
`,
};

export default page;
