/*
 * The embedded example registry.
 *
 * Same shape as the javascript registry next door, and the same reading
 * order idea: the first category is the rung below everything and the last
 * is the board-facing side. Every entry carries real C++ and a browser
 * equivalent, and scripts/check-embedded-examples.mjs compiles the C++ of
 * every one of them against the actual headers.
 */

import type { EmbeddedExample, EmbeddedCategory } from './types';
import { fsExamples } from './first-sounds';
import { engExamples } from './engines';
import { seqExamples } from './sequencing';
import { thExamples } from './theory';
import { fxExamples } from './effects';
import { ctlExamples } from './control';

export type { EmbeddedExample, EmbeddedCategory } from './types';

export const EMBEDDED_CATEGORIES: EmbeddedCategory[] = [
  {
    name: 'FIRST SOUNDS',
    blurb: 'One oscillator, then an envelope, then a filter. The rungs below every engine.',
    examples: fsExamples,
  },
  {
    name: 'ENGINES',
    blurb: 'One per ported engine, showing what each is for rather than that it exists.',
    examples: engExamples,
  },
  {
    name: 'SEQUENCING',
    blurb: 'Euclidean rhythms, arpeggios, Markov melodies. The layer other embedded audio libraries do not have.',
    examples: seqExamples,
  },
  {
    name: 'THEORY + TUNING',
    blurb: 'Scales, chords and tunings. Pitch is a layer here, not a formula.',
    examples: thExamples,
  },
  {
    name: 'EFFECTS + MIXING',
    blurb: 'Delay, plate, chorus, EQ, a limiter, and the send bus you write by hand.',
    examples: fxExamples,
  },
  {
    name: 'CONTROL + POLYPHONY',
    blurb: 'Voice pools, a compile-time bank, a pot, a button, MIDI in, and CPU load.',
    examples: ctlExamples,
  },
];

export const EMBEDDED_EXAMPLES: EmbeddedExample[] = EMBEDDED_CATEGORIES.reduce<EmbeddedExample[]>(
  (out, c) => out.concat(c.examples),
  [],
);

const byId = new Map<string, EmbeddedExample>();
for (const ex of EMBEDDED_EXAMPLES) byId.set(ex.id, ex);

export function embeddedById(id: string): EmbeddedExample | undefined {
  return byId.get(id);
}

export const defaultEmbeddedExample: EmbeddedExample = EMBEDDED_EXAMPLES[0];
