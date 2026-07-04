<script setup lang="ts">
import { ref } from 'vue';

const emit = defineEmits<{ (e: 'go', mode: 'bench' | 'code'): void }>();

const copied = ref(false);

async function copyInstall() {
  try {
    await navigator.clipboard.writeText('npm install bellowsjs');
    copied.value = true;
    setTimeout(() => (copied.value = false), 1600);
  } catch {
    // clipboard may be unavailable; the text is right there anyway
  }
}

const FEATURES = [
  {
    num: '01',
    title: 'One clock, one kernel',
    body: 'A single AudioWorklet hosts every voice and effect. Events queue sample-accurately on the audio thread, so a busy tab never smears your timing.',
  },
  {
    num: '02',
    title: '18 synthesis engines',
    body: 'Virtual analog, FM, additive, wavetable, granular, Karplus-Strong, waveguides, modal banks, west coast, formant, drums, noise, harmonic-plus-noise. Swap engines mid-piece with one line.',
  },
  {
    num: '03',
    title: 'Seeded everywhere',
    body: 'Every random decision flows from named, forkable PRNG streams. Same seed, same piece, forever. Nothing in the library calls Math.random.',
  },
  {
    num: '04',
    title: 'Offline is realtime',
    body: 'The same kernel renders live through the worklet and offline through a plain loop, driven by the same message stream. Render a piece 20x faster than realtime while it plays.',
  },
  {
    num: '05',
    title: 'Theory with any tuning',
    body: 'Thirty plus scales, roman numerals, voice leading, negative harmony. Pitch flows through a tuning layer: any EDO, just intonation, Scala files. 12-EDO is a default, never an assumption.',
  },
  {
    num: '06',
    title: 'Generative to the core',
    body: 'Euclidean rhythms, Markov chains with chord gravity, L-systems, cellular automata, arpeggiators, exact tempo curves, swing. Plus pitch tracking, onset detection, key estimation, and EBU R128 metering to hear what you made.',
  },
];

const CODE_SAMPLE = `import { Bellows } from 'bellowsjs';

const b = await Bellows.boot({ seed: 'forge-01' });

const lead = b.voice('fm', { algorithm: 3, feedback: 0.4 });
const verb = b.bus(['fdn'], { level: 0.4 });
lead.fx('tapeDelay').send(verb, 0.5);

const scale = b.scale('D dorian');
const rhythm = b.euclid(16, 7, 2);

b.clock.at('16n', (t, step) => {
  if (rhythm[step % 16]) {
    lead.note(scale.degreeToMidi(b.rng('mel').int(7), 4), { at: t, dur: '16n' });
  }
});

b.start();

// the same piece, rendered offline, identical output
const wav = (await b.render({ bars: 8 })).wav(24);`;
</script>

<template>
  <div class="landing">
    <section class="hero panel">
      <div class="hero-main">
        <div class="wordmark">BELL<b>O</b>WS</div>
        <p class="strap">
          A browser-native audio engine for synthesis, samples, sequencing, analysis, and I/O.
          One clock, one DSP kernel, seeded and reproducible everywhere.
        </p>
        <p class="strap dim">The name: a bellows is the air mover of the forge. Every forge needs one.</p>
        <div class="cta-row">
          <button class="lit big" @click="emit('go', 'bench')">OPEN THE WORKBENCH</button>
          <button class="big" @click="emit('go', 'code')">RUN THE EXAMPLES</button>
        </div>
      </div>
      <div class="hero-side">
        <div class="install" @click="copyInstall" :title="'copy'">
          <span class="prompt">$</span> npm install bellowsjs
          <span class="copy-note">{{ copied ? 'COPIED' : 'CLICK TO COPY' }}</span>
        </div>
        <div class="quick">
          <div class="quick-line">// tier 1: immediate</div>
          <div class="quick-code">import { play } from 'bellowsjs';<br />play('pluck', 'C4');</div>
        </div>
        <div class="linkrow">
          <a href="https://www.npmjs.com/package/bellowsjs" target="_blank" rel="noopener">NPM</a>
          <a href="https://github.com/virgilvox/bellowsjs" target="_blank" rel="noopener">GITHUB</a>
          <a href="https://github.com/virgilvox/bellowsjs/blob/main/docs/PRD.md" target="_blank" rel="noopener">PRD</a>
        </div>
      </div>
    </section>

    <section class="features">
      <div v-for="f in FEATURES" :key="f.num" class="panel feature">
        <div class="panel-title">{{ f.title }} <em>{{ f.num }}</em></div>
        <p>{{ f.body }}</p>
      </div>
    </section>

    <section class="panel sample">
      <div class="panel-title">the workbench tier <em>07</em></div>
      <pre><code>{{ CODE_SAMPLE }}</code></pre>
      <div class="sample-foot">
        Three tiers share one set of types: <span class="hot">play('pluck', 'C4')</span> up top,
        this workbench API in the middle, and raw sample-loop DSP contracts underneath.
        Custom engines and effects register by id and run in realtime and offline both.
      </div>
    </section>

    <section class="panel ship">
      <div class="panel-title">what ships <em>08</em></div>
      <div class="ship-cols">
        <div>
          <h3>Synthesis</h3>
          <p>PolyBLEP-class oscillators measured at -90 dB worst alias, ladder and SVF filters, FM algorithm routing, granular clouds, physical models, vactrol low-pass gates, vowel morphing.</p>
        </div>
        <div>
          <h3>Samples</h3>
          <p>SF2 with real generator resolution, the SFZ subset free libraries use, velocity layers, round robins, loop-seam crossfades.</p>
        </div>
        <div>
          <h3>Effects</h3>
          <p>Tape delay, FDN and Dattorro plate reverbs, lookahead compressor, true-peak limiter, parametric EQ, oversampled saturation, Hilbert frequency shifter, a full phase-vocoder spectral suite.</p>
        </div>
        <div>
          <h3>Analysis and I/O</h3>
          <p>YIN and MPM pitch, onset and tempo, chroma and key, EBU R128 loudness. WAV and MIDI files, Web MIDI with MPE, WebCodecs Opus export where available.</p>
        </div>
      </div>
      <div class="ship-foot">
        Over a thousand behavioral tests run in plain Node: filters by measured response, reverbs by decay
        time, whole pieces by golden-render diff. Apache-2.0.
      </div>
    </section>
  </div>
