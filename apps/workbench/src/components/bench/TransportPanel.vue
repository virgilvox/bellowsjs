<script setup lang="ts">
import { bench, pressPlay, compose, toggleEvolve, panic } from '../../lib/bench-store';

function onSeedEnter(e: KeyboardEvent) {
  void compose(bench.seed);
  (e.target as HTMLInputElement | null)?.blur();
}
</script>

<template>
  <div class="panel">
    <div class="panel-title">transport <em>01</em></div>
    <div class="xport">
      <button class="big" :class="{ lit: bench.playing }" :disabled="bench.busy" @click="pressPlay()">
        {{ bench.busy ? 'FORGING' : bench.playing ? 'STOP' : 'PLAY' }}
      </button>
      <button class="big" :disabled="bench.busy" @click="compose()">COMPOSE</button>
    </div>
    <div class="field">
      <label for="seedInput">seed // enter to reforge</label>
      <input
        id="seedInput"
        v-model="bench.seed"
        type="text"
        spellcheck="false"
        autocomplete="off"
        @keydown.enter="onSeedEnter"
      />
    </div>
    <div class="duo">
      <button :class="{ lit: bench.evolve }" @click="toggleEvolve()">
        EVOLVE: {{ bench.evolve ? 'ON' : 'OFF' }}
      </button>
      <button @click="panic()">PANIC</button>
    </div>
    <div v-if="bench.error" class="err">FAULT // {{ bench.error }}</div>
  </div>
</template>

<style scoped>
.xport {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-bottom: 10px;
}

.xport .big {
  font-family: var(--disp);
  font-size: 13px;
  font-weight: 700;
  padding: 11px 8px;
}

.err {
  margin-top: 10px;
  font-size: 9px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--slag);
  word-break: break-word;
}
</style>
