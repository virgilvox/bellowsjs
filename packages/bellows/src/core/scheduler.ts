/*
 * Lookahead scheduler. A timer on the main thread wakes up every few tens
 * of milliseconds and asks the transport for every subdivision tick inside
 * the upcoming window; callbacks fire ahead of time with the exact tick
 * seconds, and whatever events they emit get timestamped with those
 * seconds, so kernel placement stays sample accurate no matter how late
 * the timer ran. Pure logic: the caller supplies the current time.
 *
 * Two defenses against late wakeups:
 *  - the window start reaches back up to CATCHUP seconds behind now, so a
 *    stalled timer replays recently missed ticks slightly late instead of
 *    dropping them;
 *  - the lookahead stretches to cover the observed wakeup gap, so under
 *    background-tab throttling (timers clamped to a second or more) the
 *    schedule keeps running ahead of the clamp and nothing is missed.
 */

import type { Transport } from '../seq/transport';

export type TickCallback = (timeSeconds: number, step: number) => void;

interface Sub {
  subdivision: number;
  cb: TickCallback;
  /** end of the last scheduled window, so overlapping wakeups never double-fire */
  scheduledTo: number;
  /** last step index delivered, guards the window-overlap backup in scheduleHorizon */
  lastStep: number;
}

const CATCHUP = 0.25;

export class Scheduler {
  private subs = new Set<Sub>();
  private readonly horizon: number;
  private lastTick = -1;
  private gap = 0;

  constructor(private transport: Transport, opts?: { horizon?: number }) {
    this.horizon = opts?.horizon ?? 0.12;
  }

  /**
   * Register a callback for every `subdivision` beats. Returns an
   * unsubscribe function.
   */
  at(subdivision: number, cb: TickCallback): () => void {
    const sub: Sub = { subdivision, cb, scheduledTo: -Infinity, lastStep: -1 };
    this.subs.add(sub);
    return () => this.subs.delete(sub);
  }

  clear(): void {
    this.subs.clear();
  }

  get size(): number {
    return this.subs.size;
  }

  /** Reset window tracking, for transport restarts. */
  rewind(): void {
    this.lastTick = -1;
    this.gap = 0;
    for (const s of this.subs) {
      s.scheduledTo = -Infinity;
      s.lastStep = -1;
    }
  }

  /**
   * Re-aim delivery at a beat position, for pause/resume: the next tick
   * delivered for each subscription is the one at or after `beat`, and
   * window tracking restarts.
   */
  resyncTo(beat: number): void {
    for (const s of this.subs) {
      s.scheduledTo = -Infinity;
      s.lastStep = Math.ceil(beat / s.subdivision - 1e-9) - 1;
    }
  }

  /** Called by the timer with the current absolute time. */
  tick(nowSeconds: number): void {
    // adaptive lookahead: track the observed wakeup cadence and stay ahead of it
    if (this.lastTick >= 0) {
      const observed = nowSeconds - this.lastTick;
      this.gap = Math.max(this.gap * 0.9, observed);
    }
    this.lastTick = nowSeconds;
    const to = nowSeconds + Math.max(this.horizon, this.gap * 1.5);

    // the catch-up reach also stretches with the observed gap, so the first
    // long stall replays its ticks (late but present) instead of dropping them
    const back = Math.max(CATCHUP, this.gap);
    for (const s of this.subs) {
      const from = s.scheduledTo === -Infinity
        ? nowSeconds
        : Math.max(s.scheduledTo, nowSeconds - back);
      if (to <= from) continue;
      for (const t of this.transport.scheduleHorizon(from, to, s.subdivision)) {
        if (t.step <= s.lastStep) continue;
        s.lastStep = t.step;
        s.cb(t.seconds, t.step);
      }
      s.scheduledTo = to;
    }
  }
}