</template>

<style scoped>
.landing {
  display: flex;
  flex-direction: column;
}

.hero {
  display: grid;
  grid-template-columns: 1.4fr 1fr;
  gap: 28px;
  padding: 34px 30px;
  align-items: center;
}

@media (max-width: 900px) {
  .hero {
    grid-template-columns: 1fr;
  }
}

.wordmark {
  font-family: var(--disp);
  font-weight: 700;
  font-size: 64px;
  letter-spacing: 0.14em;
  line-height: 1;
  color: var(--bone);
}

.wordmark b {
  color: var(--phosphor);
}

.strap {
  margin-top: 16px;
  max-width: 560px;
  font-size: 14px;
  line-height: 1.6;
}

.strap.dim {
  color: var(--tick);
  font-size: 12px;
  margin-top: 8px;
}

.cta-row {
  display: flex;
  gap: 12px;
  margin-top: 24px;
  flex-wrap: wrap;
}

.cta-row .big {
  font-family: var(--disp);
  font-size: 13px;
  font-weight: 700;
  padding: 13px 20px;
}

.hero-side {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.install {
  font-size: 14px;
  background: var(--iron);
  border: 2px solid var(--seam);
  padding: 13px 14px;
  cursor: pointer;
  color: var(--bone);
  position: relative;
}

.install:hover {
  border-color: var(--phosphor);
}

.install .prompt {
  color: var(--phosphor);
  margin-right: 6px;
}

.copy-note {
  position: absolute;
  right: 10px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 9.5px;
  letter-spacing: 0.18em;
  color: var(--faded);
}

.quick {
  border: 1px dashed var(--seam);
  padding: 10px 12px;
}

.quick-line {
  font-size: 10px;
  color: var(--faded);
  margin-bottom: 4px;
}

.quick-code {
  font-size: 12px;
  color: var(--phosphor-hot);
  line-height: 1.6;
}

.linkrow {
  display: flex;
  gap: 8px;
}

.linkrow a {
  flex: 1;
  text-align: center;
  font-size: 10px;
  letter-spacing: 0.18em;
  text-decoration: none;
  color: var(--tick);
  border: 1px solid var(--seam);
  padding: 7px 4px;
  transition: color 0.12s, border-color 0.12s;
}

.linkrow a:hover {
  color: var(--phosphor);
  border-color: var(--phosphor);
}

.features {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
}

@media (max-width: 980px) {
  .features {
    grid-template-columns: 1fr;
  }
}

.feature p {
  font-size: 12px;
  line-height: 1.6;
  color: var(--bone);
}

.sample pre {
  background: var(--iron);
  border: 1px solid var(--seam);
  padding: 16px;
  overflow-x: auto;
  font-size: 12px;
  line-height: 1.65;
  color: var(--bone);
}

.sample code {
  font-family: var(--mono);
}

.sample-foot {
  margin-top: 10px;
  font-size: 11px;
  color: var(--tick);
  line-height: 1.6;
}

.sample-foot .hot {
  color: var(--phosphor);
}

.ship-cols {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 18px;
}

@media (max-width: 980px) {
  .ship-cols {
    grid-template-columns: 1fr 1fr;
  }
}

@media (max-width: 620px) {
  .ship-cols {
    grid-template-columns: 1fr;
  }
}

.ship-cols h3 {
  font-family: var(--disp);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--phosphor);
  margin-bottom: 6px;
}

.ship-cols p {
  font-size: 11px;
  line-height: 1.6;
  color: var(--bone);
}

.ship-foot {
  margin-top: 16px;
  border-top: 1px dashed var(--seam);
  padding-top: 10px;
  font-size: 11px;
  color: var(--tick);
}
</style>
