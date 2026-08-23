/*
 * The facade's transport control surface. b.start, b.stop, b.pause,
 * b.resume, b.panic, b.bpm, b.rampBpm and b.swing were all in coverage's
 * never-called list, which is what docs/AUDIT-2.md's Scheduler.rewind
 * finding names as the cause behind its own headline: rewind had no test
 * because nothing had ever driven the facade's transport at all.
 *
 * Bellows drives its scheduler from a 25 ms setInterval reading
 * ctx.currentTime, so these tests own both clocks: vitest's fake timers
 * for the interval and FakeAudioContext.currentTime for the audio clock,
 * advanced together by run().
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { Bellows } from '../../src/bellows';
import { registerBuiltins } from '../../src/register';
import { FakeAudioContext, FakeWorkletNode, installFakeAudio } from './fake-context';

const nodes: FakeWorkletNode[] = [];

class RecordingWorkletNode extends FakeWorkletNode {
  constructor(ctx: unknown, name: string, opts?: unknown) {
    super(ctx, name, opts);
    nodes.push(this);
  }
}

const live: Bellows[] = [];

async function boot(ctx: FakeAudioContext): Promise<Bellows> {
  const b = await Bellows.boot({
    seed: 'transport-surface',
    workletUrl: 'fake://worklet',
    context: ctx as unknown as AudioContext,
  });
  live.push(b);
  return b;
}

/** Advance the interval clock and the audio clock together. */
async function run(ctx: FakeAudioContext, seconds: number): Promise<void> {
  const ticks = Math.round(seconds * 1000 / 25);
  for (let i = 0; i < ticks; i++) {
    ctx.currentTime += 0.025;
    await vi.advanceTimersByTimeAsync(25);
  }
}

function postedTypes(): string[] {
  const port = nodes[nodes.length - 1].port as unknown as { posted: { type: string }[] };
  return port.posted.map((m) => m.type);
}

beforeAll(() => {
  registerBuiltins();
});

beforeEach(() => {
  installFakeAudio();
  (globalThis as Record<string, unknown>).AudioWorkletNode = RecordingWorkletNode;
  nodes.length = 0;
  vi.useFakeTimers();
});

afterEach(() => {
  for (const b of live.splice(0)) b.dispose();
  vi.useRealTimers();
});

