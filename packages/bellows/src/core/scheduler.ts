/*
 * Lookahead scheduler. A timer on the main thread wakes up every few tens
 * of milliseconds and asks the transport for every subdivision tick inside
 * the upcoming window; callbacks fire ahead of time with the exact tick
 * seconds, and whatever events they emit get timestamped with those
 * seconds, so kernel placement stays sample accurate no matter how late
 * the timer ran. Pure logic: the caller supplies the current time.
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

export class Scheduler {
  private subs = new Set<Sub>();
  private readonly horizon: number;

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
    for (const s of this.subs) {
      s.scheduledTo = -Infinity;
      s.lastStep = -1;
    }
  }

  /** Called by the timer with the current absolute time. */
  tick(nowSeconds: number): void {
    const to = nowSeconds + this.horizon;
    for (const s of this.subs) {
      const from = Math.max(s.scheduledTo, nowSeconds);
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
