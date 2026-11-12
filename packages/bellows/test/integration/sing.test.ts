/*
 * Instrument.sing() and src/sing.ts: a lyric on a melody, through the
 * facade, to sample-accurate events and rendered audio.
 *
 * What is pinned here is the join between the layers, not the layers
 * themselves (test/lyrics covers the planner and the front ends,
 * test/engines-physical/vocal.test.ts the engine): that the Params land
 * before the NoteOn they shape, that a vowel the planner put on a beat
 * reaches the audio on that beat, that pitch inside a phrase survives a
 * tuning that is not 12-EDO, and that a sing() inside a clock callback
 * replays in b.render() exactly as note() does.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { Bellows } from '../../src/bellows';
import { registerBuiltins } from '../../src/register';
import { internParam } from '../../src/kernel/engine';
import { EventKind, type KernelEvent } from '../../src/types';
import { Tuning } from '../../src/theory/tuning';
import { VOCAL_ACOUSTICS, VOCAL_DEFAULT_PHONEME, VOCAL_PHONEMES, vocalPhonemeIndex } from '../../src/engines/vocal-phonemes';
import { parseCmudict } from '../../src/lyrics/cmudict';
import type { SungPlan } from '../../src/lyrics/types';
import { sungEvents } from '../../src/sing';
import { vocalGlideLead, VOCAL_PLAN_LEAD } from '../../src/engines/vocal';
import { planSung } from '../../src/lyrics/sing';
import { lyricsToSyllables } from '../../src/lyrics/read';
import { yin } from '../../src/analysis/pitch';
import { FakeAudioContext, FakeWorkletNode, installFakeAudio } from './fake-context';

const nodes: FakeWorkletNode[] = [];

class RecordingWorkletNode extends FakeWorkletNode {
  constructor(ctx: unknown, name: string, opts?: unknown) {
    super(ctx, name, opts);
    nodes.push(this);
  }
}

const live: Bellows[] = [];

async function boot(seed = 'sing'): Promise<Bellows> {
  const b = await Bellows.boot({
    seed,
    workletUrl: 'fake://worklet',
    context: new FakeAudioContext() as unknown as AudioContext,
  });
  live.push(b);
  return b;
}

/** Every event the facade posted live to the newest kernel node, in posting order. */
function postedEvents(): KernelEvent[] {
  const port = nodes[nodes.length - 1].port as unknown as { posted: Array<{ type: string; events?: KernelEvent[] }> };
  return port.posted.filter((m) => m.type === 'events').flatMap((m) => m.events ?? []);
}

const PHONEME = internParam('phoneme');
const BEND = internParam('bend');
const ph = (ipa: string) => vocalPhonemeIndex(ipa);

function peak(x: Float32Array, from = 0, to = x.length): number {
  let p = 0;
  for (let i = from; i < to; i++) p = Math.max(p, Math.abs(x[i]));
  return p;
}

/** RMS of x[from, to) after two one-pole lowpasses at 800 Hz: the voiced low band, not /s/ hiss. */
function lowBandRms(x: Float32Array, sr: number, from: number, to: number): number {
  const a = Math.exp((-2 * Math.PI * 800) / sr);
  let y1 = 0;
  let y2 = 0;
  let sum = 0;
  for (let i = 0; i < to; i++) {
    y1 = (1 - a) * x[i] + a * y1;
    y2 = (1 - a) * y1 + a * y2;
    if (i >= from) sum += y2 * y2;
  }
  return Math.sqrt(sum / (to - from));
}

beforeAll(() => {
  registerBuiltins();
});

beforeEach(() => {
  installFakeAudio();
  (globalThis as Record<string, unknown>).AudioWorkletNode = RecordingWorkletNode;
  nodes.length = 0;
});

afterEach(() => {
  for (const b of live.splice(0)) b.dispose();
});

