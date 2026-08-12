/*
 * Does the kernel render the same audio at any block size?
 *
 * The whole point of the event-splitting loop in KernelEngine.process is
 * that a note lands where it was aimed regardless of where a block boundary
 * falls. blockSize is a public option on renderOffline, and AudioWorklet's
 * render quantum is 128 today but the specification does not promise it
 * forever: a browser that changed it would change every render this library
 * has ever produced, quietly.
 *
 * Nothing varied it. Every test in the suite, and every golden render, used
 * 128, so the property the split loop exists to provide was never observed.
 *
 * Two of these are bit exact and one is not, and which is which is the
 * interesting part. Voices split at events, so they are exact. Effects
 * process whole blocks, and the ones with internal block structure are
 * exact too because their structure is their own rather than the host's.
 * Parameter automation steps once per block by design, so it is exact only
 * against itself and is asserted as a bound instead.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { registerBuiltins } from '../../src/register';
import { registerEngine } from '../../src/core/registry';
import { renderOffline } from '../../src/render/offline';
import { internParam } from '../../src/kernel/engine';
import { bankEngineResolver } from '../../src/render/banks';
import { EventKind } from '../../src/types';
import type { EngineDef, Voice } from '../../src/types';
import type { KernelMessage } from '../../src/kernel/messages';

const SR = 44100;
const SIZES = [32, 64, 128, 256, 512];

/** A voice whose output is its `amp` parameter, so a ramp is readable directly. */
const dc: EngineDef = {
  id: 'blocksize-dc',
  label: 'block size test dc',
  params: [{ name: 'amp', min: 0, max: 1, default: 0.5 }],
  polyphony: 2,
  createVoice(_sampleRate, params): Voice {
    let on = false;
    let amp = params.amp ?? 0.5;
    return {
      noteOn() { on = true; },
      noteOff() { on = false; },
      setParam(name, value) { if (name === 'amp') amp = value; },
      get active() { return on; },
      process(outL, outR, from, to) {
        for (let i = from; i < to; i++) {
          outL[i] += amp;
          outR[i] += amp;
        }
      },
    };
  },
};

let AMP = 0;
beforeAll(() => {
  registerBuiltins();
  registerEngine(dc);
  AMP = internParam('amp');
});

function render(msgs: KernelMessage[], blockSize: number, seconds = 0.5): Float32Array {
  return renderOffline(msgs, {
    seconds,
    sampleRate: SR,
    kernel: { blockSize, resolveBankEngine: bankEngineResolver },
  }).left;
}

/** Worst absolute difference between two renders, and where it is. */
function worstDiff(a: Float32Array, b: Float32Array): { worst: number; at: number } {
  const n = Math.min(a.length, b.length);
  let worst = 0;
  let at = -1;
  for (let i = 0; i < n; i++) {
    const d = Math.abs(a[i] - b[i]);
    if (d > worst) {
      worst = d;
      at = i;
    }
  }
  return { worst, at };
}

/* Events at fractional sample positions, so the split loop has work to do
 * and the boundaries genuinely fall in different places at each size. */
function voiceSetup(fx: boolean): KernelMessage[] {
  const m: KernelMessage[] = [
    { type: 'createChannel', id: 0, engineId: 'va', params: { cutoff: 1500 }, seed: 'bs' },
    { type: 'channelGain', id: 0, gain: 0.8 },
    { type: 'masterGain', gain: 0.9 },
  ];
  if (fx) {
    m.push({ type: 'channelFx', id: 0, chain: [{ effectId: 'delay', params: {} }] });
    m.push({
      type: 'masterFx',
      chain: [
        { effectId: 'plate', params: {} },
        { effectId: 'saturator', params: { drive: 4 } },
        { effectId: 'limiter', params: {} },
      ],
    });
  }
  m.push({
    type: 'events',
    events: [
      { time: 100.4 / SR, kind: EventKind.NoteOn, target: 0, a: 60, b: 261.63, c: 0.9 },
      { time: 5000.7 / SR, kind: EventKind.NoteOn, target: 0, a: 64, b: 329.63, c: 0.8 },
      { time: 9000.2 / SR, kind: EventKind.NoteOff, target: 0, a: 60, b: 0, c: 0 },
      { time: 13000.9 / SR, kind: EventKind.NoteOff, target: 0, a: 64, b: 0, c: 0 },
    ],
  });
  return m;
}