describe('facade transport surface', () => {
  it('start delivers from step 0, and a second start replays from step 0', async () => {
    const ctx = new FakeAudioContext();
    const b = await boot(ctx);
    const steps: number[] = [];
    b.clock.at('4n', (_t, step) => steps.push(step));

    b.start();
    expect(b.transport.state).toBe('running');
    await run(ctx, 2);
    expect(steps[0]).toBe(0);
    expect(steps.length).toBeGreaterThanOrEqual(4);

    // the second start of a session: Bellows.start rewinds the scheduler, so
    // the piece replays from its first step rather than resuming mid-count
    steps.length = 0;
    b.stop();
    b.start();
    await run(ctx, 2);
    expect(steps[0]).toBe(0);
    for (let i = 0; i < steps.length - 1; i++) expect(steps[i + 1]).toBe(steps[i] + 1);
  });

  it('stop halts delivery, rewinds the transport and panics the kernel', async () => {
    const ctx = new FakeAudioContext();
    const b = await boot(ctx);
    const steps: number[] = [];
    b.clock.at('4n', (_t, step) => steps.push(step));

    b.start();
    await run(ctx, 1);
    const delivered = steps.length;
    expect(delivered).toBeGreaterThan(0);

    b.stop();
    expect(b.transport.state).toBe('stopped');
    expect(postedTypes()).toContain('panic');
    await run(ctx, 1);
    expect(steps.length).toBe(delivered);
  });

  it('pause freezes the beat and resume continues from there instead of restarting', async () => {
    const ctx = new FakeAudioContext();
    const b = await boot(ctx);
    const steps: number[] = [];
    b.clock.at('4n', (_t, step) => steps.push(step));

    b.start();
    await run(ctx, 1.5);
    const atPause = steps[steps.length - 1];
    expect(atPause).toBeGreaterThanOrEqual(2);

    b.pause();
    expect(b.transport.state).toBe('paused');
    const frozen = b.transport.beatAt(ctx.currentTime);
    await run(ctx, 1);
    expect(b.transport.beatAt(ctx.currentTime)).toBeCloseTo(frozen, 6);
    expect(steps[steps.length - 1]).toBe(atPause);

    b.resume();
    expect(b.transport.state).toBe('running');
    await run(ctx, 1.5);
    // resume re-aims at the paused beat: the count carries on, it does not reset
    expect(steps[steps.length - 1]).toBeGreaterThan(atPause);
    expect(steps).not.toContain(0 - 1);
    expect(steps.filter((s) => s === 0)).toHaveLength(1);
  });

  it('resume re-issues the ticks the lookahead had already sent', async () => {
    /*
     * The scheduler delivers ahead of time, so at the moment of a pause some
     * ticks have already been handed out with times that the re-anchor on
     * resume invalidates. resume() calls scheduler.resyncTo(pausedBeat) so
     * those come back at corrected times. A 32nd at 120 bpm is 62.5 ms and
     * the default horizon is 120 ms, so two ticks are always in flight.
     * Without the resync the first tick after resume jumps past them.
     */
    const ctx = new FakeAudioContext();
    const b = await boot(ctx);
    const steps: number[] = [];
    b.clock.at('32n', (_t, step) => steps.push(step));

    b.start();
    await run(ctx, 0.6);
    const before = steps.slice();
    expect(before.length).toBeGreaterThan(4);

    b.pause();
    await run(ctx, 0.3);
    b.resume();
    await run(ctx, 0.6);

    const after = steps.slice(before.length);
    expect(after.length).toBeGreaterThan(4);
    expect(after[0]).toBeLessThanOrEqual(before[before.length - 1]);
    for (let i = 0; i < after.length - 1; i++) expect(after[i + 1]).toBe(after[i] + 1);
  });

  it('bpm set before start changes the tick spacing', async () => {
    const ctx = new FakeAudioContext();
    const b = await boot(ctx);
    const times: number[] = [];
    b.clock.at('4n', (t) => times.push(t));

    b.bpm(240); // 0.25 s per beat instead of 0.5
    b.start();
    await run(ctx, 1.5);
    expect(times.length).toBeGreaterThanOrEqual(4);
    for (let i = 0; i < times.length - 1; i++) {
      expect(times[i + 1] - times[i]).toBeCloseTo(0.25, 6);
    }
  });

  it('rampBpm moves the tempo across the ramp', async () => {
    const ctx = new FakeAudioContext();
    const b = await boot(ctx);
    b.clock.at('4n', () => {});

    b.start();
    await run(ctx, 0.5);
    const before = b.transport.tempo.bpmAt(b.transport.beatAt(ctx.currentTime));
    expect(before).toBeCloseTo(120, 6);

    b.rampBpm(240, '4n');
    await run(ctx, 2);
    const after = b.transport.tempo.bpmAt(b.transport.beatAt(ctx.currentTime));
    expect(after).toBeGreaterThan(before);
    expect(after).toBeCloseTo(240, 6);
  });

  it('swing delays the offbeat eighths', async () => {
    const ctx = new FakeAudioContext();
    const b = await boot(ctx);
    const times: number[] = [];
    b.clock.at('8n', (t) => times.push(t));

    b.swing(0.5, '8n');
    b.start();
    await run(ctx, 1.2);
    expect(times.length).toBeGreaterThanOrEqual(4);
    /*
     * '8n' is half a beat, so 0.25 s at 120 bpm, and the delay the transport
     * applies is amount * subdivision * 0.5 beats: 0.5 * 0.5 * 0.5 = 0.125
     * beats, which is 62.5 ms. Even steps stay on the grid.
     */
    const origin = times[0];
    expect(times[1] - origin).toBeCloseTo(0.25 + 0.0625, 6);
    expect(times[2] - origin).toBeCloseTo(0.5, 6);
    expect(times[3] - origin).toBeCloseTo(0.75 + 0.0625, 6);
  });

  it('panic posts a panic message without stopping the transport', async () => {
    const ctx = new FakeAudioContext();
    const b = await boot(ctx);
    b.start();
    await run(ctx, 0.5);
    expect(postedTypes()).not.toContain('panic');
    b.panic();
    expect(postedTypes()).toContain('panic');
    expect(b.transport.state).toBe('running');
  });
});
