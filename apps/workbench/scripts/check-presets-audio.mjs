/*
 * Render every INSTRUMENT_PRESETS row through the offline kernel, playing
 * the same part apps/workbench/src/lib/sim/voices.ts `case 'presets'`
 * plays, and measure the result.
 *
 * Run from packages/bellows, the way the parity harnesses run:
 *   npx vite-node <this file>
 *
 * What it measures, per preset:
 *   peak, RMS, RMS per bar, and whether every sample is finite
 *   the fundamental of the first note, from a second render of that note
 *   alone, by the McLeod NSDF, against 220 Hz * 2^octave
 *
 * The part is rebuilt from the constants in voices.ts rather than by
 * importing it, because voices.ts is a Vue app module that imports the
 * built package and takes a live Bellows. The kernel messages here are
 * exactly what b.voice / inst.fx / inst.gain / inst.on / inst.off post,
 * which is the level both the browser and the offline renderer share.
 *
 * WHY IT IS A FILE IN THE REPOSITORY AND NOT A ONE-OFF
 *
 * It was written as a scratch script to check the THE PRESET TABLE entry
 * before that entry was committed, and it stayed in a temp directory while
 * its result went into a commit message. So the evidence for "none of the
 * 50 is silent" was, for a day, a number nobody else could reproduce. That
 * is the same failure as an undocumented figure and it gets the same fix.
 *
 * WHAT IT DOES NOT COVER, so nobody reads more into a green run
 *
 * It renders. It does not play, and nothing here has been heard through a
 * speaker. It exercises the offline kernel rather than the AudioWorklet,
 * and it rebuilds the part rather than calling buildVoice, so the browser
 * wiring (the picker, select(), disposal between presets) is outside it.
 * It says nothing about whether a preset sounds GOOD, only that it sounds
 * at all, at the pitch it was asked for, with the names it claims.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..', '..', '..', 'packages', 'bellows', 'src');

const { registerBuiltins } = await import(SRC + '/register.ts');
const { getEngine, getEffect } = await import(SRC + '/core/registry.ts');
const { renderOffline } = await import(SRC + '/render/offline.ts');
const { INSTRUMENT_PRESETS } = await import(SRC + '/presets/instruments.ts');
const { Scale } = await import(SRC + '/theory/scales.ts');
const { RealFft, hann } = await import(SRC + '/dsp/fft.ts');

registerBuiltins();

/* ---------------- the part, from voices.ts ---------------- */

const REST = -99;
const STEP_SEC = 60 / 96 / 4;
const STEPS = 16;
const BARS = 4;
const LINE = [0, REST, 4, REST, 2, REST, 7, REST, 4, REST, 2, REST, 0, REST, REST, REST];
const TRIAD = [0, 2, 4];
const CHORD_RELEASE = 12;
const ROOT_MIDI = 57;
const ROOT_OCTAVE = 3;
const VOICES = 3;

const midiToHz = (n) => 440 * Math.pow(2, (n - 69) / 12);
const scale = new Scale(ROOT_MIDI, 'minor');

const SR = 44100;
const BARS_RENDERED = Number(process.env.BARS ?? 4);
const TAIL = 1.5;

/** NoteOn=0, NoteOff=1 (EventKind is a const enum, so it is not importable here). */
const ON = 0;
const OFF = 1;

/** The setup messages b.voice + inst.fx + inst.gain + instrumentMaster post. */
function setupFor(pre) {
  const msgs = [
    {
      type: 'createChannel',
      id: 0,
      engineId: pre.engineId,
      params: pre.params,
      seed: 'sim::ch0',
      polyphony: VOICES,
    },
  ];
  if (pre.fx?.length) {
    msgs.push({
      type: 'channelFx',
      id: 0,
      chain: pre.fx.map((f) => ({ effectId: f.effectId, params: f.params ?? {} })),
    });
  }
  msgs.push({ type: 'channelGain', id: 0, gain: pre.gain ?? 0.8 });
  msgs.push({ type: 'masterFx', chain: [{ effectId: 'limiter', params: { ceiling: -1, release: 0.06 } }] });
  return msgs;
}

