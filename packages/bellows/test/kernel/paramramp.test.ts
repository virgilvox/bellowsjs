/*
 * EventKind.ParamRamp. The test engine emits a DC level equal to its `amp`
 * param while held, so every rendered sample reads back the parameter value
 * directly and a ramp shows up as a straight line in the output.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { registerEngine } from '../../src/core/registry';
import { renderOffline } from '../../src/render/offline';
import { internParam, KernelEngine } from '../../src/kernel/engine';
import { EventKind } from '../../src/types';
import type { EngineDef, KernelEvent, Voice } from '../../src/types';
import type { KernelMessage } from '../../src/kernel/messages';

const SR = 48000;

const dc: EngineDef = {
  id: 'ramp-dc',
  label: 'ramp test dc',
  params: [{ name: 'amp', min: 0, max: 1, default: 0.5 }],
  polyphony: 2,
  createVoice(sampleRate, params): Voice {
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
  registerEngine(dc);
  AMP = internParam('amp');
});

/** Unity gain everywhere, so a rendered sample is the amp value itself. */
function setup(events: KernelEvent[], channels = 1): KernelMessage[] {
  const msgs: KernelMessage[] = [{ type: 'internParam', name: 'amp', index: AMP }];
  for (let id = 0; id < channels; id++) {
    msgs.push({ type: 'createChannel', id, engineId: 'ramp-dc', params: { amp: 0.5 }, seed: 'r' + id });
    msgs.push({ type: 'channelGain', id, gain: 1 });
    msgs.push({ type: 'events', events: [{ time: 0, kind: EventKind.NoteOn, target: id, a: 1, b: 440, c: 1 }] });
  }
  msgs.push({ type: 'masterGain', gain: 1 });
  msgs.push({ type: 'events', events });
  return msgs;
}

function render(msgs: KernelMessage[], seconds: number) {
  return renderOffline(msgs, { seconds, sampleRate: SR });
}

const at = (x: Float32Array, sec: number) => x[Math.round(sec * SR)];

