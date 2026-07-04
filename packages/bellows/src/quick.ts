/*
 * Tier 1: immediate sound. One shared Bellows instance boots lazily on the
 * first call (call from a user gesture so the context may start), one
 * cached instrument per engine id.
 */

import { Bellows, Instrument, type NoteOptions, type NoteValue } from './bellows';

let shared: Promise<Bellows> | null = null;
const cache = new Map<string, Instrument>();

export function quickBellows(): Promise<Bellows> {
  if (!shared) shared = Bellows.boot({ seed: 'quick' });
  return shared;
}

/** Play a note on a named engine: play('pluck', 'C4'). */
export async function play(engineId: string, note: NoteValue, opts: NoteOptions = {}): Promise<void> {
  const b = await quickBellows();
  let inst = cache.get(engineId);
  if (!inst) {
    inst = b.voice(engineId);
    cache.set(engineId, inst);
  }
  inst.note(note, opts);
}

/** Load an instrument by URI ('sf2:./gm.sf2#0:0') or engine id. */
export async function instrument(uri: string): Promise<Instrument> {
  const b = await quickBellows();
  return b.instrument(uri);
}
