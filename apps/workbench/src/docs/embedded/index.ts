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
import gettingStarted from './getting-started';
import programShape from './program-shape';
import output from './output-and-wiring';
import engines from './engines';
import effects from './effects';
import voices from './voices';
import sequencing from './sequencing';
import theory from './theory';
import performance from './performance';

export const EMBEDDED_DOC_GROUPS: DocGroup[] = [
  { label: 'Start here', pages: [gettingStarted, programShape] },
  { label: 'Getting sound out', pages: [output] },
  { label: 'Sound', pages: [engines, effects, voices] },
  { label: 'Structure', pages: [sequencing, theory] },
  { label: 'On the board', pages: [performance] },
];

export const EMBEDDED_DOC_PAGES = EMBEDDED_DOC_GROUPS.flatMap((g) => g.pages);
