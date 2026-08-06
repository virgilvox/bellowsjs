/*
 * Minimal AudioContext surface. Bellows.boot reaches for browser globals, so
 * facade tests install these; the offline render underneath is the real path,
 * so any audio a test compares is real audio. Same shape as the fake in
 * test/kernel/lifecycle.test.ts, factored out here because two integration
 * files need it. Not named *.test.ts, so vitest does not collect it.
 */

class FakeParam {
  value = 0;
}

class FakeNode {
  connect(): void {}
  disconnect(): void {}
}

class FakePort {
  onmessage: ((e: MessageEvent) => void) | null = null;
  readonly posted: unknown[] = [];
  postMessage(msg: unknown): void {
    this.posted.push(msg);
  }
}

export class FakeWorkletNode extends FakeNode {
  port = new FakePort();
  parameters = new Map<string, FakeParam>();
  constructor(_ctx: unknown, _name: string, _opts?: unknown) {
    super();
  }
}

class FakeAnalyser extends FakeNode {
  fftSize = 2048;
  smoothingTimeConstant = 0.8;
}

export class FakeAudioContext {
  state = 'running';
  currentTime = 0;
  closed = false;
  destination = new FakeNode();
  audioWorklet = { addModule: async (_url: string): Promise<void> => {} };
  createAnalyser(): FakeAnalyser {
    return new FakeAnalyser();
  }
  async resume(): Promise<void> {}
  async close(): Promise<void> {
    this.closed = true;
  }
}

/** Install the globals Bellows.boot needs. `ctor` overrides the context class. */
export function installFakeAudio(ctor: unknown = FakeAudioContext): void {
  const g = globalThis as Record<string, unknown>;
  g.AudioWorkletNode = FakeWorkletNode;
  g.AudioContext = ctor;
}
