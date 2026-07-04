<script setup lang="ts">
/*
 * Grouped engine select: synth engines, drum engines, and any sample
 * banks activated in the workbench soundfont panel (reactive through
 * sfState). Selecting posts through the store, which swaps the channel.
 */

import { computed } from 'vue';
import {
  MELODIC_ENGINE_IDS,
  PERCUSSION_ENGINE_IDS,
  engineLabel,
  instState,
  isPercussion,
  setEngine,
} from '../../lib/instrument-store';
import { sampleEngineOptions, sfState } from '../../lib/soundfonts';

const synths = MELODIC_ENGINE_IDS.map((id) => ({ id, label: engineLabel(id) }));
const drums = PERCUSSION_ENGINE_IDS.map((id) => ({ id, label: engineLabel(id) }));

const samples = computed(() => {
  // touch sfState.active so the option list tracks bank activation
  void sfState.active.length;
  return sampleEngineOptions();
});

const isSampler = computed(() => instState.engineId.startsWith('sampler:'));

function onPick(e: Event): void {
  setEngine((e.target as HTMLSelectElement).value);
}
</script>

<template>
  <section class="panel picker">
    <div class="panel-title">engine <em>{{ engineLabel(instState.engineId) }}</em></div>
    <select :value="instState.engineId" @change="onPick">
      <optgroup label="SYNTHS">
        <option v-for="o in synths" :key="o.id" :value="o.id">{{ o.label }}</option>
      </optgroup>
      <optgroup label="DRUMS">
        <option v-for="o in drums" :key="o.id" :value="o.id">{{ o.label }}</option>
      </optgroup>
      <optgroup v-if="samples.length" label="SAMPLES">
        <option v-for="o in samples" :key="o.id" :value="o.id">{{ o.label }}</option>
      </optgroup>
    </select>
    <p v-if="isPercussion" class="hint">
      drum engine: every key fires the hit, pitched by the key you play.
    </p>
    <p v-else-if="isSampler" class="hint">
      sample bank: keys play the mapped zones, repitched between roots.
    </p>
    <p v-if="!samples.length" class="hint dim">
      no sample banks loaded yet: open the <a href="#bench">workbench</a> soundfont panel to add
      .sf2 presets or your own samples.
    </p>
  </section>
</template>

<style scoped>
.hint {
  margin-top: 8px;
  font-size: 10px;
  color: var(--tick);
  letter-spacing: 0.06em;
}

.hint.dim {
  color: var(--faded);
}

.hint a {
  color: var(--phosphor);
  text-decoration: none;
  border-bottom: 1px dotted var(--seam);
}
</style>