/** The four-bar part, as kernel events, for one preset. */
function partEvents(pre, bars) {
  const octave = pre.octave ?? 0;
  const hz = (d) => midiToHz(scale.degreeToMidi(d, ROOT_OCTAVE)) * Math.pow(2, octave);
  const ev = [];
  let nextId = 1;
  let held = [];
  for (let i = 0; i < bars * STEPS; i++) {
    const at = i * STEP_SEC;
    const s = i % STEPS;
    const bar = Math.floor(i / STEPS) % BARS;
    if (bar % 2 === 1) {
      if (s === 0) {
        for (const id of held) ev.push({ time: at, kind: OFF, target: 0, a: id, b: 0, c: 0 });
        held = TRIAD.map((d) => {
          const id = nextId++;
          ev.push({ time: at, kind: ON, target: 0, a: id, b: hz(d), c: 0.62 });
          return id;
        });
      } else if (s === CHORD_RELEASE) {
        for (const id of held) ev.push({ time: at, kind: OFF, target: 0, a: id, b: 0, c: 0 });
        held = [];
      }
      continue;
    }
    const d = LINE[s];
    if (d === REST) continue;
    ev.push({ time: at, kind: ON, target: 0, a: nextId++, b: hz(d), c: s % 4 === 0 ? 0.9 : 0.6 });
  }
  return ev;
}

/* ---------------- measurement ---------------- */

function stats(l, r) {
  let peak = 0;
  let sum = 0;
  let bad = 0;
  let firstBad = -1;
  for (let i = 0; i < l.length; i++) {
    const a = l[i];
    const b = r[i];
    if (!Number.isFinite(a) || !Number.isFinite(b)) {
      bad++;
      if (firstBad < 0) firstBad = i;
      continue;
    }
    const m = Math.max(Math.abs(a), Math.abs(b));
    if (m > peak) peak = m;
    sum += a * a + b * b;
  }
  return { peak, rms: Math.sqrt(sum / (2 * l.length)), bad, firstBad };
}

function rmsRange(l, r, from, to) {
  let sum = 0;
  let n = 0;
  for (let i = from; i < to && i < l.length; i++) {
    if (!Number.isFinite(l[i]) || !Number.isFinite(r[i])) continue;
    sum += l[i] * l[i] + r[i] * r[i];
    n += 2;
  }
  return n ? Math.sqrt(sum / n) : 0;
}

/**
 * McLeod pitch method. Returns { hz, clarity }. Searches a wide lag range
 * so an octave error in the ENGINE is visible rather than absorbed: the
 * search covers two octaves either side of what is expected.
 */
function nsdfPitch(x, sr, fMin, fMax) {
  const maxLag = Math.min(Math.floor(sr / fMin), Math.floor(x.length / 2));
  const minLag = Math.max(2, Math.floor(sr / fMax));
  if (maxLag <= minLag + 2) return { hz: 0, clarity: 0 };
  const n = new Float64Array(maxLag + 1);
  for (let tau = minLag; tau <= maxLag; tau++) {
    let ac = 0;
    let e = 0;
    const w = x.length - tau;
    for (let i = 0; i < w; i++) {
      const a = x[i];
      const b = x[i + tau];
      ac += a * b;
      e += a * a + b * b;
    }
    n[tau] = e > 0 ? (2 * ac) / e : 0;
  }
  /* key maxima: the highest point of each stretch above zero */
  const peaks = [];
  let tau = minLag;
  while (tau <= maxLag && n[tau] > 0) tau++; /* skip the lobe at tau -> 0 */
  for (; tau <= maxLag; tau++) {
    if (n[tau] > 0 && n[tau - 1] <= 0) {
      let best = tau;
      let t = tau;
      while (t <= maxLag && n[t] > 0) {
        if (n[t] > n[best]) best = t;
        t++;
      }
      peaks.push(best);
      tau = t;
    }
  }
  if (!peaks.length) return { hz: 0, clarity: 0 };
  let top = 0;
  for (const p of peaks) if (n[p] > top) top = n[p];
  const chosen = peaks.find((p) => n[p] >= 0.9 * top) ?? peaks[0];
  /* parabolic interpolation on the lag axis */
  const y0 = n[chosen - 1] ?? n[chosen];
  const y1 = n[chosen];
  const y2 = n[chosen + 1] ?? n[chosen];
  const denom = y0 - 2 * y1 + y2;
  const shift = denom !== 0 ? (0.5 * (y0 - y2)) / denom : 0;
  return { hz: sr / (chosen + shift), clarity: y1 };
}

