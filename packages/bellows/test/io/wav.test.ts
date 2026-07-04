import { describe, expect, it } from 'vitest';
import { decodeWav, encodeWav } from '../../src/io/wav';
import { rng } from '../../src/core/prng';

function testSignal(frames: number, label: string): Float32Array {
  const r = rng(label);
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    out[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / 44100) + 0.3 * (r() * 2 - 1);
  }
  return out;
}

function ascii(v: DataView, off: number, len: number): string {
  let s = '';
  for (let i = 0; i < len; i++) s += String.fromCharCode(v.getUint8(off + i));
  return s;
}

describe('encodeWav', () => {
  it('writes correct RIFF header fields for 16-bit stereo', () => {
    const l = testSignal(100, 'wav-l');
    const r = testSignal(100, 'wav-r');
    const buf = encodeWav([l, r], 44100);
    const v = new DataView(buf);

    expect(ascii(v, 0, 4)).toBe('RIFF');
    expect(v.getUint32(4, true)).toBe(buf.byteLength - 8);
    expect(ascii(v, 8, 4)).toBe('WAVE');
    expect(ascii(v, 12, 4)).toBe('fmt ');
    expect(v.getUint32(16, true)).toBe(16);
    expect(v.getUint16(20, true)).toBe(1); // PCM
    expect(v.getUint16(22, true)).toBe(2); // channels
    expect(v.getUint32(24, true)).toBe(44100);
    expect(v.getUint32(28, true)).toBe(44100 * 4); // byte rate
    expect(v.getUint16(32, true)).toBe(4); // block align
    expect(v.getUint16(34, true)).toBe(16);
    expect(ascii(v, 36, 4)).toBe('data');
    expect(v.getUint32(40, true)).toBe(100 * 4);
    expect(buf.byteLength).toBe(44 + 400);
  });

  it('writes IEEE float format code and a fact chunk at 32 bits', () => {
    const buf = encodeWav([testSignal(10, 'wav-f')], 48000, { bitDepth: 32 });
    const v = new DataView(buf);
    expect(v.getUint32(16, true)).toBe(18); // extended fmt
    expect(v.getUint16(20, true)).toBe(3); // IEEE float
    expect(ascii(v, 38, 4)).toBe('fact');
    expect(v.getUint32(46, true)).toBe(10); // frame count
    expect(ascii(v, 50, 4)).toBe('data');
  });

  it('pads an odd-sized data chunk to even length', () => {
    // 24-bit mono, 3 frames: 9 data bytes, odd.
    const buf = encodeWav([new Float32Array(3)], 44100, { bitDepth: 24 });
    const v = new DataView(buf);
    expect(v.getUint32(40, true)).toBe(9);
    expect(buf.byteLength).toBe(44 + 10);
    expect(v.getUint32(4, true)).toBe(buf.byteLength - 8);
  });

  it('rejects empty input, mismatched lengths, and bad depths', () => {
    expect(() => encodeWav([], 44100)).toThrow();
    expect(() => encodeWav([new Float32Array(3), new Float32Array(4)], 44100)).toThrow();
    expect(() =>
      encodeWav([new Float32Array(4)], 44100, { bitDepth: 8 as unknown as 16 }),
    ).toThrow();
    expect(() => encodeWav([new Float32Array(4)], 0)).toThrow();
  });
});

