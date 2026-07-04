<script setup lang="ts">
import { ref } from 'vue';

const emit = defineEmits<{ (e: 'go', mode: 'bench' | 'code' | 'play'): void }>();

const copiedInstall = ref(false);
const copiedHtml = ref(false);

const HTML_EXAMPLE = `<!DOCTYPE html>
<html>
<body>
  <button id="go">play a note</button>
  <script type="module">
    import { play } from 'https://unpkg.com/bellowsjs/dist/bellows.js';
    document.querySelector('#go').onclick = () => play('pluck', 'C4');
  <\/script>
</body>
</html>`;

async function copy(text: string, flag: typeof copiedInstall) {
  try {
    await navigator.clipboard.writeText(text);
    flag.value = true;
    setTimeout(() => (flag.value = false), 1600);
  } catch {
    // clipboard may be unavailable; the text is right there anyway
  }
}

// template refs auto-unwrap, so pass the Ref from script scope
const copyInstall = () => copy('npm install bellowsjs', copiedInstall);
const copyHtml = () => copy(HTML_EXAMPLE, copiedHtml);

const SIMPLE = [
  {
    num: '01',
    title: 'Play instruments',
    body: '18 built-in synthesizers: pianos that pluck, basses that growl, bells, drums, voices, textures. Try them on the Instrument page with your mouse, keyboard, or a MIDI controller.',
  },
  {
    num: '02',
    title: 'Make music that writes itself',
    body: 'Turn a seed word into a whole piece: beats, basslines, melodies, and chords that follow real music theory. Same seed, same song, every time.',
  },
  {
    num: '03',
    title: 'Bring your own sounds',
    body: 'Load SoundFont files (the free instrument banks used by musicians everywhere) or drop in your own audio samples and play them across the keyboard.',
  },
  {
    num: '04',
    title: 'Keep what you make',
    body: 'Record any piece to a WAV file, right in the browser. No account, no upload, no build tools. It is a free, open source library you can use in your own pages too.',
  },
];
</script>

<template>
  <div class="landing">
    <section class="hero panel">
      <div class="hero-main">
        <div class="wordmark">BELL<b>O</b>WS</div>
        <p class="strap">Make music in your browser.</p>
        <p class="strap sub">
          BELLOWS is a free, open source audio engine that runs entirely in a web page:
          synthesizers, drum machines, samplers, effects, and a sequencer in one small library.
        </p>
        <div class="cta-row">
          <button class="lit big" @click="emit('go', 'play')">PLAY THE INSTRUMENT</button>
          <button class="big" @click="emit('go', 'bench')">OPEN THE WORKBENCH</button>
          <button class="big" @click="emit('go', 'code')">SEE THE CODE</button>
        </div>
      </div>
      <div class="hero-side">
        <div class="install" @click="copyInstall()">
          <span class="prompt">$</span> npm install bellowsjs
          <span class="copy-note">{{ copiedInstall ? 'COPIED' : 'CLICK TO COPY' }}</span>
        </div>
        <div class="linkrow">
          <a href="https://www.npmjs.com/package/bellowsjs" target="_blank" rel="noopener">NPM</a>
          <a href="https://github.com/virgilvox/bellowsjs" target="_blank" rel="noopener">GITHUB</a>
        </div>
      </div>
    </section>

    <section class="features">
      <div v-for="f in SIMPLE" :key="f.num" class="panel feature">
        <div class="panel-title">{{ f.title }} <em>{{ f.num }}</em></div>
        <p>{{ f.body }}</p>
      </div>
    </section>

    <section class="panel htmlbox">
      <div class="panel-title">
        a whole instrument in one html file <em>05</em>
        <button class="copy-btn" @click="copyHtml()">
          {{ copiedHtml ? 'COPIED' : 'COPY' }}
        </button>
      </div>
      <p class="lead">
        Save this as a .html file, open it, click the button. That is the whole setup:
        the library loads from a CDN, no install, no build step.
      </p>
      <pre><code>{{ HTML_EXAMPLE }}</code></pre>
    </section>

    <section class="panel usage">
      <div class="panel-title">use it your way <em>06</em></div>
      <div class="usage-cols">
        <div>
          <h3>In a web page</h3>
          <p class="usage-note">One script tag from a CDN, like the example above. unpkg and jsdelivr both serve it.</p>
          <pre><code>import { play } from
'https://unpkg.com/bellowsjs/dist/bellows.js';</code></pre>
        </div>
        <div>
          <h3>In an app (Vite, webpack)</h3>
          <p class="usage-note">Install from npm and import what you need. Unused parts stay out of your bundle.</p>
          <pre><code>npm install bellowsjs

