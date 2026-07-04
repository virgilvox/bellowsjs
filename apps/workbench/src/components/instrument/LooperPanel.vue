<script setup lang="ts">
/*
 * Loop pedal plus session clips. The transport row drives the looper
 * store's private clock; below it a playhead lamp row and one step-grid
 * row per recorded layer. The store outlives this component (KeepAlive
 * navigation keeps a jam running), so everything here is a plain view
 * over looperState.
 */

import { computed } from 'vue';
import {
  clearLayers,
  deleteLayer,
  looperState,
  play,
  rec,
  setBars,
  setBpm,
  stop,
  toggleLayer,
  toggleMetronome,
  toggleQuantize,
} from '../../lib/looper-store';

const SIXTEENTH = 0.25;

const loopSteps = computed(() => looperState.bars * 16);

const stepsStyle = computed(() => ({
  gridTemplateColumns: 'repeat(' + loopSteps.value + ', minmax(12px, 1fr))',
  minWidth: loopSteps.value * 15 + 'px',
}));

const recStatus = computed(() => {
  if (looperState.recState === 'armed') return 'armed: recording starts at the loop top';
  if (looperState.recState === 'count') return 'count-in ' + (looperState.countBeat || 4) + ': recording next, early notes snap to the top';
  if (looperState.recState === 'recording') return 'recording: play now';
  return '';
});

const recLabel = computed(() => {
  if (looperState.recState === 'armed') return 'arm';
  if (looperState.recState === 'count') return String(looperState.countBeat || 4);
  return 'rec';
});

const posLabel = computed(() => {
  const bar = Math.floor(looperState.posStep / 16) + 1;
  const beat = Math.floor((looperState.posStep % 16) / 4) + 1;
  return bar + '.' + beat;
});

/** step buckets with at least one note start, per layer id */
const layerStepSets = computed(() => {
  const map = new Map<number, Set<number>>();
  for (const layer of looperState.layers) {
    const set = new Set<number>();
    for (const ev of layer.events) {
      set.add(Math.floor(ev.beat / SIXTEENTH + 1e-6) % loopSteps.value);
    }
    map.set(layer.id, set);
  }
  return map;
});

function hasStep(layerId: number, step: number): boolean {
  return layerStepSets.value.get(layerId)?.has(step) ?? false;
}

function onBarsPick(e: Event): void {
  setBars(Number((e.target as HTMLSelectElement).value));
}
</script>