describe('kernel param ramps', () => {
  it('moves a parameter from its current value to the destination over the ramp time', () => {
    const msgs = setup([
      { time: 0.01, kind: EventKind.ParamRamp, target: 0, a: AMP, b: 1, c: 0.2 },
    ]);
    const { left } = render(msgs, 0.35);
    // still at the starting value before the ramp event
    expect(at(left, 0.005)).toBeCloseTo(0.5, 5);
    // strictly rising through the ramp
    expect(at(left, 0.06)).toBeGreaterThan(at(left, 0.03));
    expect(at(left, 0.15)).toBeGreaterThan(at(left, 0.06));
    // lands exactly on the destination and stays there
    expect(at(left, 0.25)).toBeCloseTo(1, 5);
    expect(at(left, 0.34)).toBeCloseTo(1, 5);
  });

  it('is about halfway at the midpoint of the ramp', () => {
    const msgs = setup([
      { time: 0, kind: EventKind.ParamRamp, target: 0, a: AMP, b: 1, c: 0.2 },
    ]);
    const { left } = render(msgs, 0.25);
    expect(at(left, 0.1)).toBeCloseTo(0.75, 2);
    expect(at(left, 0.05)).toBeCloseTo(0.625, 2);
    expect(at(left, 0.15)).toBeCloseTo(0.875, 2);
  });

  it('applies immediately when the duration is zero or negative', () => {
    for (const c of [0, -1]) {
      const msgs = setup([
        { time: 0.01, kind: EventKind.ParamRamp, target: 0, a: AMP, b: 0.25, c },
      ]);
      const { left } = render(msgs, 0.05);
      expect(at(left, 0.005)).toBeCloseTo(0.5, 5);
      // the sample right after the event frame already holds the destination
      expect(left[Math.round(0.01 * SR) + 1]).toBeCloseTo(0.25, 5);
    }
  });

  it('cancels an in-flight ramp when a zero duration event retargets it', () => {
    const msgs = setup([
      { time: 0, kind: EventKind.ParamRamp, target: 0, a: AMP, b: 1, c: 0.4 },
      { time: 0.1, kind: EventKind.ParamRamp, target: 0, a: AMP, b: 0.2, c: 0 },
    ]);
    const { left } = render(msgs, 0.3);
    // frozen at the immediate value: the cancelled ramp does not resume
    expect(at(left, 0.15)).toBeCloseTo(0.2, 5);
    expect(at(left, 0.29)).toBeCloseTo(0.2, 5);
  });

  it('lets a plain Param event cancel a ramp still moving that parameter', () => {
    const msgs = setup([
      { time: 0, kind: EventKind.ParamRamp, target: 0, a: AMP, b: 1, c: 0.4 },
      { time: 0.1, kind: EventKind.Param, target: 0, a: AMP, b: 0.2, c: 0 },
    ]);
    const { left } = render(msgs, 0.3);
    // an explicit set outranks automation, and the ramp does not creep back
    expect(at(left, 0.15)).toBeCloseTo(0.2, 5);
    expect(at(left, 0.29)).toBeCloseTo(0.2, 5);
  });

  it('lets a live channelParam message cancel a ramp on the same parameter', () => {
    // The live path posts channelParam as a message mid-stream, which
    // renderOffline cannot express, so drive the engine directly.
    const k = new KernelEngine(SR, { blockSize: 128 });
    for (const m of setup([{ time: 0, kind: EventKind.ParamRamp, target: 0, a: AMP, b: 1, c: 0.4 }])) {
      k.apply(m);
    }
    const l = new Float32Array(128);
    const r = new Float32Array(128);
    for (let i = 0; i < 20; i++) k.process(l, r);
    const moving = l[0];
    expect(moving).toBeGreaterThan(0.5);
    k.apply({ type: 'channelParam', id: 0, name: 'amp', value: 0.2 });
    for (let i = 0; i < 20; i++) k.process(l, r);
    // the ramp is gone, not merely interrupted: it does not creep back up
    expect(l[0]).toBeCloseTo(0.2, 5);
  });

  it('retargets an in-flight ramp without consuming a second slot', () => {
    // 32 slots exist. Ramping the same channel parameter 40 times must still
    // leave every other channel able to claim one.
    const events: KernelEvent[] = [];
    for (let i = 0; i < 40; i++) {
      events.push({ time: 0.001 * i, kind: EventKind.ParamRamp, target: 0, a: AMP, b: 1, c: 0.2 });
    }
    // channel 1 asks last, and only gets a slot if channel 0 used exactly one
    events.push({ time: 0.05, kind: EventKind.ParamRamp, target: 1, a: AMP, b: 1, c: 0.2 });
    const msgs = setup(events, 2);
    const { left } = render(msgs, 0.3);
    // both channels sum into the mix: a slot-starved channel 1 would jump to 1
    // immediately, so the sum would be 1.5 rather than a gradual climb
    expect(at(left, 0.055)).toBeLessThan(1.4);
    expect(at(left, 0.055)).toBeGreaterThan(1.0);
    expect(at(left, 0.29)).toBeCloseTo(2, 5);
  });

  it('applies the destination immediately once every slot is busy', () => {
    // 33 channels each ramping their own amp. Only the first 32 get slots.
    const n = 33;
    const events: KernelEvent[] = [];
    for (let id = 0; id < n; id++) {
      events.push({ time: 0, kind: EventKind.ParamRamp, target: id, a: AMP, b: 1, c: 1 });
    }
    const msgs = setup(events, n);
    // mute every channel but the last, so the output is channel 32 alone
    for (let id = 0; id < n - 1; id++) msgs.push({ type: 'channelGain', id, gain: 0 });
    const { left } = render(msgs, 0.1);
    // a ramp over one second would read about 0.5 here; the fallback is at 1
    expect(at(left, 0.002)).toBeCloseTo(1, 5);
    expect(at(left, 0.09)).toBeCloseTo(1, 5);
  });

  it('clears active ramps on panic', () => {
    const msgs = setup([
      { time: 0, kind: EventKind.ParamRamp, target: 0, a: AMP, b: 1, c: 0.5 },
    ]);
    let panicked = false;
    let restarted = false;
    const { left } = renderOffline(msgs, {
      seconds: 0.4,
      sampleRate: SR,
      onBlock(engine, sec) {
        // panic mid ramp, then start a fresh note to read the frozen value
        if (!panicked && sec >= 0.05) {
          engine.apply({ type: 'panic' });
          panicked = true;
          return;
        }
        if (panicked && !restarted && sec >= 0.06) {
          engine.apply({
            type: 'events',
            events: [{ time: sec, kind: EventKind.NoteOn, target: 0, a: 2, b: 440, c: 1 }],
          });
          restarted = true;
        }
      },
    });
    // 0.05 s into a 0.5 s ramp from 0.5 to 1 is 0.55, and it stays there
    const frozen = at(left, 0.1);
    expect(frozen).toBeCloseTo(0.55, 2);
    expect(at(left, 0.39)).toBeCloseTo(frozen, 6);
  });

  it('drops ramps for a removed channel', () => {
    const msgs = setup([
      { time: 0, kind: EventKind.ParamRamp, target: 0, a: AMP, b: 1, c: 0.3 },
    ]);
    let removed = false;
    const out = renderOffline(msgs, {
      seconds: 0.2,
      sampleRate: SR,
      onBlock(engine, sec) {
        if (!removed && sec >= 0.05) {
          engine.apply({ type: 'removeChannel', id: 0 });
          removed = true;
        }
      },
    });
    // the channel is gone, so the render is silent and nothing throws
    expect(at(out.left, 0.15)).toBe(0);
  });

  it('leaves a render with no ramp events byte identical', () => {
    const msgs = setup([
      { time: 0.1, kind: EventKind.Param, target: 0, a: AMP, b: 0.25, c: 0 },
    ]);
    const a = render(msgs, 0.2);
    const b = render(setup([
      { time: 0.1, kind: EventKind.Param, target: 0, a: AMP, b: 0.25, c: 0 },
    ]), 0.2);
    expect(a.left).toEqual(b.left);
    // exactly the values the block loop produced before ramps existed: an
    // unmodulated DC engine at unity gain, stepping once at the Param event
    const want = new Float32Array(a.left.length);
    const step = Math.round(0.1 * SR);
    for (let i = 0; i < want.length; i++) want[i] = i < step ? 0.5 : 0.25;
    expect(a.left).toEqual(want);
    expect(a.right).toEqual(want);
  });
});