describe('sing(): events', () => {
  it('sets the phoneme before the NoteOn it shapes, at the same time', async () => {
    const b = await boot();
    const v = b.voice('vocal');
    const plan = v.sing('/sɑ/', [{ note: 'A3', dur: '2n' }], { at: 1 });
    const ev = postedEvents();
    const on = ev.findIndex((e) => e.kind === EventKind.NoteOn);
    expect(on).toBeGreaterThan(0);
    const start = plan.phrases[0].start;
    expect(ev[on].time).toBe(start);
    const before = ev.slice(0, on);
    expect(before).toContainEqual({ time: start, kind: EventKind.Param, target: v.channel, a: PHONEME, b: ph('s'), c: 0 });
    expect(before).toContainEqual({ time: start, kind: EventKind.Param, target: v.channel, a: BEND, b: 0, c: 0 });
    /* and the vowel arrives as its own Param, on the beat */
    expect(ev.slice(on + 1)).toContainEqual({ time: 1, kind: EventKind.Param, target: v.channel, a: PHONEME, b: ph('ɑ'), c: 0 });
  });

  it('posts one note per phrase, in time order, with the opening consonants ahead of the beat', async () => {
    const b = await boot();
    const v = b.voice('vocal');
    const plan = v.sing('string, string', [
      { note: 'C4', dur: '2n' },
      { note: 'D4', dur: '2n' },
    ], { at: 2 });
    expect(plan.phrases).toHaveLength(2);
    /* s t ɹ before the first beat */
    expect(plan.leadIn).toBeGreaterThan(0.1);
    expect(plan.phrases[0].start).toBeCloseTo(2 - plan.leadIn, 12);
    const ev = postedEvents();
    for (let i = 1; i < ev.length; i++) expect(ev[i].time).toBeGreaterThanOrEqual(ev[i - 1].time);
    const ons = ev.filter((e) => e.kind === EventKind.NoteOn);
    const offs = ev.filter((e) => e.kind === EventKind.NoteOff);
    expect(ons).toHaveLength(2);
    expect(offs.map((e) => e.a)).toEqual(ons.map((e) => e.a));
    expect(ons[1].a).toBe(ons[0].a + 1);
    expect(ons.map((e) => e.time)).toEqual(plan.phrases.map((p) => p.start));
    expect(offs.map((e) => e.time)).toEqual(plan.phrases.map((p) => p.end));
    /* the first phrase is over before the second begins: one singer */
    expect(offs[0].time).toBeLessThanOrEqual(ons[1].time);
  });

  it('reproduces a 19-EDO line exactly through bend, relative to the phrase first Hz', async () => {
    const b = await boot();
    b.tuning = Tuning.edo(19);
    const v = b.voice('vocal');
    const steps = [60, 63, 66, 71, 60];
    const plan = v.sing('/lɑ lɑ lɑ lɑ lɑ/', steps.map((n) => ({ note: n, dur: '4n' })), { at: 0.5 });
    expect(plan.phrases).toHaveLength(1);
    const hz = steps.map((n) => b.tuning.freqOf(n));
    const ev = postedEvents();
    const on = ev.find((e) => e.kind === EventKind.NoteOn)!;
    expect(on.b).toBe(hz[0]);
    const bends = ev.filter((e) => e.kind === EventKind.Param && e.a === BEND && e.time > on.time && e.time < plan.phrases[0].end);
    /* one bend per change of pitch, posted the glide's lead time before the planner's time */
    const lead = vocalGlideLead();
    const want = plan.phrases[0].pitches.slice(1).map((p) => p.time - lead);
    bends.forEach((e, k) => expect(e.time).toBeCloseTo(want[k], 12));
    expect(bends).toHaveLength(want.length);
    bends.forEach((e, k) => {
      const back = on.b * Math.pow(2, e.b / 12);
      expect(Math.abs(back / hz[k + 1] - 1)).toBeLessThan(1e-12);
    });
    /* not 12-EDO in disguise: three 19-EDO steps are 189.47 cents */
    expect(bends[0].b).toBeCloseTo((3 * 12) / 19, 12);
    /* the return to the first note bends back to exactly 0 */
    expect(bends[bends.length - 1].b).toBe(0);
  });

  it('lays notes end to end through the tempo map, and a null note is a rest that ends a phrase', async () => {
    const b = await boot();
    const v = b.voice('vocal');
    // 120 bpm default: a quarter is 0.5 s
    const plan = v.sing('/ɑ ɑ ɑ/', [
      { note: 'A3', dur: '4n' },
      { note: 'B3', dur: '4n' },
      { note: null, dur: '2n' },
      { note: 'C4', dur: { seconds: 0.3 } },
    ], { at: 1 });
    expect(plan.phrases).toHaveLength(2);
    const vowelStarts = plan.phrases.flatMap((p) => p.spans.filter((s) => s.kind === 'nucleus').map((s) => s.start));
    expect(vowelStarts).toEqual([1, 1.5, 3]);
    expect(plan.phrases[1].end).toBeCloseTo(3.3, 12);
  });

  it('leaves a default channel at bend 0 and the default phoneme after the NoteOff', async () => {
    const b = await boot();
    const v = b.voice('vocal');
    const plan = v.sing('/sɪt/', [{ note: 'C4', dur: '4n' }], { at: 1 });
    const ev = postedEvents();
    const off = ev.findIndex((e) => e.kind === EventKind.NoteOff);
    expect(ev.slice(off + 1)).toEqual([
      { time: plan.phrases[0].end, kind: EventKind.Param, target: v.channel, a: BEND, b: 0, c: 0 },
      { time: plan.phrases[0].end, kind: EventKind.Param, target: v.channel, a: PHONEME, b: VOCAL_DEFAULT_PHONEME, c: 0 },
    ]);
    expect(VOCAL_PHONEMES[VOCAL_DEFAULT_PHONEME]).toBe('ɑ');
  });

  it('gives a channel back its own phoneme and bend, and an untimed param() becomes its own', async () => {
    const b = await boot();
    const v = b.voice('vocal', { phoneme: ph('i'), bend: 12 });
    const resets = (from: number) => {
      const ev = postedEvents().slice(from);
      const off = ev.findIndex((e) => e.kind === EventKind.NoteOff);
      return ev.slice(off + 1, off + 3).map((e) => [e.a, e.b]);
    };
    v.sing('/mɑ/', [{ note: 'C3', dur: '4n' }], { at: 1 });
    expect(resets(0)).toEqual([[BEND, 12], [PHONEME, ph('i')]]);
    // a sung line does not take the channel's bend: it opens at 0, on its own Hz
    const ev = postedEvents();
    const on = ev.find((e) => e.kind === EventKind.NoteOn)!;
    expect(ev.filter((e) => e.time === on.time && e.kind === EventKind.Param && e.a === BEND).map((e) => e.b)).toEqual([0]);
    expect(on.b).toBeCloseTo(b.tuning.freqOf(48), 9);

    // posted ahead, this line would hand back /i/ at its end; an untimed param in between changes that
    const before = postedEvents().length;
    const plan = v.sing('/mɑ/', [{ note: 'C3', dur: '4n' }], { at: 3 });
    v.param('phoneme', ph('u'));
    const after = postedEvents().slice(before);
    const end = plan.phrases[0].end;
    const atEnd = after.filter((e) => e.time === end && e.kind === EventKind.Param && e.a === PHONEME).map((e) => VOCAL_PHONEMES[e.b]);
    // the line's own reset, then the new value after it, which the kernel applies last
    expect(atEnd).toEqual(['i', 'u']);
    const later = postedEvents().length;
    v.sing('/mɑ/', [{ note: 'C3', dur: '4n' }], { at: 5 });
    expect(resets(later)).toEqual([[BEND, 12], [PHONEME, ph('u')]]);
    // and a value that is not a number changes nothing, as the pool ignores it
    v.param('bend', NaN);
    const last = postedEvents().length;
    v.sing('/mɑ/', [{ note: 'C3', dur: '4n' }], { at: 7 });
    expect(resets(last)).toEqual([[BEND, 12], [PHONEME, ph('u')]]);
  });

  it('fits a line around one still singing on the same instrument, and says what it cut', async () => {
    const b = await boot();
    const v = b.voice('vocal');
    const a = v.sing('/ɑ ɑ/', [{ note: 'C4', dur: { seconds: 0.5 } }, { note: 'G4', dur: { seconds: 0.5 } }], { at: 0.5 });
    expect(a.trimmed).toBe(0);
    const endA = a.phrases[0].end;
    // /stɑ/ on the beat where A ends: its s and t would start inside A
    const before = postedEvents().length;
    const bLine = v.sing('/stɑ/', [{ note: 'C4', dur: { seconds: 0.5 } }], { at: endA });
    const ev = postedEvents().slice(before);
    const on = ev.find((e) => e.kind === EventKind.NoteOn)!;
    expect(on.time).toBe(endA);
    // the whole lead-in went, so the line opens on its vowel
    expect(bLine.trimmed).toBeCloseTo(bLine.phrases[0].spans[0].kind === 'onset' ? endA - bLine.phrases[0].start : 0, 12);
    expect(bLine.trimmed).toBeGreaterThan(0.1);
    expect(ev.filter((e) => e.time === endA && e.kind === EventKind.Param && e.a === PHONEME).map((e) => VOCAL_PHONEMES[e.b])).toEqual(['ɑ']);
    expect(ev.every((e) => e.time >= endA)).toBe(true);

    // the other way: a line posted later that runs into one already posted ends where that one starts
    const c = v.sing('/ɑ/', [{ note: 'C4', dur: { seconds: 2 } }], { at: 4 });
    const after = postedEvents().length;
    const d = v.sing('/mɑ/', [{ note: 'E4', dur: { seconds: 2 } }], { at: 2.5 });
    const dev = postedEvents().slice(after);
    const off = dev.find((e) => e.kind === EventKind.NoteOff)!;
    // a nanosecond early, so the kernel releases d before c's opening events reach the voice
    expect(off.time).toBe(c.phrases[0].start - 1e-9);
    // and posts no resets there, which would land after c's opening events
    expect(dev.filter((e) => Math.abs(e.time - c.phrases[0].start) < 1e-6 && e.kind === EventKind.Param)).toEqual([]);
    expect(d.trimmed).toBeCloseTo(d.phrases[0].end - c.phrases[0].start, 12);
  });

  it('never releases a stop early into the phrase before it, so a short rest keeps its /t/', async () => {
    const b = await boot();
    const v = b.voice('vocal');
    const plan = v.sing('ta ta', [{ note: 'A3', dur: '8n' }, { note: null, dur: '32n' }, { note: 'A3', dur: '8n' }], { at: 1 });
    expect(plan.trimmed).toBe(0);
    const ev = postedEvents();
    const ons = ev.filter((e) => e.kind === EventKind.NoteOn);
    const offs = ev.filter((e) => e.kind === EventKind.NoteOff);
    expect(ons).toHaveLength(2);
    expect(ons[1].time).toBeGreaterThanOrEqual(offs[0].time);
    const second = ev.filter((e) => e.kind === EventKind.Param && e.a === PHONEME && e.time >= ons[1].time && e.time < offs[1].time);
    const t = second.find((e) => e.b === ph('t'));
    const a = second.find((e) => e.b === ph('ɑ') && e.time > t!.time);
    expect(t).toBeDefined();
    expect(a!.time - t!.time).toBeGreaterThanOrEqual(0.02 - 1e-12);
  });

  it('live with no at, starts the line late enough for its opening consonants to sound', async () => {
    const b = await boot();
    const v = b.voice('vocal');
    const now = (b as unknown as { ctx: AudioContext }).ctx.currentTime;
    const plan = v.sing('string', [{ note: 'A3', dur: '4n' }]);
    expect(plan.leadIn).toBeGreaterThan(0.1);
    for (const e of postedEvents()) expect(e.time).toBeGreaterThanOrEqual(now);
    expect(plan.phrases[0].pitches[0].time).toBeGreaterThanOrEqual(now);
  });

  it('with the transport stopped, lays a line through a tempo ramp beat by beat', async () => {
    const b = await boot();
    b.bpm(120);
    b.rampBpm(240, '2m');
    const v = b.voice('vocal');
    const plan = v.sing('la la la la', [0, 1, 2, 3].map(() => ({ note: 'A3', dur: '4n' })), { at: 1 });
    const beats = plan.phrases[0].spans.filter((s) => s.kind === 'nucleus').map((s) => s.start);
    const gaps = beats.slice(1).map((t, i) => t - beats[i]);
    expect(gaps[0]).toBeLessThan(0.5);
    expect(gaps[1]).toBeLessThan(gaps[0]);
    expect(gaps[2]).toBeLessThan(gaps[1]);
  });

  it('reports a symbol the engine lacks and keeps the sound before it, instead of throwing', async () => {
    const b = await boot();
    const v = b.voice('vocal');
    // x (as in loch) and ç have no phoneme; a phrase opening on one starts from the breath's silence
    const plan = v.sing('/xɑç ɑ/', [{ note: 'C4', dur: '4n' }, { note: 'D4', dur: '4n' }], { at: 1 });
    expect(plan.unknown).toEqual(['x', 'ç']);
    const phonemes = postedEvents().filter((e) => e.kind === EventKind.Param && e.a === PHONEME);
    // silence for x, ɑ on the beat, nothing for ç, so ɑ holds into the next note, then the reset
    expect(phonemes.map((e) => VOCAL_PHONEMES[e.b])).toEqual(['_', 'ɑ', 'ɑ']);
    expect(phonemes[0].time).toBe(plan.phrases[0].start);
    expect(phonemes[1].time).toBe(1);
    // a letter outside the tokenizer's inventory is reported too, not dropped on the way
    expect(v.sing('/ʍɑt/', [{ note: 'C4', dur: '4n' }], { at: 3 }).unknown).toEqual(['ʍ']);
  });

  it('reads words through b.dictionary, and opts.dictionary overrides it', async () => {
    const b = await boot();
    const v = b.voice('vocal');
    const sounds = (p: SungPlan) => p.phrases[0].spans.map((s) => s.ipa).join(' ');
    const note = [{ note: 'C4', dur: '4n' }];
    const rules = sounds(v.sing('cat', note, { at: 1 }));
    b.dictionary = parseCmudict('CAT  D AO1 G\n');
    expect(sounds(v.sing('cat', note, { at: 2 }))).toBe('d ɔ g');
    expect(sounds(v.sing('cat', note, { at: 3, dictionary: parseCmudict('CAT  M IY1 UW0\n') }))).not.toContain('ɔ');
    b.dictionary = null;
    expect(sounds(v.sing('cat', note, { at: 4 }))).toBe(rules);
    expect(rules).toContain('k');
  });

  it('refuses an instrument whose engine cannot sing, and says which engine to use', async () => {
    const b = await boot();
    const pluck = b.voice('pluck');
    expect(() => pluck.sing('la', [{ note: 'C4', dur: '4n' }])).toThrow(/'vocal'.*'pluck'|'pluck'.*'vocal'/);
    expect(postedEvents()).toEqual([]);
  });

  it('goes inert once disposed, like every other Instrument call, whatever its engine', async () => {
    const b = await boot();
    const v = b.voice('vocal');
    v.dispose();
    const empty = { phrases: [], leadIn: 0, unknown: [], trimmed: 0 };
    expect(v.sing('la', [{ note: 'C4', dur: '4n' }], { at: 1 })).toEqual(empty);
    // a disposed handle ignores everything, so it does not get as far as checking its engine
    const pluck = b.voice('pluck');
    pluck.dispose();
    expect(pluck.sing('la', [{ note: 'C4', dur: '4n' }], { at: 1 })).toEqual(empty);
    expect(postedEvents().filter((e) => e.kind === EventKind.NoteOn)).toEqual([]);
  });
});

