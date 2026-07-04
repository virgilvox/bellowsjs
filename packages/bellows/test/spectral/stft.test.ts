import { describe, expect, it } from 'vitest';
import { Stft, Istft, StftProcessor, colaNorm } from '../../src/dsp/stft';
import { hann, blackmanHarris } from '../../src/dsp/fft';
import { sine, rms } from './helpers';

const SR = 44100;

describe('colaNorm', () => {
  it('hann squared at hop N/4 sums to the constant 1.5', () => {
    const w = hann(2048);
    const norm = colaNorm(w, w, 512);
    let lo = Infinity;
    let hi = -Infinity;
    for (let j = 0; j < norm.length; j++) {
      lo = Math.min(lo, norm[j]);
      hi = Math.max(hi, norm[j]);
    }
    expect(lo).toBeCloseTo(1.5, 4);
    expect(hi).toBeCloseTo(1.5, 4);
  });

  it('hann squared at hop N/8 sums to the constant 3', () => {
    const w = hann(1024);
    const norm = colaNorm(w, w, 128);
    for (let j = 0; j < norm.length; j++) {
      expect(norm[j]).toBeCloseTo(3, 4);
    }
  });

  it('stays strictly positive for hann at hop N/2', () => {
    const w = hann(2048);
    const norm = colaNorm(w, w, 1024);
    for (let j = 0; j < norm.length; j++) {
      expect(norm[j]).toBeGreaterThan(0.49);
    }
  });
});

describe('Stft', () => {
  it('emits one frame per hop once the window has filled', () => {
    const stft = new Stft(1024, 256);
    const input = sine(440, SR, 4096);
    let frames = 0;
    stft.onFrame = () => frames++;
    stft.push(input, 0, input.length);
    // First frame after 1024 samples, then every 256.
    expect(frames).toBe(1 + Math.floor((4096 - 1024) / 256));
  });

  it('reports latency of one window and validates arguments', () => {
    const stft = new Stft(1024, 256);
    expect(stft.latency).toBe(1024);
    expect(stft.bins).toBe(513);
    expect(() => new Stft(1000, 250)).toThrow();
    expect(() => new Stft(1024, 0)).toThrow();
    expect(() => new Stft(1024, 2048)).toThrow();
  });

  it('places a sine at the expected bin', () => {
    const n = 2048;
    const hop = 512;
    const freq = 1000;
    const stft = new Stft(n, hop);
    const input = sine(freq, SR, n * 4);
    stft.push(input, 0, input.length);
    let frame = stft.nextFrame();
    // Skip to the last queued frame for a fully filled window.
    let last = frame;
    while (frame) {
      last = frame;
      frame = stft.nextFrame();
    }
    expect(last).not.toBeNull();
    const re = (last as { re: Float32Array }).re;
    const im = (last as { im: Float32Array }).im;
    let best = 0;
    let bestMag = -1;
    for (let k = 1; k < re.length; k++) {
      const m = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
      if (m > bestMag) {
        bestMag = m;
        best = k;
      }
    }
    expect(best).toBe(Math.round((freq * n) / SR));
  });

  it('pull mode and callback mode deliver identical frames', () => {
    const input = sine(330, SR, 3000, 0.7);
    const a = new Stft(1024, 256);
    const b = new Stft(1024, 256);
    const cbFrames: Float32Array[] = [];
    b.onFrame = (re, im) => {
      cbFrames.push(re.slice());
      cbFrames.push(im.slice());
    };
    a.push(input, 0, input.length);
    b.push(input, 0, input.length);
    let i = 0;
    for (;;) {
      const f = a.nextFrame();
      if (!f) break;
      expect(Array.from(f.re)).toEqual(Array.from(cbFrames[i]));
      expect(Array.from(f.im)).toEqual(Array.from(cbFrames[i + 1]));
      i += 2;
      // Frames must be consumed before the next push per the reuse
      // contract; here everything was pushed already so pulling all
      // queued frames back to back is fine.
      a.push(input, 0, 0);
    }
    expect(i).toBe(cbFrames.length);
  });

  it('is deterministic across runs and after reset', () => {
    const input = sine(770, SR, 5000, 0.5);
    const stft = new Stft(512, 128);
    const collect = (): number[] => {
      const out: number[] = [];
      stft.onFrame = (re, im) => {
        out.push(re[3], im[3], re[40], im[40]);
      };
      stft.push(input, 0, input.length);
      return out;
    };
    const first = collect();
    stft.reset();
    const second = collect();
    expect(second).toEqual(first);
  });
});

