<script setup lang="ts">
import { onActivated, onDeactivated, onMounted, onUnmounted } from 'vue';
import { bench, pressPlay, compose, drainReadout } from '../lib/bench-store';
import { PROG_BARS } from '../lib/composer';
import TransportPanel from '../components/bench/TransportPanel.vue';
import MoodPanel from '../components/bench/MoodPanel.vue';
import TuningPanel from '../components/bench/TuningPanel.vue';
import FxPanel from '../components/bench/FxPanel.vue';
import ExportPanel from '../components/bench/ExportPanel.vue';
import TrackStrip from '../components/bench/TrackStrip.vue';
import ScopePanel from '../components/bench/ScopePanel.vue';

let raf = 0;

function loop() {
  drainReadout();
  raf = requestAnimationFrame(loop);
}

function onKey(e: KeyboardEvent) {
  const tag = (e.target as HTMLElement | null)?.tagName?.toUpperCase() ?? '';
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
  if (e.code === 'Space') {
    e.preventDefault();
    void pressPlay();
  } else if (e.key === 'c' || e.key === 'C') {
    void compose();
  }
}

function start() {
  if (raf === 0) raf = requestAnimationFrame(loop);
  window.addEventListener('keydown', onKey);
}

function stop() {
  cancelAnimationFrame(raf);
  raf = 0;
  window.removeEventListener('keydown', onKey);
}

onMounted(start);
onActivated(start);
onDeactivated(stop);
onUnmounted(stop);
</script>

<template>
  <div class="deck">
    <div class="console">
      <TransportPanel />
      <MoodPanel />
      <TuningPanel />
      <FxPanel />
      <ExportPanel />
    </div>

    <div class="bench">
      <div class="panel">
        <div class="panel-title bench-head">
          <span>voice strips <em>06</em></span>
          <span class="chord-readout">{{ bench.readout.chord }}</span>
          <span class="bar-readout">
            BAR {{ (bench.readout.bar % PROG_BARS) + 1 }}/{{ PROG_BARS }} // PHRASE {{ bench.readout.phrase }}
          </span>
        </div>
        <TrackStrip v-for="t in bench.tracks" :key="t.id" :track="t" />
      </div>

      <ScopePanel />

      <div class="hints">
        <span><kbd>space</kbd> play <kbd>c</kbd> compose</span>
        <span class="badges"><span>SIX STRIPS</span><span>ONE CLOCK</span><span>SEEDED</span></span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.deck {
  display: grid;
  grid-template-columns: 288px 1fr;
  gap: 16px;
  align-items: start;
}

@media (max-width: 900px) {
  .deck {
    grid-template-columns: 1fr;
  }
}

.bench-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 8px;
}

.chord-readout {
  font-family: var(--disp);
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0.1em;
  color: var(--phosphor);
}

.bar-readout {
  font-size: 9px;
  color: var(--faded);
  letter-spacing: 0.16em;
}

.hints {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  font-size: 9px;
  color: var(--faded);
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.hints .badges span {
  border: 1px solid var(--seam);
  padding: 2px 6px;
  margin-left: 6px;
}
</style>
