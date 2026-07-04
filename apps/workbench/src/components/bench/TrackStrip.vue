<script setup lang="ts">
import { computed } from 'vue';
import { MELODIC_ENGINES, type MacroState, type TrackState } from '../../lib/composer';
import { sampleEngineOptions } from '../../lib/soundfonts';
import {
  bench,
  setPulses,
  setRot,
  setOct,
  setDensity,
  toggleMute,
  setLevel,
  setSendDelay,
  setSendVerb,
  setMacro,
  switchEngine,
} from '../../lib/bench-store';
import StepperField from './StepperField.vue';

const props = defineProps<{ track: TrackState }>();

// reads reactive sfState.active underneath, so activations refresh the list
const sampleOptions = computed(() => sampleEngineOptions());

function onEngine(e: Event) {
  switchEngine(props.track, (e.target as HTMLSelectElement).value);
}

function num(e: Event): number {
  return Number((e.target as HTMLInputElement).value);
}

function macroStep(m: MacroState): number {
  return (m.max - m.min) / 100;
}

function macroDisplay(m: MacroState): string {
  const span = m.max - m.min;
  if (span >= 100) return String(Math.round(m.value));
  if (span >= 10) return m.value.toFixed(1);
  return m.value.toFixed(2);
}
</script>

<template>
  <div class="strip" :class="{ armed: !track.mute, muted: track.mute }">
    <div class="strip-top">
      <span class="tname">{{ track.name }}</span>
      <select v-if="track.kind !== 'kit'" :value="track.engine" @change="onEngine">
        <optgroup label="BUILT-IN">
          <option v-for="[id, label] in MELODIC_ENGINES" :key="id" :value="id">{{ label }}</option>
        </optgroup>
        <optgroup v-if="sampleOptions.length" label="SAMPLES">
          <option v-for="o in sampleOptions" :key="o.id" :value="o.id">{{ o.label }}</option>
        </optgroup>
      </select>
      <select v-else disabled>
        <option>KICK+SNR+HAT</option>
      </select>
      <button class="mute-btn" :class="{ lit: track.mute }" @click="toggleMute(track)">MUTE</button>
    </div>

    <div class="lamps">
      <i
        v-for="i in 16"
        :key="i"
        class="lamp"
        :class="{
          on: !!track.pattern[i - 1],
          now: bench.playing && bench.readout.step === i - 1,
        }"
      ></i>
    </div>

    <div class="ctl-row">
      <StepperField label="HITS" :value="track.pulses" @change="setPulses(track, $event)" />
      <StepperField label="ROT" :value="track.rot" @change="setRot(track, $event)" />
      <StepperField
        v-if="track.kind === 'melodic'"
        label="OCT"
        :value="track.oct"
        @change="setOct(track, $event)"
      />
      <StepperField
        label="DENS"
        :value="Math.round(track.density * 100)"
        :step="5"
        :display="Math.round(track.density * 100) + '%'"
        @change="setDensity(track, $event)"
      />
      <div class="lvl-wrap">
        <label>LEVEL</label>
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          :value="track.level"
          @input="setLevel(track, num($event))"
        />
      </div>
    </div>

    <div class="aux-row">
      <div class="aux">
        <label>DLY SEND</label>
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          :value="track.sendDelay"
          @input="setSendDelay(track, num($event))"
        />
      </div>
      <div class="aux">
        <label>VRB SEND</label>
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          :value="track.sendVerb"
          @input="setSendVerb(track, num($event))"
        />
      </div>
      <div v-for="m in track.macros" :key="m.param + (m.target ?? '')" class="aux macro">
        <label>{{ m.label }} <b>{{ macroDisplay(m) }}</b></label>
        <input
          type="range"
          :min="m.min"
          :max="m.max"
          :step="macroStep(m)"
          :value="m.value"
          @input="setMacro(track, m, num($event))"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.strip {
  background: var(--char);
  border: 1px solid var(--seam);
  border-left: 3px solid var(--seam);
  padding: 9px 10px;
  margin-bottom: 9px;
  transition: border-color 0.15s;
}

.strip.armed {
  border-left-color: var(--phosphor);
}

.strip.muted {
  opacity: 0.45;
}

.strip-top {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  flex-wrap: wrap;
}

.tname {
  font-family: var(--disp);
  font-weight: 700;
  font-size: 12px;
  letter-spacing: 0.18em;
  color: var(--bone);
  width: 74px;
}

.strip-top select {
  width: auto;
  min-width: 104px;
  padding: 4px 6px;
  font-size: 10px;
  flex: 0 0 auto;
}

.mute-btn {
  padding: 4px 9px;
  font-size: 10px;
  box-shadow: none;
  margin-left: auto;
}

.mute-btn.lit {
  background: var(--slag);
  border-color: var(--slag);
  color: var(--lit-text);
}

.lamps {
  display: grid;
  grid-template-columns: repeat(16, 1fr);
  gap: 3px;
  margin-bottom: 8px;
}

.ctl-row {
  display: flex;
  gap: 10px;
  align-items: flex-end;
  flex-wrap: wrap;
  margin-bottom: 6px;
}

.lvl-wrap {
  flex: 1;
  min-width: 110px;
}

.lvl-wrap label,
.aux label {
  font-size: 9.5px;
  letter-spacing: 0.18em;
  color: var(--faded);
  text-transform: uppercase;
  display: block;
  margin-bottom: 1px;
}

.aux label b {
  color: var(--phosphor-hot);
  font-weight: 400;
  letter-spacing: 0.05em;
}

.aux-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(96px, 1fr));
  gap: 8px 10px;
}
</style>