describe('sing(): audio', () => {
  const SR = 48000;

  async function sungRender(seed: string, extra?: (v: ReturnType<Bellows['voice']>, t: number) => void) {
    const b = await boot(seed);
    const v = b.voice('vocal');
    b.clock.at('1m', (t, step) => {
      if (step !== 0) return;
      v.sing('/sɑ/', [{ note: 'A4', dur: { seconds: 0.6 } }], { at: t + 0.5 });
      if (extra) extra(v, t + 0.5);
    });
    return b.render({ seconds: 1.4, sampleRate: SR });
  }

  it('renders a sung phrase, non-silent and identical on every run of the seed', async () => {
    const a = await sungRender('sing-audio');
    const again = await sungRender('sing-audio');
    expect(peak(a.left)).toBeGreaterThan(0.02);
    expect(peak(a.left)).toBeLessThan(1);
    for (const x of a.left) expect(Number.isFinite(x)).toBe(true);
    expect(Array.from(again.left)).toEqual(Array.from(a.left));
    expect(Array.from(again.right)).toEqual(Array.from(a.right));
  });

  it('starts voicing the first vowel on its beat, within one 128-frame block', async () => {
    /*
     * The counterfactual is the same render with the vowel cancelled: a
     * Param back to /s/ posted after sing()'s vowel at the same time, which
     * the kernel applies second, before the voice renders a sample. Up to
     * the moment the vowel takes effect the two renders are the same
     * samples (same seed, same events), so the first sample where they
     * differ is where the vowel reached the audio. Then the low band, the
     * voicing that /s/ does not have, has to rise from there.
     */
    const sung = await sungRender('sing-onset');
    const held = await sungRender('sing-onset', (v, beat) => v.param('phoneme', ph('s'), beat));
    const beat = Math.round(0.5 * SR);
    let first = -1;
    for (let i = 0; i < sung.left.length; i++) {
      if (sung.left[i] !== held.left[i]) {
        first = i;
        break;
      }
    }
    expect(first).toBeGreaterThanOrEqual(beat);
    expect(first - beat).toBeLessThan(128);
    /* the /s/ before it was already sounding: this is a change of sound, not the note starting */
    expect(peak(sung.left, beat - 2400, beat)).toBeGreaterThan(0.005);
    const before = lowBandRms(sung.left, SR, beat - 2400, beat);
    const after = lowBandRms(sung.left, SR, beat + 2400, beat + 4800);
    expect(20 * Math.log10(after / before)).toBeGreaterThan(20);
    expect(lowBandRms(held.left, SR, beat + 2400, beat + 4800)).toBeLessThan(2 * before);
  });

  it('leaves a line untouched by the next line on the same instrument, even when it opens early', async () => {
    /*
     * The counterfactual of the onset test: line B at velocity 0 is
     * silent, so anything it changes in the render is its events reaching
     * line A's voice. Its /st/ would start 156 ms before A ends.
     */
    const render = async (withB: boolean) => {
      const b = await boot('sing-overlap');
      const v = b.voice('vocal', { vibratoDepth: 0, drift: 0, roughness: 0, breath: 0 });
      b.clock.at('1m', (_t, step) => {
        if (step !== 0) return;
        v.sing('/ɑ ɑ/', [{ note: 'C4', dur: { seconds: 0.5 } }, { note: 'G4', dur: { seconds: 0.5 } }], { at: 0.5 });
        if (withB) v.sing('/stɑ/', [{ note: 'C4', dur: { seconds: 0.5 }, vel: 0 }], { at: 1.5 });
      });
      return b.render({ seconds: 2.2, sampleRate: 22050 });
    };
    const alone = await render(false);
    const both = await render(true);
    expect(peak(alone.left)).toBeGreaterThan(0.02);
    expect(Array.from(both.left)).toEqual(Array.from(alone.left));
  });

  it('leaves a line untouched by a later line posted before it, that it runs into', async () => {
    /*
     * The other order: B is posted first, then A, which ends exactly where
     * B's opening /st/ starts, so nothing is cut and A has to come out the
     * same samples as A alone. Before the fix A's NoteOff sorted after B's
     * opening events at that time and its voice took B's /s/ and bend.
     */
    const bStart = planSung([{ time: 1.5, dur: 0.5, hz: 261.63 }], lyricsToSyllables('/stɑ/')).phrases[0].start;
    const half = { seconds: (bStart - 0.5) / 2 };
    const render = async (withB: boolean) => {
      const b = await boot('sing-overlap-reverse');
      const v = b.voice('vocal', { vibratoDepth: 0, drift: 0, roughness: 0, breath: 0 });
      b.clock.at('1m', (_t, step) => {
        if (step !== 0) return;
        if (withB) {
          const line = v.sing('/stɑ/', [{ note: 'C4', dur: { seconds: 0.5 }, vel: 0 }], { at: 1.5 });
          expect(line.phrases[0].start).toBe(bStart);
        }
        const a = v.sing('/ɑ ɑ/', [{ note: 'C4', dur: half }, { note: 'G4', dur: half }], { at: 0.5 });
        expect(a.trimmed).toBeLessThan(1e-9);
      });
      return b.render({ seconds: 2.2, sampleRate: 22050 });
    };
    const alone = await render(false);
    const both = await render(true);
    expect(peak(alone.left)).toBeGreaterThan(0.02);
    expect(Array.from(both.left)).toEqual(Array.from(alone.left));
  });

  it('after a sung line, a plain note sings the channel\'s own vowel at its own pitch', async () => {
    const render = async (withLine: boolean) => {
      const b = await boot('sing-rest');
      const v = b.voice('vocal', { phoneme: ph('i'), bend: 12, vibratoDepth: 0, drift: 0, roughness: 0 });
      b.clock.at('1m', (_t, step) => {
        if (step !== 0) return;
        if (withLine) v.sing('/mɑ/', [{ note: 'C3', dur: { seconds: 0.5 } }], { at: 0.5 });
        v.note('C3', { at: 2, dur: { seconds: 0.6 } });
      });
      return b.render({ seconds: 2.8, sampleRate: SR });
    };
    const plain = await render(false);
    const sung = await render(true);
    const s0 = Math.round(2.2 * SR);
    const pitch = (x: Float32Array) => yin(x.subarray(s0, s0 + 4096), SR)!.freq;
    // C3 up the channel's octave of bend, both times
    expect(Math.abs(1200 * Math.log2(pitch(plain.left) / 261.63))).toBeLessThan(10);
    expect(Math.abs(1200 * Math.log2(pitch(sung.left) / 261.63))).toBeLessThan(10);
    // and the same vowel: /i/ has F2 near 2.3 kHz, /ɑ/ nothing there and F2 near 1.3 kHz
    const band = (x: Float32Array, lo: number, hi: number) => {
      let acc = 0;
      for (let f = lo; f <= hi; f += 25) {
        let re = 0;
        let im = 0;
        for (let i = 0; i < 4096; i++) {
          const w = (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / 4096)) * x[s0 + i];
          re += w * Math.cos((2 * Math.PI * f * i) / SR);
          im -= w * Math.sin((2 * Math.PI * f * i) / SR);
        }
        acc += re * re + im * im;
      }
      return acc;
    };
    const tilt = (x: Float32Array) => 10 * Math.log10(band(x, 1800, 3000) / band(x, 800, 1400));
    expect(tilt(plain.left)).toBeGreaterThan(-5);
    expect(Math.abs(tilt(sung.left) - tilt(plain.left))).toBeLessThan(3);
  });

  it('voices the vowel after an aspirated stop on its beat, as it does after a voiced one', async () => {
    /*
     * The release of /t/ holds voicing off for its 70 ms VOT. Posted at
     * the beat, the vowel was voiced 81 ms late (MEASURED); sing() now
     * releases the stop early by that much, so voicing reaches half its
     * steady level close to the beat.
     */
    const onset = async (lyric: string) => {
      const b = await boot('sing-vot');
      const v = b.voice('vocal', { vibratoDepth: 0, breath: 0 });
      b.clock.at('1m', (t, step) => {
        if (step !== 0) return;
        v.sing(lyric, [{ note: 'A2', dur: { seconds: 0.6 } }], { at: t + 0.5 });
      });
      const out = await b.render({ seconds: 1.2, sampleRate: SR });
      const beat = Math.round(0.5 * SR);
      const steady = lowBandRms(out.left, SR, beat + 0.25 * SR, beat + 0.45 * SR);
      const frame = Math.round(0.005 * SR);
      for (let i = beat - 0.1 * SR; i < beat + 0.2 * SR; i += frame) {
        if (lowBandRms(out.left, SR, i, i + frame) > steady / 2) return (i + frame / 2 - beat) / SR;
      }
      return Infinity;
    };
    const t = await onset('/tɑ/');
    const d = await onset('/dɑ/');
    /*
     * The articulatory voice voices /t/ 22.5 ms before the beat and /d/
     * 2.5 ms after it (MEASURED): its aspiration is CHIMERA's abduction
     * gesture, a little shorter than the VOT sing() releases early by.
     */
    expect(Math.abs(t)).toBeLessThan(0.025);
    expect(Math.abs(t - d)).toBeLessThan(0.03);
  });

  it('replays a sing() made inside a clock callback in b.render(), and only that one', async () => {
    const b = await boot('sing-replay');
    const v = b.voice('vocal');
    // a top-level sing() is live only, as a top-level note() is: render replays the callbacks
    v.sing('/ɑ/', [{ note: 'C4', dur: '2n' }], { at: 0.1 });
    const silent = await b.render({ beats: 4, sampleRate: 22050 });
    expect(peak(silent.left)).toBe(0);
    // a half note is 1 s at the default 120 bpm, so this sings at 0.1 s and 1.1 s
    b.clock.at('2n', (t, step) => {
      v.sing('/ma/', [{ note: step % 2 === 0 ? 'C4' : 'G4', dur: '4n' }], { at: t + 0.1 });
    });
    const first = await b.render({ beats: 4, sampleRate: 22050 });
    const second = await b.render({ beats: 4, sampleRate: 22050 });
    // one phrase in each half of the render
    const half = first.left.length >> 1;
    expect(peak(first.left, 0, half)).toBeGreaterThan(0.01);
    expect(peak(first.left, half)).toBeGreaterThan(0.01);
    expect(Array.from(second.left)).toEqual(Array.from(first.left));
  });
});