<template>
  <section class="panel">
    <div class="panel-title">
      looper
      <em>{{ looperState.status || looperState.bars + ' bar / ' + loopSteps + ' step' }}</em>
    </div>

    <div class="transport">
      <button :class="{ lit: looperState.playing }" @click="looperState.playing ? stop() : play()">
        {{ looperState.playing ? 'stop' : 'play' }}
      </button>
      <button class="rec" :class="{ hot: looperState.recState !== 'idle' }" @click="rec">
        {{ recLabel }}
      </button>
      <div class="field bpm">
        <label>bpm</label>
        <div class="slider-row">
          <input
            type="range"
            min="60"
            max="180"
            step="1"
            :value="looperState.bpm"
            @input="setBpm(($event.target as HTMLInputElement).valueAsNumber)"
          />
          <output>{{ looperState.bpm }}</output>
        </div>
      </div>
      <div class="field bars">
        <label>bars</label>
        <select
          :value="String(looperState.bars)"
          :disabled="looperState.recState !== 'idle'"
          @change="onBarsPick"
        >
          <option value="1">1</option>
          <option value="2">2</option>
          <option value="4">4</option>
        </select>
      </div>
      <button :class="{ lit: looperState.metronome }" @click="toggleMetronome">metro</button>
      <button :class="{ lit: looperState.quantize }" @click="toggleQuantize">quant</button>
      <button :disabled="!looperState.layers.length" @click="clearLayers">clear all</button>
    </div>

    <p v-if="recStatus" class="rec-status" :class="{ live: looperState.recState === 'recording' }">{{ recStatus }}</p>

    <div class="row head-row">
      <div class="row-head">
        <span class="pos-label">{{ looperState.playing ? posLabel : 'pos' }}</span>
      </div>
      <div class="grid-scroll">
        <div class="steps" :style="stepsStyle">
          <div
            v-for="i in loopSteps"
            :key="i"
            class="lamp"
            :class="{ q: (i - 1) % 4 === 0, now: looperState.playing && looperState.posStep === i - 1 }"
          ></div>
        </div>
      </div>
      <div></div>
    </div>

    <div v-for="layer in looperState.layers" :key="layer.id" class="row">
      <div class="row-head">
        <button class="on-btn" :title="layer.on ? 'mute' : 'unmute'" @click="toggleLayer(layer)">
          <span class="lamp-dot" :class="{ hot: layer.on }"></span>
        </button>
        <span class="lname">{{ layer.name }}</span>
      </div>
      <div class="grid-scroll">
        <div class="steps" :class="{ muted: !layer.on }" :style="stepsStyle">
          <div
            v-for="i in loopSteps"
            :key="i"
            class="lamp"
            :class="{
              on: hasStep(layer.id, i - 1),
              now: layer.on && looperState.playing && looperState.posStep === i - 1 && hasStep(layer.id, i - 1),
            }"
          ></div>
        </div>
      </div>
      <button class="del" @click="deleteLayer(layer.id)">del</button>
    </div>

    <p v-if="!looperState.layers.length" class="note">press rec, play something, it loops</p>
    <p class="note">each take remembers its instrument. switch engines between takes to build a band.</p>
  </section>
</template>

<style scoped>
.transport {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  align-items: flex-end;
  margin-bottom: 12px;
}

.transport .field {
  margin-bottom: 0;
}

.transport > button {
  min-width: 58px;
}

.rec.hot {
  background: var(--slag);
  border-color: var(--slag);
  color: var(--lit-text);
  font-weight: 700;
  box-shadow: 0 0 9px var(--slag-glow);
}

.rec.hot:hover {
  border-color: var(--slag);
  color: var(--lit-text);
}

.bpm {
  flex: 1 1 170px;
  min-width: 150px;
}

.bars select {
  width: 64px;
}

.row {
  display: grid;
  grid-template-columns: 128px minmax(0, 1fr) 46px;
  gap: 8px;
  align-items: center;
  margin-bottom: 6px;
}

.row-head {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.rec-status {
  font-size: 10.5px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--tick);
  margin: 2px 0 8px;
}

.rec-status.live {
  color: var(--slag);
  font-weight: 700;
}

.pos-label {
  font-size: 10px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--tick);
}

.grid-scroll {
  overflow-x: auto;
}

.steps {
  display: grid;
  gap: 3px;
}

.steps .lamp.q {
  border-color: var(--faded);
}

/* recorded steps must read at a glance in both themes: the shared
   .lamp.on dim wash is too subtle over --iron in daylight */
.steps .lamp.on {
  background: var(--phosphor);
  opacity: 0.55;
  border-color: var(--phosphor);
}

.steps .lamp.now {
  opacity: 1;
}

/* an off layer shows its pattern as ghosts */
.steps.muted .lamp.on {
  background: var(--phosphor-ghost);
  opacity: 1;
  border-color: var(--seam);
}

.on-btn {
  padding: 3px 6px;
  box-shadow: none;
}

.on-btn .lamp-dot {
  margin-right: 0;
}

.lname {
  font-size: 10px;
  letter-spacing: 0.08em;
  color: var(--phosphor-hot);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.del {
  padding: 4px 6px;
  box-shadow: none;
  border-color: var(--seam);
  color: var(--faded);
}

.del:hover {
  border-color: var(--slag);
  color: var(--slag);
}

.note {
  font-size: 10px;
  color: var(--faded);
  letter-spacing: 0.05em;
  margin-top: 8px;
}
</style>
