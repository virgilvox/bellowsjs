<script setup lang="ts">
/*
 * The playable instrument. One gesture on START powers the audio graph;
 * after that the piano, the computer keys, and MIDI all press notes into
 * the shared store. The keystroke layer is active only while this view is
 * shown (it lives under a KeepAlive) and never fights text inputs.
 */

import { computed, onActivated, onBeforeUnmount, onDeactivated, onMounted } from 'vue';
import {
  boot,
  instState,
  legatoCapable,
  noteOff,
  noteOn,
  panic,
  setGain,
  setLegato,
  setOctave,
  setPan,
  setSustain,
  setVelocity,
} from '../lib/instrument-store';
import PianoKeyboard from '../components/instrument/PianoKeyboard.vue';
import LooperPanel from '../components/instrument/LooperPanel.vue';
import EnginePicker from '../components/instrument/EnginePicker.vue';
import ParamPanel from '../components/instrument/ParamPanel.vue';
import FxRack from '../components/instrument/FxRack.vue';
import MidiPanel from '../components/instrument/MidiPanel.vue';
import KeysHelp from '../components/instrument/KeysHelp.vue';

/* ableton-style note row: A=C4 upward, K and L continue into the next octave */
const KEY_OFFSETS: Record<string, number> = {
  KeyA: 0,
  KeyW: 1,
  KeyS: 2,
  KeyE: 3,
  KeyD: 4,
  KeyF: 5,
  KeyT: 6,
  KeyG: 7,
  KeyY: 8,
  KeyH: 9,
  KeyU: 10,
  KeyJ: 11,
  KeyK: 12,
  KeyL: 14,
};
const KB_BASE = 60; // C4 before octave shift

const heldCodes = new Set<string>();
let listening = false;

const canLegato = computed(() => legatoCapable(instState.engineId));

function inTextTarget(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  return (
    t instanceof HTMLInputElement ||
    t instanceof HTMLTextAreaElement ||
    t instanceof HTMLSelectElement ||
    t.isContentEditable
  );
}

function onKeyDown(e: KeyboardEvent): void {
  if (e.repeat || inTextTarget(e) || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.code === 'Space') {
    e.preventDefault();
    setSustain(true);
    return;
  }
  if (e.code === 'KeyZ') return setOctave(instState.octave - 1);
  if (e.code === 'KeyX') return setOctave(instState.octave + 1);
  if (e.code === 'KeyC') return setVelocity(instState.velocity - 0.1);
  if (e.code === 'KeyV') return setVelocity(instState.velocity + 0.1);
  const offset = KEY_OFFSETS[e.code];
  if (offset === undefined || heldCodes.has(e.code)) return;
  // keep keystrokes inside the 88-key piano so sound and lit keys agree
  const sounding = KB_BASE + offset + instState.octave * 12;
  if (sounding < 21 || sounding > 108) return;
  heldCodes.add(e.code);
  noteOn(KB_BASE + offset, instState.velocity, 'kb');
}

function onKeyUp(e: KeyboardEvent): void {
  if (e.code === 'Space') {
    setSustain(false);
    return;
  }
  const offset = KEY_OFFSETS[e.code];
  if (offset === undefined || !heldCodes.has(e.code)) return;
  heldCodes.delete(e.code);
  noteOff(KB_BASE + offset, 'kb');
}

function attach(): void {
  if (listening) return;
  listening = true;
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
}

function detach(): void {
  if (!listening) return;
  listening = false;
  window.removeEventListener('keydown', onKeyDown);
  window.removeEventListener('keyup', onKeyUp);
  for (const code of [...heldCodes]) {
    heldCodes.delete(code);
    const offset = KEY_OFFSETS[code];
    if (offset !== undefined) noteOff(KB_BASE + offset, 'kb');
  }
  setSustain(false);
}

onMounted(attach);
onActivated(attach);
onDeactivated(detach);
onBeforeUnmount(detach);

async function start(): Promise<void> {
  await boot();
}
</script>

