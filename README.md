# bellowsjs

A browser-native audio engine for synthesis, samples, sequencing, analysis, and I/O. One clock, one DSP kernel in an AudioWorklet, and a layered API that goes from one line of code down to raw sample-loop DSP. Every random decision is seeded and reproducible: same seed, same piece, forever.

The name: a bellows is the air mover of the forge. Every forge needs one.

```js
import { play } from 'bellowsjs';
play('pluck', 'C4');
```

## Why

The Web Audio API is a good set of parts and a bad instrument. A browser music project of any ambition ends up stitching together five or six packages that do not share a clock, a random source, or an AudioContext. BELLOWS collapses that stack into one engine designed from the kernel up:

- Timing lives on the audio thread. Musical logic compiles to timestamped events; the kernel splits its render blocks at event boundaries, so notes land sample-accurately no matter how busy the main thread is.
- No garbage at note rate. Voices are pooled and reused inside the kernel. Steady-state playback allocates nothing on the audio path.
- Offline is realtime. The same kernel renders live through the worklet and offline through a plain loop, driven by the same message stream. Renders are deterministic enough to diff against golden references in CI, on Node, with no browser.
- Musical types are first class. Notes, degrees, chords, scales, tunings, bars, and swing are library types with exact semantics, including under tempo curves (beat-to-seconds over a bpm ramp is a closed-form integral, not an approximation).
- 12-EDO is a default, never an assumption. Pitch flows through a tuning layer: any EDO, just intonation ratios, cents tables, Scala .scl/.kbm import.
- Seeded everywhere. Every stochastic choice flows from named, forkable PRNG streams. Nothing in the library calls Math.random.

## Install

```
npm install bellowsjs
```

Or from a CDN in a plain HTML page, no build step:

```html
<script type="module">
  import { play } from 'https://unpkg.com/bellowsjs/dist/bellows.js';
  document.querySelector('#go').onclick = () => play('kick', 'C2');
</script>
```

The AudioWorklet kernel ships inlined and loads through a blob URL, so there is no second file to deploy. Hosts whose CSP blocks blob: scripts can point the loader at the packaged `bellowsjs/worklet.js` instead.

## Three tiers

Tier 1, immediate:

```js
import { play, instrument } from 'bellowsjs';

play('pluck', 'C4');

const piano = await instrument('sf2:./fonts/gm.sf2#0:0');
piano.note('E3', { dur: '8n', vel: 0.7 });
```

Tier 2, the workbench:

```js
import { Bellows } from 'bellowsjs';

const b = await Bellows.boot({ seed: 'forge-01' });

const lead = b.voice('fm', { algorithm: 3, feedback: 0.4 });
const bass = b.voice('va', { shape: 1, cutoff: 400, resonance: 0.5 });

const verb = b.bus(['fdn'], { level: 0.4 });
lead.fx('tapeDelay').send(verb, 0.5);

const scale = b.scale('D dorian');
const rhythm = b.euclid(16, 7, 2);
const melody = b.rng('melody');

b.clock.at('16n', (t, step) => {
  if (rhythm[step % 16]) {
    lead.note(scale.degreeToMidi(melody.int(7), 4), { at: t, dur: '16n' });
  }
  if (step % 4 === 0) {
    bass.note(scale.degreeToMidi(0, 2), { at: t, dur: '8n' });
  }
});

b.rampBpm(96, '8m');
b.start();
```

Tier 3, the kernel. Custom engines and effects implement small contracts and become addressable by id like the built-ins, in realtime and offline both:

```js
b.defEffect({
  id: 'crush',
  label: 'bitcrusher',
  params: [{ name: 'bits', min: 1, max: 16, default: 8 }],
  create(sampleRate, params) {
    let bits = params.bits ?? 8;
    return {
      process(l, r, from, to) {
        const q = Math.pow(2, bits - 1);
        for (let i = from; i < to; i++) {
          l[i] = Math.round(l[i] * q) / q;
          r[i] = Math.round(r[i] * q) / q;
        }
      },
      setParam(name, value) { if (name === 'bits') bits = value; },
      reset() {},
    };
  },
});
```

