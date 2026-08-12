import { describe, it, expect, beforeAll } from 'vitest';
import { KernelEngine, internParam } from '../../src/kernel/engine';
import { registerEngine, registerEffect } from '../../src/core/registry';
import { EventKind } from '../../src/types';
import type { EngineDef, EffectDef, Voice } from '../../src/types';

/* A test engine emitting a constant DC value while held, immediate release. */
function makeTestEngine(id: string): EngineDef {
  return {
    id,
    label: 'test',
    params: [{ name: 'amp', min: 0, max: 1, default: 0.5 }],
    polyphony: 4,
    createVoice(sampleRate, params): Voice {
      let on = false;
      let amp = params.amp ?? 0.5;
      let vel = 1;
      return {
        noteOn(freq, v) { on = true; vel = v; },
        noteOff() { on = false; },
        setParam(name, value) { if (name === 'amp') amp = value; },
        get active() { return on; },
        process(outL, outR, from, to) {
          for (let i = from; i < to; i++) {
            outL[i] += amp * vel;
            outR[i] += amp * vel;
          }
        },
      };
    },
  };
}

const halver: EffectDef = {
  id: 'test-halver',
  label: 'halver',
  params: [],
  create() {
    return {
      process(l, r, from, to) {
        for (let i = from; i < to; i++) { l[i] *= 0.5; r[i] *= 0.5; }
      },
      setParam() {},
      reset() {},
    };
  },
};

beforeAll(() => {
  registerEngine(makeTestEngine('test-dc'));
  registerEffect(halver);
});

function boot(sr = 48000) {
  const k = new KernelEngine(sr);
  k.apply({ type: 'createChannel', id: 0, engineId: 'test-dc', params: { amp: 0.5 }, seed: 's' });
  k.apply({ type: 'channelGain', id: 0, gain: 1 });
  k.apply({ type: 'masterGain', gain: 1 });
  return k;
}

function run(k: KernelEngine, blocks: number): { l: Float32Array; r: Float32Array } {
  const l = new Float32Array(blocks * k.blockSize);
  const r = new Float32Array(blocks * k.blockSize);
  const bl = new Float32Array(k.blockSize);
  const br = new Float32Array(k.blockSize);
  for (let b = 0; b < blocks; b++) {
    k.process(bl, br);
    l.set(bl, b * k.blockSize);
    r.set(br, b * k.blockSize);
  }
  return { l, r };
}