<template>
  <div class="instrument">
    <div class="top">
      <EnginePicker class="engine" />
      <section class="panel master">
        <div class="panel-title">
          master
          <em><span class="lamp-dot" :class="{ hot: instState.voices > 0 }"></span>{{ instState.voices }} voices</em>
        </div>
        <div class="strip">
          <div class="field">
            <label>gain</label>
            <div class="slider-row">
              <input
                type="range"
                min="0"
                max="1.2"
                step="0.01"
                :value="instState.gain"
                @input="setGain(($event.target as HTMLInputElement).valueAsNumber)"
              />
              <output>{{ instState.gain.toFixed(2) }}</output>
            </div>
          </div>
          <div class="field">
            <label>pan</label>
            <div class="slider-row">
              <input
                type="range"
                min="-1"
                max="1"
                step="0.01"
                :value="instState.pan"
                @input="setPan(($event.target as HTMLInputElement).valueAsNumber)"
              />
              <output>{{ instState.pan.toFixed(2) }}</output>
            </div>
          </div>
          <div class="field oct">
            <label>octave</label>
            <div class="oct-row">
              <button @click="setOctave(instState.octave - 1)" :disabled="instState.octave <= -3">-</button>
              <output>{{ instState.octave > 0 ? '+' + instState.octave : instState.octave }}</output>
              <button @click="setOctave(instState.octave + 1)" :disabled="instState.octave >= 3">+</button>
            </div>
          </div>
          <div class="field vel">
            <label>velocity</label>
            <output class="vel-out">{{ Math.round(instState.velocity * 127) }}</output>
          </div>
          <div class="field sus">
            <label>sustain</label>
            <span class="lamp-dot" :class="{ hot: instState.sustain }"></span>
          </div>
          <div class="field legato-field">
            <label>legato</label>
            <button
              class="legato-btn"
              :class="{ lit: instState.legato }"
              :disabled="!canLegato"
              :title="
                canLegato
                  ? 'one bow: overlapping notes glide instead of re-attacking'
                  : 'legato needs a bowed string or blown tube engine'
              "
              @click="setLegato(!instState.legato)"
            >
              {{ instState.legato ? 'on' : 'off' }}
            </button>
          </div>
          <div class="field panic-field">
            <label>&nbsp;</label>
            <button class="panic" @click="panic">panic</button>
          </div>
        </div>
      </section>
    </div>

    <div class="kbd-wrap">
      <PianoKeyboard :class="{ dimmed: !instState.ready }" />
      <div v-if="!instState.ready" class="boot-overlay">
        <button class="lit start" :disabled="instState.booting" @click="start">
          {{ instState.booting ? 'powering...' : 'start' }}
        </button>
        <p>click to power the instrument</p>
      </div>
    </div>

    <LooperPanel />

    <div class="grid3">
      <ParamPanel />
      <FxRack />
      <div class="stack">
        <MidiPanel />
        <KeysHelp />
      </div>
    </div>
  </div>
</template>

<style scoped>
.top {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
  align-items: stretch;
}

.engine {
  flex: 1 1 240px;
  min-width: 240px;
}

.master {
  flex: 2 1 420px;
  min-width: 280px;
}

.strip {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
  align-items: flex-end;
}

.strip .field {
  margin-bottom: 0;
}

.strip .field:nth-child(1),
.strip .field:nth-child(2) {
  flex: 1 1 130px;
  min-width: 110px;
}

.oct-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.oct-row button {
  padding: 3px 9px;
  box-shadow: none;
}

.oct-row output,
.vel-out {
  font-size: 12px;
  color: var(--phosphor-hot);
  min-width: 24px;
  text-align: center;
}

.sus .lamp-dot {
  margin: 6px 0 4px;
}

.legato-btn {
  padding: 3px 12px;
  box-shadow: none;
}

.panic {
  border-color: var(--slag);
  color: var(--slag);
}

.panic:hover {
  border-color: var(--slag);
  color: var(--slag);
  box-shadow: 0 0 6px var(--slag-glow);
}

.kbd-wrap {
  position: relative;
  margin-bottom: 16px;
}

.dimmed {
  opacity: 0.45;
  pointer-events: none;
}

.boot-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  z-index: 5;
}

.boot-overlay::before {
  content: '';
  position: absolute;
  inset: 0;
  background: var(--forge);
  opacity: 0.55;
}

.boot-overlay .start {
  position: relative;
  font-family: var(--disp);
  font-size: 15px;
  padding: 12px 34px;
  box-shadow: 0 0 18px var(--phosphor-glow);
}

.boot-overlay p {
  position: relative;
  font-size: 10px;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--tick);
}

.grid3 {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 0 16px;
  align-items: start;
}

.stack {
  display: flex;
  flex-direction: column;
}
</style>
