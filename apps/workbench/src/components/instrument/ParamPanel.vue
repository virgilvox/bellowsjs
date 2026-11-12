<script setup lang="ts">
/*
 * Auto-generated parameter editor: one slider row per ParamSpec of the
 * current engine. Sliders run 0..1 and map through the spec curve ('exp'
 * gets a log scale, 'db' is linear in decibels). Posts coalesce to one
 * per frame per param inside the store.
 */

import { computed } from 'vue';
import {
  formatValue,
  fromSlider,
  instState,
  paramSpecsFor,
  resetParams,
  setParam,
  stepNamesFor,
  toSlider,
} from '../../lib/instrument-store';

const specs = computed(() => paramSpecsFor(instState.engineId));

function names(name: string): readonly string[] | null {
  return stepNamesFor(instState.engineId, name);
}

function onSlide(name: string, e: Event): void {
  const t = (e.target as HTMLInputElement).valueAsNumber;
  const spec = specs.value.find((s) => s.name === name);
  if (!spec) return;
  const v = fromSlider(spec, t);
  // a named param moves in whole steps, so the label always matches the sound
  setParam(name, names(name) ? Math.round(v) : v);
}
</script>

<template>
  <section class="panel">
    <div class="panel-title">
      parameters <em>{{ specs.length }}</em>
      <button class="reset" @click="resetParams">reset</button>
    </div>
    <div class="grid">
      <div v-for="spec in specs" :key="spec.name" class="field">
        <label>{{ spec.name }}</label>
        <div class="slider-row">
          <input
            type="range"
            min="0"
            max="1"
            step="0.001"
            :value="toSlider(spec, instState.params[spec.name] ?? spec.default)"
            @input="onSlide(spec.name, $event)"
          />
          <output>{{ formatValue(spec, instState.params[spec.name] ?? spec.default, names(spec.name)) }}</output>
        </div>
      </div>
    </div>
    <p v-if="!specs.length" class="empty">this engine has no editable parameters.</p>
  </section>
</template>

<style scoped>
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  column-gap: 16px;
}

.reset {
  font-size: 9px;
  padding: 3px 8px;
  box-shadow: none;
}

.empty {
  font-size: 11px;
  color: var(--faded);
}
</style>