describe('roundtrip', () => {
  const cases: { bitDepth: 16 | 24 | 32; tol: number }[] = [
    { bitDepth: 16, tol: 1 / 32767 + 1e-7 },
    { bitDepth: 24, tol: 1 / 8388607 + 1e-9 },
    { bitDepth: 32, tol: 0 },
  ];

  for (const { bitDepth, tol } of cases) {
    it(`survives at ${bitDepth} bits within ${tol}`, () => {
      const l = testSignal(512, 'rt-l');
      const r = testSignal(512, 'rt-r');
      const decoded = decodeWav(encodeWav([l, r], 44100, { bitDepth }));
      expect(decoded.sampleRate).toBe(44100);
      expect(decoded.channels).toHaveLength(2);
      expect(decoded.channels[0]).toHaveLength(512);
      for (let i = 0; i < 512; i++) {
        expect(Math.abs(decoded.channels[0][i] - l[i])).toBeLessThanOrEqual(tol);
        expect(Math.abs(decoded.channels[1][i] - r[i])).toBeLessThanOrEqual(tol);
      }
    });
  }

  it('keeps channels un-swapped through interleaving', () => {
    const l = new Float32Array([0.25, 0.25]);
    const r = new Float32Array([-0.75, -0.75]);
    const decoded = decodeWav(encodeWav([l, r], 22050, { bitDepth: 24 }));
    expect(decoded.channels[0][0]).toBeCloseTo(0.25, 5);
    expect(decoded.channels[1][0]).toBeCloseTo(-0.75, 5);
  });

  it('clamps out-of-range samples on integer paths', () => {
    const decoded = decodeWav(encodeWav([new Float32Array([1.5, -1.5])], 44100, { bitDepth: 16 }));
    expect(decoded.channels[0][0]).toBeCloseTo(1, 3);
    expect(decoded.channels[0][1]).toBeCloseTo(-1, 3);
  });

  it('preserves out-of-range samples on the float path', () => {
    const decoded = decodeWav(encodeWav([new Float32Array([1.5, -2.5])], 44100, { bitDepth: 32 }));
    expect(decoded.channels[0][0]).toBe(1.5);
    expect(decoded.channels[0][1]).toBe(-2.5);
  });
});

/* Hand-built fixtures exercise the decoder against bytes this codec
 * did not produce. */

function fixture(parts: (string | number[])[]): ArrayBuffer {
  const bytes: number[] = [];
  for (const p of parts) {
    if (typeof p === 'string') for (let i = 0; i < p.length; i++) bytes.push(p.charCodeAt(i));
    else bytes.push(...p);
  }
  return new Uint8Array(bytes).buffer;
}

function u16(v: number): number[] {
  return [v & 0xff, (v >> 8) & 0xff];
}

function u32(v: number): number[] {
  return [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff];
}

