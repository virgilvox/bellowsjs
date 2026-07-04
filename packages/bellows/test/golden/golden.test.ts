/*
 * Golden render regression. A fixed message stream renders offline and the
 * output is compared against a stored reference with tolerance (never exact
 * float equality: platforms may differ in transcendental rounding).
 *
 * Regenerate after intentional DSP changes:
 *   GOLDEN_UPDATE=1 npx vitest run test/golden
 * and commit the .bin files with the change that explains them.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerBuiltins } from '../../src/core/register';
import { renderOffline } from '../../src/render/offline';
import { EventKind } from '../../src/types';
import type { KernelMessage } from '../../src/kernel/messages';

const here = dirname(fileURLToPath(import.meta.url));
const UPDATE = process.env.GOLDEN_UPDATE === '1';

beforeAll(() => registerBuiltins());

/** A small deterministic piece touching several engines and effects. */
function pieceSetup(): KernelMessage[] {
  const events: KernelMessage = {
    type: 'events',
    events: [
      { time: 0.02, kind: EventKind.NoteOn, target: 0, a: 1, b: 110, c: 0.9 },
      { time: 0.5, kind: EventKind.NoteOff, target: 0, a: 1, b: 0, c: 0 },
      { time: 0.25, kind: EventKind.NoteOn, target: 1, a: 2, b: 440, c: 0.7 },
      { time: 0.6, kind: EventKind.NoteOff, target: 1, a: 2, b: 0, c: 0 },
      { time: 0.02, kind: EventKind.NoteOn, target: 2, a: 3, b: 55, c: 1 },
      { time: 0.1, kind: EventKind.NoteOff, target: 2, a: 3, b: 0, c: 0 },
      { time: 0.75, kind: EventKind.NoteOn, target: 3, a: 4, b: 330, c: 0.8 },
      { time: 1.1, kind: EventKind.NoteOff, target: 3, a: 4, b: 0, c: 0 },
    ],
  };
  return [
    { type: 'createChannel', id: 0, engineId: 'va', params: { cutoff: 900, resonance: 0.4 }, seed: 'g0' },
    { type: 'createChannel', id: 1, engineId: 'fm', params: {}, seed: 'g1' },
    { type: 'createChannel', id: 2, engineId: 'kick', params: {}, seed: 'g2' },
    { type: 'createChannel', id: 3, engineId: 'pluck', params: {}, seed: 'g3' },
    { type: 'channelGain', id: 0, gain: 0.7 },
    { type: 'channelGain', id: 1, gain: 0.5 },
    { type: 'channelGain', id: 2, gain: 0.9 },
    { type: 'channelGain', id: 3, gain: 0.6 },
    { type: 'channelPan', id: 1, pan: 0.4 },
    { type: 'channelPan', id: 3, pan: -0.3 },
    { type: 'createBus', id: 1, chain: [{ effectId: 'fdn', params: { decay: 1.4, mix: 1 } }], returnLevel: 0.35 },
    { type: 'send', channelId: 1, busId: 1, level: 0.5 },
    { type: 'send', channelId: 3, busId: 1, level: 0.6 },
    { type: 'channelFx', id: 0, chain: [{ effectId: 'saturator', params: { drive: 2 } }] },
    { type: 'masterFx', chain: [{ effectId: 'compressor', params: { threshold: -14, ratio: 3 } }] },
    { type: 'masterGain', gain: 0.9 },
    events,
  ];
}

function renderPiece(): Float32Array {
  const { left, right } = renderOffline(pieceSetup(), { seconds: 1.6, sampleRate: 44100 });
  const out = new Float32Array(left.length * 2);
  out.set(left, 0);
  out.set(right, left.length);
  return out;
}

describe('golden render', () => {
  const goldenPath = join(here, 'piece-a.f32');

  it('matches the stored reference within tolerance', () => {
    const got = renderPiece();
    if (UPDATE || !existsSync(goldenPath)) {
      mkdirSync(here, { recursive: true });
      writeFileSync(goldenPath, Buffer.from(got.buffer));
      expect(UPDATE || !existsSync(goldenPath)).toBeTruthy();
      return;
    }
    const raw = readFileSync(goldenPath);
    const want = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
    expect(got.length).toBe(want.length);
    let maxDiff = 0;
    let sumSq = 0;
    for (let i = 0; i < got.length; i++) {
      const d = Math.abs(got[i] - want[i]);
      if (d > maxDiff) maxDiff = d;
      sumSq += d * d;
    }
    const rmsDiff = Math.sqrt(sumSq / got.length);
    expect(maxDiff).toBeLessThan(1e-3);
    expect(rmsDiff).toBeLessThan(1e-4);
  });

  it('renders are exactly reproducible in-process', () => {
    expect(renderPiece()).toEqual(renderPiece());
  });
});
