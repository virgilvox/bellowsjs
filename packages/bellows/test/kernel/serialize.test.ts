import { describe, it, expect } from 'vitest';
import { serializeDef } from '../../src/core/serialize';

function rehydrate(code: string): Record<string, unknown> {
  return new Function('return (' + code + ')')();
}

describe('serializeDef', () => {
  it('roundtrips method shorthand containing arrow functions in the body', () => {
    const def = {
      id: 'x',
      params: [{ name: 'gain', min: 0, max: 1, default: 0.5 }],
      create(sampleRate: number) {
        const scale = (v: number) => v * 2; // arrow inside a shorthand body
        return { value: scale(sampleRate) };
      },
    };
    const out = rehydrate(serializeDef(def)) as typeof def;
    expect(out.id).toBe('x');
    expect((out.create(10) as { value: number }).value).toBe(20);
  });

  it('roundtrips arrow-valued and function-valued properties', () => {
    const def = {
      id: 'y',
      make: (n: number) => n + 1,
      run: function (n: number) {
        return n * 3;
      },
    };
    const out = rehydrate(serializeDef(def)) as typeof def;
    expect(out.make(1)).toBe(2);
    expect(out.run(2)).toBe(6);
  });

  it('roundtrips async method shorthand', () => {
    const def = {
      id: 'z',
      async load() {
        return 7;
      },
    };
    const out = rehydrate(serializeDef(def)) as typeof def;
    return expect(out.load()).resolves.toBe(7);
  });
});