describe('decodeWav fixtures', () => {
  it('decodes a minimal 16-bit mono file with an unknown odd-sized chunk', () => {
    const buf = fixture([
      'RIFF',
      u32(4 + 8 + 16 + 8 + 3 + 1 + 8 + 6),
      'WAVE',
      'fmt ',
      u32(16),
      u16(1), // PCM
      u16(1), // mono
      u32(8000),
      u32(16000),
      u16(2),
      u16(16),
      'junk',
      u32(3),
      [1, 2, 3, 0], // odd chunk plus pad byte
      'data',
      u32(6),
      u16(0x4000), // 0.5
      u16(0xc000), // -0.5
      u16(0x0000),
    ]);
    const decoded = decodeWav(buf);
    expect(decoded.sampleRate).toBe(8000);
    expect(decoded.channels).toHaveLength(1);
    expect(decoded.channels[0][0]).toBeCloseTo(0.5, 6);
    expect(decoded.channels[0][1]).toBeCloseTo(-0.5, 6);
    expect(decoded.channels[0][2]).toBe(0);
  });

  it('decodes unsigned 8-bit PCM', () => {
    const buf = fixture([
      'RIFF',
      u32(4 + 8 + 16 + 8 + 3),
      'WAVE',
      'fmt ',
      u32(16),
      u16(1),
      u16(1),
      u32(8000),
      u32(8000),
      u16(1),
      u16(8),
      'data',
      u32(3),
      [0, 128, 255],
    ]);
    const decoded = decodeWav(buf);
    expect(decoded.channels[0][0]).toBe(-1);
    expect(decoded.channels[0][1]).toBe(0);
    expect(decoded.channels[0][2]).toBeCloseTo(127 / 128, 6);
  });

  it('decodes 32-bit integer PCM', () => {
    const buf = fixture([
      'RIFF',
      u32(4 + 8 + 16 + 8 + 8),
      'WAVE',
      'fmt ',
      u32(16),
      u16(1),
      u16(1),
      u32(44100),
      u32(44100 * 4),
      u16(4),
      u16(32),
      'data',
      u32(8),
      u32(0x40000000), // 0.5
      u32(0x80000000), // -1
    ]);
    const decoded = decodeWav(buf);
    expect(decoded.channels[0][0]).toBeCloseTo(0.5, 7);
    expect(decoded.channels[0][1]).toBe(-1);
  });

  it('decodes float32 written with a plain 16-byte fmt chunk', () => {
    const buf = fixture([
      'RIFF',
      u32(4 + 8 + 16 + 8 + 8),
      'WAVE',
      'fmt ',
      u32(16),
      u16(3), // IEEE float
      u16(1),
      u32(48000),
      u32(48000 * 4),
      u16(4),
      u16(32),
      'data',
      u32(8),
      u32(0x3f000000), // 0.5f
      u32(0xbf800000), // -1.0f
    ]);
    const decoded = decodeWav(buf);
    expect(decoded.channels[0][0]).toBe(0.5);
    expect(decoded.channels[0][1]).toBe(-1);
  });

  it('reads the subformat of a WAVE_FORMAT_EXTENSIBLE file', () => {
    const buf = fixture([
      'RIFF',
      u32(4 + 8 + 40 + 8 + 2),
      'WAVE',
      'fmt ',
      u32(40),
      u16(0xfffe),
      u16(1),
      u32(44100),
      u32(88200),
      u16(2),
      u16(16),
      u16(22), // cbSize
      u16(16), // valid bits
      u32(4), // channel mask
      u16(1), // subformat: PCM
      [0, 0, 0, 0, 0x10, 0, 0x80, 0, 0, 0xaa, 0, 0x38, 0x9b, 0x71], // GUID remainder
      'data',
      u32(2),
      u16(0x4000),
    ]);
    const decoded = decodeWav(buf);
    expect(decoded.channels[0][0]).toBeCloseTo(0.5, 6);
  });

  it('throws on malformed input', () => {
    expect(() => decodeWav(new ArrayBuffer(0))).toThrow();
    expect(() => decodeWav(new ArrayBuffer(4))).toThrow();
    expect(() => decodeWav(fixture(['RIFX', u32(4), 'WAVE']))).toThrow(/RIFF/);
    // fmt but no data
    expect(() =>
      decodeWav(
        fixture([
          'RIFF',
          u32(4 + 8 + 16),
          'WAVE',
          'fmt ',
          u32(16),
          u16(1),
          u16(1),
          u32(8000),
          u32(16000),
          u16(2),
          u16(16),
        ]),
      ),
    ).toThrow(/data/);
    // data but no fmt
    expect(() =>
      decodeWav(fixture(['RIFF', u32(4 + 8 + 2), 'WAVE', 'data', u32(2), u16(0)])),
    ).toThrow(/fmt/);
    // unsupported format code
    expect(() =>
      decodeWav(
        fixture([
          'RIFF',
          u32(4 + 8 + 16 + 8),
          'WAVE',
          'fmt ',
          u32(16),
          u16(7), // mu-law
          u16(1),
          u32(8000),
          u32(8000),
          u16(1),
          u16(8),
          'data',
          u32(0),
        ]),
      ),
    ).toThrow(/format/);
  });

  it('tolerates a data size field that overruns the buffer', () => {
    const buf = fixture([
      'RIFF',
      u32(9999),
      'WAVE',
      'fmt ',
      u32(16),
      u16(1),
      u16(1),
      u32(8000),
      u32(16000),
      u16(2),
      u16(16),
      'data',
      u32(9999), // lies: only 4 bytes follow
      u16(0x4000),
      u16(0xc000),
    ]);
    const decoded = decodeWav(buf);
    expect(decoded.channels[0]).toHaveLength(2);
    expect(decoded.channels[0][0]).toBeCloseTo(0.5, 6);
  });
});
