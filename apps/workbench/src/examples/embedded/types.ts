/*
 * One embedded example: real C++ next to a browser equivalent you can hear.
 *
 * The two fields are not two versions of the same thing and the page says
 * so. `cpp` is the firmware: it compiles against the actual headers, and
 * scripts/check-embedded-examples.mjs runs a compiler over every one of
 * them so a snippet that stops compiling fails the build rather than
 * misleading a reader. `code` is the browser equivalent, run by the same
 * runner the javascript examples use, so you can hear what the C++ would
 * do without owning a board.
 *
 * Where the two implementations are the same engine with the same
 * parameters, the difference between them is measured: `parityRow` names
 * the row in the parity harness and `parityRelRms` is what it reported.
 * Where there is no such row, both are null and the page says the sound is
 * an illustration rather than a measured match.
 *
 * The cpp contract, which check-embedded-examples.mjs enforces:
 *
 *   includes, then file-scope statics, then
 *     void setup()                              rate is kSampleRate
 *     void render(float* l, float* r, int from, int to)
 *     void loop()                               optional, board side
 *
 * Voices ADD into (l, r, from, to) and the caller clears the block, which
 * is the same contract as the browser library.
 */

import type { Example } from '../types';

export interface EmbeddedExample extends Example {
  /** Real C++, compiled by check-embedded-examples.mjs. */
  cpp: string;
  /** Headers the snippet includes, for the "what this needs" line. */
  needs: string[];
  /** The parity harness row this engine is measured on, or null. */
  parityRow: string | null;
  parityRelRms: number | null;
  /** One line on where the browser equivalent genuinely differs, or null. */
  caveat: string | null;
}

export interface EmbeddedCategory {
  name: string;
  blurb: string;
  examples: EmbeddedExample[];
}