Offline is the same graph:

```js
const audio = await b.render({ bars: 16 });
const wav = audio.wav(24); // ArrayBuffer, ready to download
```

## What ships

Synthesis: virtual analog (tabulated-BLEP oscillators measuring around -90 dB worst alias, ladder and SVF filters, per-voice drift), FM (2/4/6 operators, DX-style algorithm routing), additive, wavetable (mipmapped, position scan), granular (64-grain clouds), extended Karplus-Strong, waveguide string and tube, modal banks (bar, membrane, bell, glass, wood), west coast (wavefolder into a vactrol low-pass gate), formant vocal synthesis, five drum engines, noise synth, and a DDSP-style harmonic-plus-noise engine with a frame-driven control input.

Samples: a sampler engine with velocity layers, crossfades, round robins, and loop-seam crossfading; an SF2 parser implementing the generator resolution model of the spec; an SFZ parser covering the opcodes the popular free libraries actually use, with #include and #define.

Theory and tuning: thirty plus scales, chord parsing and detection, roman numerals in both directions, nearest-motion voice leading, negative harmony, seeded functional-harmony progressions; tunings as objects (EDO, just intonation, cents, Scala import).

Sequencing: a transport with exact tempo-curve integration, meter changes, and swing; Euclidean patterns (true Bjorklund), Markov chains of any order with chord-tone gravity, L-systems, elementary cellular automata, arpeggiators, and a small step-indexed pattern combinator layer.

Effects: clean/tape/multitap delays, an 8-line FDN reverb (Householder feedback, modulated coprime lines), the Dattorro plate with the 1997 constants, compressor with lookahead and program-dependent release, true-peak limiter, gate, transient shaper, 6-band parametric EQ, saturator with 4x oversampling, chorus, flanger, phaser, tremolo, autopan, ring mod, Hilbert-pair frequency shifter, and a spectral suite (phase-vocoder pitch shift with identity phase locking, freeze, blur, robot, whisper, denoise, offline time stretch).

Analysis: YIN and MPM pitch detection, spectral-flux onset detection, tempo estimation, chroma and key estimation, spectral descriptors, MFCC, and an EBU R128 loudness meter (momentary, short-term, gated integrated, LRA, 4x oversampled true peak) with K-weighting derived per sample rate.

I/O: WAV encode/decode at 8/16/24/32 bits, standard MIDI file read/write, Web MIDI with MPE zones where the platform has it, WebCodecs Opus export where available, WAV everywhere.

## Determinism and testing

The DSP core has zero browser dependencies, which is why the library carries more than a thousand behavioral tests that run in plain Node: filters are tested by measured frequency response, oscillators by measured alias suppression, reverbs by decay time, the loudness meter against the BS.1770 reference points, and whole pieces by golden-render comparison. `renderOffline` produces the same output on every run of the same seed.

## Browser support

AudioWorklet is required (Chrome 66+, Firefox 76+, Safari 14.1+). Web MIDI is Chromium and Firefox only. WebCodecs Opus export is feature-detected with WAV as the universal fallback. See `docs/ENGINEERING.md` in the repository for the full capability matrix.

## Repository layout

- packages/bellows is the library published to npm as bellowsjs
- apps/workbench is the Vue demo app: generative bench plus code mode
- docs/ holds the PRD, the engineering brief, and prototype 0

## Development

```
git clone https://github.com/virgilvox/bellowsjs
cd bellowsjs
npm install
npm test              # library test suite
npm run dev           # the workbench app (Vue), live against library source
npm run build         # library build including the worklet bundle
```

The workbench app doubles as the documentation: a generative bench showing every engine swappable mid-piece, and a code mode with about thirty runnable, editable examples covering the entire API.

## License

Apache-2.0. See LICENSE.