/** The loudest 250 ms inside [from, to), where the pitch is worth reading. */
function loudestWindow(x, sr, from, to, lenSec) {
  const win = Math.floor(lenSec * sr);
  const a = Math.floor(from * sr);
  const b = Math.min(Math.floor(to * sr), x.length) - win;
  if (b <= a) return x.subarray(a, Math.min(a + win, x.length));
  let best = a;
  let bestE = -1;
  for (let s = a; s <= b; s += Math.floor(sr * 0.01)) {
    let e = 0;
    for (let i = s; i < s + win; i++) e += x[i] * x[i];
    if (e > bestE) {
      bestE = e;
      best = s;
    }
  }
  return x.subarray(best, best + win);
}

/*
 * Spectral cross check, because NSDF answers a question about the WAVEFORM
 * and the question here is about the ENGINE. A sub oscillator, an
 * inharmonic mode set and a non integer FM ratio all give a true period
 * longer than 1/f0 while the engine is doing exactly what was asked. What
 * separates those from a real octave error is whether energy exists AT the
 * requested frequency, so this reports the magnitude in a narrow band
 * around f0 and around f0/2, both relative to the strongest bin.
 */
const FFT_N = 32768;
const fft = new RealFft(FFT_N);
const fftRe = new Float32Array(FFT_N / 2 + 1);
const fftIm = new Float32Array(FFT_N / 2 + 1);
const fftIn = new Float32Array(FFT_N);
const fftMag = new Float64Array(FFT_N / 2 + 1);

function spectrum(x, sr) {
  fftIn.fill(0);
  const n = Math.min(x.length, FFT_N);
  const w = hann(n);
  for (let i = 0; i < n; i++) fftIn[i] = x[i] * w[i];
  fft.forward(fftIn, fftRe, fftIm);
  let max = 0;
  let maxBin = 0;
  for (let k = 0; k <= FFT_N / 2; k++) {
    const m = Math.hypot(fftRe[k], fftIm[k]);
    fftMag[k] = m;
    if (m > max && k > 2) {
      max = m;
      maxBin = k;
    }
  }
  return { max, peakHz: (maxBin * sr) / FFT_N };
}

/** Strongest bin within tolerance of f, in dB below the strongest bin. */
function bandDb(f, sr, max) {
  if (max <= 0) return -Infinity;
  const binHz = sr / FFT_N;
  const lo = Math.max(1, Math.floor((f * 0.98) / binHz) - 2);
  const hi = Math.min(FFT_N / 2, Math.ceil((f * 1.02) / binHz) + 2);
  let m = 0;
  for (let k = lo; k <= hi; k++) if (fftMag[k] > m) m = fftMag[k];
  return 20 * Math.log10(Math.max(m, 1e-12) / max);
}

/** The n strongest spectral peaks, as [hz, dB below the strongest]. */
function topPeaks(sr, max, n) {
  const out = [];
  for (let k = 3; k < FFT_N / 2 - 1; k++) {
    if (fftMag[k] > fftMag[k - 1] && fftMag[k] >= fftMag[k + 1]) {
      out.push([(k * sr) / FFT_N, 20 * Math.log10(Math.max(fftMag[k], 1e-12) / max)]);
    }
  }
  out.sort((a, b) => b[1] - a[1]);
  return out.slice(0, n);
}

/* ---------------- param-name sanity, which is the silent failure ------- */

