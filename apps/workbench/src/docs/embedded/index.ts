/*
 * The embedded documentation tree.
 *
 * A second tree beside the browser one rather than a section inside it,
 * because the two have different vocabularies for the same ideas. A voice
 * in the browser is a channel on a kernel; on a board it is an object you
 * own. Interleaving them makes both harder to read, so the DOCS page
 * switches between the trees and each one is internally consistent.
 *
 * Reading order is the prev/next chain in the pages themselves, and the
 * groups below are only how the sidebar stacks them.
 */

import type { DocGroup } from '../index';
import t1 from './t1-make-a-sound';
import t2 from './t2-make-a-beat';
import t3 from './t3-give-it-a-tune';
import t4 from './t4-put-it-on-a-board';
import h1 from './h1-why-is-it-silent';
import h2 from './h2-get-sound-out';
import e1 from './e1-browser-and-board';
import gettingStarted from './getting-started';
import programShape from './program-shape';
import output from './output-and-wiring';
import engines from './engines';
import effects from './effects';
import voices from './voices';
import sequencing from './sequencing';
import theory from './theory';
import performance from './performance';

/*
 * Grouped by what the reader is doing, which is the Diataxis split: learning,
 * looking a fact up, understanding why. See docs/DOCS-PLAN.md.
 *
 * The tutorial is first, and that ordering is the whole of making it the way
 * in: DocsView lands on pagesFor(tree)[0] when somebody presses EMBEDDED, so
 * a visitor now arrives at a play button rather than at a flash table.
 *
 * The four pages under Start here are one path with no branches. Everything
 * below them assumes the reader already has a reason to be there, which is
 * why the reference pages are not softened: guidance that helps a beginner
 * measurably slows down somebody who already knows the material.
 */
export const EMBEDDED_DOC_GROUPS: DocGroup[] = [
  { label: 'Start here', pages: [t1, t2, t3, t4] },
  { label: 'How to', pages: [h2, h1] },
  { label: 'Reference', pages: [engines, effects, voices, sequencing, theory, output] },
  { label: 'Understanding', pages: [gettingStarted, e1, programShape, performance] },
];

export const EMBEDDED_DOC_PAGES = EMBEDDED_DOC_GROUPS.flatMap((g) => g.pages);
