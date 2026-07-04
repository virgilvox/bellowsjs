/*
 * The docs registry: reading order, slug lookup, and sidebar groups.
 * DocsView renders from here; adding a page means one import and one
 * entry in a group.
 */

import type { DocPage } from './types';
import gettingStarted from './pages/getting-started';
import playingNotes from './pages/playing-notes';
import engines from './pages/engines';
import presets from './pages/presets';
import sequencing from './pages/sequencing';
import generativeMusic from './pages/generative-music';
import theory from './pages/theory';
import tuning from './pages/tuning';
import effects from './pages/effects';
import soundfontsAndSamples from './pages/soundfonts-and-samples';
import renderingAndExport from './pages/rendering-and-export';
import analysis from './pages/analysis';
import midi from './pages/midi';
import customDsp from './pages/custom-dsp';

export type { DocPage } from './types';

export interface DocGroup {
  label: string;
  pages: DocPage[];
}

/** Sidebar groups in display order; flattening them yields reading order. */
export const DOC_GROUPS: DocGroup[] = [
  { label: 'Start here', pages: [gettingStarted, playingNotes] },
  { label: 'Sound', pages: [engines, presets] },
  { label: 'Time', pages: [sequencing, generativeMusic] },
  { label: 'Pitch', pages: [theory, tuning] },
  { label: 'Mix and sample', pages: [effects, soundfontsAndSamples] },
  { label: 'Output', pages: [renderingAndExport, analysis] },
  { label: 'Extend', pages: [midi, customDsp] },
];

/** All pages in reading order. */
export const DOC_PAGES: DocPage[] = DOC_GROUPS.flatMap((g) => g.pages);

export const bySlug: Map<string, DocPage> = new Map(DOC_PAGES.map((p) => [p.slug, p]));