function unknownParams(pre) {
  const out = [];
  let engine;
  try {
    engine = getEngine(pre.engineId);
  } catch (e) {
    return ['engine ' + pre.engineId + ' is not registered'];
  }
  const known = new Set(engine.params.map((p) => p.name));
  for (const k of Object.keys(pre.params)) if (!known.has(k)) out.push('param ' + k);
  for (const f of pre.fx ?? []) {
    let def;
    try {
      def = getEffect(f.effectId);
    } catch {
      out.push('effect ' + f.effectId + ' is not registered');
      continue;
    }
    const fk = new Set(def.params.map((p) => p.name));
    for (const k of Object.keys(f.params ?? {})) if (!fk.has(k)) out.push(f.effectId + '.' + k);
  }
  return out;
}

/* ---------------- run ---------------- */

const rows = [];
const t0 = Date.now();

for (const pre of INSTRUMENT_PRESETS) {
  const octave = pre.octave ?? 0;
  const expected = 220 * Math.pow(2, octave);

  /* 1. the part */
  const seconds = BARS_RENDERED * STEPS * STEP_SEC + TAIL;
  const setup = setupFor(pre);
  const part = renderOffline([...setup, { type: 'events', events: partEvents(pre, BARS_RENDERED) }], {
    seconds,
    sampleRate: SR,
  });
  const st = stats(part.left, part.right);
  const barFrames = Math.floor(STEPS * STEP_SEC * SR);
  const bars = [];
  for (let b = 0; b < BARS_RENDERED; b++) {
    bars.push(rmsRange(part.left, part.right, b * barFrames, (b + 1) * barFrames));
  }

  /* 2. the first note alone, for pitch. Same channel, same fx, same gain,
   * same event as step 0 of bar 0, held for the whole render. */
  const solo = renderOffline(
    [
      ...setup,
      {
        type: 'events',
        events: [{ time: 0.0, kind: ON, target: 0, a: 1, b: expected, c: 0.9 }],
      },
    ],
    { seconds: 2.0, sampleRate: SR },
  );
  const mono = new Float32Array(solo.left.length);
  let soloFinite = true;
  for (let i = 0; i < mono.length; i++) {
    const v = 0.5 * (solo.left[i] + solo.right[i]);
    if (!Number.isFinite(v)) {
      soloFinite = false;
      mono[i] = 0;
    } else mono[i] = v;
  }
  const soloStats = stats(solo.left, solo.right);
  const win = loudestWindow(mono, SR, 0.005, 1.6, 0.25);
  /* two octaves either side of what is expected, so an octave error shows */
  const p = nsdfPitch(win, SR, Math.max(25, expected / 4), Math.min(SR / 4, expected * 4));
  const cents = p.hz > 0 ? 1200 * Math.log2(p.hz / expected) : NaN;

  const sp = spectrum(win, SR);
  const dbAtF0 = bandDb(expected, SR, sp.max);
  const dbAtHalf = bandDb(expected / 2, SR, sp.max);
  const dbAtDouble = bandDb(expected * 2, SR, sp.max);
  const peaks = topPeaks(SR, sp.max, 5);

  /*
   * 3. the fx insert, proved rather than assumed. Same render with the
   * channelFx message dropped: if the two are sample identical the insert
   * did nothing, which for a chorus, a plate, a tremolo or a delay means
   * it was not applied.
   */
  let fxDelta = null;
  if (pre.fx?.length) {
    const dry = renderOffline(
      [...setup.filter((m) => m.type !== 'channelFx'),
       { type: 'events', events: [{ time: 0.0, kind: ON, target: 0, a: 1, b: expected, c: 0.9 }] }],
      { seconds: 2.0, sampleRate: SR },
    );
    let d = 0;
    for (let i = 0; i < dry.left.length; i++) {
      d = Math.max(d, Math.abs(dry.left[i] - solo.left[i]), Math.abs(dry.right[i] - solo.right[i]));
    }
    fxDelta = d;
  }

  /* 4. the root the scale path actually produces, against 220 * 2^octave */
  const scaleHz = midiToHz(scale.degreeToMidi(0, ROOT_OCTAVE)) * Math.pow(2, octave);

  rows.push({
    fxDelta,
    scaleHz,
    id: pre.id,
    engine: pre.engineId,
    octave,
    expected,
    peak: st.peak,
    rms: st.rms,
    bars,
    bad: st.bad,
    firstBad: st.firstBad,
    soloRms: soloStats.rms,
    soloPeak: soloStats.peak,
    soloFinite: soloFinite && soloStats.bad === 0,
    hz: p.hz,
    clarity: p.clarity,
    cents,
    peakHz: sp.peakHz,
    dbAtF0,
    dbAtHalf,
    dbAtDouble,
    peaks,
    fx: (pre.fx ?? []).map((f) => f.effectId).join('+') || '-',
    unknown: unknownParams(pre),
  });
  process.stderr.write('.');
}
process.stderr.write('\n');

