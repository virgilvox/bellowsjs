<script setup lang="ts">
/*
 * The beatbox controls: ready-made patterns, every sound to audition (clicking one plays it and adds it
 * to the pattern), and tempo, swing and how many times through.
 */

import { BEAT_PRESETS, VOCAL_BEATS } from 'bellows-voice';

export interface BeatState {
  pattern: string;
  bpm: number;
  swing: number;
  loops: number;
}

const beat = defineModel<BeatState>({ required: true });
const emit = defineEmits<{ try: [id: string] }>();

function usePreset(id: string): void {
  const p = BEAT_PRESETS.find((x) => x.id === id);
  if (p) beat.value = { ...beat.value, pattern: p.text, bpm: p.bpm, swing: p.swing };
}
function set<K extends keyof BeatState>(key: K, value: BeatState[K]): void {
  beat.value = { ...beat.value, [key]: value };
}
</script>

<template>
  <div class="beat-panel">
    <div class="examples">
      <span>Beats</span>
      <button v-for="p in BEAT_PRESETS" :key="p.id" class="link" @click="usePreset(p.id)">{{ p.name }}</button>
    </div>
    <div class="palette" aria-label="the sounds; click one to hear it and add it">
      <button v-for="bt in VOCAL_BEATS.filter((x) => x.id !== '.' && x.id !== 'in')" :key="bt.id" class="chip" :title="bt.hint + ' (' + bt.airstream + ')'" @click="emit('try', bt.id)">
        <b>{{ bt.id }}</b><span>{{ bt.name }}</span>
      </button>
      <p class="palette-note">One step a sixteenth: <code>.</code> rests, <code>|</code> marks a bar, <code>&gt;</code> accents, <code>m:43</code> hums MIDI note 43. Hover a sound for how the mouth makes it.</p>
    </div>
    <div class="settings">
      <label class="set">
        <span class="set-label">Tempo <output>{{ beat.bpm }} bpm</output></span>
        <input :value="beat.bpm" type="range" min="60" max="180" step="1" @input="set('bpm', ($event.target as HTMLInputElement).valueAsNumber)" />
      </label>
      <label class="set">
        <span class="set-label">Swing <output>{{ Math.round(beat.swing * 100) }}%</output></span>
        <input :value="beat.swing" type="range" min="0" max="0.6" step="0.01" @input="set('swing', ($event.target as HTMLInputElement).valueAsNumber)" />
      </label>
      <label class="set">
        <span class="set-label">Times through <output>{{ beat.loops }}</output></span>
        <input :value="beat.loops" type="range" min="1" max="8" step="1" @input="set('loops', ($event.target as HTMLInputElement).valueAsNumber)" />
      </label>
    </div>
  </div>
</template>
