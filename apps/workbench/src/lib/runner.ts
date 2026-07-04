/*
 * Executes example code against a fresh Bellows instance. Every run
 * disposes the previous instance and boots a new one with the example's
 * seed, so examples never leak channels, fx, or clock callbacks into each
 * other. The code string becomes the body of an async function with the
 * parameters (b, lib, log, onCleanup).
 */

import { reactive } from 'vue';
import * as lib from 'bellowsjs';
import { bellows, ensureBellows, disposeBellows } from './audio';
import type { Example } from '../examples/types';

export interface ConsoleLine {
  kind: 'log' | 'info' | 'error';
  text: string;
}

export const runner = reactive({
  running: false,
  runningId: null as string | null,
  lines: [] as ConsoleLine[],
});

const MAX_LINES = 200;

/* Invalidates log/cleanup callbacks from superseded runs. */
let runToken = 0;
let cleanups: Array<() => void> = [];

function pushLine(kind: ConsoleLine['kind'], text: string): void {
  runner.lines.push({ kind, text });
  if (runner.lines.length > MAX_LINES) {
    runner.lines.splice(0, runner.lines.length - MAX_LINES);
  }
}

function roundNumber(v: number): number {
  if (!Number.isFinite(v)) return v;
  return Math.round(v * 1000) / 1000;
}

export function formatValue(v: unknown): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(roundNumber(v));
  if (typeof v === 'boolean') return String(v);
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  if (typeof v === 'function') return '[function]';
  if (v instanceof ArrayBuffer) return 'ArrayBuffer(' + v.byteLength + ')';
  if (ArrayBuffer.isView(v)) {
    const len = (v as unknown as { length?: number }).length ?? v.byteLength;
    return v.constructor.name + '(' + len + ')';
  }
  try {
    return JSON.stringify(v, (_key, val) => {
      if (typeof val === 'function') return '[function]';
      if (val instanceof ArrayBuffer) return 'ArrayBuffer(' + val.byteLength + ')';
      if (ArrayBuffer.isView(val)) {
        const len = (val as unknown as { length?: number }).length ?? val.byteLength;
        return val.constructor.name + '(' + len + ')';
      }
      if (typeof val === 'number') return roundNumber(val);
      return val;
    });
  } catch {
    return String(v);
  }
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/*
 * The AsyncFunction wrapper prepends two generated lines plus '"use
 * strict";', so a stack frame at generated line N maps to code line N - 3.
 */
function lineHint(err: unknown): string {
  if (!(err instanceof Error) || typeof err.stack !== 'string') return '';
  const m = /<anonymous>:(\d+):(\d+)/.exec(err.stack);
  if (!m) return '';
  const line = parseInt(m[1], 10) - 3;
  if (line < 1) return '';
  return ' (line ' + line + ':' + m[2] + ')';
}

/** Stop the current run: cleanups, transport stop, panic, dispose. */
export function stopRun(): void {
  runToken++;
  const fns = cleanups;
  cleanups = [];
  for (const fn of fns) {
    try {
      fn();
    } catch (err) {
      pushLine('error', 'CLEANUP ERROR: ' + errorMessage(err));
    }
  }
  const b = bellows.value;
  if (b) {
    try {
      b.stop();
      b.panic();
    } catch {
      // the instance may already be torn down; dispose below regardless
    }
  }
  disposeBellows();
  if (runner.running) pushLine('info', 'STOPPED');
  runner.running = false;
  runner.runningId = null;
}

/*
 * Runs are chained so two boots can never race: a RUN during a slow boot
 * queues behind it, and the stale run aborts via the token check.
 */
let runChain: Promise<void> = Promise.resolve();

/** Compile and run example code. A run while running stops first. */
export function runExample(example: Example, code: string): Promise<void> {
  const next = runChain.then(() => doRun(example, code));
  runChain = next.catch(() => undefined);
  return next;
}

async function doRun(example: Example, code: string): Promise<void> {
  stopRun();
  const token = runToken;
  runner.lines = [];

  type ExampleFn = (b: unknown, libNs: unknown, log: unknown, onCleanup: unknown) => Promise<unknown>;
  const AsyncFunction = Object.getPrototypeOf(async function () {
    /* prototype probe */
  }).constructor as new (...args: string[]) => ExampleFn;

  let fn: ExampleFn;
  try {
    fn = new AsyncFunction('b', 'lib', 'log', 'onCleanup', '"use strict";\n' + code);
  } catch (err) {
    pushLine('error', 'COMPILE ERROR: ' + errorMessage(err));
    return;
  }

  pushLine('info', 'BOOT // seed "' + example.seed + '"');
  let b: lib.Bellows;
  try {
    b = await ensureBellows(example.seed);
  } catch (err) {
    pushLine('error', 'BOOT ERROR: ' + errorMessage(err));
    return;
  }
  if (token !== runToken) return; // superseded while booting

  runner.running = true;
  runner.runningId = example.id;

  const log = (...args: unknown[]): void => {
    if (token !== runToken) return;
    pushLine('log', args.map(formatValue).join(' '));
  };
  const onCleanup = (cleanup: () => void): void => {
    if (typeof cleanup !== 'function') return;
    if (token === runToken) cleanups.push(cleanup);
  };

  try {
    await fn(b, lib, log, onCleanup);
  } catch (err) {
    if (token === runToken) {
      pushLine('error', 'RUN ERROR: ' + errorMessage(err) + lineHint(err));
    }
  }
}