import { Bellows } from 'bellowsjs';
const b = await Bellows.boot();</code></pre>
        </div>
        <div>
          <h3>In Node (no browser)</h3>
          <p class="usage-note">The sound engine also runs offline: render songs to WAV files in scripts or on a server.</p>
          <pre><code>import { registerBuiltins, renderOffline,
  encodeWav } from 'bellowsjs';</code></pre>
        </div>
      </div>
    </section>

    <details class="panel deep">
      <summary class="panel-title deep-title">under the hood, for the curious <em>07</em></summary>
      <div class="deep-body">
        <ul>
          <li>One clock, one DSP kernel in an AudioWorklet. Events land sample-accurately on the audio thread, so timing survives a busy tab.</li>
          <li>Every random decision flows from named, seeded streams. A seed fully determines a piece, forever.</li>
          <li>Offline rendering runs the same kernel as live playback and produces identical output, which is also the test strategy: over a thousand behavioral tests run in plain Node, including golden-render diffs.</li>
          <li>Synthesis: virtual analog (about -90 dB worst alias), FM with DX-style algorithms, additive, wavetable, granular, physical models, west coast, formant, drums, harmonic-plus-noise.</li>
          <li>Samples: SF2 with real generator resolution, the SFZ subset free libraries use, velocity layers, round robins.</li>
          <li>Theory with any tuning: 30 plus scales, roman numerals, voice leading, negative harmony, any EDO, just intonation, Scala files.</li>
          <li>Effects and analysis: tape delay, FDN and plate reverbs, compressor, limiter, EQ, spectral suite; pitch tracking, onset detection, key estimation, EBU R128 loudness.</li>
        </ul>
        <pre><code>const b = await Bellows.boot({ seed: 'forge-01' });
const lead = b.voice('fm', { algorithm: 3 });
lead.fx('tapeDelay');
const rhythm = b.euclid(16, 7, 2);
b.clock.at('16n', (t, step) => {
  if (rhythm[step % 16]) lead.note('D4', { at: t, dur: '16n' });
});
b.start();
const wav = (await b.render({ bars: 8 })).wav(24); // same piece, offline</code></pre>
      </div>
    </details>
  </div>
</template>

<style scoped>
.landing {
  display: flex;
  flex-direction: column;
}

.hero {
  display: grid;
  grid-template-columns: 1.5fr 1fr;
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
  font-family: var(--disp);
  font-size: 22px;
  font-weight: 600;
  color: var(--bone);
}

.strap.sub {
  font-family: var(--mono);
  font-size: 13px;
  font-weight: 400;
  color: var(--tick);
  max-width: 540px;
  line-height: 1.6;
  margin-top: 10px;
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
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
}

@media (max-width: 760px) {
  .features {
    grid-template-columns: 1fr;
  }
}

.feature p {
  font-size: 12.5px;
  line-height: 1.65;
  color: var(--bone);
}

.htmlbox .lead {
  font-size: 12px;
  color: var(--tick);
  line-height: 1.6;
  margin-bottom: 10px;
}

.htmlbox pre,
.usage-cols pre,
.deep-body pre {
  background: var(--iron);
  border: 1px solid var(--seam);
  padding: 12px 14px;
  overflow-x: auto;
  font-size: 12px;
  line-height: 1.65;
  color: var(--bone);
}

.copy-btn {
  box-shadow: none;
  padding: 3px 10px;
  font-size: 9.5px;
}

.usage-cols {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 18px;
}

@media (max-width: 980px) {
  .usage-cols {
    grid-template-columns: 1fr;
  }
}

.usage-cols h3 {
  font-family: var(--disp);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--phosphor);
  margin-bottom: 6px;
}

.usage-note {
  font-size: 11.5px;
  color: var(--tick);
  line-height: 1.55;
  margin-bottom: 8px;
  min-height: 2.6em;
}

.usage-cols pre {
  font-size: 10.5px;
}

.deep summary {
  cursor: pointer;
  list-style: none;
}

.deep summary::-webkit-details-marker {
  display: none;
}

.deep-title::after {
  content: '+ EXPAND';
  font-size: 9.5px;
  color: var(--faded);
  letter-spacing: 0.18em;
}

.deep[open] .deep-title::after {
  content: '- COLLAPSE';
}

.deep-body {
  margin-top: 10px;
}

.deep-body ul {
  list-style: none;
  margin-bottom: 12px;
}

.deep-body li {
  font-size: 11.5px;
  line-height: 1.7;
  color: var(--bone);
  padding-left: 14px;
  position: relative;
}

.deep-body li::before {
  content: '//';
  position: absolute;
  left: 0;
  color: var(--phosphor);
}
</style>