describe('Stft plus Istft round trip', () => {
  it('reconstructs a sine at unity gain', () => {
    const n = 2048;
    const hop = 512;
    const input = sine(523.25, SR, SR / 2, 0.8);
    const stft = new Stft(n, hop);
    const istft = new Istft(n, hop);
    const out = new Float32Array(input.length + n);
    let at = 0;
    stft.onFrame = (re, im) => {
      istft.pushFrame(re, im, out, at);
      at += hop;
    };
    stft.push(input, 0, input.length);
    // out[t] approximates input[t]; skip the edge ramp regions.
    let worst = 0;
    for (let t = 2 * n; t < input.length - n; t++) {
      worst = Math.max(worst, Math.abs(out[t] - input[t]));
    }
    expect(worst).toBeLessThan(2e-3);
  });
});

describe('StftProcessor', () => {
  it('reconstructs its input delayed by exactly latency samples', () => {
    const n = 2048;
    const hop = 512;
    const proc = new StftProcessor(n, hop);
    expect(proc.latency).toBe(n);
    const input = sine(440, SR, SR, 0.9);
    const buf = input.slice();
    proc.process(buf, 0, buf.length);
    let worst = 0;
    for (let i = 3 * n; i < buf.length; i++) {
      worst = Math.max(worst, Math.abs(buf[i] - input[i - n]));
    }
    expect(worst).toBeLessThan(2e-3);
  });

  it('reconstructs at hop N/2 thanks to exact per-position normalization', () => {
    const n = 1024;
    const proc = new StftProcessor(n, n / 2);
    const input = sine(1234, SR, SR / 2, 0.5);
    const buf = input.slice();
    proc.process(buf, 0, buf.length);
    let worst = 0;
    for (let i = 3 * n; i < buf.length; i++) {
      worst = Math.max(worst, Math.abs(buf[i] - input[i - n]));
    }
    expect(worst).toBeLessThan(2e-3);
  });

  it('reconstructs with a blackman-harris window', () => {
    const n = 2048;
    const proc = new StftProcessor(n, 256, blackmanHarris(n));
    const input = sine(880, SR, SR / 2, 0.5);
    const buf = input.slice();
    proc.process(buf, 0, buf.length);
    let worst = 0;
    for (let i = 3 * n; i < buf.length; i++) {
      worst = Math.max(worst, Math.abs(buf[i] - input[i - n]));
    }
    expect(worst).toBeLessThan(2e-3);
  });

  it('applies the spectral callback', () => {
    const proc = new StftProcessor(1024, 256);
    proc.spectral = (re, im) => {
      for (let k = 0; k < re.length; k++) {
        re[k] = 0;
        im[k] = 0;
      }
    };
    const buf = sine(440, SR, 8192, 0.9);
    proc.process(buf, 0, buf.length);
    expect(rms(buf, 4096, 8192)).toBeLessThan(1e-6);
  });

  it('reset restores the initial state', () => {
    const proc = new StftProcessor(512, 128);
    const input = sine(300, SR, 4096, 0.6);
    const a = input.slice();
    proc.process(a, 0, a.length);
    proc.reset();
    const b = input.slice();
    proc.process(b, 0, b.length);
    expect(Array.from(b)).toEqual(Array.from(a));
  });

  it('block splits do not change the output', () => {
    const input = sine(555, SR, 6000, 0.4);
    const a = input.slice();
    const b = input.slice();
    const pa = new StftProcessor(1024, 256);
    const pb = new StftProcessor(1024, 256);
    pa.process(a, 0, a.length);
    let at = 0;
    const sizes = [1, 7, 128, 500, 33];
    let si = 0;
    while (at < b.length) {
      const step = Math.min(sizes[si++ % sizes.length], b.length - at);
      pb.process(b, at, at + step);
      at += step;
    }
    expect(Array.from(b)).toEqual(Array.from(a));
  });
});