/* ---------------- report ---------------- */

const f = (v, d = 4) => (Number.isFinite(v) ? v.toFixed(d) : String(v));
console.log(
  `${BARS_RENDERED} bars at 96 bpm, ${SR} Hz, A natural minor from MIDI 57, ` +
    `polyphony ${VOICES}, master limiter at -1 dB`,
);
console.log(`rendered in ${((Date.now() - t0) / 1000).toFixed(1)} s\n`);
console.log(
  'preset'.padEnd(18) +
    'engine'.padEnd(10) +
    'oct'.padStart(4) +
    'peak'.padStart(9) +
    'rms'.padStart(9) +
    'bar0'.padStart(9) +
    'bar1'.padStart(9) +
    'want'.padStart(9) +
    'got'.padStart(9) +
    'cents'.padStart(8) +
    'clar'.padStart(6) +
    'dB@f0'.padStart(8) +
    'dB@f0/2'.padStart(9) +
    '  fx',
);
for (const r of rows) {
  console.log(
    r.id.padEnd(18) +
      r.engine.padEnd(10) +
      String(r.octave).padStart(4) +
      f(r.peak).padStart(9) +
      f(r.rms, 5).padStart(9) +
      f(r.bars[0] ?? 0, 5).padStart(9) +
      f(r.bars[1] ?? 0, 5).padStart(9) +
      r.expected.toFixed(1).padStart(9) +
      (r.hz > 0 ? r.hz.toFixed(1) : '-').padStart(9) +
      (Number.isFinite(r.cents) ? r.cents.toFixed(0) : '-').padStart(8) +
      f(r.clarity, 2).padStart(6) +
      r.dbAtF0.toFixed(1).padStart(8) +
      r.dbAtHalf.toFixed(1).padStart(9) +
      '  ' +
      r.fx +
      (r.unknown.length ? '  UNKNOWN: ' + r.unknown.join(', ') : ''),
  );
}

const NEAR_SILENT = 2e-3;
const silent = rows.filter((r) => r.rms < NEAR_SILENT);
/* A bar that goes quiet catches a voice pool that stops answering after
 * the steals, which whole-render RMS would hide. */
const quietBar = rows.filter((r) => Math.min(...r.bars) < NEAR_SILENT);
const nonFinite = rows.filter((r) => r.bad > 0 || !r.soloFinite);
/* 3 percent is about 51 cents */
const periodOff = rows.filter((r) => r.clarity >= 0.5 && Math.abs(r.cents) > 51.2);
/*
 * A real pitch failure: the period is wrong AND there is no energy at the
 * frequency that was asked for. -24 dB below the strongest bin is generous,
 * a filtered saw's fundamental sits above that everywhere here.
 */
const offPitch = periodOff.filter((r) => r.dbAtF0 < -24);
const explained = periodOff.filter((r) => r.dbAtF0 >= -24);
const unclear = rows.filter((r) => r.clarity < 0.5);
const unknown = rows.filter((r) => r.unknown.length);
const hot = rows.filter((r) => r.peak > 0.9);

