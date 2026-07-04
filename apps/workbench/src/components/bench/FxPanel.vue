<script setup lang="ts">
import { bench, setDelayFx, setVerbFx, toggleComp } from '../../lib/bench-store';

function num(e: Event): number {
  return Number((e.target as HTMLInputElement).value);
}
</script>

<template>
  <div class="panel">
    <div class="panel-title">fx sends <em>04</em></div>
    <div class="field">
      <label for="dlyTime">delay time</label>
      <div class="slider-row">
        <input
          id="dlyTime"
          type="range"
          min="0.05"
          max="1.2"
          step="0.01"
          :value="bench.fx.delayTime"
          @input="setDelayFx(num($event), bench.fx.delayFb)"
        />
        <output>{{ bench.fx.delayTime.toFixed(2) }}s</output>
      </div>
    </div>
    <div class="field">
      <label for="dlyFb">delay feedback</label>
      <div class="slider-row">
        <input
          id="dlyFb"
          type="range"
          min="0"
          max="0.9"
          step="0.01"
          :value="bench.fx.delayFb"
          @input="setDelayFx(bench.fx.delayTime, num($event))"
        />
        <output>{{ Math.round(bench.fx.delayFb * 100) }}%</output>
      </div>
    </div>
    <div class="field">
      <label for="vrbSize">reverb size</label>
      <div class="slider-row">
        <input
          id="vrbSize"
          type="range"
          min="0.25"
          max="3"
          step="0.05"
          :value="bench.fx.verbSize"
          @input="setVerbFx(num($event), bench.fx.verbDecay)"
        />
        <output>{{ bench.fx.verbSize.toFixed(2) }}</output>
      </div>
    </div>
    <div class="field">
      <label for="vrbDecay">reverb decay</label>
      <div class="slider-row">
        <input
          id="vrbDecay"
          type="range"
          min="0.2"
          max="12"
          step="0.1"
          :value="bench.fx.verbDecay"
          @input="setVerbFx(bench.fx.verbSize, num($event))"
        />
        <output>{{ bench.fx.verbDecay.toFixed(1) }}s</output>
      </div>
    </div>
    <button class="comp-btn" :class="{ lit: bench.fx.comp }" @click="toggleComp()">
      MASTER COMP: {{ bench.fx.comp ? 'ON' : 'OFF' }}
    </button>
  </div>
</template>

<style scoped>
.comp-btn {
  width: 100%;
}
</style>