describe('kernel engine', () => {
  it('places a note on at the exact sample', () => {
    const k = boot();
    // note starts at frame 200 (inside block 1)
    k.apply({ type: 'events', events: [
      { time: 200 / 48000, kind: EventKind.NoteOn, target: 0, a: 1, b: 440, c: 1 },
    ] });
    // snap gains so panning ramp does not blur the step
    const { l } = run(k, 3);
    expect(l[198]).toBe(0);
    expect(l[199]).toBe(0);
    expect(l[200]).toBeGreaterThan(0);
    expect(l[201]).toBeGreaterThan(0);
  });

  /*
   * The test above, and every other event test here, uses a whole number
   * of samples, where round, floor and ceil all agree. So none of them can
   * see which one the kernel uses: changing Math.round to Math.floor in
   * process() left all 1273 tests passing. That is the property CLAUDE.md
   * names as the reason voices take (l, r, from, to) ranges at all, and
   * the golden render cannot cover it either, because its events also sit
   * on exact sample boundaries.
   *
   * Rounding to nearest is what the kernel does and what it should do: a
   * request is served by the sample closest to it, so the worst placement
   * error is half a sample rather than a whole one.
   *
   * The exact half-way case is deliberately not asserted. Events carry
   * seconds, so reaching it needs frames / sr * sr to land back on .5, and
   * at 48000 it does not: 200.5 / 48000 * 48000 is 200.49999999999997 and
   * rounds down. Gating that would gate the round trip's luck at one
   * sample rate rather than the kernel's rule.
   */
  it('rounds a fractional event time to the nearest sample, not down or up', () => {
    const firstSounding = (frames: number): number => {
      const k = boot();
      k.apply({ type: 'events', events: [
        { time: frames / 48000, kind: EventKind.NoteOn, target: 0, a: 1, b: 440, c: 1 },
      ] });
      const { l } = run(k, 3);
      for (let i = 0; i < l.length; i++) if (l[i] !== 0) return i;
      return -1;
    };
    /* floor would give 200 for the middle four; ceil would give 201 for
     * 200.2 and 200.49. Only round produces this column. */
    expect(firstSounding(200)).toBe(200);
    expect(firstSounding(200.2)).toBe(200);
    expect(firstSounding(200.49)).toBe(200);
    expect(firstSounding(200.6)).toBe(201);
    expect(firstSounding(200.8)).toBe(201);
    expect(firstSounding(201)).toBe(201);
  });

  it('rounds every event in a block, not just the first', () => {
    /* The split loop reuses `from` across events, so an event placed
     * inside the block has to be rounded against the block, not against
     * the previous split point. Three note ons and two note offs land at
     * five different fractional positions inside one 128 sample block. */
    const k = boot();
    k.apply({ type: 'events', events: [
      { time: 10.6 / 48000, kind: EventKind.NoteOn, target: 0, a: 1, b: 440, c: 1 },
      { time: 40.4 / 48000, kind: EventKind.NoteOff, target: 0, a: 1, b: 0, c: 0 },
      { time: 70.5 / 48000, kind: EventKind.NoteOn, target: 0, a: 2, b: 440, c: 1 },
      { time: 100.2 / 48000, kind: EventKind.NoteOff, target: 0, a: 2, b: 0, c: 0 },
      { time: 120.9 / 48000, kind: EventKind.NoteOn, target: 0, a: 3, b: 440, c: 1 },
    ] });
    const { l } = run(k, 2);
    const edges: number[] = [];
    for (let i = 1; i < 200; i++) if ((l[i] !== 0) !== (l[i - 1] !== 0)) edges.push(i);
    expect(edges).toEqual([11, 40, 71, 100, 121]);
  });

  it('stops at note off, sample accurate', () => {
    const k = boot();
    k.apply({ type: 'events', events: [
      { time: 0, kind: EventKind.NoteOn, target: 0, a: 7, b: 440, c: 1 },
      { time: 300 / 48000, kind: EventKind.NoteOff, target: 0, a: 7, b: 0, c: 0 },
    ] });
    const { l } = run(k, 4);
    expect(l[299]).toBeGreaterThan(0);
    expect(l[300]).toBe(0);
  });

  it('sums polyphony and respects the pool size', () => {
    const k = boot();
    const events = [];
    for (let n = 0; n < 6; n++) {
      events.push({ time: 0, kind: EventKind.NoteOn, target: 0, a: n, b: 440, c: 1 });
    }
    k.apply({ type: 'events', events });
    const { l } = run(k, 1);
    // polyphony 4, amp 0.5, equal-power center pan is cos(pi/4)*sqrt2 = 1
    expect(l[100]).toBeCloseTo(4 * 0.5, 3);
    expect(k.voiceCount).toBe(4);
  });

  it('applies channel fx and master gain', () => {
    const k = boot();
    k.apply({ type: 'channelFx', id: 0, chain: [{ effectId: 'test-halver' }] });
    k.apply({ type: 'events', events: [
      { time: 0, kind: EventKind.NoteOn, target: 0, a: 1, b: 440, c: 1 },
    ] });
    const { l } = run(k, 2);
    expect(l[200]).toBeCloseTo(0.25, 3);
  });

  it('routes sends through bus fx and returns', () => {
    const k = boot();
    k.apply({ type: 'createBus', id: 1, chain: [{ effectId: 'test-halver' }], returnLevel: 1 });
    k.apply({ type: 'send', channelId: 0, busId: 1, level: 1 });
    k.apply({ type: 'events', events: [
      { time: 0, kind: EventKind.NoteOn, target: 0, a: 1, b: 440, c: 1 },
    ] });
    const { l } = run(k, 8);
    // dry 0.5 plus send 0.5 halved = 0.75 after ramps settle
    expect(l[8 * 128 - 1]).toBeCloseTo(0.75, 2);
  });

  it('param events reach voices via the intern table', () => {
    const k = boot();
    const idx = internParam('amp');
    k.apply({ type: 'internParam', name: 'amp', index: idx });
    k.apply({ type: 'events', events: [
      { time: 0, kind: EventKind.NoteOn, target: 0, a: 1, b: 440, c: 1 },
      { time: 128 / 48000, kind: EventKind.Param, target: 0, a: idx, b: 0.9, c: 0 },
    ] });
    const { l } = run(k, 2);
    expect(l[64]).toBeCloseTo(0.5, 3);
    expect(l[192]).toBeCloseTo(0.9, 3);
  });

  it('panic silences everything', () => {
    const k = boot();
    k.apply({ type: 'events', events: [
      { time: 0, kind: EventKind.NoteOn, target: 0, a: 1, b: 440, c: 1 },
    ] });
    run(k, 1);
    k.apply({ type: 'panic' });
    const { l } = run(k, 1);
    expect(Math.max(...l)).toBe(0);
  });

  it('is deterministic: same messages, same output', () => {
    const render = () => {
      const k = boot();
      k.apply({ type: 'events', events: [
        { time: 0, kind: EventKind.NoteOn, target: 0, a: 1, b: 440, c: 0.8 },
        { time: 0.005, kind: EventKind.NoteOff, target: 0, a: 1, b: 0, c: 0 },
      ] });
      return run(k, 4).l;
    };
    const a = render();
    const b = render();
    expect(a).toEqual(b);
  });

  it('starts at a master gain of 0.9 when nothing sets one', () => {
    /*
     * Bellows.boot only posts masterGain when the caller passes one, so
     * the kernel's constructor default is what a plain boot plays at. It
     * was observable by nothing: every test here and every golden render
     * sets the gain explicitly, so changing 0.9 to 0.7 passed the suite
     * while quietly making everybody's default output 2 dB quieter.
     *
     * 0.9 leaves a little room under full scale for a sum of voices
     * without being an audible attenuation.
     */
    const k = new KernelEngine(48000);
    k.apply({ type: 'createChannel', id: 0, engineId: 'test-dc', params: { amp: 0.5 }, seed: 's' });
    k.apply({ type: 'channelGain', id: 0, gain: 1 });
    k.apply({ type: 'events', events: [
      { time: 0, kind: EventKind.NoteOn, target: 0, a: 1, b: 440, c: 1 },
    ] });
    /* The dc engine emits amp * vel = 0.5 into both channels, the pan law
     * is equal power at unity in the centre, so the only thing left is
     * the master gain. Read late, after every ramp has settled. */
    const { l } = run(k, 40);
    expect(l[40 * 128 - 1]).toBeCloseTo(0.5 * 0.9, 4);
  });

  it('equal power pan moves energy between channels', () => {
    const k = boot();
    k.apply({ type: 'channelPan', id: 0, pan: -1 });
    k.apply({ type: 'events', events: [
      { time: 0, kind: EventKind.NoteOn, target: 0, a: 1, b: 440, c: 1 },
    ] });
    const { l, r } = run(k, 20);
    const at = 20 * 128 - 1;
    expect(l[at]).toBeGreaterThan(0.6);
    expect(r[at]).toBeLessThan(0.01);
  });
});