const section = (name, list, fmt) => {
  console.log(`\n${name}: ${list.length}`);
  for (const r of list) console.log('  ' + fmt(r));
};
section('silent or near silent (part rms < 2e-3)', silent, (r) =>
  `${r.id} rms ${r.rms.toExponential(2)} peak ${r.peak.toExponential(2)} solo rms ${r.soloRms.toExponential(2)}`);
section('any single bar below 2e-3 rms', quietBar, (r) =>
  `${r.id} bars ${r.bars.map((b) => b.toExponential(2)).join(' ')}`);
section('non finite samples', nonFinite, (r) =>
  `${r.id} ${r.bad} bad samples, first at ${r.firstBad}`);
section('PITCH FAILURE: wrong period and no energy at the requested f0', offPitch, (r) =>
  `${r.id} want ${r.expected.toFixed(1)} got ${r.hz.toFixed(1)} (${r.cents.toFixed(0)} cents), ` +
  `f0 band ${r.dbAtF0.toFixed(1)} dB, f0/2 band ${r.dbAtHalf.toFixed(1)} dB, ` +
  `peaks ${r.peaks.map(([h, d]) => h.toFixed(0) + '@' + d.toFixed(0)).join(' ')}`);
section('longer period than 1/f0, but f0 is present (sub osc, inharmonic modes, FM ratio)', explained, (r) =>
  `${r.id} period reads ${r.hz.toFixed(1)} vs ${r.expected.toFixed(1)}, ` +
  `f0 band ${r.dbAtF0.toFixed(1)} dB below peak, peaks ` +
  r.peaks.map(([h, d]) => h.toFixed(0) + '@' + d.toFixed(0)).join(' '));
section('pitch not measurable (clarity < 0.5), reported not judged', unclear, (r) =>
  `${r.id} got ${r.hz > 0 ? r.hz.toFixed(1) : '-'} vs ${r.expected.toFixed(1)}, clarity ${r.clarity.toFixed(2)}, f0 band ${r.dbAtF0.toFixed(1)} dB`);
section('param or effect names the registry does not know', unknown, (r) =>
  `${r.id}: ${r.unknown.join(', ')}`);
section('peak above 0.9 after the -1 dB limiter', hot, (r) =>
  `${r.id} peak ${r.peak.toFixed(4)}`);

const withFx = rows.filter((r) => r.fxDelta !== null);
section('insert fx: max sample difference against the same render with no insert', withFx, (r) =>
  `${r.id} ${r.fx} delta ${r.fxDelta.toExponential(2)}${r.fxDelta < 1e-6 ? '   INSERT DID NOTHING' : ''}`);
const fxDead = withFx.filter((r) => r.fxDelta < 1e-6);

const rootBad = rows.filter((r) => Math.abs(r.scaleHz - r.expected) > 1e-6);
section('scale path root against 220 * 2^octave', rootBad, (r) =>
  `${r.id} scale gives ${r.scaleHz} want ${r.expected}`);

console.log(
  `\n${rows.length} presets. silent ${silent.length}, non finite ${nonFinite.length}, ` +
    `off pitch ${offPitch.length}, unclear ${unclear.length}, unknown names ${unknown.length}, ` +
    `dead inserts ${fxDead.length}, root mismatches ${rootBad.length}`,
);

/*
 * The gate. Everything above is a report, and a report that always exits 0
 * is a thing nobody notices going wrong, which is the whole subject of the
 * document this file was written alongside.
 *
 * `unclear` is deliberately NOT fatal. One preset, muted-electric, is damped
 * hard enough that the autocorrelation abstains at clarity 0.45 while its
 * strongest spectral bin still sits at the requested 220 Hz. Failing on
 * "could not measure" would be failing on the measurement rather than on the
 * sound, so it is printed and counted and left alone.
 */
const fatal =
  silent.length +
  quietBar.length +
  nonFinite.length +
  offPitch.length +
  unknown.length +
  fxDead.length +
  rootBad.length;

if (fatal > 0) {
  console.log(`\n${fatal} preset(s) failed. See the sections above.`);
  process.exit(1);
}
console.log(`ok       ${rows.length} presets all sound, at pitch, with names the registry knows`);