describe('sungEvents()', () => {
  const opts = { channel: 3, phonemeParam: 7, bendParam: 8, firstNoteId: 40 };

  it('numbers phrases from firstNoteId and sends a phoneme only when the sound changes', () => {
    const plan: SungPlan = {
      leadIn: 0.05,
      phrases: [
        {
          start: 0.95,
          end: 1.5,
          vel: 0.6,
          spans: [
            { ipa: 'd', start: 0.95, end: 1, kind: 'onset' },
            { ipa: 'ɑ', start: 1, end: 1.2, kind: 'nucleus' },
            { ipa: 'ɑ', start: 1.2, end: 1.4, kind: 'nucleus' },
            { ipa: 't', start: 1.4, end: 1.5, kind: 'coda' },
          ],
          pitches: [
            { time: 0.95, hz: 220 },
            { time: 1.2, hz: 440 },
          ],
        },
        {
          start: 2,
          end: 2.5,
          vel: 0.9,
          spans: [{ ipa: 'i', start: 2, end: 2.5, kind: 'nucleus' }],
          pitches: [{ time: 2, hz: 330 }],
        },
      ],
    };
    const { events, unknown, windows, leadIn, trimmed } = sungEvents(plan, opts);
    expect(unknown).toEqual([]);
    expect(windows).toEqual([
      { start: 0.95, end: 1.5, resets: true },
      { start: 2, end: 2.5, resets: true },
    ]);
    expect(leadIn).toBeCloseTo(0.05, 12);
    expect(trimmed).toBe(0);
    const P = EventKind.Param;
    expect(events).toEqual([
      { time: 0.95, kind: P, target: 3, a: 8, b: 0, c: 0 },
      { time: 0.95, kind: P, target: 3, a: 7, b: ph('d'), c: 0 },
      { time: 0.95, kind: EventKind.NoteOn, target: 3, a: 40, b: 220, c: 0.6 },
      { time: 1, kind: P, target: 3, a: 7, b: ph('ɑ'), c: 0 },
      // the second ɑ span is the same sound: no event; the octave is a bend of 12
      { time: 1.2, kind: P, target: 3, a: 8, b: 12, c: 0 },
      { time: 1.4, kind: P, target: 3, a: 7, b: ph('t'), c: 0 },
      { time: 1.5, kind: EventKind.NoteOff, target: 3, a: 40, b: 0, c: 0 },
      { time: 1.5, kind: P, target: 3, a: 8, b: 0, c: 0 },
      { time: 1.5, kind: P, target: 3, a: 7, b: VOCAL_DEFAULT_PHONEME, c: 0 },
      { time: 2, kind: P, target: 3, a: 8, b: 0, c: 0 },
      { time: 2, kind: P, target: 3, a: 7, b: ph('i'), c: 0 },
      { time: 2, kind: EventKind.NoteOn, target: 3, a: 41, b: 330, c: 0.9 },
      { time: 2.5, kind: EventKind.NoteOff, target: 3, a: 41, b: 0, c: 0 },
      { time: 2.5, kind: P, target: 3, a: 8, b: 0, c: 0 },
      { time: 2.5, kind: P, target: 3, a: 7, b: VOCAL_DEFAULT_PHONEME, c: 0 },
    ]);
  });

  it('puts a phoneme ahead of a bend at the same time, and skips a phrase it cannot play', () => {
    const plan: SungPlan = {
      leadIn: 0,
      phrases: [
        { start: 0, end: 1, vel: 1, spans: [], pitches: [{ time: 0, hz: 220 }] },
        {
          start: 1,
          end: 2,
          vel: 1,
          spans: [
            { ipa: 'ɑ', start: 1, end: 1.5, kind: 'nucleus' },
            { ipa: 'm', start: 1.5, end: 2, kind: 'onset' },
          ],
          pitches: [
            { time: 1, hz: 220 },
            { time: 1.5, hz: 247.5 },
          ],
        },
      ],
    };
    const { events } = sungEvents(plan, { ...opts, firstNoteId: 1 });
    const at15 = events.filter((e) => e.time === 1.5);
    expect(at15.map((e) => e.a)).toEqual([7, 8]);
    expect(at15[1].b).toBeCloseTo(12 * Math.log2(247.5 / 220), 12);
    // the empty first phrase is skipped but keeps its note id, so ids still follow phrase order
    expect(events.filter((e) => e.kind === EventKind.NoteOn).map((e) => e.a)).toEqual([2]);
  });

  const phrase = (spans: Array<[string, number, number, 'onset' | 'nucleus' | 'coda']>, end: number, vel = 1): SungPlan['phrases'][number] => ({
    start: spans[0][1],
    end,
    vel,
    spans: spans.map(([ipa, start, stop, kind]) => ({ ipa, start, end: stop, kind })),
    pitches: [{ time: spans[0][1], hz: 220 }],
  });
  const phonemeTimes = (events: KernelEvent[]) =>
    events.filter((e) => e.kind === EventKind.Param && e.a === 7).map((e) => [VOCAL_PHONEMES[e.b], +e.time.toFixed(6)]);

  it('releases an aspirated stop early by its VOT, so the vowel is voiced on the beat', () => {
    const lead = VOCAL_ACOUSTICS[ph('t')].vot + 0.01;
    // opening on /t/: the stop and its release both move back, and the NoteOn with them
    const opening = sungEvents({ leadIn: 0.06, phrases: [phrase([['t', 0.94, 1, 'onset'], ['ɑ', 1, 1.5, 'nucleus']], 1.5)] }, opts);
    expect(phonemeTimes(opening.events)).toEqual([
      ['t', +(0.94 - lead).toFixed(6)],
      ['ɑ', +(1 - lead).toFixed(6)],
      ['ɑ', 1.5],
    ]);
    expect(opening.events.find((e) => e.kind === EventKind.NoteOn)!.time).toBeCloseTo(0.94 - lead, 12);
    expect(opening.leadIn).toBeCloseTo(0.06 + lead, 12);
    // inside a phrase the stop takes at most half of the sound before it
    const inside = sungEvents({ leadIn: 0, phrases: [phrase([['ɑ', 1, 1.1, 'nucleus'], ['k', 1.1, 1.16, 'onset'], ['ɑ', 1.16, 1.6, 'nucleus']], 1.6)] }, opts);
    const kLead = VOCAL_ACOUSTICS[ph('k')].vot + 0.01;
    expect(phonemeTimes(inside.events)).toEqual([
      ['ɑ', 1],
      ['k', +Math.max(1.1 - kLead, 1.05).toFixed(6)],
      ['ɑ', +(1.16 - kLead).toFixed(6)],
      ['ɑ', 1.6],
    ]);
    // not after /s/, not for a voiced stop, not before a glide
    for (const spans of [
      [['s', 0.85, 0.94, 'onset'], ['t', 0.94, 1, 'onset'], ['ɑ', 1, 1.5, 'nucleus']],
      [['d', 0.94, 1, 'onset'], ['ɑ', 1, 1.5, 'nucleus']],
      [['t', 0.9, 0.95, 'onset'], ['w', 0.95, 1, 'onset'], ['ɑ', 1, 1.5, 'nucleus']],
    ] as Array<Array<[string, number, number, 'onset' | 'nucleus']>>) {
      const got = sungEvents({ leadIn: 0, phrases: [phrase(spans, 1.5)] }, opts);
      expect(phonemeTimes(got.events).slice(0, spans.length), spans.map((x) => x[0]).join('')).toEqual(spans.map(([ipa, t]) => [ipa, t]));
    }
  });

  it('keeps an early release after notBefore, the start of a render or now', () => {
    const one = phrase([['t', 0.02, 0.05, 'onset'], ['ɑ', 0.05, 0.5, 'nucleus']], 0.5);
    const free = sungEvents({ leadIn: 0.03, phrases: [one] }, opts);
    expect(free.events[0].time).toBeLessThan(0);
    const floored = sungEvents({ leadIn: 0.03, phrases: [one] }, { ...opts, notBefore: 0 });
    for (const e of floored.events) expect(e.time).toBeGreaterThanOrEqual(0);
    expect(phonemeTimes(floored.events).map((p) => p[0])).toEqual(['t', 'ɑ', 'ɑ']);
  });

  it('fits phrases between the ones posted before, cutting where they would overlap', () => {
    const one = phrase([['m', 0.9, 1, 'onset'], ['ɑ', 1, 1.5, 'nucleus']], 1.5);
    // opening inside a busy window: starts where it ends, on the sound in force there
    const late = sungEvents({ leadIn: 0.1, phrases: [one] }, { ...opts, busy: [{ start: 0, end: 0.95, resets: true }] });
    expect(late.events.find((e) => e.kind === EventKind.NoteOn)!.time).toBe(0.95);
    expect(phonemeTimes(late.events)).toEqual([['m', 0.95], ['ɑ', 1], ['ɑ', 1.5]]);
    expect(late.trimmed).toBeCloseTo(0.05, 12);
    expect(late.leadIn).toBeCloseTo(0.05, 12);
    // running into a later window: ends at its start, without the resets
    const early = sungEvents({ leadIn: 0.1, phrases: [one] }, { ...opts, busy: [{ start: 1.3, end: 2, resets: true }] });
    // a nanosecond early, so it sorts ahead of that phrase's opening events at 1.3
    expect(early.events[early.events.length - 1]).toEqual({ time: 1.3 - 1e-9, kind: EventKind.NoteOff, target: 3, a: 40, b: 0, c: 0 });
    expect(early.windows).toEqual([{ start: 0.9, end: 1.3, resets: false }]);
    expect(early.trimmed).toBeCloseTo(0.2, 12);
    // no room at all: nothing posted, all of it trimmed
    const none = sungEvents({ leadIn: 0.1, phrases: [one] }, { ...opts, busy: [{ start: 0.5, end: 2, resets: true }] });
    expect(none.events).toEqual([]);
    expect(none.windows).toEqual([]);
    expect(none.trimmed).toBeCloseTo(0.6, 12);
    // the rest values given are the ones handed back
    const rest = sungEvents({ leadIn: 0.1, phrases: [one] }, { ...opts, restPhoneme: ph('i'), restBend: -5 });
    expect(rest.events.slice(-2).map((e) => [e.a, e.b])).toEqual([[8, -5], [7, ph('i')]]);
  });
});

