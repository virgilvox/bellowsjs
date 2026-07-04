<script setup lang="ts">
/*
 * Insert chain editor. The kernel replaces the whole chain on any add or
 * remove (inst.fx() is a full swap), so those go through the store's
 * rebuild; per-param tweaks flow through fxParam without a rebuild.
 */

import { computed } from 'vue';
import { listEffects, type ParamSpec } from 'bellowsjs';
import {
  addFx,
  formatValue,
  fromSlider,
  instState,
  removeFx,
  setFxParam,
  toSlider,
} from '../../lib/instrument-store';

const effectDefs = listEffects();

const options = computed(() =>
  effectDefs.map((e) => ({ id: e.id, label: e.label })).sort((a, b) => a.label.localeCompare(b.label)),
);

function specsFor(effectId: string): ParamSpec[] {
  return effectDefs.find((e) => e.id === effectId)?.params ?? [];
}

function labelFor(effectId: string): string {
  return effectDefs.find((e) => e.id === effectId)?.label ?? effectId;
}

function onAdd(e: Event): void {
  const sel = e.target as HTMLSelectElement;
  if (sel.value) addFx(sel.value);
  sel.value = '';
}

function onSlide(index: number, spec: ParamSpec, e: Event): void {
  const t = (e.target as HTMLInputElement).valueAsNumber;
  setFxParam(index, spec.name, fromSlider(spec, t));
}
</script>

<template>
  <section class="panel">
    <div class="panel-title">effects <em>{{ instState.fx.length }} in chain</em></div>

    <div v-for="(slot, i) in instState.fx" :key="i + ':' + slot.effectId" class="card">
      <div class="card-head">
        <span class="fx-name">{{ i + 1 }}. {{ labelFor(slot.effectId) }}</span>
        <button class="rm" @click="removeFx(i)" title="remove effect">X</button>
      </div>
      <div class="mini-grid">
        <div v-for="spec in specsFor(slot.effectId)" :key="spec.name" class="mini">
          <label>{{ spec.name }}</label>
          <div class="mini-row">
            <input
              type="range"
              min="0"
              max="1"
              step="0.001"
              :value="toSlider(spec, slot.params[spec.name] ?? spec.default)"
              @input="onSlide(i, spec, $event)"
            />
            <output>{{ formatValue(spec, slot.params[spec.name] ?? spec.default) }}</output>
          </div>
        </div>
      </div>
    </div>

    <p v-if="!instState.fx.length" class="empty">dry signal. add an effect below.</p>

    <div class="field add">
      <label>add effect</label>
      <select @change="onAdd">
        <option value="">select an effect...</option>
        <option v-for="o in options" :key="o.id" :value="o.id">{{ o.label }}</option>
      </select>
    </div>
  </section>
</template>

<style scoped>
.card {
  border: 1px solid var(--seam);
  background: var(--char);
  padding: 8px;
  margin-bottom: 10px;
}

.card-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}

.fx-name {
  font-family: var(--disp);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--phosphor-hot);
}

.rm {
  padding: 1px 7px;
  font-size: 10px;
  box-shadow: none;
}

.mini-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  column-gap: 12px;
}

.mini label {
  display: block;
  font-size: 9px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--tick);
}

.mini-row {
  display: grid;
  grid-template-columns: 1fr 52px;
  gap: 6px;
  align-items: center;
}

.mini-row input[type='range'] {
  height: 16px;
}

.mini-row output {
  font-size: 9px;
  color: var(--phosphor-hot);
  text-align: right;
}

.empty {
  font-size: 11px;
  color: var(--faded);
  margin-bottom: 10px;
}

.add {
  margin-bottom: 0;
}
</style>
