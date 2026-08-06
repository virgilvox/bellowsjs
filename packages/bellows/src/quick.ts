/*
 * Tier 1: immediate sound. One shared Bellows instance boots lazily on the
 * first call (call from a user gesture so the context may start), one
 * cached instrument per engine id.
 *
 * Both module globals are recoverable, which is the whole point of the
 * bookkeeping below. Caching the boot promise before it settles is what makes
 * concurrent callers share one boot, but it also caches a rejection, and the
 * two rejections that happen in practice are both worth retrying: boot()
 * called outside a user gesture, and createKernelNode throwing because a CSP
 * blocks the blob worklet URL. The cached Instrument handles are bound to one
 * Bellows, so they have to go whenever that instance does.
 */

import { Bellows, Instrument, type NoteOptions, type NoteValue } from './bellows';

let shared: Promise<Bellows> | null = null;
/** The resolved value of `shared`, once it has one, so dispose can be seen. */
let sharedInstance: Bellows | null = null;
const cache = new Map<string, Instrument>();
/** The Bellows the cached instruments are bound to. */
let cacheOwner: Bellows | null = null;

export function quickBellows(): Promise<Bellows> {
  // A disposed instance has given back its kernel node, its scheduler and
  // usually its AudioContext, so every note played through it goes nowhere
  // and nothing reports it. Drop it and boot again.
  if (sharedInstance && sharedInstance.disposed) {
    shared = null;
    sharedInstance = null;
  }
  if (!shared) {
    const booting = Bellows.boot({ seed: 'quick' });
    shared = booting;
    // The identity test in both branches matters: a caller may already have
    // started the next boot by the time this one settles.
    booting.then(
      (b) => {
        if (shared === booting) sharedInstance = b;
      },
      () => {
        if (shared === booting) shared = null;
      },
    );
  }
  return shared;
}

/** Cached voice per engine id, dropped whole when the owning Bellows changes. */
function instrumentFor(b: Bellows, engineId: string): Instrument {
  if (cacheOwner !== b) {
    cache.clear();
    cacheOwner = b;
  }
  let inst = cache.get(engineId);
  if (!inst) {
    inst = b.voice(engineId);
    cache.set(engineId, inst);
  }
  return inst;
}

/** Play a note on a named engine: play('pluck', 'C4'). */
export async function play(engineId: string, note: NoteValue, opts: NoteOptions = {}): Promise<void> {
  const b = await quickBellows();
  instrumentFor(b, engineId).note(note, opts);
}

/** Load an instrument by URI ('sf2:./gm.sf2#0:0') or engine id. */
export async function instrument(uri: string): Promise<Instrument> {
  const b = await quickBellows();
  return b.instrument(uri);
}