describe('sungEvents(): the sounds ahead and the early bends', () => {
  const plan = planSung(
    [
      { time: 1, dur: 0.5, hz: 220 },
      { time: 1.5, dur: 0.5, hz: 330 },
    ],
    lyricsToSyllables('/mɑ sɑ/'),
  );
  const opts = { channel: 0, phonemeParam: 7, bendParam: 8, nextPhonemeParam: 9, nextInParam: 10 };

  it('posts nothing extra without planLead and bendLead, as before', () => {
    const plain = sungEvents(plan, opts).events;
    expect(plain.some((e) => e.kind === EventKind.Param && (e.a === 9 || e.a === 10))).toBe(false);
  });

  it('announces every later sound planLead ahead, never before the NoteOn, as nextIn then nextPhoneme', () => {
    const { events } = sungEvents(plan, { ...opts, planLead: VOCAL_PLAN_LEAD });
    const on = events.findIndex((e) => e.kind === EventKind.NoteOn);
    const phonemes = events.filter((e) => e.kind === EventKind.Param && e.a === 7).slice(1, -1);
    const next = events.filter((e) => e.kind === EventKind.Param && e.a === 9);
    const inn = events.filter((e) => e.kind === EventKind.Param && e.a === 10);
    expect(next.map((e) => e.b)).toEqual(phonemes.map((e) => e.b));
    next.forEach((e, k) => {
      expect(e.time).toBeGreaterThanOrEqual(events[on].time);
      expect(e.time + inn[k].b).toBeCloseTo(phonemes[k].time, 12);
      expect(inn[k].b).toBeLessThanOrEqual(VOCAL_PLAN_LEAD + 1e-12);
      expect(events.indexOf(inn[k])).toBe(events.indexOf(e) - 1);
      expect(events.indexOf(e)).toBeGreaterThan(on);
    });
    for (let i = 1; i < events.length; i++) expect(events[i].time).toBeGreaterThanOrEqual(events[i - 1].time);
  });

  it('posts each bend bendLead early, but not before the NoteOn', () => {
    const { events } = sungEvents(plan, { ...opts, bendLead: 0.05 });
    const bends = events.filter((e) => e.kind === EventKind.Param && e.a === 8);
    const change = plan.phrases[0].pitches[1];
    expect(bends.find((e) => e.b !== 0)!.time).toBeCloseTo(change.time - 0.05, 12);
  });
});
