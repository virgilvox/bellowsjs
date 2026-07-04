<script setup lang="ts">
import { SCALES } from 'bellowsjs';
import {
  bench,
  NOTE_NAMES,
  TUNING_SYSTEMS,
  setRoot,
  setScaleName,
  setBpm,
  setSwing,
  setMaster,
  setTuningSystem,
  type TuningSystemId,
} from '../../lib/bench-store';

const scaleNames = Object.keys(SCALES).filter((n) => n !== 'ionian' && n !== 'aeolian');

function num(e: Event): number {
  return Number((e.target as HTMLInputElement).value);
}
</script>

<template>
  <div class="panel">
    <div class="panel-title">tuning <em>03</em></div>
    <div class="duo" style="margin-bottom: 10px">
      <div class="field" style="margin: 0">
        <label for="rootSel">root</label>
        <select id="rootSel" :value="bench.root" @change="setRoot(num($event))">
          <option v-for="(n, i) in NOTE_NAMES" :key="n" :value="i">{{ n }}</option>
        </select>
      </div>
      <div class="field" style="margin: 0">
        <label for="scaleSel">scale</label>
        <select
          id="scaleSel"
          :value="bench.scaleName"
          @change="setScaleName(($event.target as HTMLSelectElement).value)"
        >
          <option v-for="n in scaleNames" :key="n" :value="n">{{ n }}</option>
        </select>
      </div>
    </div>
    <div class="field">
      <label for="tuneSel">tuning system</label>
      <select
        id="tuneSel"
        :value="bench.tuningSystem"
        @change="setTuningSystem(($event.target as HTMLSelectElement).value as TuningSystemId)"
      >
        <option v-for="t in TUNING_SYSTEMS" :key="t.id" :value="t.id">{{ t.label }}</option>
      </select>
    </div>
    <div class="field">
      <label for="bpmRange">tempo</label>
      <div class="slider-row">
        <input id="bpmRange" type="range" min="52" max="160" :value="bench.bpm" @input="setBpm(num($event))" />
        <output>{{ bench.bpm }}</output>
      </div>
    </div>
    <div class="field">
      <label for="swingRange">swing</label>
      <div class="slider-row">
        <input id="swingRange" type="range" min="0" max="60" :value="bench.swing" @input="setSwing(num($event))" />
        <output>{{ bench.swing }}%</output>
      </div>
    </div>
    <div class="field" style="margin: 0">
      <label for="masterRange">master</label>
      <div class="slider-row">
        <input id="masterRange" type="range" min="0" max="100" :value="bench.master" @input="setMaster(num($event))" />
        <output>{{ bench.master }}</output>
      </div>
    </div>
  </div>
</template>
