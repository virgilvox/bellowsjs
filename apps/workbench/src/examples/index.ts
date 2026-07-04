/*
 * The example registry: every category in display order, plus lookup
 * helpers for the view and the url hash router.
 */

import type { Example } from './types';
import { basicsExamples } from './basics';
import { firstSounds } from './firstsounds';
import { engineExamples } from './engines';
import { sequencingExamples } from './sequencing';
import { theoryExamples } from './theory';
import { effectExamples } from './effects';
import { analysisExamples } from './analysis';
import { extendExamples } from './extend';

export type { Example } from './types';

export interface ExampleCategory {
  name: string;
  examples: Example[];
}

export const categories: ExampleCategory[] = [
  { name: 'FIRST SOUNDS', examples: firstSounds },
  { name: 'BASICS', examples: basicsExamples },
  { name: 'ENGINES', examples: engineExamples },
  { name: 'SEQUENCING', examples: sequencingExamples },
  { name: 'THEORY + TUNING', examples: theoryExamples },
  { name: 'EFFECTS', examples: effectExamples },
  { name: 'ANALYSIS', examples: analysisExamples },
  { name: 'RENDER + EXTEND', examples: extendExamples },
];

export const allExamples: Example[] = categories.reduce<Example[]>(
  (out, cat) => out.concat(cat.examples),
  [],
);

const byId = new Map<string, Example>();
for (const ex of allExamples) byId.set(ex.id, ex);

export function exampleById(id: string): Example | undefined {
  return byId.get(id);
}

export const defaultExample: Example = allExamples[0];