describe('block size independence', () => {
  it('renders voices bit-identically at every block size', () => {
    const ref = render(voiceSetup(false), 128);
    expect(ref.some((v) => v !== 0)).toBe(true);
    for (const bs of SIZES) {
      expect(worstDiff(ref, render(voiceSetup(false), bs)), `blockSize ${bs}`).toEqual({
        worst: 0,
        at: -1,
      });
    }
  });

  it('renders a full effect chain bit-identically at every block size', () => {
    /* A delay on the channel, then a plate, an oversampled saturator and a
     * lookahead limiter on master. Each of those carries state across
     * blocks and the last two carry latency, so if any of them were sized
     * from the host block rather than from their own design this fails. */
    const ref = render(voiceSetup(true), 128);
    expect(ref.some((v) => v !== 0)).toBe(true);
    for (const bs of SIZES) {
      expect(worstDiff(ref, render(voiceSetup(true), bs)), `blockSize ${bs}`).toEqual({
        worst: 0,
        at: -1,
      });
    }
  });

  it('steps parameter automation once per block, and says so', () => {
    /*
     * advanceRamps runs once at the top of each block, so a ramp is a
     * staircase whose tread is the block size. That is a deliberate choice
     * (the alternative is a per-sample ramp on every parameter of every
     * voice), and it is the one thing here that block size does change.
     *
     * The bound: the error against a reference at 128 can be no larger
     * than one step of the ramp over one block. Measured over 0.2 s from
     * 0.5 to 1.0, the step at blockSize 512 is 512/(0.2*44100) * 0.5 =
     * 0.029, and the measured worst difference is 0.0284.
     */
    const msgs: KernelMessage[] = [
      { type: 'internParam', name: 'amp', index: AMP },
      { type: 'createChannel', id: 0, engineId: 'blocksize-dc', params: { amp: 0.5 }, seed: 'r' },
      { type: 'channelGain', id: 0, gain: 1 },
      { type: 'masterGain', gain: 1 },
      {
        type: 'events',
        events: [
          { time: 0, kind: EventKind.NoteOn, target: 0, a: 1, b: 440, c: 1 },
          { time: 0.05, kind: EventKind.ParamRamp, target: 0, a: AMP, b: 1.0, c: 0.2 },
        ],
      },
    ];
    const ref = render(msgs, 128);
    /* The ramp really runs: the parameter starts at 0.5 and reaches 1. */
    expect(ref[Math.round(0.01 * SR)]).toBeCloseTo(0.5, 3);
    expect(ref[Math.round(0.3 * SR)]).toBeCloseTo(1.0, 3);

    const rampSeconds = 0.2;
    for (const bs of SIZES) {
      const { worst } = worstDiff(ref, render(msgs, bs));
      /* One tread of the larger of the two staircases, plus a little. */
      const bound = ((Math.max(bs, 128) / (rampSeconds * SR)) * 0.5) * 1.1;
      expect(worst, `blockSize ${bs}`).toBeLessThanOrEqual(bound);
      if (bs === 128) expect(worst).toBe(0);
    }
  });

  it('lands every ramp on its exact destination whatever the block size', () => {
    /* The staircase is allowed to differ; where it stops is not. */
    const msgs: KernelMessage[] = [
      { type: 'internParam', name: 'amp', index: AMP },
      { type: 'createChannel', id: 0, engineId: 'blocksize-dc', params: { amp: 0.5 }, seed: 'r' },
      { type: 'channelGain', id: 0, gain: 1 },
      { type: 'masterGain', gain: 1 },
      {
        type: 'events',
        events: [
          { time: 0, kind: EventKind.NoteOn, target: 0, a: 1, b: 440, c: 1 },
          { time: 0.05, kind: EventKind.ParamRamp, target: 0, a: AMP, b: 0.875, c: 0.2 },
        ],
      },
    ];
    for (const bs of SIZES) {
      const out = render(msgs, bs);
      expect(out[out.length - 1], `blockSize ${bs}`).toBeCloseTo(0.875, 6);
    }
  });
});
