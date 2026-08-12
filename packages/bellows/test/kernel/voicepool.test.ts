/*
 * Which note gets cut off when you run out of voices.
 *
 * voicepool.ts states the policy in its header: "Stealing order: free
 * voice, then oldest released voice, then oldest held voice." Nothing
 * checked it. Two tests mention VoicePool and neither observes the order,
 * so the pool could have taken the newest note, or the first slot every
 * time, and the suite would not have noticed.
 *
 * It is a musical decision rather than an implementation detail. Stealing
 * the newest note makes a held chord swallow the melody, and stealing a
 * still-held voice in preference to one already released cuts a note that
 * is under a finger in order to protect a release tail.
 *
 * The three branches only exist separately if a released voice stays
 * active for a while, which is what a real release envelope does. The first
 * version of this file used a voice that went inactive the instant it was
 * released; that made every released voice a free voice, the first branch
 * caught them all, and the middle branch was unreachable. So the voice here
 * has a tail, and it reports which note it is playing rather than a level,
 * because a level cannot distinguish a released voice from a silent one.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { VoicePool } from '../../src/core/voicepool';
import { rng } from '../../src/core/prng';
import type { EngineDef, Voice } from '../../src/types';

const SR = 48000;

/** One entry per constructed voice, in construction order. */
interface Tap {
  note: number;
  state: 'idle' | 'held' | 'releasing';
}
let taps: Tap[] = [];

/**
 * A voice that stays active after noteOff, the way anything with a release
 * envelope does, and records the note it is playing.
 */
const tailed: EngineDef = {
  id: 'voicepool-tailed',
  label: 'release tail',
  params: [],
  polyphony: 3,
  createVoice(): Voice {
    const tap: Tap = { note: -1, state: 'idle' };
    taps.push(tap);
    return {
      noteOn(freq) {
        tap.note = freq;
        tap.state = 'held';
      },
      noteOff() {
        if (tap.state === 'held') tap.state = 'releasing';
      },
      setParam() {},
      get active() {
        return tap.state !== 'idle';
      },
      process() {},
    };
  },
};

/** Notes the pool is playing, sorted, with their state. */
function playing(): string[] {
  return taps
    .filter((t) => t.state !== 'idle')
    .map((t) => `${t.note}:${t.state}`)
    .sort();
}

function pool(size = 3): VoicePool {
  taps = [];
  return new VoicePool(tailed, SR, {}, rng('vp'), size);
}

beforeEach(() => {
  taps = [];
});

/* Notes are identified by their frequency argument, which the voice records. */
describe('voice stealing order', () => {
  it('takes a free voice before stealing anything', () => {
    const p = pool();
    p.noteOn(1, 100, 1, 0);
    p.noteOn(2, 200, 1, 10);
    expect(playing()).toEqual(['100:held', '200:held']);
    expect(p.activeCount).toBe(2);
  });

  it('steals the oldest held voice when every voice is held', () => {
    const p = pool();
    p.noteOn(1, 100, 1, 0);
    p.noteOn(2, 200, 1, 10);
    p.noteOn(3, 300, 1, 20);
    p.noteOn(4, 400, 1, 30);
    /* 100 is the oldest, so 100 is the one that goes. */
    expect(playing()).toEqual(['200:held', '300:held', '400:held']);
  });

  it('steals by age and not by slot position', () => {
    /*
     * Started out of slot order: the note in slot 0 is the newest. If the
     * pool walked slots rather than start frames it would take 100.
     */
    const p = pool();
    p.noteOn(1, 100, 1, 300);
    p.noteOn(2, 200, 1, 100);
    p.noteOn(3, 300, 1, 200);
    p.noteOn(4, 400, 1, 400);
    expect(playing()).toEqual(['100:held', '300:held', '400:held']);
  });

  it('prefers a released voice over a held one, however old the held one is', () => {
    /*
     * 100 is the oldest note by a long way and is still held; 300 was
     * started last and has been let go. A pool that only looked at age
     * would take 100, cutting a note still under a finger while a free
     * running release tail kept its voice.
     */
    const p = pool();
    p.noteOn(1, 100, 1, 0);
    p.noteOn(2, 200, 1, 100);
    p.noteOn(3, 300, 1, 200);
    p.noteOff(3);
    p.noteOn(4, 400, 1, 300);
    expect(playing()).toEqual(['100:held', '200:held', '400:held']);
  });

  it('takes the oldest released voice when several have been let go', () => {
    const p = pool();
    p.noteOn(1, 100, 1, 100);
    p.noteOn(2, 200, 1, 200);
    p.noteOn(3, 300, 1, 300);
    p.noteOff(2);
    p.noteOff(1);
    /* 200 and 100 are both releasing; 100 is older by start frame. */
    p.noteOn(4, 400, 1, 400);
    expect(playing()).toEqual(['200:releasing', '300:held', '400:held']);
  });

  it('releases every voice holding a note id, and only those', () => {
    const p = pool();
    p.noteOn(7, 100, 1, 0);
    p.noteOn(8, 200, 1, 10);
    p.noteOff(7);
    expect(playing()).toEqual(['100:releasing', '200:held']);
    /* Still allocated: a release tail owns its voice until it finishes. */
    expect(p.activeCount).toBe(2);
  });

  it('allNotesOff releases everything and holds nothing', () => {
    const p = pool();
    p.noteOn(1, 100, 1, 0);
    p.noteOn(2, 200, 1, 10);
    p.noteOn(3, 300, 1, 20);
    p.allNotesOff();
    expect(playing()).toEqual(['100:releasing', '200:releasing', '300:releasing']);
    /* And now every voice is stealable as a released one, oldest first. */
    p.noteOn(4, 400, 1, 30);
    expect(playing()).toEqual(['200:releasing', '300:releasing', '400:held']);
  });

  it('reuses a genuinely free voice rather than stealing a releasing one', () => {
    /*
     * The first branch has to win on its own merits: a voice whose tail has
     * finished costs nothing to take, while stealing one still releasing
     * cuts a tail short.
     *
     * The free voice here is deliberately NOT the oldest released one. With
     * both released and 100 the older, a pool without the free-voice branch
     * would fall through to "oldest released" and cut 100's tail while an
     * idle voice sat next to it. An earlier version of this test made the
     * free voice the oldest as well, so the two branches gave the same
     * answer and removing the first one changed nothing.
     */
    const p = pool();
    p.noteOn(1, 100, 1, 0);
    p.noteOn(2, 200, 1, 100);
    p.noteOn(3, 300, 1, 200);
    p.noteOff(1);
    p.noteOff(2);
    /* 200's tail finishes; 100 is still ringing and is older. */
    taps[1].state = 'idle';
    p.noteOn(4, 400, 1, 300);
    expect(playing()).toEqual(['100:releasing', '300:held', '400:held']);
  });
});
