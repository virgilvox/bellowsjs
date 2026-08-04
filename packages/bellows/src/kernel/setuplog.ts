/*
 * The recorded setup stream: every structural kernel message a piece has
 * posted, in the order it was posted, ready to replay into a fresh offline
 * kernel.
 *
 * Why this is not a plain array: a live piece calls the same setters over
 * and over (an fx param tweaked every bar, a filter cutoff moved on every
 * legato note), and an append-only log grows without bound for the whole
 * session. State setters are idempotent and every setup message is applied
 * before the first rendered block, so keeping only the last value written
 * for a given target replays to exactly the same kernel state. The entry
 * stays at its first position so the ordering of everything else, which is
 * not idempotent, is untouched.
 *
 * It lives in the kernel layer, not in core, because it is defined entirely
 * in terms of KernelMessage. Core sits below the kernel and must not import
 * upward, even for a type.
 */

import type { KernelMessage } from './messages';

/**
 * Identity of a message whose repeats collapse last-write-wins, or null for
 * messages that must always append (creation, registration, definitions,
 * events, panic, removal).
 */
function collapseKey(msg: KernelMessage): string | null {
  switch (msg.type) {
    case 'channelParam':
      return 'channelParam:' + msg.id + ':' + msg.name;
    case 'channelGain':
      return 'channelGain:' + msg.id;
    case 'channelPan':
      return 'channelPan:' + msg.id;
    case 'channelFx':
      return 'channelFx:' + msg.id;
    case 'send':
      return 'send:' + msg.channelId + ':' + msg.busId;
    case 'fxParam':
      return 'fxParam:' + msg.channelId + ':' + msg.fxIndex + ':' + msg.name;
    case 'busFxParam':
      return 'busFxParam:' + msg.busId + ':' + msg.fxIndex + ':' + msg.name;
    case 'masterFxParam':
      return 'masterFxParam:' + msg.fxIndex + ':' + msg.name;
    case 'masterGain':
      return 'masterGain';
    case 'masterFx':
      return 'masterFx';
    default:
      return null;
  }
}

/** The channel a message configures, or null if it is not channel scoped. */
function channelOf(msg: KernelMessage): number | null {
  switch (msg.type) {
    case 'createChannel':
    case 'removeChannel':
    case 'channelFx':
    case 'channelParam':
    case 'channelGain':
    case 'channelPan':
      return msg.id;
    case 'fxParam':
    case 'send':
      return msg.channelId;
    default:
      return null;
  }
}

export class SetupLog {
  private msgs: KernelMessage[] = [];
  /** collapse key to position in msgs, rebuilt whenever positions shift */
  private slots = new Map<string, number>();

  get messages(): readonly KernelMessage[] {
    return this.msgs;
  }

  get size(): number {
    return this.msgs.length;
  }

  /** Record a message, collapsing it onto an earlier one where that is safe. */
  record(msg: KernelMessage): void {
    const key = collapseKey(msg);
    if (key === null) {
      this.msgs.push(msg);
      return;
    }
    const at = this.slots.get(key);
    if (at !== undefined) {
      this.msgs[at] = msg;
      return;
    }
    this.slots.set(key, this.msgs.length);
    this.msgs.push(msg);
  }

  /**
   * Forget a channel: its creation and everything posted for it afterwards.
   * A disposed instrument must not come back to life in an offline render.
   */
  forgetChannel(id: number): void {
    const created = this.msgs.findIndex((m) => m.type === 'createChannel' && m.id === id);
    if (created < 0) return;
    const kept: KernelMessage[] = [];
    for (let i = 0; i < this.msgs.length; i++) {
      const m = this.msgs[i];
      if (i >= created && channelOf(m) === id) continue;
      kept.push(m);
    }
    this.msgs = kept;
    this.reindex();
  }

  private reindex(): void {
    this.slots.clear();
    for (let i = 0; i < this.msgs.length; i++) {
      const key = collapseKey(this.msgs[i]);
      if (key !== null && !this.slots.has(key)) this.slots.set(key, i);
    }
  }
}
